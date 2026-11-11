/**
 * boatrace-sentinel（本体 Worker の外形監視・自己復旧）の回帰テスト（2026-11-11）
 *
 * sentinel.js を実際に import し、fetch / KV / 時刻を stub して runCheck() の状態遷移を固定する:
 *   - 正常時は KV に書かない（本体と namespace 共用、無料枠を食わない）
 *   - 失敗のたびに refresh-now を呼ぶ（TRIGGER_SECRET を提示）
 *   - 連続 FAIL_THRESHOLD 回で初めて障害扱い: cron 死亡 + 本体応答 → deploy-worker dispatch 1 回、issue 起票
 *   - クールダウン内は再 dispatch しない / 経過コメントは間隔を守る
 *   - Worker 到達不能 (unreachable) では dispatch しない
 *   - GH_TOKEN 無しでは GitHub API を一切呼ばず、監視と refresh-now だけ動く
 *   - 復旧で issue を閉じ、状態をリセット
 *   - 閾値は JST 時間帯で切替
 *   - sentinel 自身の cron 生存記録 (cron_last_at) は 1 時間に 1 回 + デプロイ直後だけ KV に書く
 *   - 失敗区間 (streak) は復旧時に history へ確定し、直近 10 件だけ保持する
 *   - refresh-now の 429 は残りが短ければ待って 1 回だけ再試行する（予備 cron の 5 分周期を保つ）
 *   - 失敗が長時間続いても KV 書込は 1 日の予算内（本体と共用の無料枠を食い潰さない）。
 *     予算を超えても refresh-now は毎 tick 続き、記録できなかった tick は履歴に残る
 *
 *   node scripts/tests/test_sentinel_worker.mjs
 */

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'sentinel', 'sentinel.js')).href);
const { runCheck, maxAgeSecFor, LIVENESS_WRITE_INTERVAL_SEC, DAILY_WRITE_BUDGET } = mod;
const worker = mod.default;

function makeKV() {
  const store = new Map();
  let writes = 0;
  return {
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      writes++;
      store.set(k, v);
    },
    get writes() {
      return writes;
    },
    _store: store,
  };
}

function baseEnv(overrides = {}) {
  return Object.assign(
    {
      BOATRACE_KV: makeKV(),
      MAIN_BASE: 'https://main.example.dev',
      GH_REPO: 'o/r',
      DEPLOY_WORKFLOW: 'deploy-worker.yml',
      ISSUE_LABEL: 'worker-cron-dead',
      FAIL_THRESHOLD: '3',
      REDEPLOY_COOLDOWN_SEC: '10800',
      ISSUE_COMMENT_INTERVAL_SEC: '3600',
      GH_TOKEN: 'ghp_test',
      TRIGGER_SECRET: 's3cret',
    },
    overrides
  );
}

/** 呼出を記録する fetch stub。health は scenario.health() が返す {status, body}。 */
function makeFetch(scenario) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: (init.method || 'GET').toUpperCase(), headers: init.headers || {}, body: init.body });
    if (u.includes('/health?strict=1')) {
      const h = scenario.health();
      if (h.throw) throw new Error('fetch failed');
      return new Response(JSON.stringify(h.body), { status: h.status });
    }
    if (u.includes('/api/refresh-now')) {
      const s = scenario.refresh ? scenario.refresh() : 200;
      if (s === 'throw') throw new Error('fetch failed');
      if (s && typeof s === 'object') return new Response(JSON.stringify(s.body), { status: s.status });
      return new Response(JSON.stringify({ refreshed: s === 200 }), { status: s });
    }
    if (u.startsWith('https://api.github.com/')) {
      if (u.includes('/dispatches')) return new Response(null, { status: 204 });
      if (u.includes('/labels')) return new Response('{}', { status: 201 });
      if (u.includes('/issues?')) return new Response(JSON.stringify(scenario.openIssues || []), { status: 200 });
      if (u.match(/\/issues\/\d+\/comments$/)) return new Response('{"id":1}', { status: 201 });
      if (u.match(/\/issues\/\d+$/)) return new Response('{"state":"closed"}', { status: 200 });
      if (u.endsWith('/issues')) return new Response(JSON.stringify({ number: 42 }), { status: 201 });
    }
    return new Response('nf', { status: 404 });
  };
  fn.calls = calls;
  fn.count = (pred) => calls.filter(pred).length;
  return fn;
}

const OK = { status: 200, body: { ok: true, cron_age_sec: 120 } };
const CRON_DEAD = { status: 500, body: { ok: false, reason: 'cron_heartbeat_stale', cron_age_sec: 3000 } };
const UNREACHABLE = { throw: true };
// 本体 /health?strict=1 の 500 応答は keys も含む（履歴の data 用）
const CRON_DEAD_WITH_KEYS = {
  status: 500,
  body: {
    ok: false,
    reason: 'cron_heartbeat_stale',
    cron_age_sec: 1260,
    keys: {
      previews: { wrote_at: 'x', age_sec: 95, src: 'ondemand', exists: true },
      programs: { wrote_at: 'x', age_sec: 1500, src: 'cron', exists: true },
      results: { wrote_at: 'x', age_sec: 1310, src: 'cron', exists: true },
    },
  },
};

