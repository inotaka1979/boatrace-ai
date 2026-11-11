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
// KV 書込は状態遷移時のみ (正常時 0 回/日)。本体と namespace を共用するため枯渇させない。
//
// エンドポイント:
//   GET /health   — sentinel 自身の疎通
//   GET /status   — 保存状態 + 本体 /health の生 probe (書込なし)
//   GET /run?secret=<TRIGGER_SECRET> — cron を待たず 1 回検査 (secret 設定時のみ)

const STATE_KEY = 'sentinel:state';
const UA = 'boatrace-sentinel (+https://github.com/inotaka1979/boatrace-ai)';

// JST 8-22 時: 本体 cron 5 分間隔 → 4 tick 欠落 (20 分) で stale。夜間 (30 分間隔) は 45 分。
const MAX_AGE_DAY_SEC = 1200;
const MAX_AGE_NIGHT_SEC = 2700;
const CRON_DEAD_REASONS = new Set(['cron_heartbeat_stale', 'cron_heartbeat_missing']);

function jstHour(now) {
  return (now.getUTCHours() + 9) % 24;
}

export function maxAgeSecFor(now) {
  const h = jstHour(now);
  return h >= 8 && h <= 22 ? MAX_AGE_DAY_SEC : MAX_AGE_NIGHT_SEC;
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
  };
}

async function loadState(env) {
  try {
    const raw = await env.BOATRACE_KV.get(STATE_KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    return Object.assign(emptyState(), s);
  } catch (_) {
    return emptyState();
  }
}

async function saveState(env, state) {
  try {
    await env.BOATRACE_KV.put(STATE_KEY, JSON.stringify(state));
  } catch (_) {
    /* KV 障害時も監視自体は続ける */
  }
}

// --- 本体 probe ------------------------------------------------------------
export async function probeHealth(env, now, fetchImpl) {
  const base = env.MAIN_BASE;
  const url = `${base}/health?strict=1&max_age_sec=${maxAgeSecFor(now)}`;
  try {
    const r = await fetchImpl(url, {
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
      worker_alive: true,
    };
  } catch (e) {
    return { ok: false, http: 0, reason: 'unreachable', cron_age_sec: null, worker_alive: false, error: String(e && e.message || e) };
  }
}

async function refreshNow(env, fetchImpl) {
  const headers = { 'user-agent': UA };
  if (env.TRIGGER_SECRET) headers['x-trigger-secret'] = env.TRIGGER_SECRET;
  try {
    const r = await fetchImpl(`${env.MAIN_BASE}/api/refresh-now`, {
      headers,
      signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
    });
    return { http: r.status, alive: r.status === 200 || r.status === 429 };
  } catch (e) {
    return { http: 0, alive: false, error: String(e && e.message || e) };
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
export async function runCheck(env, opts = {}) {
  const now = opts.now || new Date();
  const fetchImpl = opts.fetchImpl || fetch;
  const threshold = intVar(env, 'FAIL_THRESHOLD', 3);
  const cooldownSec = intVar(env, 'REDEPLOY_COOLDOWN_SEC', 3 * 3600);
  const commentIntervalSec = intVar(env, 'ISSUE_COMMENT_INTERVAL_SEC', 3600);

  const state = await loadState(env);
  const probe = await probeHealth(env, now, fetchImpl);
  const actions = [];
  const api = gh(env, fetchImpl);
  let dirty = false;

  if (probe.ok) {
    if (state.consecutive_failures > 0 || state.incident) {
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
      state.consecutive_failures = 0;
      state.incident = null;
      state.last_transition_at = now.toISOString();
      state.last_action = actions.join('; ') || 'recovered';
      dirty = true;
    }
    if (dirty) await saveState(env, state);
    return { ok: true, probe, actions, state };
  }

  // --- 失敗 ---
  state.consecutive_failures += 1;
  dirty = true;
  const rn = await refreshNow(env, fetchImpl);
  actions.push(`refresh-now http=${rn.http}`);

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
        action = '再デプロイ不可（GH_TOKEN 未設定）。Actions タブから "Deploy Cloudflare Worker" を手動実行してください';
      } else if (!cooldownOk) {
        action = `再デプロイ見送り（直近 ${Math.round(cooldownSec / 3600)} 時間以内に dispatch 済: ${state.last_redeploy_at}）`;
      } else {
        const r = await api.dispatchDeploy();
        if (r.status === 204) {
          state.last_redeploy_at = now.toISOString();
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
        } else {
          const last = state.incident.last_comment_at ? Date.parse(state.incident.last_comment_at) : 0;
          if (now.getTime() - last >= commentIntervalSec * 1000) {
            await api.comment(state.incident.issue_number, incidentBody(env, now, probe, rn, state, action));
            state.incident.last_comment_at = now.toISOString();
            actions.push(`commented issue #${state.incident.issue_number}`);
          }
        }
      } catch (e) {
        actions.push(`github error: ${e && e.message}`);
      }
    }
  }

  state.last_action = actions.join('; ');
  if (dirty) await saveState(env, state);
  return { ok: false, probe, actions, state };
}

// --- Worker entry ------------------------------------------------------------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runCheck(env).then(
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
      const probe = await probeHealth(env, new Date(), fetch);
      return json({
        ok: true,
        time: new Date().toISOString(),
        gh_token: !!env.GH_TOKEN,
        trigger_secret: !!env.TRIGGER_SECRET,
        main_probe: probe,
        state,
      });
    }
    if (url.pathname === '/run') {
      const secret = url.searchParams.get('secret') || request.headers.get('x-trigger-secret');
      if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const r = await runCheck(env);
      return json({ ok: r.ok, probe: r.probe, actions: r.actions, state: r.state });
    }
    return json({ ok: false, error: 'not found' }, 404);
  },
};
