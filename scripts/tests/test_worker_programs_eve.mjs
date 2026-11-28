/**
 * Worker: 朝、上流 (openapi) が当日分に切り替わる前でも、今日の番組表・展示・結果を出す（2026-11-28）
 *
 * 実害: 2026-11-28 の朝、番組表がどの経路からも当日分に切り替わっていなかった（上流は 9:20 すぎまで
 *   前日のまま、自前の当日分は GitHub の定時実行の遅れで昼前後）。アプリは開催中の 14 場すべてを「次節」と
 *   表示した。
 *
 * ここで固定すること:
 *   1. 番組表: 自前の当日分が無い間は、上流の今日の行 + 前の晩に取った分（data/schedule/programs_tomorrow.json）
 *   2. 番組表が今日の分の時、上流の previews / results が別の日のままなら、その行を今日の分に混ぜない
 *      （previews は番組表から作る / results は空から始めて公式ページから取った分を足す）
 *   3. KV の文書が「古い」と判定された時の経路と、その後ろの補完も同じ（前日の行で今日の分を上書きしない）
 *
 *   node scripts/tests/test_worker_programs_eve.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = path.join(ROOT, 'scripts', 'tests', 'fixtures');
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', String(e && e.message ? e.message : e).split('\n')[0]); fail++; }
}

// --- 時計（「その日」の朝から始め、自分で進める）-------------------------------------------------
const RealDate = Date;
const jstDay = (ms) => new RealDate(ms + 9 * 3600e3).toISOString().slice(0, 10);
const DAY = jstDay(RealDate.now());
const dayPlus = (n) => jstDay(RealDate.parse(`${DAY}T12:00:00+09:00`) + n * 86400e3);
const YDAY = dayPlus(-1);
const TOMORROW = dayPlus(1);
const at = (hhmm, sec = 0, day = DAY) => RealDate.parse(`${day}T${hhmm}:${String(sec).padStart(2, '0')}+09:00`);
let clock = at('08:40');
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(clock); else super(...a); }
  static now() { return clock; }
}
globalThis.Date = FakeDate;
const MIN = 60000;
const iso = (ms) => new RealDate(ms).toISOString();
const hhmmOf = (deltaMin) => new RealDate(clock + 9 * 3600e3 + deltaMin * MIN).toISOString().slice(11, 16);
// 締切時刻（今の時計から deltaMin 分後。日付は day）
const closedAt = (deltaMin, day = DAY) => `${day} ${hhmmOf(deltaMin)}:00`;

// --- 取得元の差し替え ---------------------------------------------------------------------------
const PAGE_EXHIBITION = fs.readFileSync(path.join(FIX, 'beforeinfo_naruto_R01.html'), 'utf8');
const PAGE_RESULT = fs.readFileSync(path.join(FIX, 'raceresult_start_info.html'), 'utf8');
// src.official / src.eve / src.programs / src.previews / src.results:
//   オブジェクト = その JSON、文字列 = そのままの本文、null = 404
let src;
let official;   // { beforeinfo, raceresult }: 文字列 / (url) => 文字列 / null (= 404)
let hits;       // 取りに行った先の記録
const respond = (v) => {
  if (v == null) return new Response('', { status: 404 });
  if (typeof v === 'string') return new Response(v, { status: 200 });
  return new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
};
globalThis.fetch = async (input) => {
  const u = String(input && input.url ? input.url : input);
  if (u.includes('boatrace.jp')) {
    const kind = u.includes('beforeinfo') ? 'beforeinfo' : u.includes('raceresult') ? 'raceresult' : 'other';
    hits.push(kind + ':' + (/jcd=(\d+)/.exec(u) || [])[1] + '-' + (/rno=(\d+)/.exec(u) || [])[1] + '@' + (/hd=(\d+)/.exec(u) || [])[1]);
    const s = official[kind];
    const page = typeof s === 'function' ? s(u) : s;
    return page ? new Response(page, { status: 200 }) : new Response('', { status: 404 });
  }
  if (u.includes('raw.githubusercontent.com')) {
    if (u.endsWith('/data/programs/today.json')) { hits.push('official'); return respond(src.official); }
    if (u.endsWith('/data/schedule/programs_tomorrow.json')) { hits.push('eve'); return respond(src.eve); }
    return new Response('', { status: 404 });
  }
  const kind = u.includes('/previews/') ? 'previews' : u.includes('/programs/') ? 'programs' : u.includes('/results/') ? 'results' : null;
  if (!kind) return new Response('', { status: 404 });
  hits.push('openapi:' + kind);
  return respond(src[kind]);
};
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

// --- KV -----------------------------------------------------------------------------------------
function makeKV() {
  const store = new Map();
  const kv = {
    puts: [],
    async get(k) { const e = store.get(k); return e ? e.value : null; },
    async getWithMetadata(k) { const e = store.get(k); return e ? { value: e.value, metadata: e.meta } : { value: null, metadata: null }; },
    async put(k, v, o) {
      store.set(k, { value: v, meta: (o && o.metadata) || null });
      kv.puts.push({ k, at: clock, src: (o && o.metadata && o.metadata.src) || null });
    },
    _store: store,
  };
  return kv;
}
function seed(kv, key, data, ageMin = 0, srcName = 'cron') {
  const when = iso(clock - ageMin * MIN);
  kv._store.set(key, { value: JSON.stringify({ updated_at: when, data }), meta: { hash: 'seed', wrote_at: when, src: srcName } });
}
const has = (kv, key) => kv._store.has(key);
const doc = (kv, key) => JSON.parse(kv._store.get(key).value);
const putsOf = (kv, key) => kv.puts.filter((p) => p.k === key);

// --- データの形 ---------------------------------------------------------------------------------
const progRow = (sid, rno, deltaMin, day = DAY, tag = '') => ({
  race_date: day, race_stadium_number: sid, race_number: rno, race_closed_at: closedAt(deltaMin, day),
  race_title: 'テスト' + tag,
  boats: [1, 2, 3, 4, 5, 6].map((n) => ({ racer_boat_number: n, racer_number: 4000 + sid * 10 + n })),
});
// 自前の文書（先頭に race_date がある）と、上流の文書（先頭は最初の行）
const ownDoc = (day, rows, extra = {}) => Object.assign({ updated_at: iso(clock - 600 * MIN), race_date: day }, extra, { programs: rows });
const openapiDoc = (rows) => ({ programs: rows });
// previews: 上流の行（展示なし・体重あり、boats は配列）と、展示のある上流の行
const upBoats = (ex) => [1, 2, 3, 4, 5, 6].map((n) => ({
  racer_boat_number: n, racer_weight: 52, racer_weight_adjustment: 0, racer_exhibition_time: ex ? 6.7 + n / 100 : 0,
  racer_course_number: ex ? n : null, racer_start_timing: ex ? 0.1 : null, racer_tilt_adjustment: 0,
}));
const pvRow = (sid, rno, day = DAY, ex = false) => ({
  race_date: day, race_stadium_number: sid, race_number: rno, race_wind: ex ? 3 : 0, race_wind_direction_number: 17,
  race_wave: 0, race_weather_number: 1, race_temperature: ex ? 12 : 0, race_water_temperature: ex ? 11 : 0, boats: upBoats(ex),
});
// この Worker が展示を取った行（boats は艇番がキー）
const richRow = (sid, rno, day = DAY) => {
  const row = pvRow(sid, rno, day, true);
  row.boats = Object.fromEntries(row.boats.map((b) => [b.racer_boat_number, Object.assign(b, { racer_propeller: '', racer_parts_replaced: '', racer_adjust_weight: 0 })]));
  return row;
};
const finished = (sid, rno, day = DAY) => ({
  race_date: day, race_stadium_number: sid, race_number: rno, race_technique_number: 2,
  boats: [1, 2, 3, 4, 5, 6].map((n) => ({ racer_boat_number: n, racer_place_number: n })),
  payouts: { trifecta: [{ combination: '1-2-3', payout: 1230 }] },
});
const keys = (rows) => rows.map((r) => `${r.race_stadium_number}-${r.race_number}`).sort();
const days = (rows) => [...new Set(rows.map((r) => r.race_date))].sort();
const exRaces = (previewsDoc) => previewsDoc.previews
  .filter((r) => Object.values(r.boats || {}).some((b) => b && b.racer_exhibition_time > 0))
  .map((r) => `${r.race_stadium_number}-${r.race_number}@${r.race_date}`).sort();
const finishedRaces = (resultsDoc) => resultsDoc.results
  .filter((r) => r.race_technique_number != null).map((r) => `${r.race_stadium_number}-${r.race_number}@${r.race_date}`).sort();

let seq = 0;
async function load() {
  const url = pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'worker.js')).href + '?programs_eve=' + (++seq);
  return (await import(url)).default;
}
function makeCtx() {
  const waits = [];
  return { waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); }, async settle() { while (waits.length) await waits.shift(); } };
}
const CRON = '*/5 23,0-13 * * *';
async function cron(worker, kv, ctx) {
  await worker.scheduled({ cron: CRON, scheduledTime: clock }, { BOATRACE_KV: kv }, ctx);
  await ctx.settle();
}
async function get(worker, kv, ctx, pathname) {
  const res = await worker.fetch(new Request('https://worker.example' + pathname), { BOATRACE_KV: kv }, ctx);
  const body = await res.json();
  await ctx.settle();
  return { status: res.status, body };
}
let logs = [];
const quiet = (fn) => async () => {
  const log = console.log, warn = console.warn, err = console.error;
  logs = [];
  console.log = console.warn = console.error = (...a) => { logs.push(a.map(String).join(' ')); };
  try { await fn(); } finally { console.log = log; console.warn = warn; console.error = err; }
};
const lastRefresh = () => {
  const line = logs.filter((l) => l.startsWith('refresh: ')).pop();
  return line ? JSON.parse(line.slice('refresh: '.length)) : null;
};