const T0 = new Date('2026-11-11T03:00:00Z'); // JST 12:00
const at = (min) => new Date(T0.getTime() + min * 60000);

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  PASS:', name);
    pass++;
  } catch (e) {
    console.log('  FAIL:', name, '\n    ', e.message);
    fail++;
  }
}

console.log('=== boatrace-sentinel (外形監視・自己復旧) ===');

await t('閾値: JST 昼は 1200s、夜は 2700s', () => {
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-11T03:00:00Z')), 1200); // 12:00 JST
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-11T13:30:00Z')), 1200); // 22:30 JST
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-11T13:59:00Z')), 1200); // 22:59 JST
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-11T14:00:00Z')), 2700); // 23:00 JST (夜間 cron 開始)
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-11T14:30:00Z')), 2700); // 23:30 JST
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-10T22:00:00Z')), 2700); // 07:00 JST
});

await t('閾値: 朝 08:00 の切替直後は夜間閾値のまま（毎朝の誤検知を防ぐ）', async () => {
  // 08:00 JST の時点で最後の heartbeat は 07:30 の夜間 tick = 約 1800 秒前が正常。
  //   日中閾値 (1200s) を 08:00 から適用すると、本体の 08:00 tick が heartbeat を書く前に
  //   sentinel が probe して毎朝必ず失敗になる。
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-10T23:00:00Z')), 2700); // 08:00 JST
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-10T23:19:59Z')), 2700); // 08:19 JST
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-10T23:20:00Z')), 1200); // 08:20 JST
  // 実シナリオ: 08:00:01 の probe で heartbeat 1801 秒 → 本体は max_age_sec=2700 を受け取り 200 を返す
  const env = baseEnv();
  const f = makeFetch({
    health: () => ({ status: 200, body: { ok: true, cron_age_sec: 1801 } }),
  });
  const r = await runCheck(env, { now: new Date('2026-11-10T23:00:01Z'), fetchImpl: f, source: 'cron' });
  assert.ok(f.calls[0].url.includes('max_age_sec=2700'), f.calls[0].url);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(
    f.count((c) => c.url.includes('/api/refresh-now')),
    0,
    '朝の切替で refresh-now を無駄打ちした'
  );
});

await t('正常: KV に書かず、GitHub にも触らない', async () => {
  const env = baseEnv();
  const f = makeFetch({ health: () => OK });
  const r = await runCheck(env, { now: T0, fetchImpl: f });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(env.BOATRACE_KV.writes, 0, '正常時に KV write している');
  assert.strictEqual(
    f.count((c) => c.url.startsWith('https://api.github.com/')),
    0
  );
  assert.ok(f.calls[0].url.includes('max_age_sec=1200'), '昼の閾値が付いていない');
});

await t('失敗 1-2 回目: refresh-now は呼ぶが、障害扱い (dispatch/issue) にはしない', async () => {
  const env = baseEnv();
  const f = makeFetch({ health: () => CRON_DEAD });
  for (let i = 0; i < 2; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f });
  assert.strictEqual(
    f.count((c) => c.url.includes('/api/refresh-now')),
    2
  );
  const rn = f.calls.find((c) => c.url.includes('/api/refresh-now'));
  assert.strictEqual(rn.headers['x-trigger-secret'], 's3cret', 'TRIGGER_SECRET を提示していない');
  assert.strictEqual(
    f.count((c) => c.url.startsWith('https://api.github.com/')),
    0,
    '閾値前に GitHub を叩いた'
  );
  const st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.strictEqual(st.consecutive_failures, 2);
  assert.strictEqual(st.incident, null);
});

await t('失敗 3 回目: cron 死亡 + 本体応答 → deploy dispatch 1 回 + issue 起票', async () => {
  const env = baseEnv();
  const f = makeFetch({ health: () => CRON_DEAD });
  let r;
  for (let i = 0; i < 3; i++) r = await runCheck(env, { now: at(i * 5), fetchImpl: f });
  assert.strictEqual(
    f.count((c) => c.url.includes('/dispatches') && c.method === 'POST'),
    1
  );
  const d = f.calls.find((c) => c.url.includes('/dispatches'));
  assert.ok(d.url.endsWith('/actions/workflows/deploy-worker.yml/dispatches'), d.url);
  assert.deepStrictEqual(JSON.parse(d.body), { ref: 'main' });
  assert.strictEqual(d.headers.authorization, 'Bearer ghp_test');
  assert.strictEqual(
    f.count((c) => c.url.endsWith('/issues') && c.method === 'POST'),
    1,
    'issue が 1 件起票されていない'
  );
  const st = r.state;
  assert.strictEqual(st.incident.issue_number, 42);
  assert.ok(st.last_redeploy_at, 'last_redeploy_at が記録されていない');
  assert.ok(
    r.actions.some((a) => a.includes('dispatch')),
    r.actions.join(';')
  );
});

