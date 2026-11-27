/**
 * 直前情報の気象と、展示データ (boats) の形（Worker 側）
 *
 * 2026-11-27 に本番で見つけた 2 件:
 *   1. 気象（風・波・気温・水温・天候）がどの経路にも入っていなかった。上流 (openapi) の previews は気象の欄を
 *      持つが値が無く、Worker の展示の補完も気象を読んでいなかった（168 レースすべて気象なし）。
 *   2. 上流の boats は配列（位置 0 = 1 号艇）で、Worker は boats[艇番] に書いていた。取得した 1 号艇の値が
 *      位置 1（艇番の欄は 2）に入り、6 号艇の分は 7 番目の要素になる。アプリも同じ読み方をするので表示は
 *      合っていたが、艇番の欄とは 1 つずれていた。
 *
 * フィクスチャは実ページ / 本番の実データ:
 *   beforeinfo_naruto_R01.html      2026-11-27 鳴門 1R（展示後）
 *   beforeinfo_kiryu_R12_pre.html   2026-11-27 桐生 12R（展示前。気象の欄は空白）
 *   raceresult_*.html               結果ページ（同じ気象の欄。class が 1 つ多い）
 *   previews_legacy_shifted.json    修正前の Worker が配っていた形
 *
 *   node scripts/tests/test_preview_weather.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 時刻に依存しないよう、テスト全体を「その日の 10:00 (JST)」に固定する。
//   通しのテストは「締切 10 分前」のレースを作る。実時計のままだと、真夜中の前後では締切と気象の計測時刻が
//   別の日になり、朝や夜は実ページの計測時刻（7:45）が締切から離れすぎて、走らせる時刻で結果が変わる。
const RealDate = Date;
const FIXED_NOW = RealDate.parse(new RealDate(RealDate.now() + 9 * 3600e3).toISOString().slice(0, 10) + 'T10:00:00+09:00');
class FixedDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(FIXED_NOW);
    else super(...a);
  }
  static now() {
    return FIXED_NOW;
  }
}
globalThis.Date = FixedDate;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = path.join(ROOT, 'scripts', 'tests', 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

const PAGE = read('beforeinfo_naruto_R01.html');
const PAGE_PRE = read('beforeinfo_kiryu_R12_pre.html');
const LEGACY = JSON.parse(read('previews_legacy_shifted.json'));
// 公式ページ（鳴門 1R 11/27）に載っている値
const OFFICIAL = {
  1: { et: 6.84, course: 1, st: 0.08, tilt: 0 },
  2: { et: 6.77, course: 2, st: 0.11, tilt: 0 },
  3: { et: 6.81, course: 3, st: 0.08, tilt: -0.5 },
  4: { et: 6.79, course: 4, st: 0.08, tilt: 0 },
  5: { et: 6.75, course: 5, st: 0.01, tilt: 0 },
  6: { et: 6.83, course: 6, st: 0.07, tilt: -0.5 },
};
const OFFICIAL_WEATHER = {
  race_temperature: 11, race_wind: 1, race_water_temperature: 18, race_wave: 1,
  race_weather_number: 1, race_wind_direction_number: 13,
};

// --- 関数単位: worker.js から関数を抜き出して vm で動かす ---------------------------------
const SRC = fs.readFileSync(path.join(ROOT, 'cloudflare-worker', 'worker.js'), 'utf8');
function extractFn(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('関数が無い: ' + name);
  let depth = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}' && --depth === 0) return SRC.slice(i, k + 1);
  }
  throw new Error(name);
}
function extractConst(name) {
  const m = new RegExp('const ' + name + ' = [\\s\\S]*?;\\n').exec(SRC);
  if (!m) throw new Error('定数が無い: ' + name);
  return m[0];
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  [
    extractConst('PREVIEW_BOAT_MERGED_MARK'), extractConst('PREVIEW_WEATHER_FIELDS'),
    extractConst('WEATHER_CLOCK_BEFORE_MIN'), extractConst('WEATHER_CLOCK_AFTER_MIN'),
    extractFn('parseWeatherAsOf'), extractFn('weatherFitsRace'), extractFn('closeMinutesOf'),
    extractFn('stripTags'), extractFn('parseBeforeinfoHTML'), extractFn('parseBeforeinfoWeather'),
    extractFn('applyBeforeinfoWeather'), extractFn('normalizePreviewBoats'), extractFn('isValidPreviewsShape'),
    extractFn('normalizePreviewsDoc'), extractFn('hasPreviewWeather'), extractFn('exhibitionCount'),
    extractFn('carryRicherExhibitions'), extractFn('mergePreviewsBoatsFrom'),
  ].join('\n') +
    '\nthis.F = { parseBeforeinfoHTML, parseBeforeinfoWeather, applyBeforeinfoWeather, normalizePreviewBoats,' +
    ' normalizePreviewsDoc, hasPreviewWeather, carryRicherExhibitions, mergePreviewsBoatsFrom, PREVIEW_WEATHER_FIELDS,' +
    ' parseWeatherAsOf, weatherFitsRace, closeMinutesOf };',
  ctx
);
const F = ctx.F;
const plain = (v) => JSON.parse(JSON.stringify(v));
const clone = plain;

console.log('[気象の読み取り: 実ページ]');
await t('展示後のページ（鳴門 1R）から 6 項目を読む', () => {
  assert.deepStrictEqual(plain(F.parseBeforeinfoWeather(PAGE)), OFFICIAL_WEATHER);
});
await t('展示前のページ（桐生 12R。欄は空白）は null — 天候の画像の番号だけでは気象ありにしない', () => {
  assert.ok(/is-weather7/.test(PAGE_PRE), 'フィクスチャが想定の形でない');
  assert.strictEqual(F.parseBeforeinfoWeather(PAGE_PRE), null);
  assert.strictEqual(F.parseBeforeinfoHTML(PAGE_PRE), null, '展示前なのに展示ありと読んだ');
});
await t('結果ページの気象の欄（class が 1 つ多い形）も同じ読み方で読める', () => {
  const kiryu = plain(F.parseBeforeinfoWeather(read('raceresult_start_info.html')));
  assert.deepStrictEqual(kiryu, {
    race_temperature: 7, race_wind: 5, race_water_temperature: 13, race_wave: 4,
    race_weather_number: 1, race_wind_direction_number: 2,
  });
  const miyajima = plain(F.parseBeforeinfoWeather(read('raceresult_nonfinishers.html')));
  assert.deepStrictEqual(miyajima, {
    race_temperature: 9, race_wind: 5, race_water_temperature: 20, race_wave: 5,
    race_weather_number: 1, race_wind_direction_number: 15,
  });
});

console.log('[気象の読み取り: 形の違うページ]');
const unit = (title, data) =>
  '<div class="weather1_bodyUnitLabel"><span class="weather1_bodyUnitLabelTitle">' + title + '</span>\n' +
  '<span class="weather1_bodyUnitLabelData">' + data + '</span></div>';
const block = (inner) => '<div class="weather1"><div class="weather1_body">' + inner + '</div></div>';
await t('気象の欄が無いページ・空・文字列でない入力は null', () => {
  assert.strictEqual(F.parseBeforeinfoWeather('<html><body>なにもない</body></html>'), null);
  assert.strictEqual(F.parseBeforeinfoWeather(''), null);
  assert.strictEqual(F.parseBeforeinfoWeather(null), null);
  assert.strictEqual(F.parseBeforeinfoWeather(undefined), null);
});
await t('読めた項目だけを返す（一部だけのページ）', () => {
  const w = plain(F.parseBeforeinfoWeather(block(unit('風速', '3m') + unit('波高', '2cm'))));
  assert.deepStrictEqual(w, { race_wind: 3, race_wave: 2 });
});
await t('0 は「計測値 0」として読む（無風・波なし）。無風の矢印は 17', () => {
  const html = block(
    unit('気温', '0.0℃') + unit('風速', '0m') + '<p class="weather1_bodyUnitImage is-wind17"></p>' + unit('水温', '9.5℃') + unit('波高', '0cm')
  );
  assert.deepStrictEqual(plain(F.parseBeforeinfoWeather(html)), {
    race_temperature: 0, race_wind: 0, race_water_temperature: 9.5, race_wave: 0, race_wind_direction_number: 17,
  });
});
await t('氷点下の気温を読む', () => {
  assert.strictEqual(F.parseBeforeinfoWeather(block(unit('気温', '-1.5℃'))).race_temperature, -1.5);
});
await t('知らない見出し・Object の既定の名前（constructor など）は拾わない', () => {
  const html = block(unit('constructor', '5') + unit('toString', '7') + unit('湿度', '40%') + unit('風速', '2m'));
  const w = F.parseBeforeinfoWeather(html);
  assert.deepStrictEqual(plain(w), { race_wind: 2 });
  assert.deepStrictEqual(Object.keys(w), ['race_wind']);
});
await t('方位の画像 (is-directionN) を風向と読み違えない', () => {
  const html = block('<p class="weather1_bodyUnitImage is-direction15"></p>' + unit('風速', '2m'));
  assert.strictEqual(F.parseBeforeinfoWeather(html).race_wind_direction_number, undefined);
});
await t('数値が 1 つも無ければ、矢印や天候の画像があっても null', () => {
  const html = block(unit('風速', '&nbsp;') + '<p class="weather1_bodyUnitImage is-wind5"></p><p class="weather1_bodyUnitImage is-weather2"></p>');
  assert.strictEqual(F.parseBeforeinfoWeather(html), null);
});

console.log('[気象の欄の見出し: いつの計測値か]');
const titled = (title) => '<div class="weather1"><p class="weather1_title">' + title + '</p><div class="weather1_body"></div></div>';
await t('実ページの見出しを読む（◯R時点 / HH:MM現在 / 空白）', () => {
  assert.deepStrictEqual(plain(F.parseWeatherAsOf(PAGE)), { minutes: 7 * 60 + 45 }, '鳴門 1R 当日 = 7:45現在');
  assert.strictEqual(F.parseWeatherAsOf(PAGE_PRE), null, '展示前 = 空白');
  // 2026-11-19 桐生のページを後日開いた時の見出し（12R / 1R）
  assert.deepStrictEqual(plain(F.parseWeatherAsOf(titled('水面気象情報\u300011R時点'))), { race: 11 });
  assert.deepStrictEqual(plain(F.parseWeatherAsOf(titled('水面気象情報\u300020:34現在'))), { minutes: 20 * 60 + 34 });
  assert.strictEqual(F.parseWeatherAsOf(titled('水面気象情報\u3000&nbsp;')), null);
  assert.strictEqual(F.parseWeatherAsOf(titled('水面気象情報')), null);
  assert.strictEqual(F.parseWeatherAsOf('<html></html>'), null);
  assert.strictEqual(F.parseWeatherAsOf(null), null);
});
await t('◯R時点: そのレースより前のレースの値だけ使う（締切時刻は要らない）', () => {
  assert.strictEqual(F.weatherFitsRace({ race: 11 }, 12, null), true);
  assert.strictEqual(F.weatherFitsRace({ race: 3 }, 12, null), true, '前のレースが中止の時は、もっと前のレースの値になる');
  assert.strictEqual(F.weatherFitsRace({ race: 12 }, 12, null), false, '同じレースの時点の値は「締切前」ではない');
  assert.strictEqual(F.weatherFitsRace({ race: 11 }, 1, 600), false);
  assert.strictEqual(F.weatherFitsRace({ race: 0 }, 5, 600), false);
});
await t('HH:MM現在: 締切の 3 時間前 〜 10 分後の値だけ使う。締切時刻が分からなければ使わない', () => {
  const close = 8 * 60 + 35; // 鳴門 1R の締切 8:35
  assert.strictEqual(F.weatherFitsRace({ minutes: 7 * 60 + 45 }, 1, close), true, '当日の朝の値');
  assert.strictEqual(F.weatherFitsRace({ minutes: close - 180 }, 1, close), true);
  assert.strictEqual(F.weatherFitsRace({ minutes: close - 181 }, 1, close), false);
  assert.strictEqual(F.weatherFitsRace({ minutes: close + 10 }, 1, close), true);
  assert.strictEqual(F.weatherFitsRace({ minutes: close + 11 }, 1, close), false);
  // 2026-11-19 桐生 1R（締切 15 時台）のページを後日開くと「20:34現在」= その日の最後の値
  assert.strictEqual(F.weatherFitsRace({ minutes: 20 * 60 + 34 }, 1, 15 * 60 + 25), false);
  assert.strictEqual(F.weatherFitsRace({ minutes: 7 * 60 + 45 }, 1, null), false);
  assert.strictEqual(F.weatherFitsRace({ minutes: 7 * 60 + 45 }, 1, undefined), false);
});
await t('見出しが読めない時は使わない', () => {
  assert.strictEqual(F.weatherFitsRace(null, 5, 600), false);
  assert.strictEqual(F.weatherFitsRace(undefined, 5, 600), false);
  assert.strictEqual(F.weatherFitsRace({}, 5, 600), false);
});
await t('締切時刻の文字列 → 0 時からの分', () => {
  assert.strictEqual(F.closeMinutesOf('2026-11-27 08:35:00'), 515);
  assert.strictEqual(F.closeMinutesOf('2026-11-27 20:45:00'), 1245);
  for (const bad of [null, undefined, '', '08:35', '2026-11-27T08:35:00', 20261127]) assert.strictEqual(F.closeMinutesOf(bad), null, String(bad));
});

console.log('[applyBeforeinfoWeather / hasPreviewWeather]');
await t('読めた項目だけ書く。読めなかった項目は元の値を消さない', () => {
  const row = { race_wind: 4, race_wave: 3, race_temperature: null };
  F.applyBeforeinfoWeather(row, { race_wind: 1, race_temperature: 11 });
  assert.deepStrictEqual(plain(row), { race_wind: 1, race_wave: 3, race_temperature: 11 });
  F.applyBeforeinfoWeather(row, null);
  F.applyBeforeinfoWeather(null, { race_wind: 9 });
  assert.strictEqual(row.race_wind, 1);
});
await t('気象の項目以外は書かない', () => {
  const row = {};
  F.applyBeforeinfoWeather(row, { race_wind: 2, boats: 'x', race_date: '2000-01-01' });
  assert.deepStrictEqual(Object.keys(row), ['race_wind']);
});
await t('上流の「欄はあるが値が無い」（0 / null）は、気象なしと見る', () => {
  assert.strictEqual(F.hasPreviewWeather(LEGACY.previews[0]), false);
  assert.strictEqual(F.hasPreviewWeather(null), false);
  assert.strictEqual(F.hasPreviewWeather({ race_temperature: 11 }), true);
  assert.strictEqual(F.hasPreviewWeather({ race_wind: 0, race_wave: 0, race_wind_direction_number: 17 }), true);
});

console.log('[boats の形をそろえる]');
const byBoat = (boats) => Object.fromEntries(Object.entries(boats).map(([k, b]) => [k, {
  et: b.racer_exhibition_time, course: b.racer_course_number, st: b.racer_start_timing, tilt: b.racer_tilt_adjustment,
}]));
await t('修正前の Worker が書いた形（7 要素・1 つずれ）→ 位置 n を n 号艇として読み替える（本番の実データ）', () => {
  const src = clone(LEGACY.previews[0].boats);
  assert.strictEqual(src.length, 7);
  assert.strictEqual(src[1].racer_boat_number, 2, 'フィクスチャが想定の形でない');
  const out = F.normalizePreviewBoats(src);
  assert.deepStrictEqual(Object.keys(out), ['1', '2', '3', '4', '5', '6']);
  assert.deepStrictEqual(plain(byBoat(out)), plain(OFFICIAL), '公式ページの値と艇番が合わない');
  for (const n of [1, 2, 3, 4, 5, 6]) assert.strictEqual(out[n].racer_boat_number, n, n + ' 号艇の艇番の欄');
});
await t('ずれた形の体重の欄（隣の艇の枠のもの）は引き継がない', () => {
  const src = clone(LEGACY.previews[0].boats);
  src[1].racer_weight = 52.5;
  src[1].racer_weight_adjustment = 1.5;
  const out = F.normalizePreviewBoats(src);
  assert.strictEqual(out[1].racer_weight, undefined);
  assert.strictEqual(out[1].racer_weight_adjustment, undefined);
  assert.strictEqual(out[1].racer_adjust_weight, 0, '取得した調整重量まで消した');
});
await t('上流そのままの配列（位置 0 = 1 号艇）→ 艇番の欄どおりに引き直す', () => {
  const src = clone(LEGACY.previews[1].boats);
  assert.strictEqual(src.length, 6);
  src[0].racer_exhibition_time = 6.5; // 上流が自分で値を入れた場合
  src[5].racer_exhibition_time = 6.9;
  const out = F.normalizePreviewBoats(src);
  assert.deepStrictEqual(Object.keys(out), ['1', '2', '3', '4', '5', '6']);
  assert.strictEqual(out[1].racer_exhibition_time, 6.5, '1 号艇の値が 1 号艇に入っていない');
  assert.strictEqual(out[6].racer_exhibition_time, 6.9);
  assert.strictEqual(out[2].racer_exhibition_time, 0);
});
await t('艇番をキーにした形はそのまま（艇番の欄は補う）。範囲外のキーは捨てる', () => {
  const out = F.normalizePreviewBoats({ 1: { racer_exhibition_time: 6.7 }, 6: { racer_boat_number: 6 }, 0: { x: 1 }, 7: { x: 1 }, a: { x: 1 }, 3: null });
  assert.deepStrictEqual(Object.keys(out), ['1', '6']);
  assert.strictEqual(out[1].racer_boat_number, 1);
  assert.strictEqual(out[1].racer_exhibition_time, 6.7);
});
await t('一部の艇だけ補完された「ずれた形」（欠場など）も位置で読む', () => {
  const src = clone(LEGACY.previews[1].boats); // 上流の 6 要素
  // 旧版が 2・4 号艇だけ書いた状態を作る
  for (const bn of [2, 4]) Object.assign(src[bn], { racer_exhibition_time: 6.7 + bn / 100, racer_course_number: bn, racer_propeller: '' });
  const out = F.normalizePreviewBoats(src);
  assert.strictEqual(out[2].racer_exhibition_time, 6.72);
  assert.strictEqual(out[4].racer_exhibition_time, 6.74);
  assert.strictEqual(out[2].racer_boat_number, 2);
  assert.strictEqual(out[1].racer_exhibition_time, 0);
  assert.strictEqual(out[3].racer_exhibition_time, 0);
});
await t('ずれた形で 1 号艇の値が無い時だけ、位置 0（上流の 1 号艇の枠）を使う', () => {
  const src = clone(LEGACY.previews[0].boats);
  src[1] = null;
  const out = F.normalizePreviewBoats(src);
  assert.strictEqual(out[1].racer_boat_number, 1);
  assert.strictEqual(out[1].racer_exhibition_time, 0);
  assert.strictEqual(out[2].racer_exhibition_time, 6.77);
});
await t('壊れた入力でも落ちない（null・文字列・数値・null 入りの配列・艇番の欄が無い配列）', () => {
  for (const bad of [null, undefined, 'x', 5, true, [], [null, null], [{ a: 1 }], [{ racer_boat_number: 9 }], {}]) {
    assert.deepStrictEqual(plain(F.normalizePreviewBoats(bad)), {}, JSON.stringify(bad));
  }
  const dup = F.normalizePreviewBoats([{ racer_boat_number: 2, v: 'a' }, { racer_boat_number: 2, v: 'b' }]);
  assert.strictEqual(dup[2].v, 'a', '同じ艇番が 2 つある時は先のほう');
});
await t('文書ごとそろえる。形の違う文書（上流が壊れている時）はそのまま返す', () => {
  const doc = clone(LEGACY);
  F.normalizePreviewsDoc(doc);
  assert.ok(!Array.isArray(doc.previews[0].boats) && !Array.isArray(doc.previews[1].boats));
  assert.strictEqual(doc.previews[0].boats[6].racer_exhibition_time, 6.83);
  const broken = { results: [] };
  assert.strictEqual(F.normalizePreviewsDoc(broken), broken);
  assert.strictEqual(F.normalizePreviewsDoc(null), null);
  const withNull = { previews: [null, { race_number: 1 }] };
  F.normalizePreviewsDoc(withNull);
  assert.deepStrictEqual(plain(withNull.previews[1].boats), {});
});
await t('2 回そろえても同じ（そろえた後の形を、ずれた形と読み違えない）', () => {
  const doc = clone(LEGACY);
  F.normalizePreviewsDoc(doc);
  const once = clone(doc);
  F.normalizePreviewsDoc(doc);
  assert.deepStrictEqual(plain(doc), once);
});

console.log('[前回の KV からの引き継ぎ]');
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const nativeRow = (sid, rno, date = TODAY) => ({
  race_date: date, race_stadium_number: sid, race_number: rno,
  race_wind: 0, race_wind_direction_number: null, race_wave: 0, race_weather_number: null, race_temperature: 0, race_water_temperature: 0,
  boats: [1, 2, 3, 4, 5, 6].map((n) => ({ racer_boat_number: n, racer_course_number: null, racer_start_timing: null, racer_weight: 0, racer_weight_adjustment: 0, racer_exhibition_time: 0, racer_tilt_adjustment: 0 })),
});
await t('修正前の形の KV から、展示を艇番どおりに引き継ぐ', () => {
  const target = F.normalizePreviewsDoc({ previews: [nativeRow(14, 1)] });
  const old = clone(LEGACY);
  old.previews[0].race_date = TODAY;
  assert.strictEqual(F.carryRicherExhibitions(target, old), 1);
  assert.deepStrictEqual(plain(byBoat(target.previews[0].boats)), plain(OFFICIAL));
});
await t('展示の艇数が同じでも、前回読めた気象は引き継ぐ。今回の行に気象があれば上書きしない', () => {
  const mk = () => {
    const d = F.normalizePreviewsDoc({ previews: [nativeRow(14, 1)] });
    for (const n of [1, 2, 3, 4, 5, 6]) d.previews[0].boats[n].racer_exhibition_time = 6.8;
    return d;
  };
  const old = mk();
  Object.assign(old.previews[0], OFFICIAL_WEATHER);
  const target = mk();
  assert.strictEqual(F.carryRicherExhibitions(target, old), 0, '展示は増えていない');
  for (const f of Object.keys(OFFICIAL_WEATHER)) assert.strictEqual(target.previews[0][f], OFFICIAL_WEATHER[f], f);
  const target2 = mk();
  Object.assign(target2.previews[0], { race_temperature: 5, race_wind: 7 });
  F.carryRicherExhibitions(target2, old);
  assert.strictEqual(target2.previews[0].race_temperature, 5);
  assert.strictEqual(target2.previews[0].race_wind, 7);
});
await t('前日の KV の気象は引き継がない', () => {
  const old = F.normalizePreviewsDoc({ previews: [Object.assign(nativeRow(14, 1, '2000-01-01'), OFFICIAL_WEATHER)] });
  const target = F.normalizePreviewsDoc({ previews: [nativeRow(14, 1)] });
  F.carryRicherExhibitions(target, old);
  assert.strictEqual(target.previews[0].race_temperature, 0);
  assert.strictEqual(target.previews[0].race_wind_direction_number, null);
});

// --- 通し: 実モジュールを import し、cron 1 回 / HTTP 1 回を KV 付きで回す ------------------
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
const jstClose = (minFromNow) => {
  const d = new Date(Date.now() + 9 * 3600e3 + minFromNow * 60e3);
  return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 19);
};
let upstreamPreviews = { previews: [] };
let officialPage = { status: 200, body: PAGE };
let officialHits = [];
const PROGRAMS = () => ({
  programs: [
    { race_stadium_number: 14, race_number: 1, race_date: TODAY, race_closed_at: jstClose(10), boats: [] },
    { race_stadium_number: 14, race_number: 12, race_date: TODAY, race_closed_at: jstClose(300), boats: [] },
  ],
});
globalThis.fetch = async (input) => {
  const u = String(input && input.url ? input.url : input);
  if (u.includes('boatrace.jp')) {
    officialHits.push(u);
    if (u.includes('/beforeinfo')) return new Response(officialPage.body, { status: officialPage.status });
    return new Response('', { status: 404 });
  }
  let body;
  if (u.includes('previews')) body = upstreamPreviews;
  else if (u.includes('programs')) body = PROGRAMS();
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
    async delete(k) { store.delete(k); },
    _store: store,
  };
}
const worker = (await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'worker.js')).href)).default;
const kvRow = (kv, sid, rno) =>
  JSON.parse(kv._store.get('previews:today').value).data.previews.find((r) => r.race_stadium_number === sid && r.race_number === rno);
const cron = (kv) => worker.scheduled({ cron: '*/5 23,0-13 * * *' }, { BOATRACE_KV: kv }, { waitUntil() {} });
const beforeinfoHits = () => officialHits.filter((u) => u.includes('/beforeinfo'));

