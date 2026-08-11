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

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