// 朝の場面（8:40 JST）: 鳴門 (14) は今日も前日も開催、常滑 (8) は今日だけ、桐生 (1) は前日だけ。
//   上流の 3 つの文書はまだ前日のまま。自前の当日分 (official) も前日のまま。前の晩に取った分 (eve) は今日。
//   鳴門 1R は締切 5 分前（展示の窓の中）、2R は 21 分後（窓の中）、常滑 1R は 2 時間後。
function morning() {
  clock = at('08:40');
  const eveRows = [progRow(14, 1, 5), progRow(14, 2, 21), progRow(8, 1, 120)];
  src = {
    official: ownDoc(YDAY, [progRow(14, 1, 5, YDAY, 'Y_OFFICIAL'), progRow(1, 1, 400, YDAY, 'Y_OFFICIAL')]),
    eve: ownDoc(DAY, eveRows, { partial: false, expected: 3 }),
    programs: openapiDoc([progRow(14, 1, 5, YDAY, 'Y_OPENAPI'), progRow(14, 2, 21, YDAY, 'Y_OPENAPI'), progRow(1, 1, 400, YDAY, 'Y_OPENAPI')]),
    previews: { previews: [pvRow(14, 1, YDAY, true), pvRow(14, 2, YDAY, true), pvRow(1, 1, YDAY, true)] },
    results: { results: [finished(14, 1, YDAY), finished(14, 2, YDAY), finished(1, 1, YDAY)] },
  };
  official = { beforeinfo: null, raceresult: null };
  hits = [];
  return makeKV();
}