await t('障害継続: クールダウン内は再 dispatch しない、コメントは 1 時間に 1 回', async () => {
  const env = baseEnv();
  const f = makeFetch({ health: () => CRON_DEAD });
  // 3 回で障害 (t=10) → その後 t=70 まで継続 (起票から 60 分)
  for (let i = 0; i < 15; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f });
  assert.strictEqual(
    f.count((c) => c.url.includes('/dispatches')),
    1,
    'クールダウン内に再 dispatch した'
  );
  assert.strictEqual(
    f.count((c) => c.url.endsWith('/issues') && c.method === 'POST'),
    1,
    'issue を二重起票した'
  );
  // 起票 (t=10) から 60 分後 (t=70) で初めて 1 件コメント
  const comments = f.count((c) => /\/issues\/42\/comments$/.test(c.url));
  assert.strictEqual(comments, 1, `comments=${comments}`);
  // 3 時間後の tick では再 dispatch する
  await runCheck(env, { now: at(10 + 181), fetchImpl: f });
  assert.strictEqual(
    f.count((c) => c.url.includes('/dispatches')),
    2,
    'クールダウン後に再 dispatch していない'
  );
});

await t('既に open の issue があれば再利用する（二重起票しない）', async () => {
  const env = baseEnv();
  const f = makeFetch({ health: () => CRON_DEAD, openIssues: [{ number: 7 }] });
  let r;
  for (let i = 0; i < 3; i++) r = await runCheck(env, { now: at(i * 5), fetchImpl: f });
  assert.strictEqual(
    f.count((c) => c.url.endsWith('/issues') && c.method === 'POST'),
    0
  );
  assert.strictEqual(r.state.incident.issue_number, 7);
});

await t('本体が到達不能 (unreachable) なら再デプロイしない（Worker 全体停止は対象外）', async () => {
  const env = baseEnv();
  const f = makeFetch({ health: () => UNREACHABLE, refresh: () => 'throw' });
  let r;
  for (let i = 0; i < 3; i++) r = await runCheck(env, { now: at(i * 5), fetchImpl: f });
  assert.strictEqual(r.probe.reason, 'unreachable');
  assert.strictEqual(
    f.count((c) => c.url.includes('/dispatches')),
    0,
    '到達不能なのに dispatch した'
  );
  assert.strictEqual(
    f.count((c) => c.url.endsWith('/issues') && c.method === 'POST'),
    1,
    'issue は起票すべき'
  );
  assert.ok(
    r.actions.some((a) => a.includes('応答しない')),
    r.actions.join(';')
  );
});

await t('GH_TOKEN 無し: GitHub API を一切呼ばず、refresh-now と状態記録だけ行う', async () => {
  const env = baseEnv({ GH_TOKEN: undefined });
  const f = makeFetch({ health: () => CRON_DEAD });
  let r;
  for (let i = 0; i < 4; i++) r = await runCheck(env, { now: at(i * 5), fetchImpl: f });
  assert.strictEqual(
    f.count((c) => c.url.startsWith('https://api.github.com/')),
    0
  );
  assert.strictEqual(
    f.count((c) => c.url.includes('/api/refresh-now')),
    4
  );
  assert.ok(r.state.incident, '障害状態は記録すべき');
  assert.ok(
    r.actions.some((a) => a.includes('GH_TOKEN')),
    r.actions.join(';')
  );
});

await t('復旧: issue にコメントして閉じ、状態をリセットする', async () => {
  const env = baseEnv();
  let healthy = false;
  const f = makeFetch({ health: () => (healthy ? OK : CRON_DEAD) });
  for (let i = 0; i < 3; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f });
  healthy = true;
  const r = await runCheck(env, { now: at(15), fetchImpl: f });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(
    f.count((c) => /\/issues\/42$/.test(c.url) && c.method === 'PATCH'),
    1,
    'issue を閉じていない'
  );
  assert.strictEqual(
    f.count((c) => /\/issues\/42\/comments$/.test(c.url)),
    1,
    '復旧コメントが無い'
  );
  assert.strictEqual(r.state.consecutive_failures, 0);
  assert.strictEqual(r.state.incident, null);
  // 次の正常 tick では何も書かない
  const w = env.BOATRACE_KV.writes;
  await runCheck(env, { now: at(20), fetchImpl: f });
  assert.strictEqual(env.BOATRACE_KV.writes, w, '安定後の正常 tick で KV write している');
});

await t('一過性の失敗 (1 回) が回復しても issue は作られず、状態だけ戻る', async () => {
  const env = baseEnv();
  let healthy = false;
  const f = makeFetch({ health: () => (healthy ? OK : CRON_DEAD) });
  await runCheck(env, { now: at(0), fetchImpl: f });
  healthy = true;
  const r = await runCheck(env, { now: at(5), fetchImpl: f });
  assert.strictEqual(r.state.consecutive_failures, 0);
  assert.strictEqual(
    f.count((c) => c.url.startsWith('https://api.github.com/')),
    0
  );
});

