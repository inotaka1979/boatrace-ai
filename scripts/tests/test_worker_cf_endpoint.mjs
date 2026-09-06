/**
 * Cloudflare Worker HTTP 層の回帰テスト（FA-5 / 2026-08-11 追加）
 *
 * 背景（監査で確定した 2 件）:
 *   1. /api/refresh-now が完全に未認証だった。refreshAll() は upstream 3 fetch +
 *      最大 20 件の HTML スクレイプ + KV write を伴うため、第三者が連打するだけで
 *      無料枠 (KV write 1000/日, CPU) を枯渇させられた。README / deploy-worker.yml は
 *      「TRIGGER_SECRET 必須」と書いていたが実装に存在しない doc/impl 乖離だった。
 *   2. access-control-allow-origin: '*' のため、/odds-proxy・/orig-exhibition-proxy が
 *      「誰でも使える boatrace.jp 向け無料 CORS プロキシ」として第三者サイトから
 *      利用可能だった。
 *
 * 本テストは worker module を実際に import して fetch() を叩き、
 *   - 未認証 refresh-now が 2 回目以降 429 になること
 *   - TRIGGER_SECRET 提示時は throttle を素通りすること
 *   - 誤った secret は未認証と同じ扱いになること
 *   - ACAO が Origin 許可リストで正規化されること
 * を固定する。
 *
 *   node scripts/tests/test_worker_cf_endpoint.mjs
 */

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// --- Worker ランタイムのスタブ（import より先に用意する） --------------------
const _cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      const v = _cacheStore.get(typeof req === 'string' ? req : req.url);
      return v == null ? undefined : new Response(v);
    },
    async put(req, res) {
      _cacheStore.set(typeof req === 'string' ? req : req.url, await res.text());
    },
  },
};

// upstream fetch は一切外に出さない（空データで即返す）
let fetchCalls = 0;
globalThis.fetch = async (input) => {
  fetchCalls++;
  const u = String(input && input.url ? input.url : input);
  const body = u.includes('results')
    ? { results: [] }
    : u.includes('programs')
      ? { programs: [] }
      : { previews: [] };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

function makeKV() {
  const store = new Map();
  return {
    async get(k) {
      const e = store.get(k);
      return e === undefined ? null : e.value;
    },
    async getWithMetadata(k) {
      const e = store.get(k);
      return e === undefined ? { value: null, metadata: null } : { value: e.value, metadata: e.meta };
    },
    async put(k, v, opts) {
      store.set(k, { value: v, meta: (opts && opts.metadata) || null });
    },
    _store: store,
  };
}

const worker = (await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'worker.js')).href))
  .default;

const SECRET = 'unit-test-secret-value';
const CTX = { waitUntil() {} };

function req(pathname, { origin, headers } = {}) {
  const h = Object.assign({}, headers || {});
  if (origin) h.origin = origin;
  return new Request('https://worker.example.dev' + pathname, { headers: h });
}

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

console.log('=== Cloudflare Worker HTTP 層 (FA-5) ===');

await t('refresh-now: 未認証の初回は実行される', async () => {
  const env = { BOATRACE_KV: makeKV(), TRIGGER_SECRET: SECRET };
  const res = await worker.fetch(req('/api/refresh-now'), env, CTX);
  assert.strictEqual(res.status, 200);
  const j = await res.json();
  assert.strictEqual(j.authorized, false, '未認証なのに authorized=true');
  assert.ok(j.refreshed, 'refreshAll が実行されていない');
});

await t('refresh-now: 未認証の連打は 429 で抑止される', async () => {
  const env = { BOATRACE_KV: makeKV(), TRIGGER_SECRET: SECRET };
  const before = fetchCalls;
  const res = await worker.fetch(req('/api/refresh-now'), env, CTX);
  assert.strictEqual(res.status, 429, '2 回目が throttle されていない');
  const j = await res.json();
  assert.strictEqual(j.throttled, true);
  assert.ok(j.retry_after_sec > 0, 'retry_after_sec が無い');
  assert.strictEqual(fetchCalls, before, 'throttle されたのに upstream を叩いている');
});

await t('refresh-now: 正しい secret は throttle を素通りする', async () => {
  const env = { BOATRACE_KV: makeKV(), TRIGGER_SECRET: SECRET };
  const res = await worker.fetch(
    req('/api/refresh-now', { headers: { 'x-trigger-secret': SECRET } }),
    env,
    CTX
  );
  assert.strictEqual(res.status, 200, 'secret 提示でも throttle された');
  const j = await res.json();
  assert.strictEqual(j.authorized, true);
});

await t('refresh-now: ?secret= クエリでも認証できる', async () => {
  const env = { BOATRACE_KV: makeKV(), TRIGGER_SECRET: SECRET };
  const res = await worker.fetch(req('/api/refresh-now?secret=' + SECRET), env, CTX);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).authorized, true);
});

