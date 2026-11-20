/**
 * worker.js parseRaceresultHTML の回帰テスト (2026-07-19 markup 変更対応)。
 *   boatrace.jp が払戻券種ラベルを th→td rowspan に変更し旧パーサが全滅した
 *   実障害の固定。フィクスチャは probe の実採取 HTML (場2 戸田 1R 20260719)。
 *
 *   node scripts/tests/test_raceresult_parse.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'cloudflare-worker', 'worker.js'), 'utf8');

// worker.js から必要な関数だけ brace-matching で抽出して eval する
function extractFn(name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `function ${name} not found in worker.js`);
  let depth = 0;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

const ctx = { console };
vm.createContext(ctx);
for (const fn of ['stripTags', 'toHalfWidthInt', 'parseStTiming', 'applyStartInfoAndTechnique', 'parseRaceresultHTML']) {
  vm.runInContext(extractFn(fn), ctx);
}
// 2026-11-20: 決まり手の対応表（関数ではないので行ごと取り出す）
vm.runInContext(/^const TECHNIQUE_NUM = .*$/m.exec(src)[0].replace(/^const /, 'var '), ctx);

const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'raceresult_new_markup.html'), 'utf8');
// vm 別レルムの Object と deepStrictEqual の prototype 比較を避けるため JSON 正規化
const r = JSON.parse(JSON.stringify(vm.runInContext('parseRaceresultHTML(HTML, 2, 1, "2026-07-19")',
  Object.assign(ctx, { HTML: html }))));

let pass = 0, fail = 0;
function t(name, f) {
  try { f(); pass++; console.log(`  PASS: ${name}`); }
  catch (e) { fail++; console.log(`  FAIL: ${name} — ${e.message}`); }
}

console.log('[parseRaceresultHTML: 2026-07-19 markup]');
t('着順 6 艇 (全角数字対応)', () => {
  assert.strictEqual(r.boats.length, 6);
  const byPlace = {};
  r.boats.forEach(b => { byPlace[b.racer_place_number] = b.racer_boat_number; });
  assert.deepStrictEqual(byPlace, { 1: 4, 2: 2, 3: 3, 4: 1, 5: 5, 6: 6 });
});
t('確定判定 (technique=1)', () => assert.strictEqual(r.race_technique_number, 1));
t('3連単 (td rowspan ラベル + span 組番 + &yen; 金額)', () =>
  assert.deepStrictEqual(r.payouts.trifecta, [{ combination: '4-2-3', amount: 5350 }]));
t('2連単 / 単勝', () => {
  assert.deepStrictEqual(r.payouts.exacta, [{ combination: '4-2', amount: 1930 }]);
  assert.deepStrictEqual(r.payouts.win, [{ combination: '4', amount: 860 }]);
});
t('3連複 同着 (rowspan 継続行)', () =>
  assert.deepStrictEqual(r.payouts.trio, [
    { combination: '2=3=4', amount: 1020 },
    { combination: '1=2=4', amount: 980 },
  ]));
t('&nbsp; 埋め草行の除外', () => {
  assert.strictEqual(r.payouts.trifecta.length, 1);
  assert.strictEqual(r.payouts.win.length, 1);
});
t('未掲載ページは technique=null', () => {
  const empty = vm.runInContext(
    'parseRaceresultHTML("<table><tbody><tr><td>データはありません</td></tr></tbody></table>", 2, 1, "2026-07-19")', ctx);
  assert.strictEqual(empty.race_technique_number, null);
});

// 2026-11-20: 決まり手・進入・ST・登録番号（fixture は boatrace.jp 2026-11-19 桐生 12R、Python 側と同じ）
console.log('[parseRaceresultHTML: スタート情報 / 決まり手 / 登録番号]');
const html2 = fs.readFileSync(path.join(__dirname, 'fixtures', 'raceresult_start_info.html'), 'utf8');
const run2 = (h) => JSON.parse(JSON.stringify(vm.runInContext('parseRaceresultHTML(HTML2, 1, 12, "2026-11-19")', Object.assign(ctx, { HTML2: h }))));
const r2 = run2(html2);
const by2 = {}; r2.boats.forEach((b) => { by2[b.racer_boat_number] = b; });
t('登録番号を読む（従来 null）', () => { assert.strictEqual(by2[1].racer_number, 4471); assert.strictEqual(by2[6].racer_number, 5004); });
t('ST を読む', () => { assert.strictEqual(by2[1].racer_start_timing, 0.13); assert.strictEqual(by2[5].racer_start_timing, 0.16); });
t('決まり手を読む（逃げ以外も）', () => {
  assert.strictEqual(r2.race_technique_name, '逃げ');
  assert.strictEqual(r2.race_technique_number, 1);
  const r3 = run2(html2.replace('<td class="is-fs16">逃げ</td>', '<td class="is-fs16">まくり差し</td>'));
  assert.strictEqual(r3.race_technique_number, 4, '従来は常に 1 (逃げ)');
});
t('進入コースはスタート情報の並び順（前付け）', () => {
  const a = '<span class="table1_boatImage1Number is-type1">1</span>';
  const b = '<span class="table1_boatImage1Number is-type2">2</span>';
  const r4 = run2(html2.replace(a, '@@A@@').replace(b, a).replace('@@A@@', b));
  const by4 = {}; r4.boats.forEach((x) => { by4[x.racer_boat_number] = x; });
  assert.strictEqual(by4[2].racer_course_number, 1);
  assert.strictEqual(by4[1].racer_course_number, 2);
});
t('F / L の ST', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext('parseStTiming("F.02")', ctx))), { st: -0.02, kind: 'F' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext('parseStTiming("L")', ctx))), { st: null, kind: 'L' });
});

// 2026-11-20: 「レース中止」ページ（津 1R 20261119 の縮小）
t('レース中止は race_cancelled（着順・決まり手なし）', () => {
  const hc = fs.readFileSync(path.join(__dirname, 'fixtures', 'raceresult_cancelled.html'), 'utf8');
  const rc = JSON.parse(JSON.stringify(vm.runInContext('parseRaceresultHTML(HC, 9, 1, "2026-11-19")', Object.assign(ctx, { HC: hc }))));
  assert.strictEqual(rc.race_cancelled, true);
  assert.strictEqual(rc.race_technique_number, null);
  assert.strictEqual(rc.boats.length, 0);
  assert.ok(!('race_cancelled' in r), '通常の結果に付いた');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
