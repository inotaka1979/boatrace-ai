/**
 * Cloudflare Worker の KV 書込枠（2026-11-20）
 *
 *   - heartbeat は直近 9 分以内に書いていれば書かない（日中 5 分毎 cron で ~180 → ~90 writes/日）
 *   - KV put の失敗を数え、/health の kv_put_failures に出す（従来は heartbeat の失敗を握り潰し、
 *     枠切れと cron 停止を区別できなかった）
 *
 *   node scripts/tests/test_worker_kv_budget.mjs
 */

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
globalThis.fetch = async (input) => {
  const u = String(input && input.url ? input.url : input);
  const body = u.includes('results') ? { results: [] } : u.includes('programs') ? { programs: [] } : { previews: [] };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
function makeKV({ failPut } = {}) {
  const store = new Map();
  const puts = [];
  return {
    async get(k) { const e = store.get(k); return e === undefined ? null : e.value; },
    async getWithMetadata(k) { const e = store.get(k); return e === undefined ? { value: null, metadata: null } : { value: e.value, metadata: e.meta }; },
    async put(k, v, opts) {
      puts.push(k);
      if (failPut) throw new Error('KV put() limit exceeded for the day.');
      store.set(k, { value: v, meta: (opts && opts.metadata) || null });
    },
    _store: store,
    _puts: puts,
  };
}
const worker = (await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'worker.js')).href)).default;
const CTX = { waitUntil() {} };

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}
const hbPuts = (kv) => kv._puts.filter((k) => k === 'health:heartbeat').length;

await t('heartbeat: 未記録なら書く、9 分以内なら書かない、9 分を過ぎたら書く', async () => {
  const kv = makeKV();
  const env = { BOATRACE_KV: kv };
  await worker.scheduled({}, env, CTX);
  assert.strictEqual(hbPuts(kv), 1, '初回');
  await worker.scheduled({}, env, CTX);
  assert.strictEqual(hbPuts(kv), 1, '直後の 2 回目は書かない');
  kv._store.set('health:heartbeat', { value: new Date(Date.now() - 9.5 * 60000).toISOString(), meta: null });
  await worker.scheduled({}, env, CTX);
  assert.strictEqual(hbPuts(kv), 2, '9 分超で書く');
});
await t('KV put が失敗したら /health の kv_put_failures に出る', async () => {
  const kv = makeKV({ failPut: true });
  const env = { BOATRACE_KV: kv };
  await worker.scheduled({}, env, CTX).catch(() => {});
  const res = await worker.fetch(new Request('https://w.example.dev/health'), { BOATRACE_KV: makeKV() }, CTX);
  const j = await res.json();
  assert.ok(j.kv_put_failures && j.kv_put_failures.count >= 1, JSON.stringify(j.kv_put_failures));
  assert.ok(/limit exceeded/.test(j.kv_put_failures.last.error));
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail);