await t('refresh-now: 誤った secret は未認証扱い（throttle 対象）', async () => {
  const env = { BOATRACE_KV: makeKV(), TRIGGER_SECRET: SECRET };
  const res = await worker.fetch(
    req('/api/refresh-now', { headers: { 'x-trigger-secret': 'wrong-secret-value!!' } }),
    env,
    CTX
  );
  assert.strictEqual(res.status, 429, '誤 secret が認証を通過した');
});

await t('refresh-now: TRIGGER_SECRET 未設定なら常に未認証（throttle のみで保護）', async () => {
  const env = { BOATRACE_KV: makeKV() };
  const res = await worker.fetch(
    req('/api/refresh-now', { headers: { 'x-trigger-secret': '' } }),
    env,
    CTX
  );
  assert.strictEqual(res.status, 429);
});

await t('CORS: 許可オリジンには ACAO をそのオリジンで返す', async () => {
  const env = { BOATRACE_KV: makeKV() };
  const res = await worker.fetch(req('/health', { origin: 'https://inotaka1979.github.io' }), env, CTX);
  assert.strictEqual(
    res.headers.get('access-control-allow-origin'),
    'https://inotaka1979.github.io'
  );
  assert.strictEqual(res.headers.get('vary'), 'Origin');
});

await t('CORS: 許可外オリジンには ACAO を返さない', async () => {
  const env = { BOATRACE_KV: makeKV() };
  const res = await worker.fetch(req('/health', { origin: 'https://evil.example.com' }), env, CTX);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), null, 'ACAO が漏れている');
});

await t('CORS: ワイルドカード ACAO は如何なる経路でも返らない', async () => {
  const env = { BOATRACE_KV: makeKV() };
  for (const p of ['/health', '/api/previews', '/odds-proxy', '/nope']) {
    const res = await worker.fetch(req(p, { origin: 'https://evil.example.com' }), env, CTX);
    assert.notStrictEqual(res.headers.get('access-control-allow-origin'), '*', p + ' で ACAO=*');
  }
});

await t('CORS: Origin 無し（curl / Actions / 外形監視）は従来どおり読める', async () => {
  const env = { BOATRACE_KV: makeKV() };
  const res = await worker.fetch(req('/health'), env, CTX);
  assert.strictEqual(res.status, 200);
  assert.ok((await res.json()).ok !== undefined, '/health が壊れている');
});

await t('CORS: ALLOWED_ORIGINS env で許可を追加できる', async () => {
  const env = { BOATRACE_KV: makeKV(), ALLOWED_ORIGINS: 'https://custom.example.jp' };
  const res = await worker.fetch(req('/health', { origin: 'https://custom.example.jp' }), env, CTX);
  assert.strictEqual(
    res.headers.get('access-control-allow-origin'),
    'https://custom.example.jp'
  );
});

await t('OPTIONS preflight も ACAO が正規化される', async () => {
  const env = { BOATRACE_KV: makeKV() };
  const r = new Request('https://worker.example.dev/api/previews', {
    method: 'OPTIONS',
    headers: { origin: 'https://inotaka1979.github.io' },
  });
  const res = await worker.fetch(r, env, CTX);
  assert.strictEqual(res.status, 204);
  assert.strictEqual(
    res.headers.get('access-control-allow-origin'),
    'https://inotaka1979.github.io'
  );
});


// ---------------------------------------------------------------------------
// 2026-09-06: serve-heal — cron が死んでいたら通常の /api/* アクセスで refreshAll を自走する
//   実障害: 9/5 22:36 JST に scheduled() が停止し heartbeat が更新されず、翌朝まで
//   データが縮退モード (12 分 stale 後の key 単位 live fetch) のままだった。
// ---------------------------------------------------------------------------
console.log('\n=== serve-heal (cron 死亡時のサーブ時セルフヒール) ===');

const WORKER_HREF = pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'worker.js')).href;
let _freshN = 0;
// module ローカルの throttle / heartbeat キャッシュを捨てるため毎回 fresh import する
async function freshWorker() {
  _cacheStore.clear();
  return (await import(WORKER_HREF + '?fresh=' + ++_freshN)).default;
}
function makeCtx() {
  const promises = [];
  return {
    waitUntil(p) { promises.push(Promise.resolve(p).catch(() => {})); },
    promises,
  };
}
// 入れ子の waitUntil (heal → refreshAll) も含めて全て待つ
async function drain(ctx) {
  let i = 0;
  while (i < ctx.promises.length) await ctx.promises[i++];
}
function kvWithHeartbeat(ageMs) {
  const kv = makeKV();
  kv._store.set('programs:today', {
    value: JSON.stringify({ updated_at: new Date().toISOString(), data: { programs: [] } }),
    meta: { wrote_at: new Date().toISOString(), src: 'cron' },
  });
  if (ageMs != null) {
    kv._store.set('health:heartbeat', { value: new Date(Date.now() - ageMs).toISOString(), meta: null });
  }
  return kv;
}