console.log('[通し: cron 1 回]');
await t('上流が配列の形でも、補完した展示は艇番どおり・気象も入る（公式ページの値と一致）', async () => {
  upstreamPreviews = { previews: [nativeRow(14, 1), nativeRow(14, 12)] };
  officialPage = { status: 200, body: PAGE };
  officialHits = [];
  const kv = makeKV();
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.ok(r && !Array.isArray(r.boats), 'boats が配列のまま');
  assert.deepStrictEqual(Object.keys(r.boats), ['1', '2', '3', '4', '5', '6']);
  assert.deepStrictEqual(plain(byBoat(r.boats)), plain(OFFICIAL));
  for (const n of [1, 2, 3, 4, 5, 6]) assert.strictEqual(r.boats[n].racer_boat_number, n);
  for (const f of Object.keys(OFFICIAL_WEATHER)) assert.strictEqual(r[f], OFFICIAL_WEATHER[f], f);
  assert.strictEqual(beforeinfoHits().length, 1, '取得は展示の窓の中の 1 レースだけ');
  // 窓の外のレースは取りに行かない。形はそろえる
  const far = kvRow(kv, 14, 12);
  assert.deepStrictEqual(Object.keys(far.boats), ['1', '2', '3', '4', '5', '6']);
  assert.strictEqual(far.race_temperature, 0);
});
await t('更新の結果に、気象も入れられたレース数が出る（展示は入るのに 0 が続けば、公式ページの形が変わった合図）', async () => {
  const refresh = async (body) => {
    upstreamPreviews = { previews: [nativeRow(14, 1), nativeRow(14, 12)] };
    officialPage = { status: 200, body };
    // 認証つきで呼ぶ（未認証は 5 分に 1 回までなので、続けて呼ぶと 2 回目から断られる）
    const res = await worker.fetch(
      new Request('https://w.example/api/refresh-now', { headers: { 'x-trigger-secret': 'test-secret-for-weather' } }),
      { BOATRACE_KV: makeKV(), TRIGGER_SECRET: 'test-secret-for-weather' },
      { waitUntil() {} }
    );
    assert.strictEqual(res.status, 200);
    return (await res.json()).refreshed.exhibition_scrape;
  };
  assert.deepStrictEqual(await refresh(PAGE), { targets: 1, scraped: 1, merged: 1, weather: 1 });
  assert.deepStrictEqual(await refresh(PAGE.replace(/weather1_body/g, 'weatherX_body')), { targets: 1, scraped: 1, merged: 1, weather: 0 });
  assert.deepStrictEqual(await refresh(PAGE_PRE), { targets: 1, scraped: 1, merged: 0, weather: 0 });
});
await t('次の回: 上流は空のまま → 展示と気象を引き継ぐ。公式ページは取り直さない', async () => {
  upstreamPreviews = { previews: [nativeRow(14, 1), nativeRow(14, 12)] };
  officialPage = { status: 200, body: PAGE };
  const kv = makeKV();
  await cron(kv);
  officialHits = [];
  officialPage = { status: 500, body: '' }; // 取りに行けば失敗する
  upstreamPreviews = { previews: [nativeRow(14, 1), nativeRow(14, 12)] };
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.deepStrictEqual(plain(byBoat(r.boats)), plain(OFFICIAL));
  for (const f of Object.keys(OFFICIAL_WEATHER)) assert.strictEqual(r[f], OFFICIAL_WEATHER[f], f);
  assert.strictEqual(beforeinfoHits().length, 0, '展示があるのに取り直した');
});
await t('KV が修正前の形（本番の実データ）でも、艇番どおりに引き継ぐ。7 番目の要素は残さない', async () => {
  const old = clone(LEGACY);
  for (const r of old.previews) r.race_date = TODAY;
  const kv = makeKV({ 'previews:today': JSON.stringify({ updated_at: new Date().toISOString(), data: { previews: old.previews } }) });
  upstreamPreviews = { previews: [nativeRow(14, 1), nativeRow(14, 12)] };
  officialHits = [];
  officialPage = { status: 500, body: '' };
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.deepStrictEqual(Object.keys(r.boats), ['1', '2', '3', '4', '5', '6']);
  assert.deepStrictEqual(plain(byBoat(r.boats)), plain(OFFICIAL));
  assert.strictEqual(beforeinfoHits().length, 0);
});
await t('展示前のページ: 展示も気象も書かない', async () => {
  upstreamPreviews = { previews: [nativeRow(14, 1)] };
  officialPage = { status: 200, body: PAGE_PRE };
  officialHits = [];
  const kv = makeKV();
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.strictEqual(beforeinfoHits().length, 1);
  assert.strictEqual(Object.values(r.boats).filter((b) => b.racer_exhibition_time > 0).length, 0);
  assert.strictEqual(r.race_temperature, 0);
  assert.strictEqual(r.race_weather_number, null, '展示前の天候の番号（不明）を入れた');
});
await t('気象の欄に値があっても、展示がまだ無いページからは何も入れない', async () => {
  // 鳴門 1R のページの展示タイムだけを空欄にした形（気象の欄は「7:45現在」の実測値のまま）
  const noEx = PAGE.replace(/(<td rowspan="4">)6\.\d\d(<\/td>)/g, '$1$2');
  assert.notStrictEqual(noEx, PAGE);
  assert.strictEqual(F.parseBeforeinfoHTML(noEx), null, 'フィクスチャの加工が効いていない');
  assert.ok(F.parseBeforeinfoWeather(noEx), '気象の欄は読める');
  upstreamPreviews = { previews: [nativeRow(14, 1)] };
  officialPage = { status: 200, body: noEx };
  const kv = makeKV();
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.strictEqual(r.race_temperature, 0, '展示前の気象を入れた');
  assert.strictEqual(r.race_wind_direction_number, null);
  const j = await (await worker.fetch(new Request('https://w.example/beforeinfo-proxy?jcd=14&race=1&hd=20261127&close=0835'), { BOATRACE_KV: makeKV() }, { waitUntil() {} })).json();
  assert.deepStrictEqual(j, { pending: true });
});
await t('上流の previews が壊れている時（番組表から作り直す経路）も、修正前の形の KV から艇番どおりに引き継ぐ', async () => {
  const old = clone(LEGACY);
  for (const r of old.previews) r.race_date = TODAY;
  Object.assign(old.previews[0], OFFICIAL_WEATHER);
  const kv = makeKV({ 'previews:today': JSON.stringify({ updated_at: new Date().toISOString(), data: { previews: old.previews } }) });
  upstreamPreviews = { results: [] }; // previews キーが無い（2026-07-17 に実際に起きた形）
  officialHits = [];
  officialPage = { status: 500, body: '' };
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.ok(r, '行が無い');
  assert.deepStrictEqual(Object.keys(r.boats), ['1', '2', '3', '4', '5', '6']);
  assert.deepStrictEqual(plain(byBoat(r.boats)), plain(OFFICIAL));
  for (const f of Object.keys(OFFICIAL_WEATHER)) assert.strictEqual(r[f], OFFICIAL_WEATHER[f], f);
});
await t('後から開いた 1R のページ（計測時刻が締切より後）: 展示は入れるが、気象は入れない', async () => {
  upstreamPreviews = { previews: [nativeRow(14, 1)] };
  officialPage = { status: 200, body: PAGE.replace('7:45現在', '20:34現在') };
  assert.ok(officialPage.body.includes('20:34現在'));
  const kv = makeKV();
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.deepStrictEqual(plain(byBoat(r.boats)), plain(OFFICIAL));
  assert.strictEqual(r.race_temperature, 0, '別の時刻の気象を入れた');
  assert.strictEqual(r.race_wind_direction_number, null);
});
await t('見出しが読めないページ: 展示は入れるが、気象は入れない', async () => {
  upstreamPreviews = { previews: [nativeRow(14, 1)] };
  officialPage = { status: 200, body: PAGE.replace('7:45現在', '') };
  const kv = makeKV();
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.deepStrictEqual(plain(byBoat(r.boats)), plain(OFFICIAL));
  assert.strictEqual(r.race_temperature, 0);
});
await t('公式が 403 を返した時は、行を変えない', async () => {
  upstreamPreviews = { previews: [nativeRow(14, 1)] };
  officialPage = { status: 403, body: 'Forbidden' };
  const kv = makeKV();
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.strictEqual(Object.values(r.boats).filter((b) => b.racer_exhibition_time > 0).length, 0);
  assert.strictEqual(r.race_wind_direction_number, null);
});
await t('上流が艇番をキーにした形（もとの形）で届いても同じ結果', async () => {
  const keyed = nativeRow(14, 1);
  keyed.boats = Object.fromEntries(keyed.boats.map((b) => [String(b.racer_boat_number), b]));
  upstreamPreviews = { previews: [keyed] };
  officialPage = { status: 200, body: PAGE };
  const kv = makeKV();
  await cron(kv);
  const r = kvRow(kv, 14, 1);
  assert.deepStrictEqual(plain(byBoat(r.boats)), plain(OFFICIAL));
  assert.strictEqual(r.race_wind_direction_number, 13);
});

