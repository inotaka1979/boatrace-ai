/**
 * 直前情報の気象・展示データ (boats) の形・風向の解釈（アプリ側）
 *
 * 2026-11-27:
 *   1. boats の形: アプリは boats[艇番] で読む。上流 (openapi) の配列（位置 0 = 1 号艇）は 1 つずれて読まれ、
 *      修正前の Worker が展示を足した配列（位置 n = n 号艇）は偶然合っていた。indexPreviews でそろえる。
 *   2. 気象: Worker の /beforeinfo-proxy と data/previews（GitHub Actions）から取り込む。
 *   3. 風向の番号: 公式の番号は方位ではなく、コース図の上の矢印（5 = 右向き = 追い風、13 = 左向き = 向かい風）。
 *      従来は 1 = 北 … と仮定した表で判定していた。
 *
 *   node scripts/tests/test_preview_weather_app.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(ROOT, 'scripts', 'tests', 'fixtures');
const LEGACY = JSON.parse(fs.readFileSync(path.join(FIX, 'previews_legacy_shifted.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const plain = clone;

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
function section(title) { queue.push([title, null]); }

// 公式ページ（鳴門 1R 11/27）に載っている値
const OFFICIAL = {
  1: { et: 6.84, course: 1, st: 0.08 },
  2: { et: 6.77, course: 2, st: 0.11 },
  3: { et: 6.81, course: 3, st: 0.08 },
  4: { et: 6.79, course: 4, st: 0.08 },
  5: { et: 6.75, course: 5, st: 0.01 },
  6: { et: 6.83, course: 6, st: 0.07 },
};
const byBoat = (boats) => Object.fromEntries(Object.keys(boats).map((k) => [k, {
  et: boats[k].racer_exhibition_time, course: boats[k].racer_course_number, st: boats[k].racer_start_timing,
}]));
const ctx = makeCtx();
const todayIso = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// フィクスチャ（本番の実データ、2026-11-27 分）の行を「今日」の日付にして返す。
//   indexByStadiumRace は race_date が今日でない行を捨てる。日付をそのまま使うと、書いた日にしか通らない。
//   0 = 修正前の Worker が展示を足した行（鳴門 1R）、1 = 上流そのままの行（鳴門 12R）
const fxRow = (i, extra) => Object.assign(clone(LEGACY.previews[i]), { race_date: todayIso() }, extra || {});

// ------------------------------------------------------------------------------------------
section('[indexPreviews: boats を艇番で引ける形にそろえる]');
t('修正前の Worker の形（7 要素・1 つずれ。本番の実データ）→ boats[艇番] が公式ページの値', () => {
  const idx = ctx.indexPreviews({ previews: [fxRow(0)] });
  const pv = idx[14][1];
  assert.ok(!Array.isArray(pv.boats), 'boats が配列のまま');
  assert.deepStrictEqual(Object.keys(pv.boats), ['1', '2', '3', '4', '5', '6']);
  assert.deepStrictEqual(plain(byBoat(pv.boats)), OFFICIAL);
  for (const n of [1, 2, 3, 4, 5, 6]) assert.strictEqual(pv.boats[String(n)].racer_boat_number, n, n + ' 号艇の艇番の欄');
});
t('上流そのままの配列（位置 0 = 1 号艇）→ 1 号艇の値は boats["1"] に入る（従来は 2 号艇の値を読んでいた）', () => {
  const row = fxRow(1);
  row.boats.forEach((b, i) => { b.racer_exhibition_time = 6.5 + i / 100; });
  const pv = ctx.indexPreviews({ previews: [row] })[14][12];
  assert.deepStrictEqual(Object.keys(pv.boats), ['1', '2', '3', '4', '5', '6']);
  assert.strictEqual(pv.boats['1'].racer_exhibition_time, 6.5);
  assert.strictEqual(pv.boats['6'].racer_exhibition_time, 6.55);
});
t('艇番をキーにした形（修正後の Worker・もとの openapi）は同じオブジェクトのまま', () => {
  const boats = { 1: { racer_boat_number: 1, racer_exhibition_time: 6.7 }, 6: { racer_boat_number: 6, racer_exhibition_time: 6.9 } };
  const pv = ctx.indexPreviews({ previews: [{ race_stadium_number: 3, race_number: 2, boats }] })[3][2];
  assert.strictEqual(pv.boats, boats);
  assert.strictEqual(pv.boats['6'].racer_exhibition_time, 6.9);
});
t('壊れた boats でも落ちない（null・文字列・null 入りの配列・艇番の欄が無い配列）', () => {
  for (const bad of [null, undefined, 'x', [null, null], [{ a: 1 }], [{ racer_boat_number: 9 }], []]) {
    const pv = ctx.indexPreviews({ previews: [{ race_stadium_number: 3, race_number: 2, boats: bad }] })[3][2];
    if (Array.isArray(bad)) assert.deepStrictEqual(plain(pv.boats), {}, JSON.stringify(bad));
    assert.ok(pv.weather, 'weather が付いていない');
  }
});
t('そろえた後の形で、展示の有無の判定（_previewRichness / _isPreviewIncomplete）が合う', () => {
  const idx = ctx.indexPreviews({ previews: [fxRow(0), fxRow(1)] });
  assert.strictEqual(ctx._previewRichness(idx[14][1]), 6);
  assert.strictEqual(ctx._previewRichness(idx[14][12]), 0);
  assert.strictEqual(ctx._isPreviewIncomplete(idx[14][1]), false);
  assert.strictEqual(ctx._isPreviewIncomplete(idx[14][12]), true);
});

// ------------------------------------------------------------------------------------------
section('[気象の形]');
t('race_* の欄からアプリ内の形を作る（Worker が公式ページから読んだ値）', () => {
  const row = fxRow(0, {
    race_temperature: 11, race_wind: 1, race_water_temperature: 18, race_wave: 1, race_weather_number: 1, race_wind_direction_number: 13,
  });
  const pv = ctx.indexPreviews({ previews: [row] })[14][1];
  assert.deepStrictEqual(plain(pv.weather), {
    wind_speed: 1, wind_direction: 13, wave_height: 1, temperature: 11, water_temperature: 18, weather_number: 1,
  });
});
t('上流の「欄はあるが値が無い」行は全部 0（気象なし）', () => {
  const pv = ctx.indexPreviews({ previews: [fxRow(1)] })[14][12];
  assert.deepStrictEqual(plain(pv.weather), {
    wind_speed: 0, wind_direction: 0, wave_height: 0, temperature: 0, water_temperature: 0, weather_number: 0,
  });
  assert.strictEqual(ctx._wxAny(pv.weather), false);
});
t('アプリ内と同じ名前（data/previews の weather）からも作れる', () => {
  const w = ctx._pvWeather({ wind_speed: 4, wind_direction: 5, wave_height: 3, temperature: 12.5, water_temperature: 16, weather_number: 2 });
  assert.deepStrictEqual(plain(w), { wind_speed: 4, wind_direction: 5, wave_height: 3, temperature: 12.5, water_temperature: 16, weather_number: 2 });
});
t('値は必ず数値（文字列の数字は数値に、数値でないものは 0。画面にそのまま出すため）', () => {
  const w = ctx._pvWeather({
    race_wind: '3', race_wind_direction_number: '<img src=x onerror=alert(1)>', race_wave: { a: 1 },
    race_temperature: '-1.5', race_water_temperature: null, race_weather_number: [],
  });
  assert.deepStrictEqual(plain(w), { wind_speed: 3, wind_direction: 0, wave_height: 0, temperature: -1.5, water_temperature: 0, weather_number: 0 });
  for (const k of Object.keys(w)) assert.strictEqual(typeof w[k], 'number', k);
});
t('_wxAny: 1 項目でも入っていれば気象あり（無風 17 だけでも）', () => {
  assert.strictEqual(ctx._wxAny(null), false);
  assert.strictEqual(ctx._wxAny(undefined), false);
  assert.strictEqual(ctx._wxAny({}), false);
  assert.strictEqual(ctx._wxAny({ wind_speed: 0, wind_direction: 0, wave_height: 0, temperature: 0, water_temperature: 0, weather_number: 7 }), false);
  for (const k of ['temperature', 'water_temperature', 'wind_speed', 'wave_height']) {
    assert.strictEqual(ctx._wxAny({ [k]: 1 }), true, k);
  }
  assert.strictEqual(ctx._wxAny({ wind_direction: 17 }), true);
  assert.strictEqual(ctx._wxAny({ temperature: -2 }), true);
});

// ------------------------------------------------------------------------------------------
section('[/beforeinfo-proxy の応答を取り込む (_loadPreviewLive)]');
const PROXY_BOATS = () => Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [String(n), {
  racer_boat_number: n, racer_exhibition_time: OFFICIAL[n].et, racer_start_timing: OFFICIAL[n].st, racer_course_number: OFFICIAL[n].course,
  racer_tilt_adjustment: 0, racer_propeller: '', racer_parts_replaced: '', racer_adjust_weight: 0,
}]));
const PROXY_WX = { race_temperature: 11, race_wind: 1, race_water_temperature: 18, race_wave: 1, race_weather_number: 1, race_wind_direction_number: 13 };
const WX_APP = { wind_speed: 1, wind_direction: 13, wave_height: 1, temperature: 11, water_temperature: 18, weather_number: 1 };
const ZERO_WX = { wind_speed: 0, wind_direction: 0, wave_height: 0, temperature: 0, water_temperature: 0, weather_number: 0 };
async function loadLive(c, sid, rno, body) {
  const urls = [];
  c.fetch = (u) => {
    urls.push(String(u));
    if (String(u).includes('/beforeinfo-proxy')) return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    return Promise.reject(new Error('no network'));
  };
  c._loadPreviewLive(sid, rno);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 5));
  return urls;
}
t('展示はあるが気象の無いレース → 応答の気象を入れる', async () => {
  const c = makeCtx();
  c.previewData = c.indexPreviews({ previews: [fxRow(0)] });
  assert.strictEqual(c._wxAny(c.previewData[14][1].weather), false);
  const urls = await loadLive(c, 14, 1, Object.assign({ race_stadium_number: 14, race_number: 1, boats: PROXY_BOATS() }, PROXY_WX));
  assert.ok(urls.some((u) => /\/beforeinfo-proxy\?jcd=14&race=1&hd=\d{8}$/.test(u)), urls.join(' '));   // 番組表が無い時は close を付けない
  assert.deepStrictEqual(plain(c.previewData[14][1].weather), WX_APP);
  assert.deepStrictEqual(plain(byBoat(c.previewData[14][1].boats)), OFFICIAL);
});
t('番組表の締切時刻を close=HHMM で付ける（Worker が気象の計測時刻を確かめるため）', async () => {
  const c = makeCtx();
  c.previewData = {};
  c.programData = { 14: { 1: { race_closed_at: '2026-11-27 08:35:00' }, 12: { race_closed_at: '2026-11-27 14:13:00' }, 3: { race_closed_at: 'こわれた値' }, 4: {} } };
  const u1 = await loadLive(c, 14, 1, { pending: true });
  assert.ok(u1.some((u) => /\/beforeinfo-proxy\?jcd=14&race=1&hd=\d{8}&close=0835$/.test(u)), u1.join(' '));
  const u12 = await loadLive(c, 14, 12, { pending: true });
  assert.ok(u12.some((u) => /&race=12&hd=\d{8}&close=1413$/.test(u)), u12.join(' '));
  for (const rno of [3, 4, 5]) {
    const u = await loadLive(c, 14, rno, { pending: true });
    assert.ok(u.some((x) => new RegExp('&race=' + rno + '&hd=\\d{8}$').test(x)), '締切時刻が読めないのに close を付けた: ' + u.join(' '));
  }
});
t('応答に気象が無ければ、入っていた気象を消さない', async () => {
  const c = makeCtx();
  const row = fxRow(0, PROXY_WX);
  c.previewData = c.indexPreviews({ previews: [row] });
  await loadLive(c, 14, 1, { race_stadium_number: 14, race_number: 1, boats: PROXY_BOATS() });
  assert.deepStrictEqual(plain(c.previewData[14][1].weather), WX_APP);
});
t('まだ無いレース → 応答から新しく作る（気象あり / 気象なしは全部 0 の weather）', async () => {
  const c = makeCtx();
  c.previewData = {};
  await loadLive(c, 14, 1, Object.assign({ race_stadium_number: 14, race_number: 1, boats: PROXY_BOATS() }, PROXY_WX));
  assert.deepStrictEqual(plain(c.previewData[14][1].weather), WX_APP);
  const c2 = makeCtx();
  c2.previewData = {};
  await loadLive(c2, 14, 2, { race_stadium_number: 14, race_number: 2, boats: PROXY_BOATS() });
  assert.deepStrictEqual(plain(c2.previewData[14][2].weather), ZERO_WX);
});
t('応答の気象が数値でなくても、数値にして入れる', async () => {
  const c = makeCtx();
  c.previewData = {};
  await loadLive(c, 14, 1, { boats: PROXY_BOATS(), race_temperature: '<b>x</b>', race_wind: '4', race_wind_direction_number: 13 });
  assert.deepStrictEqual(plain(c.previewData[14][1].weather), Object.assign({}, ZERO_WX, { wind_speed: 4, wind_direction: 13 }));
});
t('展示前 (pending) の応答では何も作らない', async () => {
  const c = makeCtx();
  c.previewData = {};
  await loadLive(c, 14, 1, { pending: true });
  assert.ok(!(c.previewData[14] && c.previewData[14][1]));
});

// ------------------------------------------------------------------------------------------
section('[data/previews（GitHub Actions の取得）を取り込む (_applyLiveDataMerge)]');
const liveDoc = (races) => ({ updated_at: new Date().toISOString(), race_date: todayIso().replace(/-/g, ''), races });
const liveRow = (sid, rno, weather) => Object.assign({ stadium: sid, race: rno, boats: PROXY_BOATS(), finished: false, result: null }, weather ? { weather } : {});
t('気象の無いレースに、data/previews の気象を入れる', () => {
  const c = makeCtx();
  c.previewData = c.indexPreviews({ previews: [fxRow(0)] });
  c._applyLiveDataMerge(liveDoc([liveRow(14, 1, WX_APP)]));
  assert.deepStrictEqual(plain(c.previewData[14][1].weather), WX_APP);
});
t('Worker から届いた気象は上書きしない', () => {
  const c = makeCtx();
  const row = fxRow(0, PROXY_WX);
  c.previewData = c.indexPreviews({ previews: [row] });
  c._applyLiveDataMerge(liveDoc([liveRow(14, 1, { wind_speed: 9, wind_direction: 5, wave_height: 9, temperature: 30, water_temperature: 30 })]));
  assert.deepStrictEqual(plain(c.previewData[14][1].weather), WX_APP);
});
t('data/previews に気象が無い行では、入っていた気象を消さない・空の気象で上書きしない', () => {
  const c = makeCtx();
  const row = fxRow(0, PROXY_WX);
  c.previewData = c.indexPreviews({ previews: [row] });
  c._applyLiveDataMerge(liveDoc([liveRow(14, 1, null)]));
  assert.deepStrictEqual(plain(c.previewData[14][1].weather), WX_APP);
  c._applyLiveDataMerge(liveDoc([liveRow(14, 1, ZERO_WX)]));
  assert.deepStrictEqual(plain(c.previewData[14][1].weather), WX_APP);
});
t('まだ無いレース → 新しく作る（気象あり / 無ければ全部 0 の weather）', () => {
  const c = makeCtx();
  c.previewData = {};
  c._applyLiveDataMerge(liveDoc([liveRow(14, 1, WX_APP), liveRow(14, 2, null)]));
  assert.deepStrictEqual(plain(c.previewData[14][1].weather), WX_APP);
  assert.deepStrictEqual(plain(c.previewData[14][2].weather), ZERO_WX);
  assert.deepStrictEqual(plain(byBoat(c.previewData[14][1].boats)), OFFICIAL);
});
t('data/previews の気象が数値でなくても、数値にして入れる', () => {
  const c = makeCtx();
  c.previewData = {};
  c._applyLiveDataMerge(liveDoc([liveRow(14, 1, { wind_speed: '<i>', wind_direction: '13', temperature: '9.5' })]));
  const w = c.previewData[14][1].weather;
  assert.deepStrictEqual(plain(w), Object.assign({}, ZERO_WX, { wind_direction: 13, temperature: 9.5 }));
});

// ------------------------------------------------------------------------------------------
section('[風向の番号: 公式ページの矢印（5 = 追い風、13 = 向かい風）]');
t('表示: 3〜7 追い風 / 11〜15 向かい風 / 16・1・2 右横風 / 8〜10 左横風 / 17 無風 / それ以外 ---', () => {
  const want = {
    1: '右横風', 2: '右横風', 3: '追い風', 4: '追い風', 5: '追い風', 6: '追い風', 7: '追い風', 8: '左横風', 9: '左横風', 10: '左横風',
    11: '向かい風', 12: '向かい風', 13: '向かい風', 14: '向かい風', 15: '向かい風', 16: '右横風', 17: '無風',
  };
  for (let n = 1; n <= 17; n++) assert.strictEqual(ctx._windDirLabel(n), want[n], '番号 ' + n);
  for (const bad of [0, 18, -1, undefined, null, NaN, 'x', {}]) assert.strictEqual(ctx._windDirLabel(bad), '---', String(bad));
  assert.strictEqual(ctx._windDirLabel('13'), '向かい風', '文字列の番号');
  assert.strictEqual(ctx._windDirLabel('5'), '追い風');
});
t('表示の区分は、採点が使う判定と同じ', () => {
  for (let n = 0; n <= 18; n++) {
    assert.strictEqual(ctx._windDirLabel(n) === '追い風', ctx.isTailWind(n), 'tail ' + n);
    assert.strictEqual(ctx._windDirLabel(n) === '向かい風', ctx.isHeadWind(n), 'head ' + n);
  }
});
t('学習の特徴量（向かい風 × コース）も同じ範囲', () => {
  const boat = { racer_boat_number: 1, racer_number: 4444, racer_class_number: 1, racer_national_top_1_percent: 5.5, racer_assigned_motor_top_2_percent: 38 };
  const pvb = { racer_course_number: 1, racer_start_timing: 0.13, racer_tilt_adjustment: -0.5 };
  const base = ctx.getL2Features(boat, pvb, { wind_speed: 10, wind_direction: 0 }, 0, 0, '01');
  assert.strictEqual(base.length, 24);
  for (let n = 0; n <= 18; n++) {
    const f = ctx.getL2Features(boat, pvb, { wind_speed: 10, wind_direction: n }, 0, 0, '01');
    const changed = f.some((v, i) => v !== base[i]);
    assert.strictEqual(changed, ctx.isHeadWind(n), '番号 ' + n);
    if (changed) assert.strictEqual(f[5], -1, '1 コース・向かい風 10m の特徴量');
  }
});
t('worker が持つ判定は、アプリのものと同じ（番号 0〜18）', () => {
  const vm = require('vm');
  const wp = fs.readFileSync(path.join(ROOT, 'assets', 'worker_predictor.js'), 'utf8');
  const grab = (src, re) => { const m = re.exec(src); assert.ok(m, String(re)); return m[0]; };
  const w = {};
  vm.createContext(w);
  vm.runInContext(
    grab(wp, /^var HEAD_WIND_DIRS = [^;]*;/m) + grab(wp, /^var TAIL_WIND_DIRS = [^;]*;/m) +
    grab(wp, /function isHeadWind\([^)]*\)\{[^}]*\}/) + grab(wp, /function isTailWind\([^)]*\)\{[^}]*\}/) +
    'this.h = isHeadWind; this.t = isTailWind;', w);
  for (let n = 0; n <= 18; n++) {
    assert.strictEqual(w.h(n), ctx.isHeadWind(n), 'head ' + n);
    assert.strictEqual(w.t(n), ctx.isTailWind(n), 'tail ' + n);
  }
  assert.ok(!/STADIUM_WIND_PROFILE|GLOBAL_HEAD_DIRS|GLOBAL_TAIL_DIRS/.test(wp), 'worker に方位を仮定した表が残っている');
});
t('方位を仮定した表（WIND_DIR / 場別の表）は残っていない', () => {
  assert.strictEqual(typeof ctx.WIND_DIR, 'undefined');
  assert.strictEqual(typeof ctx.STADIUM_WIND_PROFILE, 'undefined');
  const detail = fs.readFileSync(path.join(ROOT, 'src', 'reporting', 'race_detail.js'), 'utf8');
  assert.ok(!/WIND_DIR\[/.test(detail));
});

// ------------------------------------------------------------------------------------------
section('[気象の欄の表示]');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
t('公式ページの値（鳴門 1R）: 向かい風 1m / 波 1cm / 気温 11℃ / 水温 18℃', () => {
  const html = ctx._weatherBarHtml({ weather: { wind_speed: 1, wind_direction: 13, wave_height: 1, temperature: 11, water_temperature: 18, weather_number: 1 } });
  assert.strictEqual(text(html), '風: 向かい風 1m 波: 1cm 気温: 11℃ 水温: 18℃');
  assert.ok(html.startsWith('<div class="weather-bar">'));
});
t('追い風・横風・無風の表示', () => {
  const bar = (wd, ws) => text(ctx._weatherBarHtml({ weather: { wind_speed: ws, wind_direction: wd, wave_height: 2, temperature: 20, water_temperature: 21 } }));
  assert.ok(bar(5, 4).startsWith('風: 追い風 4m'), bar(5, 4));
  assert.ok(bar(1, 3).startsWith('風: 右横風 3m'), bar(1, 3));
  assert.ok(bar(9, 3).startsWith('風: 左横風 3m'), bar(9, 3));
  assert.ok(bar(17, 0).startsWith('風: 無風 0m'), bar(17, 0));
});
t('上流が入れた気象（展示前のレースにも、その場の最新の計測値が入る。本番の実データ）を取り込んで表示する', () => {
  // 2026-11-27 11:25 JST の本番 /api/previews の 2 行: 唐津 12R（風 4m・番号 14）/ 戸田 4R（無風）。どちらも展示はまだ無い
  const UP = JSON.parse(fs.readFileSync(path.join(FIX, 'previews_upstream_weather.json'), 'utf8'));
  const rows = UP.previews.map((r) => Object.assign(clone(r), { race_date: todayIso() }));
  assert.deepStrictEqual(rows.map((r) => [r.race_stadium_number, r.race_number]), [[23, 12], [2, 4]]);
  // 展示が無くても、気象があれば取り込む
  const kept = ctx._filterStalePreviews({ previews: rows });
  assert.strictEqual(kept.previews.length, 2);
  const idx = ctx.indexPreviews({ previews: kept.previews });
  const karatsu = idx[23][12];
  const toda = idx[2][4];
  assert.deepStrictEqual(plain(karatsu.weather), { wind_speed: 4, wind_direction: 14, wave_height: 4, temperature: 14, water_temperature: 11, weather_number: 2 });
  assert.strictEqual(text(ctx._weatherBarHtml(karatsu)), '風: 向かい風 4m 波: 4cm 気温: 14℃ 水温: 11℃');
  assert.strictEqual(text(ctx._weatherBarHtml(toda)), '風: 無風 0m 波: 0cm 気温: 12℃ 水温: 11℃');
  // 体重は艇番どおり・展示はまだ無い（展示を取りに行く対象のまま）
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((n) => karatsu.boats[n].racer_weight), [52, 57.1, 52.6, 52.3, 52, 52]);
  assert.strictEqual(ctx._isPreviewIncomplete(karatsu), true);
  // 採点が使う判定: 番号 14 は向かい風
  assert.deepStrictEqual([ctx.isHeadWind(karatsu.weather.wind_direction), ctx.isTailWind(karatsu.weather.wind_direction)], [true, false]);
});
t('計測値が無い時は「気象: 未取得」とだけ出す（0 を並べて無風と見せない・「展示の後に」と書かない）', () => {
  const noEx = { boats: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, { racer_boat_number: n, racer_exhibition_time: 0 }])), weather: ZERO_WX };
  const withEx = { boats: PROXY_BOATS(), weather: ZERO_WX };
  for (const pv of [withEx, noEx, { weather: ZERO_WX }, { weather: {} }, { boats: {} }, { race_wind: 0, race_wind_direction_number: null, race_temperature: 0 }]) {
    const html = ctx._weatherBarHtml(pv);
    assert.strictEqual(html, '<div class="weather-bar"><span class="weather-item">気象: 未取得</span></div>', JSON.stringify(pv).slice(0, 80));
  }
  assert.strictEqual(ctx._weatherBarHtml(null), '');
  assert.strictEqual(ctx._weatherBarHtml(undefined), '');
  // 本番の修正前の形（展示あり・気象なし）を取り込んだレース: この欄が出るのは展示の後なので、「展示の後に表示」とは書かない
  const legacy = ctx.indexPreviews({ previews: [fxRow(0)] })[14][1];
  assert.ok(Object.values(legacy.boats).some((x) => x.racer_exhibition_time > 0));
  assert.strictEqual(text(ctx._weatherBarHtml(legacy)), '気象: 未取得');
});
t('展示も気象も無いレースは取り込まない（気象の欄は出ない）。展示か気象のどちらかがあれば取り込む', () => {
  const blank = (rno) => ({ race_date: todayIso(), race_stadium_number: 14, race_number: rno, race_wind: 0, race_wind_direction_number: null, race_wave: 0, race_weather_number: null, race_temperature: 0, race_water_temperature: 0,
    boats: [1, 2, 3, 4, 5, 6].map((n) => ({ racer_boat_number: n, racer_exhibition_time: 0 })) });
  const withEx = blank(2);
  withEx.boats[0].racer_exhibition_time = 6.8;
  const withWx = Object.assign(blank(3), { race_temperature: 12 });
  const out = ctx._filterStalePreviews({ previews: [blank(1), withEx, withWx] });
  assert.deepStrictEqual(out.previews.map((p) => p.race_number), [2, 3]);
});
t('weather が無く race_* の欄だけの形でも出せる', () => {
  const html = ctx._weatherBarHtml({ race_wind: 6, race_wind_direction_number: 5, race_wave: 8, race_temperature: 9.5, race_water_temperature: 12 });
  assert.strictEqual(text(html), '風: 追い風 6m 波: 8cm 気温: 9.5℃ 水温: 12℃');
});
t('外から来た値に HTML が入っていても、そのまま画面に出さない', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = ctx._weatherBarHtml({ weather: { wind_speed: evil, wind_direction: evil, wave_height: evil, temperature: 15, water_temperature: evil } });
  assert.ok(!/<img|onerror/.test(html), html);
  assert.strictEqual(text(html), '風: --- 0m 波: 0cm 気温: 15℃ 水温: --℃');
});
t('レース詳細は _weatherBarHtml を使う', () => {
  const detail = fs.readFileSync(path.join(ROOT, 'src', 'reporting', 'race_detail.js'), 'utf8');
  assert.ok(detail.includes('var weatherHtml = _weatherBarHtml(preview);'));
});

// ------------------------------------------------------------------------------------------
section('[採点: 向かい風は 1 コース不利、追い風は有利、横風は変えない]');
const konsen = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'golden', 'race_konsen.json'), 'utf8'));
function predictWithWind(ws, wd) {
  const c = makeCtx();
  const pv = clone(konsen.preview);
  pv.weather = Object.assign({}, pv.weather, { wind_speed: ws, wind_direction: wd });
  c.programData = { [konsen.sid]: { [konsen.rno]: konsen.program } };
  c.previewData = { [konsen.sid]: { [konsen.rno]: pv } };
  c.oddsData = { odds: [konsen.odds] };
  c.racerDB = {};
  c.stadiumDB = {};
  c.l2trainStep = 0;
  c.settings = { betCount3: 10, betCount2: 5, betCountAna: 3, betMethod: 'prob', evMode: false, kpiMode: 'balanced' };
  const r = c.predictRace(konsen.sid, konsen.rno);
  return r.marks.find((m) => m.boat === 1);
}
t('風速 5m: 向かい風 (13) < 無風 = 横風 (1・9) < 追い風 (5)。理由・リスクの文言も風向どおり', () => {
  const none = predictWithWind(0, 0), head = predictWithWind(5, 13), tail = predictWithWind(5, 5);
  const crossR = predictWithWind(5, 1), crossL = predictWithWind(5, 9);
  assert.strictEqual(none.course, 1, 'フィクスチャの 1 号艇が 1 コースでない');
  assert.ok(head.prob < none.prob - 0.02, 'head ' + head.prob + ' / none ' + none.prob);
  assert.ok(tail.prob > none.prob + 0.02, 'tail ' + tail.prob + ' / none ' + none.prob);
  assert.strictEqual(crossR.prob, none.prob);
  assert.strictEqual(crossL.prob, none.prob);
  assert.ok(head.risks.some((x) => /向かい風5m/.test(x)), JSON.stringify(head.risks));
  assert.ok(tail.reasons.some((x) => /追い風5m/.test(x)), JSON.stringify(tail.reasons));
  assert.ok(!tail.risks.some((x) => /向かい風/.test(x)) && !head.reasons.some((x) => /追い風/.test(x)));
  assert.ok(!crossR.risks.concat(crossR.reasons, crossL.risks, crossL.reasons).some((x) => /向かい風|追い風/.test(x)));
});
t('従来の表で「向かい風」だった番号 (7〜10) は、もう向かい風として採点しない', () => {
  const none = predictWithWind(0, 0);
  for (const n of [8, 9, 10]) assert.strictEqual(predictWithWind(5, n).prob, none.prob, '番号 ' + n);
});

// ------------------------------------------------------------------------------------------
section('[調整重量: 上流の欄名 (racer_weight_adjustment) でも Worker の欄名 (racer_adjust_weight) でも読む]');
// 2026-11-27 の本番: 上流の行に展示が入ると Worker の行と入れ替わる。調整重量は上流 = racer_weight_adjustment、
//   Worker / scraper = racer_adjust_weight で、同じレースの値は 198 艇すべて一致していた。
function predictWithAdj(field, values) {
  const c = makeCtx();
  const pv = clone(konsen.preview);
  for (const n of Object.keys(pv.boats)) {
    delete pv.boats[n].racer_adjust_weight;
    delete pv.boats[n].racer_weight_adjustment;
  }
  for (const n of Object.keys(values || {})) pv.boats[n][field] = values[n];
  c.programData = { [konsen.sid]: { [konsen.rno]: konsen.program } };
  c.previewData = { [konsen.sid]: { [konsen.rno]: pv } };
  c.oddsData = { odds: [konsen.odds] };
  c.racerDB = {};
  c.stadiumDB = {};
  c.l2trainStep = 0;
  c.settings = { betCount3: 10, betCount2: 5, betCountAna: 3, betMethod: 'prob', evMode: false, kpiMode: 'balanced' };
  return c.predictRace(konsen.sid, konsen.rno);
}
const markOf = (r, n) => r.marks.find((m) => m.boat === n);
t('採点: どちらの欄名でも同じ予想になる。1.0kg 以上で減点し、リスクに「調整重量」と出す（外コースは「アウト不利」）', () => {
  const none = predictWithAdj('racer_adjust_weight', {});
  const w = predictWithAdj('racer_adjust_weight', { 5: 1.5, 2: 1 });
  const u = predictWithAdj('racer_weight_adjustment', { 5: 1.5, 2: 1 });
  assert.deepStrictEqual(plain(u.marks), plain(w.marks), '欄の名前で予想が変わる');
  assert.strictEqual(markOf(none, 5).course, 5);
  for (const r of [w, u]) {
    assert.ok(markOf(r, 5).prob < markOf(none, 5).prob, '5 号艇が減点されていない');
    assert.ok(markOf(r, 5).risks.some((x) => x === '調整重量+1.5kg(アウト不利)'), JSON.stringify(markOf(r, 5).risks));
    assert.ok(markOf(r, 2).risks.some((x) => x === '調整重量+1.0kg'), JSON.stringify(markOf(r, 2).risks));
  }
  assert.ok(!markOf(none, 5).risks.some((x) => /調整重量/.test(x)));
  // 文字列の数字でも同じ（外から来た値）
  const str = predictWithAdj('racer_weight_adjustment', { 5: '1.5', 2: '1' });
  assert.deepStrictEqual(plain(str.marks), plain(w.marks));
});
t('L2 の特徴量 (weightAdjust) も、どちらの欄名でも同じ値', () => {
  const i = ctx.FEATURE_PIPELINE.findIndex((f) => f.name === 'weightAdjust');
  assert.ok(i >= 12, 'weightAdjust が特徴量に無い');
  const boat5 = konsen.program.boats.find((b) => b.racer_boat_number === 5);
  const feat = (over) => {
    const pv = clone(konsen.preview);
    delete pv.boats[5].racer_adjust_weight;
    delete pv.boats[5].racer_weight_adjustment;
    Object.assign(pv.boats[5], over);
    // 2 番目の引数は、その艇の展示（previews の boats[艇番]）
    return ctx.getL2Features(boat5, pv.boats[5], pv.weather, 2, 2, konsen.sid, { allBoats: konsen.program.boats })[i];
  };
  assert.strictEqual(feat({}), 0);
  assert.strictEqual(feat({ racer_weight_adjustment: 1.5 }), 0.3);
  assert.strictEqual(feat({ racer_adjust_weight: 1.5 }), 0.3);
  assert.strictEqual(feat({ racer_weight_adjustment: 0, racer_adjust_weight: 0 }), 0);
});
t('両方の欄があって値が違う時は、展示の時に読んだ値 (racer_adjust_weight) を使う — 表示・採点・特徴量とも（本番の実データ）', () => {
  // 2026-11-27 鳴門 11R 4 号艇: 上流が展示の前に取った値 2.0 / Worker が展示の時に公式ページから読んだ値 1.5
  const MM = JSON.parse(fs.readFileSync(path.join(FIX, 'previews_adjust_weight_mismatch.json'), 'utf8')).row;
  const b4 = MM.boats[4];
  assert.deepStrictEqual([b4.racer_weight_adjustment, b4.racer_adjust_weight], [2, 1.5]);
  // 表示
  assert.strictEqual(ctx._adjWeightOf(b4), 1.5);
  // 特徴量
  const i = ctx.FEATURE_PIPELINE.findIndex((f) => f.name === 'weightAdjust');
  const boat4 = konsen.program.boats.find((b) => b.racer_boat_number === 4);
  const pv = clone(konsen.preview);
  Object.assign(pv.boats[4], { racer_weight_adjustment: b4.racer_weight_adjustment, racer_adjust_weight: b4.racer_adjust_weight });
  assert.strictEqual(ctx.getL2Features(boat4, pv.boats[4], pv.weather, 2, 2, konsen.sid, { allBoats: konsen.program.boats })[i], 0.3);
  // 採点: 予想は「展示の時の値だけがある」場合と同じになり、リスクの文言も 1.5kg
  const both = predictWithAdj('racer_adjust_weight', { 4: 1.5 });
  const c = makeCtx();
  const pv2 = clone(konsen.preview);
  for (const n of Object.keys(pv2.boats)) { delete pv2.boats[n].racer_adjust_weight; delete pv2.boats[n].racer_weight_adjustment; }
  Object.assign(pv2.boats[4], { racer_weight_adjustment: 2, racer_adjust_weight: 1.5 });
  c.programData = { [konsen.sid]: { [konsen.rno]: konsen.program } };
  c.previewData = { [konsen.sid]: { [konsen.rno]: pv2 } };
  c.oddsData = { odds: [konsen.odds] };
  c.racerDB = {};
  c.stadiumDB = {};
  c.l2trainStep = 0;
  c.settings = { betCount3: 10, betCount2: 5, betCountAna: 3, betMethod: 'prob', evMode: false, kpiMode: 'balanced' };
  const mixed = c.predictRace(konsen.sid, konsen.rno);
  assert.deepStrictEqual(plain(mixed.marks), plain(both.marks));
  assert.ok(markOf(mixed, 4).risks.some((x) => x === '調整重量+1.5kg(アウト不利)'), JSON.stringify(markOf(mixed, 4).risks));
});
t('表示: 上流の行でも Worker の行でも同じ数値を返す。数値でない値は 0（toFixed で落ちない）', () => {
  const FXW = JSON.parse(fs.readFileSync(path.join(FIX, 'previews_worker_then_upstream.json'), 'utf8'));
  // 本番の同じレース（唐津 1R）の 2 時点: 3 号艇 2.5kg / 6 号艇 1.5kg
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((n) => ctx._adjWeightOf(FXW.worker_row.boats[n])), [0, 0, 2.5, 0, 0, 1.5]);
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((n) => ctx._adjWeightOf(FXW.upstream_row.boats[n])), [0, 0, 2.5, 0, 0, 1.5]);
  assert.strictEqual(ctx._adjWeightOf({ racer_weight_adjustment: '1.5' }), 1.5);
  for (const bad of [null, undefined, {}, { racer_adjust_weight: 'x' }, { racer_weight_adjustment: '<b>' }, { racer_adjust_weight: null, racer_weight_adjustment: null }]) {
    assert.strictEqual(ctx._adjWeightOf(bad), 0, JSON.stringify(bad));
  }
  const src = fs.readFileSync(path.join(ROOT, 'src', 'reporting', 'race_detail.js'), 'utf8');
  assert.ok(/var adjVal = _adjWeightOf\(pv\);/.test(src), 'レース詳細が _adjWeightOf を使っていない');
});

// ------------------------------------------------------------------------------------------
(async () => {
  for (const [name, fn] of queue) {
    if (!fn) { console.log(name); continue; }
    try { await fn(); console.log('  PASS:', name); pass++; }
    catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
  }
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail);
})();