await t('Service Binding: env.MAIN があれば本体は MAIN.fetch で呼び、公開 URL は fetch しない', async () => {
  // 実測 (2026-11-11 初回デプロイ): Worker→同一アカウント workers.dev の公開 URL fetch は 404。
  const seen = [];
  const env = baseEnv({
    MAIN: {
      async fetch(req) {
        seen.push({ url: req.url, secret: req.headers.get('x-trigger-secret') });
        if (req.url.includes('/health')) {
          return new Response(JSON.stringify(CRON_DEAD.body), { status: 500 });
        }
        return new Response('{}', { status: 200 });
      },
    },
  });
  const f = makeFetch({ health: () => OK }); // 公開 URL 側は正常を返すが使われないこと
  const r = await runCheck(env, { now: T0, fetchImpl: f });
  assert.strictEqual(r.ok, false, 'MAIN.fetch の 500 ではなく公開 URL の 200 を見ている');
  assert.strictEqual(r.probe.reason, 'cron_heartbeat_stale');
  assert.ok(
    seen.some((s) => s.url.includes('/health?strict=1&max_age_sec=1200')),
    JSON.stringify(seen)
  );
  assert.ok(
    seen.some((s) => s.url.endsWith('/api/refresh-now') && s.secret === 's3cret'),
    'refresh-now が MAIN 経由でない'
  );
  assert.strictEqual(
    f.count((c) => c.url.startsWith('https://main.example.dev')),
    0,
    '公開 URL を fetch した'
  );
  // GitHub API は MAIN を通らない
  for (let i = 0; i < 2; i++) await runCheck(env, { now: at((i + 1) * 5), fetchImpl: f });
  assert.strictEqual(
    f.count((c) => c.url.includes('/dispatches')),
    1
  );
});

await t('cron 生存記録: 初回 tick で 1 回書き、以後 1 時間は書かない（正常時の KV 書込 ≤ 24 回/日）', async () => {
  const env = baseEnv();
  const f = makeFetch({ health: () => OK });
  assert.strictEqual(LIVENESS_WRITE_INTERVAL_SEC, 3600);
  await runCheck(env, { now: at(0), fetchImpl: f, source: 'cron' });
  assert.strictEqual(env.BOATRACE_KV.writes, 1, '初回 cron tick を記録していない');
  let st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.strictEqual(st.cron_last_at, at(0).toISOString());
  // 5 分毎に 11 回 (t=5..55): 書かない
  for (let i = 1; i <= 11; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f, source: 'cron' });
  assert.strictEqual(env.BOATRACE_KV.writes, 1, '1 時間以内に再書込している');
  // t=60 で 2 回目
  await runCheck(env, { now: at(60), fetchImpl: f, source: 'cron' });
  assert.strictEqual(env.BOATRACE_KV.writes, 2, '1 時間経過後に記録していない');
  st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.strictEqual(st.cron_last_at, at(60).toISOString());
  // 24 時間 (288 tick) 回しても 24 回前後に収まる
  for (let i = 13; i <= 288; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f, source: 'cron' });
  assert.ok(env.BOATRACE_KV.writes <= 25, `writes/day=${env.BOATRACE_KV.writes}`);
});

await t('cron 生存記録: BUILD_ID が変わったら（= デプロイ直後の初回 tick）間隔を待たず即記録', async () => {
  const env = baseEnv({ BUILD_ID: 'aaa111' });
  const f = makeFetch({ health: () => OK });
  await runCheck(env, { now: at(0), fetchImpl: f, source: 'cron' });
  await runCheck(env, { now: at(5), fetchImpl: f, source: 'cron' });
  assert.strictEqual(env.BOATRACE_KV.writes, 1);
  env.BUILD_ID = 'bbb222'; // 新バージョンをデプロイ
  await runCheck(env, { now: at(10), fetchImpl: f, source: 'cron' });
  assert.strictEqual(env.BOATRACE_KV.writes, 2, 'デプロイ直後の tick を即記録していない');
  const st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.strictEqual(st.build, 'bbb222');
  assert.strictEqual(st.cron_last_at, at(10).toISOString());
});

await t('cron 生存記録: 手動実行 (/run 相当) は cron の記録を更新しない', async () => {
  const env = baseEnv();
  const f = makeFetch({ health: () => OK });
  await runCheck(env, { now: at(0), fetchImpl: f, source: 'manual' });
  await runCheck(env, { now: at(5), fetchImpl: f }); // source 省略 = manual
  assert.strictEqual(env.BOATRACE_KV.writes, 0, '手動実行で cron の生存記録を書いた');
});

