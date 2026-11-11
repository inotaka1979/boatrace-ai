// boatrace-sentinel — 本体 Worker (boatrace-scrape-trigger) の外形監視・自己復旧
//
// 背景 (2026-11-11):
//   監視と自己復旧は GitHub Actions の schedule (worker-watchdog.yml 毎時 / data-freshness-monitor.yml
//   5 分) に載っていたが、本リポジトリでは schedule が 1 workflow あたり 1-2 回/日まで間引かれ、
//   実質機能していなかった (実測 11/8-11/11)。本体の cron 停止は 9/21-10/17 に 15 回起きている。
//   Cloudflare の Cron Triggers は間引かれないので、監視を Cloudflare 側に置く。
//
// 動作 (5 分毎):
//   1. 本体 /health?strict=1&max_age_sec=<JST 時間帯別閾値> を叩く
//   2. 200 → 正常。障害中だったなら issue を閉じ、状態をリセット
//   3. 非 200 → /api/refresh-now (TRIGGER_SECRET 提示) でデータを自己修復させる
//      連続 FAIL_THRESHOLD 回 (既定 3 = 15 分) で「障害」:
//        - reason が cron_heartbeat_stale/_missing かつ本体が応答している
//          → deploy-worker.yml を dispatch して cron trigger を再登録 (REDEPLOY_COOLDOWN_SEC に 1 回)
//        - issue (label ISSUE_LABEL) を起票。継続中は ISSUE_COMMENT_INTERVAL_SEC 毎に経過を追記
//   GitHub 操作は secret GH_TOKEN がある時だけ。無くても監視 + refresh-now は動く。
//
// 手動設定 (secret) は不要 (2026-11-11 追記):
//   GH_TOKEN / TRIGGER_SECRET が無くても、本体 cron が止まった時は sentinel が 5 分毎に
//   refresh-now を叩く「予備の cron」として働き、データ鮮度を保つ。主 cron の再登録
//   (再デプロイ) と issue 起票は GitHub 側 worker-watchdog.yml が組込みトークンで行う
//   (schedule 間引きのため最大 1 日程度遅れるが、その間もデータは更新され続ける)。
//   GH_TOKEN を入れると再デプロイ / issue が 15 分に短縮されるだけ = 任意。
//
// 自己観測:
//   - cron_last_at: sentinel 自身の cron が走った時刻。KV 書込は 1 時間に 1 回 + デプロイ直後の
//     初回 tick だけ (BUILD_ID が変わったら即記録)。worker-watchdog.yml と deploy-worker.yml が
//     /status 経由で「監視役が生きているか」を確認する。
//   - history: 本体 strict health が失敗していた区間 (streak) を直近 10 件まで記録する。
//     開始時の heartbeat 経過秒・データキーの鮮度・refresh-now の成否を残し、
//     「cron だけ止まったのか、データ更新ごと止まったのか」を後から判別できるようにする。
//
// KV 書込 (本体と namespace 共用、無料枠 1,000 writes/日):
//   正常時は生存記録の 24 回/日だけ。失敗区間中は tick 毎に状態を保存するが、1 UTC 日あたり
//   DAILY_WRITE_BUDGET 回を超えたら「必須の保存」(状態遷移・GitHub 側の副作用・生存記録) だけに
//   絞る。refresh-now (予備 cron) は KV に依らず毎 tick 続く。
//
// エンドポイント:
//   GET /health   — sentinel 自身の疎通
//   GET /status   — 保存状態 + sentinel_cron + 本体 /health の probe (書込なし、probe は 30 秒メモ)
//   GET /run?secret=<TRIGGER_SECRET> — cron を待たず 1 回検査 (secret 設定時のみ)

const STATE_KEY = 'sentinel:state';
const UA = 'boatrace-sentinel (+https://github.com/inotaka1979/boatrace-ai)';

