/**
 * Worker: KV の文書が「古い」と判定された時の経路で、取ってあった展示・確定結果を消さない（2026-11-27）
 *
 * 実害: 2026-11-27 14:50 JST、この Worker が公式ページから取った展示 57 レース分が KV から消えた。
 *   serveFromKV は、文書の updated_at が 12 分より古いと上流 (openapi) を取り直し、その素のデータを
 *   KV に書いていた。上流には Worker が取った展示が無い。締切の窓を過ぎたレースの展示は取り直せないので、
 *   一度上書きされると、その日は戻らない。kvWrite は中身が変わった時しか書かないので、cron が動いていても、
 *   展示が 2 回続けて出なければ文書は 12 分より古くなる（その状態でアプリの 1 回の取得が来ると消えた）。
 *
 * ここで固定すること:
 *   1. cron が動いている間は、中身が変わらなくても文書が「古い」と判定されない（時刻の書き直し）
 *   2. 古いと判定された時の経路は、KV の展示・確定結果を引き継いでから返す・書く
 *   3. KV を読めなかった時は、その文書に書かない（定期更新も同じ）
 *
 *   node scripts/tests/test_worker_serve_stale.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = path.join(ROOT, 'scripts', 'tests', 'fixtures');
const SRC = fs.readFileSync(path.join(ROOT, 'cloudflare-worker', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', String(e && e.message ? e.message : e).split('\n')[0]); fail++; }
}

// --- 時計（テスト全体を「その日の 14:20 JST」から始め、自分で進める）------------------------------
const RealDate = Date;
const DAY = new RealDate(RealDate.now() + 9 * 3600e3).toISOString().slice(0, 10);
const at = (hhmm, sec = 0) => RealDate.parse(`${DAY}T${hhmm}:${String(sec).padStart(2, '0')}+09:00`);
let clock = at('14:20');
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(clock); else super(...a); }
  static now() { return clock; }
}
globalThis.Date = FakeDate;
const MIN = 60000;
const iso = (ms) => new RealDate(ms).toISOString();
const hhmmOf = (deltaMin) => new RealDate(clock + 9 * 3600e3 + deltaMin * MIN).toISOString().slice(11, 16);
const closedAt = (deltaMin) => `${DAY} ${hhmmOf(deltaMin)}:00`;

// --- 上流と公式ページの差し替え ---------------------------------------------------------------
const PAGE_EXHIBITION = fs.readFileSync(path.join(FIX, 'beforeinfo_naruto_R01.html'), 'utf8');
const PAGE_RESULT = fs.readFileSync(path.join(FIX, 'raceresult_start_info.html'), 'utf8');
let up;          // { previews, programs, results }（null = 取得失敗）
let official;    // { beforeinfo, raceresult }（null = 404）
let officialHits;
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input) => {
  const u = String(input && input.url ? input.url : input);
  if (u.includes('boatrace.jp')) {
    officialHits.push(u.includes('beforeinfo') ? 'beforeinfo' : u.includes('raceresult') ? 'raceresult' : 'other');
    const src = u.includes('beforeinfo') ? official.beforeinfo : u.includes('raceresult') ? official.raceresult : null;
    const page = typeof src === 'function' ? src(u) : src; // 関数なら URL を見て返す（特定のレースだけ公開済み、など）
    return page ? new Response(page, { status: 200 }) : new Response('', { status: 404 });
  }
  const kind = u.includes('previews') ? 'previews' : u.includes('programs') ? 'programs' : u.includes('results') ? 'results' : null;
  if (!kind || up[kind] == null) return new Response('', { status: 404 });
  return json(up[kind]);
};
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };

// --- KV の差し替え（読取の失敗を起こせる）-------------------------------------------------------
function makeKV() {
  const store = new Map();
  const kv = {
    failGet: new Set(),
    puts: [],
    async get(k) {
      if (kv.failGet.has(k)) throw new Error('KV GET failed: 503 Service Unavailable');
      const e = store.get(k);
      return e ? e.value : null;
    },
    async getWithMetadata(k) {
      if (kv.failGet.has(k)) throw new Error('KV GET failed: 503 Service Unavailable');
      const e = store.get(k);
      return e ? { value: e.value, metadata: e.meta } : { value: null, metadata: null };
    },
    async put(k, v, o) {
      store.set(k, { value: v, meta: (o && o.metadata) || null });
      kv.puts.push({ k, at: clock, src: (o && o.metadata && o.metadata.src) || null });
    },
    _store: store,
  };
  return kv;
}
// 前回までの文書を置く（ageMin 分前に書かれたことにする）
function seed(kv, key, data, ageMin = 0, src = 'cron') {
  const when = iso(clock - ageMin * MIN);
  kv._store.set(key, { value: JSON.stringify({ updated_at: when, data }), meta: { hash: 'seed', wrote_at: when, src } });
}
const doc = (kv, key) => JSON.parse(kv._store.get(key).value);
const srcOf = (kv, key) => kv._store.get(key).meta && kv._store.get(key).meta.src;
const putsOf = (kv, key) => kv.puts.filter((p) => p.k === key);

// --- データの形 --------------------------------------------------------------------------------
// 上流の previews の行（展示なし・体重あり、boats は配列）
const upBoats = () => [1, 2, 3, 4, 5, 6].map((n) => ({
  racer_boat_number: n, racer_weight: 52, racer_weight_adjustment: 0, racer_exhibition_time: 0,
  racer_course_number: null, racer_start_timing: null, racer_tilt_adjustment: 0,
}));
const upRow = (sid, rno) => ({
  race_date: DAY, race_stadium_number: sid, race_number: rno, race_wind: 0, race_wind_direction_number: 17,
  race_wave: 0, race_weather_number: 1, race_temperature: 12, race_water_temperature: 11, boats: upBoats(),
});
// この Worker が公式ページから展示を取った行（boats は艇番がキー）
const richRow = (sid, rno) => {
  const row = upRow(sid, rno);
  const boats = {};
  for (const b of row.boats) {
    boats[b.racer_boat_number] = Object.assign(b, {
      racer_exhibition_time: 6.7 + b.racer_boat_number / 100, racer_course_number: b.racer_boat_number,
      racer_start_timing: 0.1, racer_propeller: '', racer_parts_replaced: b.racer_boat_number === 1 ? 'リング×２' : '',
      racer_adjust_weight: 0,
    });
  }
  row.boats = boats;
  row.race_temperature = 13;
  return row;
};
const progRow = (sid, rno, deltaMin) => ({
  race_date: DAY, race_stadium_number: sid, race_number: rno, race_closed_at: closedAt(deltaMin), boats: [],
});
const exRaces = (previewsDoc) => previewsDoc.previews
  .filter((r) => Object.values(r.boats || {}).some((b) => b && b.racer_exhibition_time > 0))
  .map((r) => `${r.race_stadium_number}-${r.race_number}`).sort();
const partsCount = (previewsDoc) => previewsDoc.previews
  .reduce((s, r) => s + Object.values(r.boats || {}).filter((b) => b && b.racer_parts_replaced).length, 0);
// 確定した結果（この Worker が公式ページから先に取った形）
const finished = (sid, rno) => ({
  race_date: DAY, race_stadium_number: sid, race_number: rno, race_technique_number: 2,
  boats: [1, 2, 3, 4, 5, 6].map((n) => ({ racer_boat_number: n, racer_place_number: n })),
  payouts: { trifecta: [{ combination: '1-2-3', payout: 1230 }] },
});
const pending = (sid, rno) => ({ race_date: DAY, race_stadium_number: sid, race_number: rno, race_technique_number: null, boats: [] });
const finishedKeys = (resultsDoc) => resultsDoc.results
  .filter((r) => r.race_technique_number != null).map((r) => `${r.race_stadium_number}-${r.race_number}`).sort();

// テストごとにモジュールを読み直す（isolate の中の状態 = 補完の間隔など を持ち越さない）
let seq = 0;
async function load() {
  const url = pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'worker.js')).href + '?serve_stale=' + (++seq);
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
// 既定の場面: 鳴門 1・2R は展示を取ってあり締切も過ぎている（取り直せない）。3R はまだ先。上流に展示は無い
function scene() {
  clock = at('14:20');
  up = {
    previews: { previews: [upRow(14, 1), upRow(14, 2), upRow(14, 3)] },
    programs: { race_date: DAY, programs: [progRow(14, 1, -120), progRow(14, 2, -90), progRow(14, 3, 180)] },
    results: { results: [] },
  };
  official = { beforeinfo: null, raceresult: null };
  officialHits = [];
  const kv = makeKV();
  seed(kv, 'previews:today', { previews: [richRow(14, 1), richRow(14, 2), upRowKeyed(14, 3)] });
  return kv;
}
function upRowKeyed(sid, rno) {
  const row = upRow(sid, rno);
  row.boats = Object.fromEntries(row.boats.map((b) => [b.racer_boat_number, b]));
  return row;
}
// テスト中のログは出さずに集める（定期更新の結果 = 「refresh: {...}」の行を確かめるため）
let logs = [];
const quiet = (fn) => async () => {
  const log = console.log, warn = console.warn, err = console.error;
  logs = [];
  console.log = console.warn = console.error = (...a) => { logs.push(a.map(String).join(' ')); };
  try { await fn(); } finally { console.log = log; console.warn = warn; console.error = err; }
};
// 直近の定期更新の結果
const lastRefresh = () => {
  const line = logs.filter((l) => l.startsWith('refresh: ')).pop();
  return line ? JSON.parse(line.slice('refresh: '.length)) : null;
};

// =============================================================================================
console.log('[cron が動いている間: 中身が変わらなくても「古い」と判定されない]');
await t('1 時間、展示が 1 つも増えなくても、/api/previews は毎回 KV の展示を返し、KV を上書きしない', quiet(async () => {
  const kv = scene();
  const worker = await load();
  const ctx = makeCtx();
  const seen = [];
  for (let run = 0; run < 13; run++) {
    const tick = at('14:20') + run * 5 * MIN;
    clock = tick + 10000; // cron が KV に書くのは発火の約 10 秒後
    await cron(worker, kv, ctx);
    // アプリの取得: 90 秒おき + 次の cron の直前（文書がいちばん古くなる時）
    for (const sec of [40, 130, 220, 299]) {
      clock = tick + sec * 1000;
      const r = await get(worker, kv, ctx, '/api/previews');
      seen.push({ t: new RealDate(clock + 9 * 3600e3).toISOString().slice(11, 19), src: r.body._source || 'kv', ex: exRaces(r.body).join(',') });
    }
  }
  const bad = seen.filter((s) => s.ex !== '14-1,14-2');
  assert.deepStrictEqual(bad.slice(0, 3), [], '展示が欠けた応答がある');
  const live = seen.filter((s) => s.src !== 'kv');
  assert.deepStrictEqual(live.slice(0, 3), [], 'cron が動いているのに「古い」と判定された');
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2']);
  assert.strictEqual(partsCount(doc(kv, 'previews:today').data), 2, '部品交換の記載が消えた');
  const puts = putsOf(kv, 'previews:today');
  assert.deepStrictEqual(puts.filter((p) => p.src !== 'cron'), [], 'cron 以外が previews を書いた');
  // 中身が変わらない間は 2 回に 1 回（10 分おき）。毎回書くと KV の書込枠（1 日 1,000 回）を使いすぎる
  assert.ok(puts.length >= 6 && puts.length <= 8, 'previews の書込 ' + puts.length + ' 回（想定 6〜8）');
}));
await t('書き直しの間隔: previews / results は cron 2 回ぶん（10 分）で必ず書かれ、12 分に届かない。programs は 30 分のまま', quiet(async () => {
  const kv = scene();
  const worker = await load();
  const ctx = makeCtx();
  const ages = { 'previews:today': 0, 'results:today': 0 };
  for (let run = 0; run < 13; run++) {
    clock = at('14:20') + run * 5 * MIN + 10000;
    for (const k of Object.keys(ages)) {
      if (kv._store.get(k)) ages[k] = Math.max(ages[k], clock - RealDate.parse(doc(kv, k).updated_at));
    }
    await cron(worker, kv, ctx);
  }
  for (const k of Object.keys(ages)) assert.ok(ages[k] <= 10 * MIN + 1000, k + ' が最長 ' + Math.round(ages[k] / 1000) + ' 秒書かれなかった');
  const prog = putsOf(kv, 'programs:today').length;
  assert.ok(prog >= 2 && prog <= 3, 'programs の書込 ' + prog + ' 回（最初の 1 回 + 30 分おき）');
}));
await t('定数の関係: 書き直しの間隔 → 次の cron（5 分おき）までに、古いと判定する 12 分に届かない', () => {
  const num = (name) => { const m = new RegExp(name + "[^\\n]*?(\\d+) \\* 60 \\* 1000").exec(SRC); assert.ok(m, name); return +m[1]; };
  const stale = num('const SERVE_STALE_MS = ');
  const touchPv = num("'previews:today': ");
  const touchRs = num("'results:today': ");
  for (const touch of [touchPv, touchRs]) {
    // 書いた時刻が run の中で 3 分遅れても（公式ページの取得待ち）、次の次の run では間隔を超えている
    assert.ok(touch <= 10 - 3, '間隔 ' + touch + ' 分は、書込が遅れた時に 15 分空く');
    // 間隔を超えた最初の run までの時間（5 分の倍数）+ 1 分の余裕が、古いと判定する時間より短い
    assert.ok(Math.ceil(touch / 5) * 5 + 1 < stale, '間隔 ' + touch + ' 分では ' + stale + ' 分に届く');
    // 毎回は書かない（5 分より長い）
    assert.ok(touch > 5, '間隔 ' + touch + ' 分は毎回書く');
  }
});

// =============================================================================================
console.log('[古いと判定された時（cron が止まっている）: KV の展示を引き継ぐ]');
await t('2026-11-27 の形: 13 分前の文書に対する 1 回の取得で、展示が消えない（応答にも KV にも残る）', quiet(async () => {
  const kv = scene();
  seed(kv, 'previews:today', { previews: [richRow(14, 1), richRow(14, 2), upRowKeyed(14, 3)] }, 13);
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/previews');
  assert.strictEqual(r.body._source, 'live', '古い文書なのに取り直していない');
  assert.deepStrictEqual(exRaces(r.body), ['14-1', '14-2'], '応答から展示が消えた');
  assert.strictEqual(partsCount(r.body), 2);
  assert.strictEqual(r.body.previews.find((x) => x.race_number === 1).race_temperature, 13, '展示の時に読んだ気象が上流の値に戻った');
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2'], 'KV の展示が消えた');
  // 取得しただけでは previews を書かない（増えた展示が無い。読んだ KV が少し前の版でも、新しい版を上書きしない）
  assert.deepStrictEqual(putsOf(kv, 'previews:today'), [], '取得しただけで previews を書いた');
  clock += MIN;
  const r2 = await get(worker, kv, ctx, '/api/previews');
  assert.deepStrictEqual(exRaces(r2.body), ['14-1', '14-2'], '2 回目の応答で展示が消えた');
  assert.deepStrictEqual(putsOf(kv, 'previews:today'), []);
  // 次の cron でも残っている
  clock += 3 * MIN;
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2']);
  assert.strictEqual(partsCount(doc(kv, 'previews:today').data), 2);
}));
await t('締切前のレースを取り足しても、取ってあった展示は残る（補完が書く文書にも引き継ぐ）', quiet(async () => {
  const kv = scene();
  seed(kv, 'previews:today', { previews: [richRow(14, 1), richRow(14, 2), upRowKeyed(14, 3)] }, 13);
  up.programs.programs[2] = progRow(14, 3, 10); // 3R は締切 10 分前（展示の窓の中）
  official.beforeinfo = PAGE_EXHIBITION;
  const worker = await load();
  const ctx = makeCtx();
  await get(worker, kv, ctx, '/api/previews');
  assert.deepStrictEqual(officialHits, ['beforeinfo'], '締切前の 1 レースを取りに行っていない');
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2', '14-3']);
  assert.strictEqual(srcOf(kv, 'previews:today'), 'ondemand');
  assert.strictEqual(partsCount(doc(kv, 'previews:today').data) >= 2, true);
}));
await t('上流の previews が壊れている時も同じ（番組表から作った文書に、KV の展示を引き継ぐ）', quiet(async () => {
  const kv = scene();
  seed(kv, 'previews:today', { previews: [richRow(14, 1), richRow(14, 2), upRowKeyed(14, 3)] }, 13);
  up.previews = { results: [] }; // previews キーが無い（2026-07-17 の上流の障害の形）
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/previews');
  assert.deepStrictEqual(exRaces(r.body), ['14-1', '14-2']);
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2']);
  assert.deepStrictEqual(putsOf(kv, 'previews:today'), []);
}));
await t('定期更新でも同じ: 上流の previews が壊れている回に、KV の展示を引き継ぐ', quiet(async () => {
  const kv = scene();
  up.previews = { results: [] };
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2'], '番組表から作った文書で、取ってあった展示を消した');
  assert.strictEqual(partsCount(doc(kv, 'previews:today').data), 2);
  assert.strictEqual(lastRefresh().previews.invalid_shape, true);
}));
await t('前日の文書からは引き継がない（日付の違う行）', quiet(async () => {
  const kv = scene();
  const old1 = richRow(14, 1);
  old1.race_date = '2000-01-01';
  seed(kv, 'previews:today', { previews: [old1, richRow(14, 2)] }, 13);
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/previews');
  assert.deepStrictEqual(exRaces(r.body), ['14-2'], '前日の展示を今日のレースに出した');
}));
await t('形の違う行（null など）が混ざっていても、ほかのレースの展示は引き継ぐ（KV 側・上流側とも）', quiet(async () => {
  const kv = scene();
  seed(kv, 'previews:today', { previews: [null, richRow(14, 1), 7, richRow(14, 2)] }, 13);
  up.previews.previews.splice(1, 0, null, 'x');
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/previews');
  assert.deepStrictEqual(exRaces(r.body), ['14-1', '14-2']);
  assert.strictEqual(r.body.previews.length, 3, '行として読めない要素を応答に残した');
  clock += 3 * MIN;
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2'], '定期更新が引き継げなかった');
}));

// =============================================================================================
console.log('[KV を読めなかった時は、その文書に書かない]');
await t('取得の経路: 読めなければ上流のデータだけを返し、previews を書かない・公式ページも取りに行かない', quiet(async () => {
  const kv = scene();
  up.programs.programs[2] = progRow(14, 3, 10);
  official.beforeinfo = PAGE_EXHIBITION;
  kv.failGet.add('previews:today');
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/previews');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body._source, 'live');
  assert.strictEqual(r.body.previews.length, 3);
  assert.deepStrictEqual(putsOf(kv, 'previews:today'), [], '中身の分からない文書を上書きした');
  assert.deepStrictEqual(officialHits, [], '置けないのに公式ページを取りに行った');
  assert.ok(logs.some((l) => l.includes('KV read failed') && l.includes('503')), '読めなかったことがログに出ていない');
  kv.failGet.clear();
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2'], '読めるようになったら元の展示が無い');
}));
await t('定期更新: previews を読めなければ previews だけ書かない（ほかの文書と生存記録は書く）。次の回に元どおり続く', quiet(async () => {
  const kv = scene();
  up.programs.programs[2] = progRow(14, 3, 10);
  official.beforeinfo = PAGE_EXHIBITION;
  kv.failGet.add('previews:today');
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(putsOf(kv, 'previews:today'), [], '読めなかった回に previews を書いた');
  assert.ok(!officialHits.includes('beforeinfo'), '置けないのに展示のページを取りに行った');
  const out = lastRefresh();
  assert.strictEqual(out.previews.kv_write_skipped, true, '書かなかったことが結果に残っていない');
  assert.ok(/kv read: .*503/.test(out.previews.kv_carry_err), '読めなかった理由が結果に残っていない: ' + out.previews.kv_carry_err);
  assert.ok(!out.programs.kv_write_skipped && !out.results.kv_write_skipped);
  assert.strictEqual(putsOf(kv, 'programs:today').length, 1, 'programs まで書かなくなった');
  assert.strictEqual(putsOf(kv, 'results:today').length, 1, 'results まで書かなくなった');
  assert.strictEqual(putsOf(kv, 'health:heartbeat').length, 1, 'cron の生存記録が書かれていない');
  kv.failGet.clear();
  clock += 5 * MIN;
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2', '14-3'], '読めるようになった回に続きを取れていない');
  assert.strictEqual(partsCount(doc(kv, 'previews:today').data) >= 2, true);
}));
await t('定期更新: results を読めなければ results だけ書かない・結果のページも取りに行かない', quiet(async () => {
  const kv = scene();
  up.programs.programs[1] = progRow(14, 2, -10); // 2R は締切 10 分後（結果を取りに行く窓の中）
  up.results = { results: [pending(14, 1), pending(14, 2)] };
  official.raceresult = PAGE_RESULT;
  seed(kv, 'results:today', { results: [finished(14, 1), pending(14, 2)] });
  kv.failGet.add('results:today');
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(putsOf(kv, 'results:today'), [], '読めなかった回に results を書いた');
  assert.ok(!officialHits.includes('raceresult'), '置けないのに結果のページを取りに行った');
  const out = lastRefresh();
  assert.strictEqual(out.results.kv_write_skipped, true, '書かなかったことが結果に残っていない');
  assert.ok(/kv read: .*503/.test(out.results.kv_merge_err), '読めなかった理由が結果に残っていない: ' + out.results.kv_merge_err);
  assert.ok(putsOf(kv, 'previews:today').length >= 1, 'previews まで書かなくなった');
  kv.failGet.clear();
  assert.deepStrictEqual(finishedKeys(doc(kv, 'results:today').data), ['14-1'], '先に取った確定結果が消えた');
}));
await t('JSON として読めない中身の文書は「まだ無い」と同じ（書き直せる。読めないまま固まらない）', quiet(async () => {
  const kv = scene();
  kv._store.set('previews:today', { value: '{"updated_at": "broken', meta: null });
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.strictEqual(putsOf(kv, 'previews:today').length, 1);
  assert.strictEqual(doc(kv, 'previews:today').data.previews.length, 3);
}));
await t('形の壊れた previews（番組表も取れない時）は書かない', quiet(async () => {
  const kv = scene();
  up.previews = { results: [] };
  up.programs = null;
  const worker = await load();
  const ctx = makeCtx();
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(putsOf(kv, 'previews:today'), [], '形の壊れた文書で上書きした');
  assert.deepStrictEqual(exRaces(doc(kv, 'previews:today').data), ['14-1', '14-2']);
}));

await t('programs は従来どおり: 無い時・古い時は取り直した中身を書く（KV と同じ中身なので何も失わない）。読めない時は書かない', quiet(async () => {
  const kv = scene();
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/programs');
  assert.strictEqual(r.body.programs.length, 3);
  assert.strictEqual(putsOf(kv, 'programs:today').length, 1, '番組表を置かなかった');
  assert.strictEqual(srcOf(kv, 'programs:today'), 'serve');
  const kv2 = scene();
  kv2.failGet.add('programs:today');
  const worker2 = await load();
  const r2 = await get(worker2, kv2, ctx, '/api/programs');
  assert.strictEqual(r2.status, 200);
  assert.deepStrictEqual(putsOf(kv2, 'programs:today'), [], '読めなかった文書に書いた');
}));

// =============================================================================================
console.log('[結果: 古いと判定された時も、先に取った確定結果を返す・消さない]');
function resultsScene() {
  const kv = scene();
  // 1R はこの Worker が公式ページから先に取った（上流はまだ未確定）。2R は締切 10 分後
  up.programs.programs[1] = progRow(14, 2, -10);
  up.results = { results: [pending(14, 1), pending(14, 2)] };
  seed(kv, 'results:today', { results: [finished(14, 1), pending(14, 2)] }, 13);
  return kv;
}
await t('13 分前の文書に対する取得: 応答に、先に取った確定結果が入っている（取得だけでは KV を書かない）', quiet(async () => {
  const kv = resultsScene();
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/results');
  assert.strictEqual(r.body._source, 'live');
  assert.deepStrictEqual(finishedKeys(r.body), ['14-1'], '上流の未確定で、取ってあった確定結果を隠した');
  assert.ok(!('_kv_merge' in r.body), '内部の印が応答に出ている');
  // results を書くのは、補完で結果が増えた時だけ（ここでは公式ページが無いので増えない）
  assert.deepStrictEqual(putsOf(kv, 'results:today'), [], '取得しただけで results を書いた');
}));
await t('日付の欄の無い行は、従来どおり重ねる（行の日付は、両方にある時だけ比べる）', quiet(async () => {
  const kv = resultsScene();
  const noDate = finished(14, 3);
  delete noDate.race_date;
  seed(kv, 'results:today', { results: [finished(14, 1), pending(14, 2), noDate] }, 13);
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/results');
  assert.deepStrictEqual(finishedKeys(r.body), ['14-1', '14-3']);
}));
await t('補完で 1 レース取り足しても、先に取った確定結果は KV に残る（取り直しもしない）', quiet(async () => {
  const kv = resultsScene();
  // 公式の結果ページは 2R だけ（1R を取り直して埋め合わせる、という通り方をさせない）
  official.raceresult = (u) => (/[?&]rno=2(&|$)/.test(u) ? PAGE_RESULT : null);
  const worker = await load();
  const ctx = makeCtx();
  await get(worker, kv, ctx, '/api/results');
  assert.deepStrictEqual(officialHits, ['raceresult'], '取りに行くのは未確定の 2R の 1 ページだけ（1R は確定済み）');
  assert.strictEqual(srcOf(kv, 'results:today'), 'ondemand');
  const after = doc(kv, 'results:today').data;
  assert.deepStrictEqual(finishedKeys(after), ['14-1', '14-2'], '取り足した時に、先に取った結果を消した');
  assert.deepStrictEqual(after.results.find((r) => r.race_number === 1).payouts.trifecta, [{ combination: '1-2-3', payout: 1230 }]);
}));
await t('KV を読めない時は、結果の補完をしない（書かない・取りに行かない）', quiet(async () => {
  const kv = resultsScene();
  official.raceresult = PAGE_RESULT;
  kv.failGet.add('results:today');
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/results');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(putsOf(kv, 'results:today'), []);
  assert.deepStrictEqual(officialHits, []);
  kv.failGet.clear();
  assert.deepStrictEqual(finishedKeys(doc(kv, 'results:today').data), ['14-1']);
}));
await t('日付が変わった後: 夜間に時刻だけ書き直された前日の結果を、今日の同じレースに重ねない（行の日付で確かめる）', quiet(async () => {
  const kv = resultsScene();
  // 文書の updated_at は今日（夜間の cron が時刻を書き直した）、中身は前日の確定結果と「レース中止」
  const y1 = finished(14, 1);
  const y2 = Object.assign(pending(14, 2), { race_cancelled: true });
  y1.race_date = y2.race_date = '2000-01-01';
  seed(kv, 'results:today', { results: [y1, y2] }, 13);
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/results');
  assert.deepStrictEqual(finishedKeys(r.body), [], '前日の確定結果を今日のレースに出した');
  assert.ok(!r.body.results.some((x) => x.race_cancelled), '前日の中止を今日のレースに出した');
  assert.ok(r.body.results.every((x) => x.race_date === DAY), '前日の行が混ざった');
  // 定期更新も同じ
  clock += 3 * MIN;
  await cron(worker, kv, ctx);
  const after = doc(kv, 'results:today').data;
  assert.deepStrictEqual(finishedKeys(after), []);
  assert.ok(after.results.every((x) => x.race_date === DAY && !x.race_cancelled), '定期更新が前日の行を持ち越した');
}));
await t('前日の文書の結果は重ねない', quiet(async () => {
  const kv = resultsScene();
  const yesterday = iso(clock - 24 * 3600e3);
  kv._store.set('results:today', { value: JSON.stringify({ updated_at: yesterday, data: { results: [finished(14, 1)] } }), meta: { hash: 'seed', wrote_at: yesterday, src: 'cron' } });
  const worker = await load();
  const ctx = makeCtx();
  const r = await get(worker, kv, ctx, '/api/results');
  assert.deepStrictEqual(finishedKeys(r.body), [], '前日の確定結果を今日のレースに出した');
  // 定期更新も同じ（前日に書かれた文書からは重ねない）
  clock += 3 * MIN;
  await cron(worker, kv, ctx);
  assert.deepStrictEqual(finishedKeys(doc(kv, 'results:today').data), [], '定期更新が前日の文書の結果を重ねた');
  assert.strictEqual(lastRefresh().results.kv_skip, 'day_change');
}));

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