// =============================================================================================
console.log('[番組表: 自前の当日分が無い間は、上流の今日の行 + 前の晩に取った分]');
await t('朝、上流も自前の当日分も前日のまま → 前の晩に取った分が今日の番組表として配られる', quiet(async () => {
  const kv = morning();
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  const pg = doc(kv, 'programs:today').data;
  assert.deepStrictEqual(keys(pg.programs), ['14-1', '14-2', '8-1']);
  assert.deepStrictEqual(days(pg.programs), [DAY]);
  assert.strictEqual(pg._source_base, 'official_eve');
  assert.strictEqual(pg.race_date, DAY);
  assert.strictEqual(pg.updated_at, src.eve.updated_at, '取った時刻は前の晩のまま出す（今の時刻に書き換えない）');
  const r = await get(worker, kv, ctx, '/api/programs');
  assert.deepStrictEqual(days(r.body.programs), [DAY], 'アプリに届く番組表が今日の分');
  assert.strictEqual(r.body.programs.length, 3);
  const ref = lastRefresh();
  assert.strictEqual(ref.programs.base, 'official_eve');
  assert.strictEqual(ref.programs.today, true);
}));
await t('前の晩の分が無ければ従来どおり（上流の文書をそのまま。previews / results も触らない）', quiet(async () => {
  const kv = morning();
  src.eve = null;
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(doc(kv, 'programs:today').data, src.programs);
  assert.deepStrictEqual(days(doc(kv, 'previews:today').data.previews), [YDAY]);
  assert.deepStrictEqual(finishedRaces(doc(kv, 'results:today').data), [`1-1@${YDAY}`, `14-1@${YDAY}`, `14-2@${YDAY}`]);
  const ref = lastRefresh();
  assert.strictEqual(ref.programs.today, false);
  assert.strictEqual(ref.previews.other_day, undefined);
  assert.strictEqual(ref.results.other_day, undefined);
}));
await t('上流が今日の分を全部持っていれば、上流の文書をそのまま使う（前の晩の分は足さない）', quiet(async () => {
  const kv = morning();
  src.programs = openapiDoc([progRow(14, 1, 5, DAY, 'UP'), progRow(14, 2, 21, DAY, 'UP'), progRow(8, 1, 120, DAY, 'UP')]);
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(doc(kv, 'programs:today').data, src.programs);
  assert.strictEqual(lastRefresh().programs.base, 'openapi');
}));
await t('上流に今日の行があるレースは上流の行、無いレースを前の晩の分で埋める（重ならない）', quiet(async () => {
  const kv = morning();
  // 上流は鳴門だけ今日に切り替わった（常滑がまだ無い）。前日の行も 1 つ混ざっている
  src.programs = openapiDoc([progRow(14, 1, 5, DAY, 'UP'), progRow(14, 2, 21, DAY, 'UP'), progRow(1, 1, 400, YDAY, 'Y')]);
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  const pg = doc(kv, 'programs:today').data;
  assert.deepStrictEqual(keys(pg.programs), ['14-1', '14-2', '8-1']);
  assert.deepStrictEqual(days(pg.programs), [DAY], '前日の行は入れない');
  const title = Object.fromEntries(pg.programs.map((p) => [`${p.race_stadium_number}-${p.race_number}`, p.race_title]));
  assert.deepStrictEqual(title, { '14-1': 'テストUP', '14-2': 'テストUP', '8-1': 'テスト' }, '鳴門は上流の行、常滑は前の晩の行');
  assert.strictEqual(pg._source_base, 'openapi+eve');
}));
await t('自前の当日分があれば、それだけを使う（上流の番組表・前の晩の分は取りに行かない）', quiet(async () => {
  const kv = morning();
  src.official = ownDoc(DAY, [progRow(14, 1, 5, DAY, 'OWN'), progRow(8, 1, 120, DAY, 'OWN')]);
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  const pg = doc(kv, 'programs:today').data;
  assert.deepStrictEqual(pg.programs.map((p) => p.race_title), ['テストOWN', 'テストOWN']);
  assert.strictEqual(pg._source_base, 'official');
  assert.deepStrictEqual(hits.filter((h) => h === 'eve' || h === 'openapi:programs'), []);
}));
await t('別の日の文書は JSON として読まない（朝は「前日のまま」の 600KB が 2 つ届く）', quiet(async () => {
  const kv = morning();
  const worker = await load();
  const ctx = makeCtx();
  const real = JSON.parse;
  const parsed = [];
  JSON.parse = function (s, r) { if (typeof s === 'string') parsed.push(s); return real.call(JSON, s, r); };
  try {
    await worker.scheduled({ cron: CRON, scheduledTime: clock }, { BOATRACE_KV: kv }, ctx);
    await ctx.settle();
  } finally { JSON.parse = real; }
  assert.ok(hits.includes('official') && hits.includes('openapi:programs') && hits.includes('eve'), '3 つとも取りには行く');
  assert.ok(!parsed.some((s) => s.includes('Y_OFFICIAL')), '前日のままの自前の文書を読んだ');
  assert.ok(!parsed.some((s) => s.includes('Y_OPENAPI')), '前日のままの上流の文書を読んだ');
  assert.strictEqual(doc(kv, 'programs:today').data.programs.length, 3);
}));
await t('前の晩の分が別の日のもの（夕方に取った翌日分・古い残り）なら使わない', quiet(async () => {
  for (const day of [TOMORROW, YDAY]) {
    const kv = morning();
    src.eve = ownDoc(day, [progRow(14, 1, 5, day), progRow(8, 1, 120, day)]);
    const worker = await load();
    const ctx = makeCtx();
    await cron(worker, kv, ctx);
    assert.deepStrictEqual(doc(kv, 'programs:today').data, src.programs, day);
  }
}));
await t('前の晩の文書の中に別の日の行が混ざっていても、今日の行だけを使う', quiet(async () => {
  const kv = morning();
  src.eve = ownDoc(DAY, [progRow(14, 1, 5), progRow(8, 1, 120, YDAY), progRow(8, 2, 150, TOMORROW), null, 'x', { race_stadium_number: 3, race_number: 1 }]);
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(keys(doc(kv, 'programs:today').data.programs), ['14-1']);
}));
await t('前の晩の文書が壊れている・空の時は、従来どおり上流の文書', quiet(async () => {
  for (const eve of ['{"race_date":"' + DAY + '","programs":[{"race_', '<html>503</html>', ownDoc(DAY, []), { race_date: DAY, programs: 'x' }, { race_date: DAY }]) {
    const kv = morning();
    src.eve = eve;
    const worker = await load();
    const ctx = makeCtx();
    await cron(worker, kv, ctx);
    assert.deepStrictEqual(doc(kv, 'programs:today').data, src.programs, JSON.stringify(eve).slice(0, 40));
  }
}));
await t('上流の番組表が取れなくても、前の晩の分があれば配る。どちらも無ければ番組表は書かない', quiet(async () => {
  let kv = morning();
  src.programs = null; // 404
  let worker = await load();
  let ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(keys(doc(kv, 'programs:today').data.programs), ['14-1', '14-2', '8-1']);

  kv = morning();
  src.programs = null;
  src.eve = null;
  worker = await load();
  ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.ok(!has(kv, 'programs:today'));
  assert.strictEqual(lastRefresh().programs.ok, false);
}));
await t('日付が変わる時: 23:55 は前日の当日分、0:00 を過ぎたら前の晩に取った分（今日の分）', quiet(async () => {
  const kv = morning();
  src.previews = { previews: [] };
  src.results = { results: [] };
  // 23:55（前日）: 自前の当日分 = 前日の番組表が「今日の分」
  clock = at('23:55', 0, YDAY);
  const worker = await load();
  const ctx = makeCtx();
  await worker.scheduled({ cron: '*/30 14-22 * * *', scheduledTime: clock }, { BOATRACE_KV: kv }, ctx);
  await ctx.settle();
  assert.deepStrictEqual(days(doc(kv, 'programs:today').data.programs), [YDAY]);
  assert.strictEqual(doc(kv, 'programs:today').data._source_base, 'official');
  // 0:00:10: 自前の当日分は前日のまま → 前の晩に取った分
  clock = at('00:00', 10);
  await worker.scheduled({ cron: '*/30 14-22 * * *', scheduledTime: clock }, { BOATRACE_KV: kv }, ctx);
  await ctx.settle();
  assert.deepStrictEqual(days(doc(kv, 'programs:today').data.programs), [DAY]);
  assert.strictEqual(doc(kv, 'programs:today').data._source_base, 'official_eve');
}));