await t('履歴: 失敗区間は復旧時に history へ確定する（理由・heartbeat 経過・データ鮮度・refresh 成否）', async () => {
  const env = baseEnv({ GH_TOKEN: undefined });
  let healthy = false;
  const f = makeFetch({ health: () => (healthy ? OK : CRON_DEAD_WITH_KEYS) });
  for (let i = 0; i < 4; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f, source: 'cron' });
  let st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.strictEqual(st.streak.started_at, at(0).toISOString());
  assert.deepStrictEqual(st.streak.data, {
    previews: { age_sec: 95, src: 'ondemand' },
    results: { age_sec: 1310, src: 'cron' },
  });
  assert.deepStrictEqual(st.history, [], '復旧前に history へ入れている');
  healthy = true;
  const r = await runCheck(env, { now: at(20), fetchImpl: f, source: 'cron' });
  st = r.state;
  assert.strictEqual(st.streak, null);
  assert.strictEqual(st.history.length, 1);
  const h = st.history[0];
  assert.strictEqual(h.started_at, at(0).toISOString());
  assert.strictEqual(h.ended_at, at(20).toISOString());
  assert.strictEqual(h.duration_sec, 1200);
  assert.strictEqual(h.failures, 4);
  assert.strictEqual(h.unrecorded_ticks, 0, '全 tick を記録できた区間で unrecorded が付いている');
  assert.strictEqual(h.reason, 'cron_heartbeat_stale');
  assert.strictEqual(h.cron_age_sec, 1260);
  assert.deepStrictEqual(h.refresh, { ok: 4, throttled: 0, failed: 0 });
  assert.strictEqual(h.escalated, true, '3 回以上の失敗は escalated');
  assert.strictEqual(h.redeploy, false, 'GH_TOKEN 無しで redeploy=true になっている');
});

await t('履歴: 1 回だけの失敗も残す（escalated=false）。直近 10 件だけ保持する', async () => {
  const env = baseEnv({ GH_TOKEN: undefined });
  let healthy = true;
  const f = makeFetch({ health: () => (healthy ? OK : CRON_DEAD) });
  let r;
  for (let k = 0; k < 12; k++) {
    healthy = false;
    await runCheck(env, { now: at(k * 10), fetchImpl: f, source: 'cron' });
    healthy = true;
    r = await runCheck(env, { now: at(k * 10 + 5), fetchImpl: f, source: 'cron' });
  }
  assert.strictEqual(r.state.history.length, 10, `history=${r.state.history.length}`);
  assert.strictEqual(r.state.history[9].started_at, at(110).toISOString(), '最新が末尾でない');
  assert.strictEqual(r.state.history[0].started_at, at(20).toISOString(), '古い 2 件が落ちていない');
  assert.strictEqual(r.state.history[9].escalated, false);
  assert.strictEqual(r.state.history[9].failures, 1);
});

await t('履歴: GH_TOKEN ありで再デプロイした区間は redeploy=true', async () => {
  const env = baseEnv();
  let healthy = false;
  const f = makeFetch({ health: () => (healthy ? OK : CRON_DEAD) });
  for (let i = 0; i < 3; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f, source: 'cron' });
  healthy = true;
  const r = await runCheck(env, { now: at(15), fetchImpl: f, source: 'cron' });
  assert.strictEqual(r.state.history.length, 1);
  assert.strictEqual(r.state.history[0].redeploy, true);
  assert.strictEqual(r.state.history[0].escalated, true);
});

await t('refresh-now 429: 残りが短ければ待って 1 回だけ再試行する（予備 cron の周期を保つ）', async () => {
  const env = baseEnv({ GH_TOKEN: undefined, TRIGGER_SECRET: undefined });
  let n = 0;
  const f = makeFetch({
    health: () => CRON_DEAD,
    refresh: () => (++n === 1 ? { status: 429, body: { refreshed: false, throttled: true, retry_after_sec: 3 } } : 200),
  });
  const slept = [];
  const r = await runCheck(env, { now: T0, fetchImpl: f, sleep: async (ms) => slept.push(ms) });
  assert.deepStrictEqual(slept, [4000], `slept=${JSON.stringify(slept)}`);
  assert.strictEqual(
    f.count((c) => c.url.includes('/api/refresh-now')),
    2
  );
  assert.deepStrictEqual(r.state.streak.refresh, { ok: 1, throttled: 0, failed: 0 });
  assert.ok(
    r.actions.some((a) => a.includes('http=200') && a.includes('retried')),
    r.actions.join(';')
  );
  // 未認証なので secret ヘッダは付けない
  const rn = f.calls.find((c) => c.url.includes('/api/refresh-now'));
  assert.strictEqual(rn.headers['x-trigger-secret'], undefined);
});

await t('refresh-now 429: 残りが長い（直近に別経路で refresh 済み）なら待たずに諦める', async () => {
  const env = baseEnv({ GH_TOKEN: undefined, TRIGGER_SECRET: undefined });
  const f = makeFetch({
    health: () => CRON_DEAD,
    refresh: () => ({ status: 429, body: { refreshed: false, throttled: true, retry_after_sec: 200 } }),
  });
  const slept = [];
  const r = await runCheck(env, { now: T0, fetchImpl: f, sleep: async (ms) => slept.push(ms) });
  assert.deepStrictEqual(slept, []);
  assert.strictEqual(
    f.count((c) => c.url.includes('/api/refresh-now')),
    1
  );
  assert.deepStrictEqual(r.state.streak.refresh, { ok: 0, throttled: 1, failed: 0 });
});