// 失敗区間 (streak) の履歴保持数。
const HISTORY_MAX = 10;
// sentinel 自身の cron 生存記録 (cron_last_at) を KV に書く最小間隔。
//   毎 tick 書くと 288 回/日で、本体と共用の無料枠 (1000 writes/日) を圧迫するため 1 時間に 1 回。
export const LIVENESS_WRITE_INTERVAL_SEC = 3600;
// sentinel の cron 周期 (wrangler.toml の crons = "*/5 * * * *" と一致させる)。
const TICK_SEC = 300;
// 1 UTC 日 (= KV 無料枠の集計単位) あたりの KV 書込予算。
//   失敗区間中は tick 毎に状態 (連続失敗数 / refresh-now の成否) を保存するので、本体 cron が
//   丸 1 日止まると 288 回書くことになる。KV 無料枠 (1,000 writes/日) は本体と共用で、本体は
//   平常時に約 700 回/日使う。障害日に sentinel が枠を押し上げて本体の書込を失敗させたら
//   本末転倒なので、予算を超えたら必須の保存だけに絞る (120 = 10 時間分の tick)。
//   絞っている間に記録できなかった tick は streak.unrecorded_ticks に数える。
export const DAILY_WRITE_BUDGET = 120;
// refresh-now が 429 (未認証 throttle) の時、残りがこの秒数以内なら待って 1 回だけ再試行する。
//   本体の throttle (5 分) と sentinel の周期 (5 分) が同値のため、数秒の揺らぎで 429 になり得る。
const REFRESH_RETRY_MAX_WAIT_SEC = 30;
// /status の本体 probe を isolate 内でメモする時間。公開エンドポイントの連打で本体 /health
//   (KV read 4 回) を増幅させない。
const STATUS_PROBE_TTL_MS = 30000;

// 本体 cron: JST 08:00-22:55 は 5 分毎、23:00-07:30 は 30 分毎。
//   日中は 4 tick 欠落 (20 分) で stale、夜間は 45 分。
const MAX_AGE_DAY_SEC = 1200;
const MAX_AGE_NIGHT_SEC = 2700;
// 朝の切替直後は日中閾値を使わない。08:00 の時点で最後の heartbeat は 07:30 の夜間 tick
//   (30 分前) のままなのが正常で、本体の 08:00 tick が heartbeat を書くのは発火の約 10 秒後。
//   同じ分境界で走る sentinel の probe はそれに間に合わないため、08:00 から日中閾値にすると
//   毎朝 1 回、必ず誤検知する。08:20 までは夜間閾値で見る (07:30 から 45 分 = 08:15 に検知できる)。
const DAY_THRESHOLD_FROM_MIN = 8 * 60 + 20;
const DAY_THRESHOLD_UNTIL_MIN = 23 * 60;
const CRON_DEAD_REASONS = new Set(['cron_heartbeat_stale', 'cron_heartbeat_missing']);

export function maxAgeSecFor(now) {
  const m = ((now.getUTCHours() + 9) % 24) * 60 + now.getUTCMinutes();
  return m >= DAY_THRESHOLD_FROM_MIN && m < DAY_THRESHOLD_UNTIL_MIN ? MAX_AGE_DAY_SEC : MAX_AGE_NIGHT_SEC;
}