// =============================================================================================
console.log('[番組表が今日の分の時、上流の previews / results が前日のままなら、今日の分に混ぜない]');
await t('previews は番組表から作り直し、results は空から始める（前日の行を KV に書かない）', quiet(async () => {
  const kv = morning();
  // 前の日の夜に書かれた KV（前日の展示・結果）が残っている
  seed(kv, 'previews:today', { previews: [richRow(14, 1, YDAY), richRow(14, 2, YDAY)] }, 40);
  seed(kv, 'results:today', { results: [finished(14, 1, YDAY), finished(14, 2, YDAY)] }, 40);
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  const pv = doc(kv, 'previews:today').data;
  assert.deepStrictEqual(keys(pv.previews), ['14-1', '14-2', '8-1'], '今日の番組表のレースだけ');
  assert.deepStrictEqual(days(pv.previews), [DAY]);
  assert.deepStrictEqual(exRaces(pv), [], '前日の展示を今日の同じ場・同じ R に持ち込まない');
  const rs = doc(kv, 'results:today').data;
  assert.deepStrictEqual(rs.results, [], '前日の確定結果を今日の結果に入れない');
  const ref = lastRefresh();
  assert.strictEqual(ref.previews.other_day, 3);
  assert.strictEqual(ref.results.other_day, 3);
  // アプリに届く応答も同じ
  const r1 = await get(worker, kv, ctx, '/api/previews');
  assert.deepStrictEqual(days(r1.body.previews), [DAY]);
  const r2 = await get(worker, kv, ctx, '/api/results');
  assert.deepStrictEqual(r2.body.results, []);
}));
await t('前日に同じ場・同じ R の展示があっても、今日の展示を公式ページから取る', quiet(async () => {
  const kv = morning();
  official.beforeinfo = PAGE_EXHIBITION;
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  const pv = doc(kv, 'previews:today').data;
  assert.deepStrictEqual(exRaces(pv), [`14-1@${DAY}`, `14-2@${DAY}`], '締切の窓の中の 2 レース');
  const hd = DAY.replace(/-/g, '');
  assert.deepStrictEqual(hits.filter((h) => h.startsWith('beforeinfo')).sort(), [`beforeinfo:14-1@${hd}`, `beforeinfo:14-2@${hd}`], '今日の日付のページを取る');
  const r = await get(worker, kv, ctx, '/api/previews');
  assert.deepStrictEqual(exRaces(r.body), [`14-1@${DAY}`, `14-2@${DAY}`]);
}));
await t('前日に同じ場・同じ R の確定結果があっても、今日の結果を公式ページから取る', quiet(async () => {
  const kv = morning();
  clock = at('08:50'); // 鳴門 1R（8:45 締切）から 5 分 → 結果の窓の中
  src.eve = ownDoc(DAY, [progRow(14, 1, -5), progRow(14, 2, 21), progRow(8, 1, 120)]);
  official.raceresult = (u) => (/rno=1\b/.test(u) ? PAGE_RESULT : null);
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  const rs = doc(kv, 'results:today').data;
  assert.deepStrictEqual(finishedRaces(rs), [`14-1@${DAY}`]);
  assert.deepStrictEqual(days(rs.results), [DAY]);
  const hd = DAY.replace(/-/g, '');
  assert.deepStrictEqual(hits.filter((h) => h.startsWith('raceresult')), [`raceresult:14-1@${hd}`]);
}));
await t('次の回も上流が前日のまま → 取ってあった今日の展示・結果は残り、取り直さない', quiet(async () => {
  const kv = morning();
  clock = at('08:50');
  src.eve = ownDoc(DAY, [progRow(14, 1, -5), progRow(14, 2, 21), progRow(8, 1, 120)]);
  official.beforeinfo = PAGE_EXHIBITION;
  official.raceresult = (u) => (/rno=1\b/.test(u) ? PAGE_RESULT : null);
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), [`14-1@${DAY}`, `14-2@${DAY}`]);
  assert.deepStrictEqual(finishedRaces(doc(kv, 'results:today').data), [`14-1@${DAY}`]);
  // 5 分後: 公式ページは取れなくなった（取り直しに頼れない）
  for (let i = 1; i <= 3; i++) {
    clock = at('08:50') + i * 5 * MIN;
    official = { beforeinfo: null, raceresult: null };
    hits = [];
    await cron(worker, kv, ctx);
    assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), [`14-1@${DAY}`, `14-2@${DAY}`], i + ' 回目: 展示');
    assert.deepStrictEqual(finishedRaces(doc(kv, 'results:today').data), [`14-1@${DAY}`], i + ' 回目: 結果');
    assert.deepStrictEqual(hits.filter((h) => h === 'raceresult:14-1@' + DAY.replace(/-/g, '')), [], '確定済みの結果は取り直さない');
    assert.deepStrictEqual(days(doc(kv, 'previews:today').data.previews), [DAY]);
    assert.deepStrictEqual(days(doc(kv, 'results:today').data.results), [DAY]);
  }
}));
await t('上流が今日の分に切り替わったら、上流の行に取ってあった展示・結果を重ねる', quiet(async () => {
  const kv = morning();
  clock = at('08:50');
  src.eve = ownDoc(DAY, [progRow(14, 1, -5), progRow(14, 2, 21), progRow(8, 1, 120)]);
  official.beforeinfo = PAGE_EXHIBITION;
  official.raceresult = (u) => (/rno=1\b/.test(u) ? PAGE_RESULT : null);
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  // 9:30 に上流が切り替わった（展示・結果はまだ持っていない）
  clock = at('09:30');
  official = { beforeinfo: null, raceresult: null };
  src.programs = openapiDoc([progRow(14, 1, -45), progRow(14, 2, -19), progRow(8, 1, 80)]);
  src.previews = { previews: [pvRow(14, 1), pvRow(14, 2), pvRow(8, 1)] };
  src.results = { results: [{ race_date: DAY, race_stadium_number: 14, race_number: 1, race_technique_number: null, boats: [] }] };
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), [`14-1@${DAY}`, `14-2@${DAY}`]);
  assert.deepStrictEqual(finishedRaces(doc(kv, 'results:today').data), [`14-1@${DAY}`]);
  assert.strictEqual(lastRefresh().programs.base, 'openapi');
  assert.strictEqual(lastRefresh().previews.other_day, undefined);
}));
await t('上流の previews に今日の行と前日の行が混ざっている時は、前日の行だけ落とす', quiet(async () => {
  const kv = morning();
  src.previews = { previews: [pvRow(14, 1, DAY, true), pvRow(14, 2, YDAY, true), pvRow(1, 1, YDAY, true)] };
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  const pv = doc(kv, 'previews:today').data;
  assert.deepStrictEqual(pv.previews.map((r) => `${r.race_stadium_number}-${r.race_number}@${r.race_date}`), [`14-1@${DAY}`]);
  assert.strictEqual(lastRefresh().previews.other_day, 2);
}));
await t('日付の無い行は落とさない（previews / results）', quiet(async () => {
  const kv = morning();
  const noDate = pvRow(14, 1, DAY, true);
  delete noDate.race_date;
  src.previews = { previews: [noDate, pvRow(1, 1, YDAY, true)] };
  const rNoDate = finished(8, 1, DAY);
  delete rNoDate.race_date;
  src.results = { results: [rNoDate, finished(1, 1, YDAY)] };
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(keys(doc(kv, 'previews:today').data.previews), ['14-1']);
  assert.deepStrictEqual(keys(doc(kv, 'results:today').data.results), ['8-1']);
  assert.strictEqual(lastRefresh().previews.other_day, 1);
  assert.strictEqual(lastRefresh().results.other_day, 1);
}));
await t('上流の results に今日の行と前日の行が混ざっている時も、前日の行だけ落とす', quiet(async () => {
  const kv = morning();
  src.results = { results: [finished(8, 1, DAY), finished(14, 1, YDAY)] };
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(finishedRaces(doc(kv, 'results:today').data), [`8-1@${DAY}`]);
}));
await t('KV に前日の結果が「今日の時刻」で残っていても、今日の結果に重ねない', quiet(async () => {
  // 文書は夜間も時刻だけ書き直されるので、日付が変わった後は前日の中身でも「今日の文書」に見える
  const kv = morning();
  seed(kv, 'results:today', { results: [finished(14, 1, YDAY), finished(8, 1, YDAY)] }, 5);
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(doc(kv, 'results:today').data.results, []);
}));
await t('通知の索引（push:index）も今日の番組表から作る', quiet(async () => {
  const kv = morning();
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.ok(has(kv, 'push:index'), '索引が書かれる');
  const idx = JSON.parse(kv._store.get('push:index').value);
  const races = (idx.r || []).map((x) => `${x[0]}-${x[1]}`).sort();
  assert.deepStrictEqual(races, ['14-1', '14-2', '8-1']);
}));