await t('refresh-now 429: 再試行は 1 回まで（2 回目も 429 なら throttled として記録）', async () => {
  const env = baseEnv({ GH_TOKEN: undefined, TRIGGER_SECRET: undefined });
  const f = makeFetch({
    health: () => CRON_DEAD,
    refresh: () => ({ status: 429, body: { refreshed: false, throttled: true, retry_after_sec: 1 } }),
  });
  const slept = [];
  const r = await runCheck(env, { now: T0, fetchImpl: f, sleep: async (ms) => slept.push(ms) });
  assert.deepStrictEqual(slept, [2000]);
  assert.strictEqual(
    f.count((c) => c.url.includes('/api/refresh-now')),
    2
  );
  assert.deepStrictEqual(r.state.streak.refresh, { ok: 0, throttled: 1, failed: 0 });
});

await t('書込予算: 本体 cron が丸 1 日止まっても KV 書込は予算内、refresh-now は毎 tick 続く', async () => {
  // KV 無料枠 (1,000 writes/日) は本体と共用。失敗 tick 毎に保存すると 288 回/日になり、
  //   障害日に限って枠を押し上げる。予算 (DAILY_WRITE_BUDGET) を超えたら必須の保存だけにする。
  assert.strictEqual(DAILY_WRITE_BUDGET, 120);
  const env = baseEnv({ GH_TOKEN: undefined });
  let healthy = false;
  const f = makeFetch({ health: () => (healthy ? OK : CRON_DEAD) });
  const D0 = new Date('2026-11-12T00:00:00Z'); // UTC 日付の頭 = KV 無料枠の集計開始
  const tick = (i) => new Date(D0.getTime() + i * 300000);
  for (let i = 0; i < 288; i++) await runCheck(env, { now: tick(i), fetchImpl: f, source: 'cron' });
  assert.strictEqual(
    f.count((c) => c.url.includes('/api/refresh-now')),
    288,
    '予算を超えた後に予備 cron (refresh-now) が止まった'
  );
  const w = env.BOATRACE_KV.writes;
  assert.ok(w >= DAILY_WRITE_BUDGET && w <= DAILY_WRITE_BUDGET + 24, `writes/day=${w}`);
  let st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.deepStrictEqual(st.writes, { day: '2026-11-12', n: w }, '書込カウンタが実際の書込回数と一致しない');
  // 生存記録は予算を超えた後も 1 時間に 1 回続く（worker-watchdog が「sentinel 停止」と誤検知しない）
  assert.ok(tick(287).getTime() - Date.parse(st.cron_last_at) < 3600 * 1000, `cron_last_at=${st.cron_last_at}`);
  // 復旧は必ず保存され、履歴が確定する。記録できなかった tick は unrecorded_ticks に出る
  healthy = true;
  const r = await runCheck(env, { now: tick(288), fetchImpl: f, source: 'cron' });
  const h = r.state.history[0];
  assert.strictEqual(h.duration_sec, 86400);
  assert.ok(h.unrecorded_ticks > 0, '記録漏れが履歴に出ていない');
  assert.strictEqual(h.failures + h.unrecorded_ticks, 288, `failures=${h.failures} unrecorded=${h.unrecorded_ticks}`);
  st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.strictEqual(st.streak, null, '復旧が KV に保存されていない');
  assert.strictEqual(st.consecutive_failures, 0);
});

await t('書込予算: 予算を超えていても復旧は必ず保存する（失敗状態が KV に残らない）', async () => {
  const env = baseEnv({ GH_TOKEN: undefined });
  let healthy = false;
  const f = makeFetch({ health: () => (healthy ? OK : CRON_DEAD) });
  const D0 = new Date('2026-11-12T00:00:00Z');
  const tick = (i) => new Date(D0.getTime() + i * 300000);
  for (let i = 0; i < 200; i++) await runCheck(env, { now: tick(i), fetchImpl: f, source: 'cron' });
  let st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.ok(st.writes.n >= DAILY_WRITE_BUDGET, `n=${st.writes.n}`);
  healthy = true;
  await runCheck(env, { now: tick(200), fetchImpl: f, source: 'cron' }); // 同じ UTC 日のうちに復旧
  st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.strictEqual(st.streak, null, '予算超過中の復旧が保存されていない');
  assert.strictEqual(st.consecutive_failures, 0);
  assert.strictEqual(st.history.length, 1);
  assert.strictEqual(st.history[0].duration_sec, 200 * 300);
  assert.strictEqual(st.history[0].failures + st.history[0].unrecorded_ticks, 200);
});