console.log('[通し: /api/previews と /beforeinfo-proxy]');
const get = (pathAndQuery, kv) =>
  worker.fetch(new Request('https://w.example' + pathAndQuery, { headers: { origin: 'https://inotaka1979.github.io' } }), { BOATRACE_KV: kv }, { waitUntil() {} });
await t('/api/previews は艇番をキーにした boats と気象を返す', async () => {
  upstreamPreviews = { previews: [nativeRow(14, 1), nativeRow(14, 12)] };
  officialPage = { status: 200, body: PAGE };
  const kv = makeKV();
  await cron(kv);
  const res = await get('/api/previews', kv);
  assert.strictEqual(res.status, 200);
  const j = await res.json();
  const r = j.previews.find((x) => x.race_stadium_number === 14 && x.race_number === 1);
  assert.deepStrictEqual(plain(byBoat(r.boats)), plain(OFFICIAL));
  assert.strictEqual(r.race_wind, 1);
  assert.strictEqual(r.race_water_temperature, 18);
});
await t('KV が無い時（上流をそのまま返す経路）も、boats は艇番をキーにした形', async () => {
  const up = nativeRow(14, 1);
  up.boats[0].racer_exhibition_time = 6.5; // 上流が自分で入れた 1 号艇の値
  upstreamPreviews = { previews: [up] };
  officialPage = { status: 500, body: '' };
  const res = await get('/api/previews', makeKV());
  const j = await res.json();
  const r = j.previews[0];
  assert.ok(!Array.isArray(r.boats));
  assert.strictEqual(r.boats[1].racer_exhibition_time, 6.5, '1 号艇の値が 1 号艇に入っていない');
  assert.strictEqual(r.boats[2].racer_exhibition_time, 0);
});
await t('/beforeinfo-proxy: 展示（艇番をキー）と気象を返す', async () => {
  officialPage = { status: 200, body: PAGE };
  officialHits = [];
  const res = await get('/beforeinfo-proxy?jcd=14&race=1&hd=20261127&close=0835', makeKV());
  assert.strictEqual(res.status, 200);
  const j = await res.json();
  assert.strictEqual(j.race_stadium_number, 14);
  assert.strictEqual(j.race_date, '2026-11-27');
  assert.deepStrictEqual(plain(byBoat(j.boats)), plain(OFFICIAL));
  for (const f of Object.keys(OFFICIAL_WEATHER)) assert.strictEqual(j[f], OFFICIAL_WEATHER[f], f);
  assert.strictEqual(beforeinfoHits().length, 1);
  assert.ok(/jcd=14/.test(beforeinfoHits()[0]) && /rno=1(&|$)/.test(beforeinfoHits()[0]) && /hd=20261127/.test(beforeinfoHits()[0]));
});
await t('/beforeinfo-proxy: 締切時刻 (close) が無い・形が違う時は、「現在」の気象を返さない（展示は返す）', async () => {
  officialPage = { status: 200, body: PAGE };
  for (const q of ['', '&close=', '&close=835', '&close=2460', '&close=0860', '&close=abcd', '&close=08350']) {
    const res = await get('/beforeinfo-proxy?jcd=14&race=1&hd=20261127' + q, makeKV());
    const j = await res.json();
    assert.deepStrictEqual(plain(byBoat(j.boats)), plain(OFFICIAL), q);
    for (const f of Object.keys(OFFICIAL_WEATHER)) assert.ok(!(f in j), q + ' で ' + f + ' が付いている');
  }
});
await t('/beforeinfo-proxy: 締切から離れた「現在」の気象は返さない（夜に朝のレースを開いた場合）', async () => {
  officialPage = { status: 200, body: PAGE.replace('7:45現在', '20:34現在') };
  const j = await (await get('/beforeinfo-proxy?jcd=14&race=1&hd=20261127&close=0835', makeKV())).json();
  assert.deepStrictEqual(plain(byBoat(j.boats)), plain(OFFICIAL));
  assert.ok(!('race_wind' in j) && !('race_temperature' in j));
});
await t('/beforeinfo-proxy: 「◯R時点」の気象は、締切時刻が無くても返す（そのレースより前のレースの値）', async () => {
  officialPage = { status: 200, body: PAGE.replace('7:45現在', '11R時点') };
  const j12 = await (await get('/beforeinfo-proxy?jcd=14&race=12&hd=20261119', makeKV())).json();
  for (const f of Object.keys(OFFICIAL_WEATHER)) assert.strictEqual(j12[f], OFFICIAL_WEATHER[f], f);
  const j1 = await (await get('/beforeinfo-proxy?jcd=14&race=1&hd=20261119', makeKV())).json();
  assert.ok(!('race_wind' in j1), '1R に 11R 時点の気象を付けた');
});
await t('/beforeinfo-proxy: 展示前は pending（気象は返さない）', async () => {
  officialPage = { status: 200, body: PAGE_PRE };
  const res = await get('/beforeinfo-proxy?jcd=1&race=12&hd=20261127', makeKV());
  const j = await res.json();
  assert.deepStrictEqual(j, { pending: true });
});
await t('/beforeinfo-proxy: 気象の欄が読めないページでも展示は返す（気象の項目は付けない）', async () => {
  officialPage = { status: 200, body: PAGE.replace(/weather1_body/g, 'weatherX_body') };
  const res = await get('/beforeinfo-proxy?jcd=14&race=1&hd=20261127&close=0835', makeKV());
  const j = await res.json();
  assert.deepStrictEqual(plain(byBoat(j.boats)), plain(OFFICIAL));
  for (const f of Object.keys(OFFICIAL_WEATHER)) assert.ok(!(f in j), f + ' が付いている');
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail);
