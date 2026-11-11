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
 *
 *   node scripts/tests/test_sentinel_worker.mjs
 */

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'sentinel', 'sentinel.js')).href);
const { runCheck, maxAgeSecFor } = mod;
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
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-11T14:30:00Z')), 2700); // 23:30 JST
  assert.strictEqual(maxAgeSecFor(new Date('2026-11-10T22:00:00Z')), 2700); // 07:00 JST
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
  } finally {
    globalThis.fetch = orig;
  }
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