// 予算を使い切った状態で障害が継続している保存状態を作る（GH_TOKEN あり）
async function envOverBudget(overrides) {
  const env = baseEnv();
  await env.BOATRACE_KV.put(
    'sentinel:state',
    JSON.stringify(
      Object.assign(
        {
          consecutive_failures: 40,
          incident: {
            opened_at: at(-185).toISOString(),
            issue_number: 42,
            last_comment_at: at(-5).toISOString(),
            first_reason: 'cron_heartbeat_stale',
          },
          last_redeploy_at: at(-5).toISOString(),
          streak: {
            started_at: at(-195).toISOString(),
            last_tick_at: at(-5).toISOString(),
            reason: 'cron_heartbeat_stale',
            cron_age_sec: 3000,
            data: null,
            refresh: { ok: 40, throttled: 0, failed: 0 },
            unrecorded_ticks: 0,
          },
          history: [],
          writes: { day: T0.toISOString().slice(0, 10), n: DAILY_WRITE_BUDGET },
          cron_last_at: at(-5).toISOString(),
          build: null,
        },
        overrides
      )
    )
  );
  return env;
}

await t('書込予算: 予算を超えていても再 dispatch の記録は必ず保存する（次の tick で連打しない）', async () => {
  // クールダウン (3 時間) が明けた tick で再 dispatch → last_redeploy_at を保存し損ねると 5 分毎に連打する
  const env = await envOverBudget({ last_redeploy_at: at(-181).toISOString() });
  const f = makeFetch({ health: () => CRON_DEAD });
  for (let i = 0; i < 3; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f, source: 'cron' });
  assert.strictEqual(
    f.count((c) => c.url.includes('/dispatches')),
    1,
    '予算超過中に dispatch を連打した'
  );
  const st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.strictEqual(st.last_redeploy_at, at(0).toISOString());
});

await t('書込予算: 予算を超えていても issue コメントの記録は必ず保存する（次の tick で連投しない）', async () => {
  const env = await envOverBudget({
    incident: {
      opened_at: at(-185).toISOString(),
      issue_number: 42,
      last_comment_at: at(-61).toISOString(),
      first_reason: 'cron_heartbeat_stale',
    },
  });
  const f = makeFetch({ health: () => CRON_DEAD });
  for (let i = 0; i < 3; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f, source: 'cron' });
  assert.strictEqual(
    f.count((c) => /\/issues\/42\/comments$/.test(c.url)),
    1,
    '予算超過中に issue コメントを連投した'
  );
});

await t('書込予算: 予算を超えていても issue 起票の記録は必ず保存する（二重起票しない）', async () => {
  // 連続 2 回失敗まで記録済み → 3 回目 (障害扱い) の tick が予算超過後に来た場合
  const env = await envOverBudget({ consecutive_failures: 2, incident: null, last_redeploy_at: at(-5).toISOString() });
  let created = 0;
  const base = makeFetch({ health: () => CRON_DEAD });
  // 起票済み issue を「open 一覧」に出さない意地悪な条件（GitHub の検索反映遅延を想定）でも
  //   state.incident.issue_number が保存されていれば二重起票しない
  const f = async (url, init = {}) => {
    if (String(url).endsWith('/issues') && (init.method || 'GET').toUpperCase() === 'POST') created++;
    return base(url, init);
  };
  for (let i = 0; i < 3; i++) await runCheck(env, { now: at(i * 5), fetchImpl: f, source: 'cron' });
  assert.strictEqual(created, 1, `issue を ${created} 件起票した`);
  const st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.strictEqual(st.incident.issue_number, 42);
});

await t('書込予算: UTC 日付が変わると予算が戻り、tick 毎の記録を再開する', async () => {
  const env = baseEnv({ GH_TOKEN: undefined });
  const f = makeFetch({ health: () => CRON_DEAD });
  const D0 = new Date('2026-11-12T12:00:00Z');
  const tick = (i) => new Date(D0.getTime() + i * 300000);
  // 12:00Z から 23:55Z まで 144 tick: 120 回で予算に達し、以後は生存記録 (1 時間に 1 回) だけ
  for (let i = 0; i < 144; i++) await runCheck(env, { now: tick(i), fetchImpl: f, source: 'cron' });
  const before = env.BOATRACE_KV.writes;
  assert.ok(before >= DAILY_WRITE_BUDGET && before <= DAILY_WRITE_BUDGET + 2, `before=${before}`);
  // 翌日 00:00Z / 00:05Z / 00:10Z: 3 tick とも保存される
  for (let i = 144; i < 147; i++) await runCheck(env, { now: tick(i), fetchImpl: f, source: 'cron' });
  assert.strictEqual(env.BOATRACE_KV.writes, before + 3, '日付が変わっても記録を再開していない');
  const st = JSON.parse(env.BOATRACE_KV._store.get('sentinel:state'));
  assert.deepStrictEqual(st.writes, { day: '2026-11-13', n: 3 });
});

await t('書込予算: 失敗と復旧を 1 日中繰り返しても KV 書込は頭打ちになる', async () => {
  const env = baseEnv({ GH_TOKEN: undefined });
  let healthy = true;
  const f = makeFetch({ health: () => (healthy ? OK : CRON_DEAD) });
  const D0 = new Date('2026-11-12T00:00:00Z');
  for (let i = 0; i < 288; i++) {
    healthy = i % 2 === 1; // 偶数 tick = 失敗、奇数 tick = 復旧
    await runCheck(env, { now: new Date(D0.getTime() + i * 300000), fetchImpl: f, source: 'cron' });
  }
  const w = env.BOATRACE_KV.writes;
  assert.ok(w <= DAILY_WRITE_BUDGET + 48, `writes/day=${w}`);
  assert.strictEqual(
    f.count((c) => c.url.includes('/api/refresh-now')),
    144,
    '失敗 tick で refresh-now を呼んでいない'
  );
});