await t('heartbeat が閾値超えなら /api/programs アクセスで refreshAll が走る', async () => {
  const w = await freshWorker();
  const env = { BOATRACE_KV: kvWithHeartbeat(60 * 60 * 1000) }; // 60 分前 = 昼夜どちらの閾値も超える
  const ctx = makeCtx();
  const before = fetchCalls;
  const res = await w.fetch(req('/api/programs'), env, ctx);
  assert.strictEqual(res.status, 200);
  await drain(ctx);
  assert.ok(fetchCalls > before, 'cron 死亡なのに upstream を取りに行っていない (refreshAll 未発火)');
  const h = await (await w.fetch(req('/health'), env, ctx)).json();
  assert.ok(h.serve_heal && h.serve_heal.last_at, '/health に serve_heal.last_at が出ていない');
});

await t('heartbeat が新鮮なら何もしない (cron 正常時の挙動は不変)', async () => {
  const w = await freshWorker();
  const env = { BOATRACE_KV: kvWithHeartbeat(0) };
  const ctx = makeCtx();
  const before = fetchCalls;
  await w.fetch(req('/api/programs'), env, ctx);
  await drain(ctx);
  assert.strictEqual(fetchCalls, before, 'cron 正常なのに refreshAll を発火している');
  const h = await (await w.fetch(req('/health'), env, ctx)).json();
  assert.strictEqual(h.serve_heal.last_at, null);
});

await t('heartbeat 未生成 (旧 Worker) では発火しない (watchdog に任せる)', async () => {
  const w = await freshWorker();
  const env = { BOATRACE_KV: kvWithHeartbeat(null) };
  const ctx = makeCtx();
  const before = fetchCalls;
  await w.fetch(req('/api/programs'), env, ctx);
  await drain(ctx);
  assert.strictEqual(fetchCalls, before);
});

await t('連続アクセスでも refreshAll は 5 分に 1 回 (refresh-now と同じ throttle を共有)', async () => {
  const w = await freshWorker();
  const env = { BOATRACE_KV: kvWithHeartbeat(60 * 60 * 1000) };
  const c1 = makeCtx();
  await w.fetch(req('/api/programs'), env, c1);
  await drain(c1);
  const afterFirst = fetchCalls;
  assert.ok(afterFirst > 0);
  const c2 = makeCtx();
  await w.fetch(req('/api/previews'), env, c2);
  await drain(c2);
  // previews は KV に無いので serveFromKV 自身が live fetch する (1-2 回)。
  // heal による refreshAll (3+ fetch) が二重に走っていないことを、throttle 状態で確認する。
  const r = await w.fetch(req('/api/refresh-now'), env, makeCtx());
  assert.strictEqual(r.status, 429, 'heal 発火後に throttle が効いていない = 連打で refreshAll が多重実行される');
});

await t('serve-heal は heartbeat を書かない (cron 生存証跡を偽装しない)', async () => {
  const w = await freshWorker();
  const kv = kvWithHeartbeat(60 * 60 * 1000);
  const hbBefore = kv._store.get('health:heartbeat').value;
  const ctx = makeCtx();
  await w.fetch(req('/api/programs'), { BOATRACE_KV: kv }, ctx);
  await drain(ctx);
  assert.strictEqual(kv._store.get('health:heartbeat').value, hbBefore,
    'serve-heal が heartbeat を更新している → watchdog が cron 死亡を検知できなくなる');
});


// ---------------------------------------------------------------------------
// 2026-09-06: base-first — 重い HTML スクレイプより先に base を KV へ書き、heartbeat も
//   base 書込直後に打つ。実障害: 日中の run が途中 kill されると KV も heartbeat も
//   残らず、cron が「発火していない」ように見えていた。
// ---------------------------------------------------------------------------
console.log('\n=== base-first (KV 書込と heartbeat をスクレイプより前に) ===');