// =============================================================================================
console.log('[KV の文書が「古い」と判定された時の経路（cron が止まっている時）]');
// cron が 20 分動いていない。KV には今日の分（番組表から作った previews + 取った展示、取った結果）がある
function stale() {
  const kv = morning();
  clock = at('09:10');
  src.eve = ownDoc(DAY, [progRow(14, 1, -25), progRow(14, 2, -1), progRow(14, 3, 25), progRow(8, 1, 100)]);
  const synth = (sid, rno) => ({ race_date: DAY, race_stadium_number: sid, race_number: rno, race_closed_at: '', boats: {} });
  seed(kv, 'previews:today', { previews: [richRow(14, 1), richRow(14, 2), synth(14, 3), synth(8, 1)], _synth: 'programs' }, 20);
  seed(kv, 'results:today', { results: [finished(14, 1)] }, 20);
  seed(kv, 'programs:today', src.eve, 20);
  return kv;
}
await t('previews: 上流が前日のままなら KV の今日の分を返す（前日の行を返さない・KV を前日の行で上書きしない）', quiet(async () => {
  const kv = stale();
  const worker = await load();
  const ctx = makeCtx();
  const before = kv._store.get('previews:today').value;
  const r = await get(worker, kv, ctx, '/api/previews');
  assert.strictEqual(r.body._source, 'live');
  assert.deepStrictEqual(days(r.body.previews), [DAY]);
  assert.deepStrictEqual(exRaces(r.body), [`14-1@${DAY}`, `14-2@${DAY}`]);
  assert.strictEqual(r.body.updated_at, JSON.parse(before).updated_at, '20 分前の中身であることを偽らない');
  assert.strictEqual(kv._store.get('previews:today').value, before, '展示が増えていないのに書いた');
}));
await t('previews: その後ろの補完は、KV の今日の分に展示を足して書く（取ってあった展示は残る）', quiet(async () => {
  const kv = stale();
  official.beforeinfo = PAGE_EXHIBITION;
  const worker = await load();
  const ctx = makeCtx();
  await get(worker, kv, ctx, '/api/previews');
  const pv = doc(kv, 'previews:today').data;
  assert.deepStrictEqual(exRaces(pv), [`14-1@${DAY}`, `14-2@${DAY}`, `14-3@${DAY}`], '鳴門 3R（締切 25 分前）が増える');
  assert.deepStrictEqual(days(pv.previews), [DAY]);
  assert.deepStrictEqual(keys(pv.previews), ['14-1', '14-2', '14-3', '8-1']);
}));
await t('results: 上流が前日のままなら KV の今日の結果を返し、補完は今日の結果に足して書く', quiet(async () => {
  const kv = stale();
  official.raceresult = (u) => (/rno=2\b/.test(u) ? PAGE_RESULT : null);
  clock = at('09:15'); // 鳴門 2R（9:09 締切）から 6 分
  src.eve = ownDoc(DAY, [progRow(14, 1, -30), progRow(14, 2, -6), progRow(14, 3, 20), progRow(8, 1, 95)]);
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/results');
  assert.strictEqual(r.body._source, 'live');
  assert.deepStrictEqual(finishedRaces(r.body), [`14-1@${DAY}`], '応答は KV の今日の結果');
  const rs = doc(kv, 'results:today').data;
  assert.deepStrictEqual(finishedRaces(rs), [`14-1@${DAY}`, `14-2@${DAY}`], '取ってあった 1R は残り、2R が増える');
  assert.deepStrictEqual(days(rs.results), [DAY]);
}));
await t('previews: KV がまだ前日の分だけの時は、補完で今日の展示を前日の行に足さない（何も書かない）', quiet(async () => {
  const kv = morning();
  clock = at('08:40');
  // 上流の前日の行に、展示の入っていないレースがある（足す先に見えてしまう形）
  src.previews = { previews: [pvRow(14, 1, YDAY, false), pvRow(14, 2, YDAY, false), pvRow(1, 1, YDAY, true)] };
  seed(kv, 'previews:today', { previews: [pvRow(14, 1, YDAY, false), pvRow(14, 2, YDAY, false)] }, 20);
  official.beforeinfo = PAGE_EXHIBITION;
  const worker = await load();
  const ctx = makeCtx();
  const before = kv._store.get('previews:today').value;
  await get(worker, kv, ctx, '/api/previews');
  assert.strictEqual(kv._store.get('previews:today').value, before);
  assert.deepStrictEqual(hits.filter((h) => h.startsWith('beforeinfo')), [], '足す先が無いので取りにも行かない');
}));
await t('results: KV に今日の結果がまだ無い時、補完が書くのは今日の結果だけ（前日の行を混ぜない）', quiet(async () => {
  const kv = morning();
  clock = at('08:50');
  src.eve = ownDoc(DAY, [progRow(14, 1, -5), progRow(14, 2, 21), progRow(8, 1, 120)]);
  seed(kv, 'results:today', { results: [] }, 20);
  official.raceresult = (u) => (/rno=1\b/.test(u) ? PAGE_RESULT : null);
  const worker = await load();
  const ctx = makeCtx();
  await get(worker, kv, ctx, '/api/results');
  const rs = doc(kv, 'results:today').data;
  assert.deepStrictEqual(finishedRaces(rs), [`14-1@${DAY}`]);
  assert.deepStrictEqual(days(rs.results), [DAY]);
}));
await t('番組表が前日のまま（前の晩の分が無い）なら、古い経路も従来どおり', quiet(async () => {
  const kv = morning();
  src.eve = null;
  seed(kv, 'previews:today', { previews: [richRow(14, 1, YDAY)] }, 20);
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/previews');
  assert.deepStrictEqual(days(r.body.previews), [YDAY]);
  assert.deepStrictEqual(exRaces(r.body), [`1-1@${YDAY}`, `14-1@${YDAY}`, `14-2@${YDAY}`]);
}));
await t('/api/programs: 古いと判定された時も、前の晩の分から今日の番組表を返す', quiet(async () => {
  const kv = morning();
  seed(kv, 'programs:today', src.programs, 40); // KV は前日の番組表のまま（0 時を過ぎてから cron がまだ動いていない）
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/programs');
  assert.deepStrictEqual(days(r.body.programs), [DAY]);
  assert.deepStrictEqual(keys(r.body.programs), ['14-1', '14-2', '8-1']);
  assert.deepStrictEqual(days(doc(kv, 'programs:today').data.programs), [DAY], 'KV も今日の分に書き直す');
}));

globalThis.Date = RealDate;
console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