function intVar(env, name, dflt) {
  const v = parseInt(env && env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

function emptyState() {
  return {
    consecutive_failures: 0,
    incident: null, // { opened_at, issue_number, last_comment_at, first_reason }
    last_redeploy_at: null,
    last_transition_at: null,
    last_action: null,
    cron_last_at: null, // sentinel の cron が最後に走った時刻 (KV 書込は ≤1 回/時 + デプロイ直後)
    build: null, // cron_last_at を記録した時の BUILD_ID
    // 進行中の失敗区間
    //   { started_at, last_tick_at, reason, cron_age_sec, data, refresh:{ok,throttled,failed}, unrecorded_ticks }
    streak: null,
    history: [], // 直近 HISTORY_MAX 件の失敗区間 (復旧時に確定)
    writes: null, // { day: 'YYYY-MM-DD' (UTC), n } — sentinel がその日に行った KV 書込回数
  };
}

async function loadState(env) {
  try {
    const raw = await env.BOATRACE_KV.get(STATE_KEY);
    if (!raw) return emptyState();
    const s = Object.assign(emptyState(), JSON.parse(raw));
    if (!Array.isArray(s.history)) s.history = [];
    return s;
  } catch (_) {
    return emptyState();
  }
}

async function saveState(env, state) {
  try {
    await env.BOATRACE_KV.put(STATE_KEY, JSON.stringify(state));
    return true;
  } catch (_) {
    /* KV 障害 (無料枠の枯渇を含む) 時も監視と refresh-now は続ける */
    return false;
  }
}

// その日 (UTC) の書込カウンタ。日付が変わっていたら 0 に戻す。
function writeBudget(state, now) {
  const day = now.toISOString().slice(0, 10);
  if (!state.writes || state.writes.day !== day) state.writes = { day, n: 0 };
  return state.writes;
}

// 状態を保存する。essential でない保存 (失敗 tick のカウンタ更新) は 1 日の予算内でだけ行う。
async function persist(env, state, now, essential) {
  const w = writeBudget(state, now);
  if (!essential && w.n >= DAILY_WRITE_BUDGET) return false;
  w.n += 1;
  return saveState(env, state);
}

// 前回記録した tick から今回までに、記録できなかった tick が何回あったか。
//   原因は書込予算の超過・KV 書込の失敗・sentinel 自身の cron 欠落のいずれか。
function missedTicks(streak, now) {
  const last = Date.parse(streak && streak.last_tick_at);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, Math.round((now.getTime() - last) / (TICK_SEC * 1000)) - 1);
}

// --- 本体への fetch ----------------------------------------------------------
// 2026-11-11 初回デプロイで判明: Worker から同一アカウントの *.workers.dev を公開 URL で fetch
//   すると Cloudflare が 404 を返す (Worker→Worker の同一ゾーン fetch は非対応、error 1042)。
//   /status の main_probe が http=404 / worker_alive=true になっていた。
//   → wrangler.toml の [[services]] で本体を MAIN にバインドし、env.MAIN.fetch() で呼ぶ。
//   URL は path / query だけが使われる (host は無視)。バインドが無い環境 (テスト) では
//   fetchImpl にフォールバックする。
function mainFetch(env, fetchImpl, url, init) {
  if (env.MAIN && typeof env.MAIN.fetch === 'function') {
    return env.MAIN.fetch(new Request(url, init));
  }
  return fetchImpl(url, init);
}

// 本体 /health の keys から、頻繁に更新される 2 キーの鮮度だけを抜き出す (履歴用)。
function summarizeKeys(body) {
  const keys = body && body.keys;
  if (!keys || typeof keys !== 'object') return null;
  const out = {};
  for (const k of ['previews', 'results']) {
    const v = keys[k];
    if (v && typeof v === 'object') {
      out[k] = { age_sec: typeof v.age_sec === 'number' ? v.age_sec : null, src: v.src || null };
    }
  }
  return Object.keys(out).length ? out : null;
}

// --- 本体 probe ------------------------------------------------------------
export async function probeHealth(env, now, fetchImpl) {
  const base = env.MAIN_BASE;
  const url = `${base}/health?strict=1&max_age_sec=${maxAgeSecFor(now)}`;
  try {
    const r = await mainFetch(env, fetchImpl, url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
    let body = null;
    try {
      body = await r.json();
    } catch (_) {
      body = null;
    }
    return {
      ok: r.status === 200,
      http: r.status,
      reason: body && body.reason ? String(body.reason) : r.status === 200 ? null : `http_${r.status}`,
      cron_age_sec: body && typeof body.cron_age_sec === 'number' ? body.cron_age_sec : null,
      data: summarizeKeys(body),
      worker_alive: true,
    };
  } catch (e) {
    return {
      ok: false,
      http: 0,
      reason: 'unreachable',
      cron_age_sec: null,
      data: null,
      worker_alive: false,
      error: String((e && e.message) || e),
    };
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function discardBody(r) {
  try {
    if (r && r.body && !r.bodyUsed) await r.body.cancel();
  } catch (_) {
    /* best effort */
  }
}

// 本体に refreshAll を 1 回走らせる。本体 cron が止まっている間は、これが「予備の cron」になる。
//   未認証 (TRIGGER_SECRET 無し) だと本体の 5 分 throttle に掛かり得る。sentinel も 5 分周期なので
//   数秒差で 429 になることがあり、その場合は残り時間だけ待って 1 回だけ再試行する
//   (残りが長い = 直近に別経路で refresh 済み = データは新しいので、そのまま諦めてよい)。
async function refreshNow(env, fetchImpl, sleep) {
  const headers = { 'user-agent': UA };
  if (env.TRIGGER_SECRET) headers['x-trigger-secret'] = env.TRIGGER_SECRET;
  const call = () =>
    mainFetch(env, fetchImpl, `${env.MAIN_BASE}/api/refresh-now`, {
      headers,
      signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
    });
  try {
    let r = await call();
    let retried = false;
    if (r.status === 429) {
      let wait = null;
      try {
        const j = await r.json();
        if (j && typeof j.retry_after_sec === 'number') wait = j.retry_after_sec;
      } catch (_) {
        wait = null;
      }
      if (wait != null && wait >= 0 && wait <= REFRESH_RETRY_MAX_WAIT_SEC) {
        await (sleep || defaultSleep)((wait + 1) * 1000);
        r = await call();
        retried = true;
      }
    }
    await discardBody(r);
    return { http: r.status, alive: r.status === 200 || r.status === 429, retried };
  } catch (e) {
    return { http: 0, alive: false, retried: false, error: String((e && e.message) || e) };
  }
}

// --- GitHub API ------------------------------------------------------------
function gh(env, fetchImpl) {
  if (!env.GH_TOKEN) return null;
  const repo = env.GH_REPO;
  const api = async (method, path, body) => {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        'user-agent': UA,
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${env.GH_TOKEN}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = r.status === 204 ? null : await r.json();
    } catch (_) {
      json = null;
    }
    return { status: r.status, json };
  };
  return {
    dispatchDeploy: () => api('POST', `/actions/workflows/${env.DEPLOY_WORKFLOW}/dispatches`, { ref: 'main' }),
    ensureLabel: () =>
      api('POST', '/labels', { name: env.ISSUE_LABEL, color: 'd93f0b', description: 'Cloudflare Worker の cron が停止' }),
    findOpenIssue: async () => {
      const r = await api('GET', `/issues?labels=${encodeURIComponent(env.ISSUE_LABEL)}&state=open&per_page=1`);
      return Array.isArray(r.json) && r.json.length ? r.json[0].number : null;
    },
    createIssue: (title, body) => api('POST', '/issues', { title, body, labels: [env.ISSUE_LABEL] }),
    comment: (n, body) => api('POST', `/issues/${n}/comments`, { body }),
    close: (n) => api('PATCH', `/issues/${n}`, { state: 'closed', state_reason: 'completed' }),
  };
}

function fmt(d) {
  return d.toISOString().slice(0, 16) + 'Z';
}

function incidentBody(env, now, probe, rn, state, action) {
  return [
    '## Cloudflare Worker cron 停止を検知 (sentinel)',
    '',
    `- 検知時刻: ${fmt(now)} UTC（連続 ${state.consecutive_failures} 回失敗）`,
    `- /health?strict=1: HTTP ${probe.http} reason=\`${probe.reason || '-'}\` cron_age_sec=\`${probe.cron_age_sec == null ? '-' : probe.cron_age_sec}\``,
    `- /api/refresh-now: HTTP ${rn.http}`,
    `- 自動対処: ${action}`,
    '',
    '### 意味',
    'sentinel (Cloudflare cron, 5 分毎) が本体 Worker の strict health を連続で失敗と判定しました。',
    'データは refresh-now / serve-heal で更新されますが、`scheduled()` の heartbeat が止まっています。',
    '',
    '### 自動復旧しない場合（この issue が数時間開いたまま）',
    'Cloudflare ダッシュボード → Workers & Pages → boatrace-scrape-trigger →',
    '1. **Settings → Triggers → Cron Triggers** が 2 件とも有効か',
    '2. **Observability** で scheduled の invocation にエラー / CPU time 超過が無いか',
    '',
    '手順の詳細: docs/RUNBOOK.md §8.3',
  ].join('\n');
}

// --- 1 回の検査 ------------------------------------------------------------
// 失敗区間を履歴 1 件に確定する (復旧時に呼ぶ)。
function closeStreak(state, now) {
  const s = state.streak;
  const started = Date.parse(s.started_at);
  return {
    started_at: s.started_at,
    ended_at: now.toISOString(),
    // 「最初に失敗を観測してから最初に成功を観測するまで」。実際の停止はこれより
    //   cron_age_sec (最初の失敗時点の heartbeat 経過秒) だけ前から始まっている。
    duration_sec: Number.isFinite(started) ? Math.max(0, Math.round((now.getTime() - started) / 1000)) : null,
    // failures / refresh は「記録できた tick」の数。記録できなかった tick は unrecorded_ticks。
    failures: state.consecutive_failures,
    unrecorded_ticks: (s.unrecorded_ticks || 0) + missedTicks(s, now),
    reason: s.reason || null,
    cron_age_sec: s.cron_age_sec == null ? null : s.cron_age_sec,
    data: s.data || null,
    refresh: s.refresh || null,
    escalated: !!state.incident,
    redeploy: !!(state.incident && state.incident.redeploy_at),
  };
}

export async function runCheck(env, opts = {}) {
  const now = opts.now || new Date();
  const fetchImpl = opts.fetchImpl || fetch;
  const sleep = opts.sleep || defaultSleep;
  const source = opts.source || 'manual'; // 'cron' = scheduled() から。生存記録は cron の時だけ
  const threshold = intVar(env, 'FAIL_THRESHOLD', 3);
  const cooldownSec = intVar(env, 'REDEPLOY_COOLDOWN_SEC', 3 * 3600);
  const commentIntervalSec = intVar(env, 'ISSUE_COMMENT_INTERVAL_SEC', 3600);

  const state = await loadState(env);
  let dirty = false;
  // essential: 1 日の書込予算を超えていても保存する変更 (状態遷移・GitHub 側の副作用・生存記録)。
  //   それ以外 (失敗 tick のカウンタ更新) は予算内でだけ保存する。
  let essential = false;

  // --- sentinel 自身の cron 生存記録 ---
  //   KV へ書くのは「前回記録から LIVENESS_WRITE_INTERVAL_SEC 経過」または「BUILD_ID が変わった
  //   (= デプロイ直後の初回 tick)」時だけ。他の理由で保存される tick では最新時刻が相乗りする。
  if (source === 'cron') {
    const build = env.BUILD_ID || null;
    const lastAt = state.cron_last_at ? Date.parse(state.cron_last_at) : NaN;
    const elapsed = Number.isFinite(lastAt) ? now.getTime() - lastAt : Infinity;
    if (elapsed >= LIVENESS_WRITE_INTERVAL_SEC * 1000 || (state.build || null) !== build) {
      dirty = true;
      essential = true;
    }
    state.cron_last_at = now.toISOString();
    state.build = build;
  }

  const probe = await probeHealth(env, now, fetchImpl);
  const actions = [];
  const api = gh(env, fetchImpl);

  if (probe.ok) {
    if (state.consecutive_failures > 0 || state.incident || state.streak) {
      if (state.incident && state.incident.issue_number && api) {
        try {
          await api.comment(
            state.incident.issue_number,
            `✅ ${fmt(now)} sentinel: /health?strict=1 が 200 に復旧しました（cron_age_sec=${probe.cron_age_sec}）。自動クローズします。`
          );
          await api.close(state.incident.issue_number);
          actions.push(`closed issue #${state.incident.issue_number}`);
        } catch (e) {
          actions.push(`issue close failed: ${e && e.message}`);
        }
      }
      if (state.streak) {
        const prev = Array.isArray(state.history) ? state.history : [];
        state.history = prev.concat([closeStreak(state, now)]).slice(-HISTORY_MAX);
      }
      state.consecutive_failures = 0;
      state.incident = null;
      state.streak = null;
      state.last_transition_at = now.toISOString();
      state.last_action = actions.join('; ') || 'recovered';
      dirty = true;
      essential = true;
    }
    if (dirty) await persist(env, state, now, essential);
    return { ok: true, probe, actions, state };
  }

  // --- 失敗 ---
  state.consecutive_failures += 1;
  dirty = true;
  if (!state.streak) {
    state.streak = {
      started_at: now.toISOString(),
      last_tick_at: now.toISOString(),
      reason: probe.reason,
      cron_age_sec: probe.cron_age_sec,
      data: probe.data || null,
      refresh: { ok: 0, throttled: 0, failed: 0 },
      unrecorded_ticks: 0,
    };
  } else {
    state.streak.unrecorded_ticks = (state.streak.unrecorded_ticks || 0) + missedTicks(state.streak, now);
    state.streak.last_tick_at = now.toISOString();
  }
  const rn = await refreshNow(env, fetchImpl, sleep);
  if (!state.streak.refresh) state.streak.refresh = { ok: 0, throttled: 0, failed: 0 };
  if (rn.http === 200) state.streak.refresh.ok += 1;
  else if (rn.http === 429) state.streak.refresh.throttled += 1;
  else state.streak.refresh.failed += 1;
  actions.push(`refresh-now http=${rn.http}${rn.retried ? ' (retried)' : ''}`);

  if (state.consecutive_failures >= threshold) {
    if (!state.incident) {
      state.incident = { opened_at: now.toISOString(), issue_number: null, last_comment_at: null, first_reason: probe.reason };
      state.last_transition_at = now.toISOString();
    }
    const workerAlive = probe.worker_alive || rn.alive;
    const cronDead = CRON_DEAD_REASONS.has(probe.reason);
    const lastRedeploy = state.last_redeploy_at ? Date.parse(state.last_redeploy_at) : 0;
    const cooldownOk = now.getTime() - lastRedeploy >= cooldownSec * 1000;
    let action = 'なし';
    if (cronDead && workerAlive) {
      if (!api) {
        // GH_TOKEN は任意。無い場合の主 cron 再登録は GitHub 側 worker-watchdog.yml (組込みトークン) が行う。
        //   それまでの間も、上の refresh-now が 5 分毎に本体を更新し続ける。
        action = 'GH_TOKEN 未設定のため再デプロイは worker-watchdog.yml に委任（データは refresh-now で更新継続）';
      } else if (!cooldownOk) {
        action = `再デプロイ見送り（直近 ${Math.round(cooldownSec / 3600)} 時間以内に dispatch 済: ${state.last_redeploy_at}）`;
      } else {
        const r = await api.dispatchDeploy();
        if (r.status === 204) {
          state.last_redeploy_at = now.toISOString();
          state.incident.redeploy_at = now.toISOString();
          essential = true; // 保存し損ねると次の tick でまた dispatch してしまう
          action = `${env.DEPLOY_WORKFLOW} を dispatch（cron trigger 再登録）`;
        } else {
          action = `${env.DEPLOY_WORKFLOW} の dispatch 失敗 (HTTP ${r.status})`;
        }
      }
      actions.push(action);
    } else if (!workerAlive) {
      action = 'Worker が応答しない（再デプロイ対象外）。Cloudflare ダッシュボードを確認';
      actions.push(action);
    }

    if (api) {
      try {
        if (!state.incident.issue_number) {
          await api.ensureLabel().catch(() => {});
          let n = await api.findOpenIssue();
          if (!n) {
            const r = await api.createIssue(
              `Worker cron 停止を検知 (${fmt(now)})`,
              incidentBody(env, now, probe, rn, state, action)
            );
            n = r.json && r.json.number ? r.json.number : null;
            actions.push(n ? `opened issue #${n}` : `issue create failed (HTTP ${r.status})`);
          } else {
            actions.push(`reusing open issue #${n}`);
          }
          state.incident.issue_number = n;
          state.incident.last_comment_at = now.toISOString();
          essential = true;
        } else {
          const last = state.incident.last_comment_at ? Date.parse(state.incident.last_comment_at) : 0;
          if (now.getTime() - last >= commentIntervalSec * 1000) {
            await api.comment(state.incident.issue_number, incidentBody(env, now, probe, rn, state, action));
            state.incident.last_comment_at = now.toISOString();
            essential = true;
            actions.push(`commented issue #${state.incident.issue_number}`);
          }
        }
      } catch (e) {
        actions.push(`github error: ${e && e.message}`);
      }
    }
  }

  state.last_action = actions.join('; ');
  if (dirty) await persist(env, state, now, essential);
  return { ok: false, probe, actions, state };
}

// --- Worker entry ------------------------------------------------------------
let _statusProbe = { at: 0, value: null }; // /status 用の本体 probe メモ (isolate ローカル)

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runCheck(env, { source: 'cron' }).then(
        (r) => console.log(`sentinel: ok=${r.ok} http=${r.probe.http} reason=${r.probe.reason} actions=[${r.actions.join('; ')}]`),
        (e) => console.log('sentinel: runCheck failed', e && e.message)
      )
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, sentinel: true, time: new Date().toISOString() });
    }
    if (url.pathname === '/status') {
      const state = await loadState(env);
      const nowMs = Date.now();
      if (!_statusProbe.value || nowMs - _statusProbe.at >= STATUS_PROBE_TTL_MS) {
        _statusProbe = { at: nowMs, value: await probeHealth(env, new Date(nowMs), fetch) };
      }
      const lastAt = state.cron_last_at ? Date.parse(state.cron_last_at) : NaN;
      return json({
        ok: true,
        time: new Date(nowMs).toISOString(),
        gh_token: !!env.GH_TOKEN,
        trigger_secret: !!env.TRIGGER_SECRET,
        main_binding: !!(env.MAIN && typeof env.MAIN.fetch === 'function'),
        build: env.BUILD_ID || null,
        // sentinel 自身の cron の生存記録。age_sec は書込間隔 (write_interval_sec) の分だけ
        //   古く見えるのが正常。build_recorded === build なら「現行版の cron が 1 回以上走った」。
        sentinel_cron: {
          last_at: state.cron_last_at || null,
          age_sec: Number.isFinite(lastAt) ? Math.max(0, Math.round((nowMs - lastAt) / 1000)) : null,
          write_interval_sec: LIVENESS_WRITE_INTERVAL_SEC,
          build_recorded: state.build || null,
        },
        main_probe: _statusProbe.value,
        state,
      });
    }
    if (url.pathname === '/run') {
      const secret = url.searchParams.get('secret') || request.headers.get('x-trigger-secret');
      if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const r = await runCheck(env, { source: 'manual' });
      return json({ ok: r.ok, probe: r.probe, actions: r.actions, state: r.state });
    }
    return json({ ok: false, error: 'not found' }, 404);
  },
};