function jstCloseAt(minutesFromNow) {
  const t = new Date(Date.now() + minutesFromNow * 60000 + 9 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ` +
         `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00`;
}
function jstToday() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}
// イベント順を記録する stub 一式。races 件のレースが「展示窓内 (締切 10 分後)」にある programs を返す。
function withOrderedStubs(races) {
  const log = [];
  const origFetch = globalThis.fetch;
  const programs = [];
  for (let i = 1; i <= races; i++) {
    programs.push({
      race_stadium_number: 1, race_number: i, race_date: jstToday(),
      race_closed_at: jstCloseAt(10 + i), // 全て展示窓 [close-30m, close+5m] 内
      boats: [],
    });
  }
  globalThis.fetch = async (input) => {
    const u = String(input && input.url ? input.url : input);
    if (u.includes('boatrace.jp')) {
      log.push('scrape:' + (u.includes('beforeinfo') ? 'beforeinfo' : u.includes('raceresult') ? 'raceresult' : 'other'));
      return new Response('<html><body></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    fetchCalls++;
    // mergeBoatraceJpExhibition は「previews に同じレースがあり boats に展示が無い」ものだけを
    // 対象にする (該当 preview が無ければ continue)。programs と対になる previews を返す。
    const previewsArr = programs.map((p) => ({
      race_stadium_number: p.race_stadium_number, race_number: p.race_number,
      race_date: p.race_date, race_closed_at: p.race_closed_at, boats: {},
    }));
    const body = u.includes('results') ? { results: [] }
      : u.includes('programs') ? { programs, race_date: jstToday() }
      : { previews: previewsArr };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const kv = makeKV();
  const origPut = kv.put.bind(kv);
  kv.put = async (k, v, o) => { log.push('put:' + k); return origPut(k, v, o); };
  return { log, kv, restore: () => { globalThis.fetch = origFetch; } };
}
const firstIdx = (log, pred) => log.findIndex(pred);

await t('refreshAll: base の KV 書込が最初の HTML スクレイプより前に起きる', async () => {
  const w = await freshWorker();
  const st = withOrderedStubs(3);
  try {
    const res = await w.fetch(req('/api/refresh-now'), { BOATRACE_KV: st.kv }, makeCtx());
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.ok(j.refreshed && j.refreshed.previews && j.refreshed.previews.kv_base_ok, 'kv_base_ok が立っていない: ' + JSON.stringify(j.refreshed.previews));
    const iPut = firstIdx(st.log, (e) => e === 'put:previews:today');
    const iScrape = firstIdx(st.log, (e) => e.startsWith('scrape:'));
    assert.ok(iPut >= 0, 'previews が KV に書かれていない');
    assert.ok(iScrape >= 0, 'テスト前提: 展示窓内のレースがあるのにスクレイプが走っていない');
    assert.ok(iPut < iScrape, `KV 書込 (${iPut}) がスクレイプ (${iScrape}) より後 = 途中 kill で全損する順序`);
  } finally { st.restore(); }
});

await t('scheduled(): heartbeat が最初の HTML スクレイプより前に書かれる', async () => {
  const w = await freshWorker();
  const st = withOrderedStubs(3);
  try {
    await w.scheduled({}, { BOATRACE_KV: st.kv }, makeCtx());
    const iHb = firstIdx(st.log, (e) => e === 'put:health:heartbeat');
    const iScrape = firstIdx(st.log, (e) => e.startsWith('scrape:'));
    assert.ok(iHb >= 0, 'heartbeat が書かれていない');
    assert.ok(iScrape >= 0, 'テスト前提: スクレイプが走っていない');
    assert.ok(iHb < iScrape, `heartbeat (${iHb}) がスクレイプ (${iScrape}) より後 = 途中 kill で cron 死亡に見える`);
    assert.strictEqual(st.log.filter((e) => e === 'put:health:heartbeat').length, 1, 'heartbeat を 2 回書いている (KV 書込枠の浪費)');
  } finally { st.restore(); }
});

await t('HTML スクレイプが失敗しても base は KV に残る', async () => {
  const w = await freshWorker();
  const st = withOrderedStubs(2);
  const f = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = String(input && input.url ? input.url : input);
    if (u.includes('boatrace.jp')) throw new Error('boatrace.jp down');
    return f(input);
  };
  try {
    await w.fetch(req('/api/refresh-now'), { BOATRACE_KV: st.kv }, makeCtx());
    assert.ok(st.kv._store.has('previews:today'), 'previews が無い');
    assert.ok(st.kv._store.has('programs:today'), 'programs が無い');
    assert.ok(st.kv._store.has('results:today'), 'results が無い');
  } finally { globalThis.fetch = f; st.restore(); }
});

await t('1 run の展示スクレイプは MAX_HTML_SCRAPES_PER_RUN (12) を超えない', async () => {
  const w = await freshWorker();
  const st = withOrderedStubs(20); // 展示窓内に 20 レース
  try {
    await w.fetch(req('/api/refresh-now'), { BOATRACE_KV: st.kv }, makeCtx());
    const n = st.log.filter((e) => e === 'scrape:beforeinfo').length;
    assert.ok(n > 0, 'テスト前提: 展示スクレイプが走っていない');
    assert.ok(n <= 12, `展示スクレイプ ${n} 件 > 12 (1 run が重すぎて途中 kill の再発リスク)`);
  } finally { st.restore(); }
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