await t('KV 書込が失敗しても（無料枠の枯渇など）例外にならず refresh-now は呼ぶ。dispatch を連打しない', async () => {
  // KV が書けないと連続失敗数が積み上がらない = 障害扱いに進まない。
  //   KV 枯渇時は本体の heartbeat 書込も失敗して cron_heartbeat_stale に見えるが、
  //   再デプロイでは直らないので dispatch しないのが正しい。
  const env = baseEnv();
  env.BOATRACE_KV.put = async () => {
    throw new Error('KV PUT failed: 429 Too Many Requests');
  };
  const f = makeFetch({ health: () => CRON_DEAD });
  for (let i = 0; i < 6; i++) {
    const r = await runCheck(env, { now: at(i * 5), fetchImpl: f, source: 'cron' });
    assert.strictEqual(r.ok, false);
  }
  assert.strictEqual(
    f.count((c) => c.url.includes('/api/refresh-now')),
    6
  );
  assert.strictEqual(
    f.count((c) => c.url.startsWith('https://api.github.com/')),
    0,
    'KV が書けない状態で GitHub を叩いた'
  );
});

await t('旧バージョンの保存状態（streak / history 無し）からでも壊れずに復旧できる', async () => {
  const env = baseEnv({ GH_TOKEN: undefined });
  // #323 時点の state 形式: 失敗 streak の途中でバージョンアップした想定
  await env.BOATRACE_KV.put(
    'sentinel:state',
    JSON.stringify({
      consecutive_failures: 2,
      incident: null,
      last_redeploy_at: null,
      last_transition_at: null,
      last_action: 'refresh-now http=200',
    })
  );
  const f = makeFetch({ health: () => OK });
  const r = await runCheck(env, { now: T0, fetchImpl: f, source: 'cron' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.consecutive_failures, 0);
  assert.deepStrictEqual(r.state.history, [], 'streak 情報が無い区間は履歴に入れない');
});

await t('HTTP: /health は 200、/run は secret 必須、/status は本体 probe を含む', async () => {
  const env = baseEnv();
  const h = await worker.fetch(new Request('https://sentinel.example.dev/health'), env);
  assert.strictEqual(h.status, 200);
  assert.strictEqual((await h.json()).sentinel, true);
  const r401 = await worker.fetch(new Request('https://sentinel.example.dev/run'), env);
  assert.strictEqual(r401.status, 401);
  const r404 = await worker.fetch(new Request('https://sentinel.example.dev/nope'), env);
  assert.strictEqual(r404.status, 404);
  // /status は globalThis.fetch を使うので stub を差し込む
  const orig = globalThis.fetch;
  globalThis.fetch = makeFetch({ health: () => OK });
  try {
    const s = await worker.fetch(new Request('https://sentinel.example.dev/status'), env);
    assert.strictEqual(s.status, 200);
    const j = await s.json();
    assert.strictEqual(j.gh_token, true);
    assert.strictEqual(j.main_probe.ok, true);
    assert.strictEqual(env.BOATRACE_KV.writes, 0, '/status が KV に書いた');
    // cron が一度も走っていない状態: age_sec は null（worker-watchdog が「未記録」と判定できる）
    assert.deepStrictEqual(j.sentinel_cron, {
      last_at: null,
      age_sec: null,
      write_interval_sec: 3600,
      build_recorded: null,
    });
    assert.strictEqual(j.build, null);

    // cron tick 後: 記録された build と現行 build が一致する（deploy-worker.yml の検証条件）
    const env2 = baseEnv({ BUILD_ID: 'cafe1234' });
    await runCheck(env2, { now: new Date(Date.now() - 90 * 1000), fetchImpl: globalThis.fetch, source: 'cron' });
    const s2 = await worker.fetch(new Request('https://sentinel.example.dev/status'), env2);
    const j2 = await s2.json();
    assert.strictEqual(j2.build, 'cafe1234');
    assert.strictEqual(j2.sentinel_cron.build_recorded, 'cafe1234');
    assert.ok(j2.sentinel_cron.age_sec >= 89 && j2.sentinel_cron.age_sec <= 100, `age_sec=${j2.sentinel_cron.age_sec}`);
    // 本体 probe は 30 秒メモ: 連続アクセスしても本体 /health を叩き直さない
    const before = globalThis.fetch.count((c) => c.url.includes('/health?strict=1'));
    await worker.fetch(new Request('https://sentinel.example.dev/status'), env2);
    await worker.fetch(new Request('https://sentinel.example.dev/status'), env2);
    const after = globalThis.fetch.count((c) => c.url.includes('/health?strict=1'));
    assert.strictEqual(after, before, '/status 連打で本体 /health を増幅している');
  } finally {
    globalThis.fetch = orig;
  }
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
