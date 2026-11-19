/**
 * 表示済みの展示が消えない（2026-11-20 鳴門の報告）
 *
 * Worker: 普段の更新は openapi の previews（展示が無い / 欠ける）をそのまま KV に上書きし、
 *   直接スクレイプで足し直すのは締切窓内の最大 20 レースだけだった。窓を過ぎたレースの展示は
 *   KV から消えたまま戻らない → carryRicherExhibitions で、同じ日の前回 KV のほうが展示が多い
 *   レースは前回の艇データを引き継ぐ。
 * アプリ: _filterStalePreviews が展示も気象も無いレースを除外するため、_mergePreviewIndex が
 *   「新しい応答に無いレース」を捨てると表示済みの展示が消えた → 今日の番組表にあるレースは残す。
 *
 *   node scripts/tests/test_preview_carry.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const exh = (n) => Object.fromEntries([1, 2, 3, 4, 5, 6].map((b) => [String(b), { racer_boat_number: b, racer_exhibition_time: b <= n ? 6.7 : 0 }]));
const row = (sid, rno, n, date = TODAY) => ({ race_stadium_number: sid, race_number: rno, race_date: date, boats: exh(n) });

// --- Worker: 実モジュールを import し、cron 1 回 (scheduled) を KV 付きで回す ---------------
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
let upstreamPreviews = { previews: [] };
globalThis.fetch = async (input) => {
  const u = String(input && input.url ? input.url : input);
  let body = {};
  if (u.includes('previews')) body = upstreamPreviews;
  else if (u.includes('programs')) body = { programs: [{ race_stadium_number: 14, race_number: 1, race_date: TODAY, race_closed_at: TODAY + ' 23:59:00', boats: [] }] };
  else if (u.includes('results')) body = { results: [] };
  else return new Response('', { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
function makeKV(init) {
  const store = new Map(Object.entries(init || {}).map(([k, v]) => [k, { value: v, meta: null }]));
  return {
    async get(k) { const e = store.get(k); return e ? e.value : null; },
    async getWithMetadata(k) { const e = store.get(k); return e ? { value: e.value, metadata: e.meta } : { value: null, metadata: null }; },
    async put(k, v, o) { store.set(k, { value: v, meta: (o && o.metadata) || null }); },
    _store: store,
  };
}
const worker = (await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'worker.js')).href)).default;
const kvPreviews = (kv) => JSON.parse(kv._store.get('previews:today').value).data.previews;

console.log('[Worker: KV の展示を引き継ぐ]');
await t('上流に展示が無くても、前回 KV の展示を残す（鳴門 1R の形）', async () => {
  upstreamPreviews = { previews: [row(14, 1, 0), row(14, 2, 0)] };
  const kv = makeKV({ 'previews:today': JSON.stringify({ updated_at: new Date().toISOString(), data: { previews: [row(14, 1, 6), row(14, 2, 0)] } }) });
  await worker.scheduled({}, { BOATRACE_KV: kv }, { waitUntil() {} });
  const p = kvPreviews(kv).find((r) => r.race_stadium_number === 14 && r.race_number === 1);
  const n = Object.values(p.boats).filter((b) => b.racer_exhibition_time > 0).length;
  assert.strictEqual(n, 6, '展示 ' + n + ' 艇');
});
await t('上流のほうが展示が多ければ上流を使う / 前日の KV は引き継がない', async () => {
  upstreamPreviews = { previews: [row(14, 1, 6), row(14, 2, 0)] };
  const kv = makeKV({ 'previews:today': JSON.stringify({ updated_at: '', data: { previews: [row(14, 1, 3), row(14, 2, 6, '2000-01-01')] } }) });
  await worker.scheduled({}, { BOATRACE_KV: kv }, { waitUntil() {} });
  const ps = kvPreviews(kv);
  const cnt = (r) => Object.values(r.boats).filter((b) => b.racer_exhibition_time > 0).length;
  assert.strictEqual(cnt(ps.find((r) => r.race_number === 1)), 6);
  assert.strictEqual(cnt(ps.find((r) => r.race_number === 2)), 0, '前日の展示を持ち越した');
});

// --- アプリ: _mergePreviewIndex ---------------------------------------------------------
console.log('[アプリ: 新しい応答に無いレースの展示を残す]');
const APP = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
function extractFn(name) {
  const i = APP.indexOf('function ' + name + '(');
  let depth = 0;
  for (let k = APP.indexOf('{', i); k < APP.length; k++) {
    if (APP[k] === '{') depth++;
    else if (APP[k] === '}' && --depth === 0) return APP.slice(i, k + 1);
  }
  throw new Error(name);
}
function appCtx() {
  const ctx = { previewData: null, programData: null };
  vm.createContext(ctx);
  vm.runInContext(extractFn('_previewRichness') + '\n' + extractFn('_mergePreviewIndex'), ctx);
  return ctx;
}
const idx = (n) => ({ boats: exh(n) });
await t('応答に無いレースの表示済み展示を残す', () => {
  const c = appCtx();
  c.programData = { 14: { 1: {}, 2: {} } };
  c.previewData = { 14: { 1: idx(6) } };
  const m = c._mergePreviewIndex({ 14: { 2: idx(0) } });
  assert.ok(m[14][1], '鳴門 1R が消えた');
  assert.strictEqual(c._previewRichness(m[14][1]), 6);
  const m2 = c._mergePreviewIndex({});
  assert.ok(m2[14] && m2[14][1], '空の応答（古い日付で全件除外）で消えた');
});
await t('今日の番組表に無いレース・展示の無いレースは残さない', () => {
  const c = appCtx();
  c.programData = { 14: { 2: {} } };
  c.previewData = { 14: { 1: idx(6), 2: idx(0) }, 5: { 3: idx(6) } };
  const m = c._mergePreviewIndex({});
  assert.ok(!(m[14] && m[14][1]), '番組表に無いレース（前日の残骸）を残した');
  assert.ok(!(m[5] && m[5][3]));
  assert.ok(!(m[14] && m[14][2]), '展示の無いレースを残した');
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail);
