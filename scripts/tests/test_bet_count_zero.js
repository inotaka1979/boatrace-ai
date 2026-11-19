/**
 * 買い目点数 0（買わない）と 2連単の点数拡張、穴狙いの 0 点（2026-11-20）
 *
 * 背景: 設定画面に 0 点が無く、2連単は 3 / 5 点しか選べなかった。さらに点数を読む箇所が
 * すべて `parseInt(v) || 既定値` で、0 を保存しても 3連単 10 点 / 2連単 5 点に化けていた。
 * _parseBetCount（src/utils/math.js）で 0 を正当な値として扱うことを固定する。
 *
 *   node scripts/tests/test_bet_count_zero.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

const ctx = makeCtx();
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'golden', 'race_konsen.json'), 'utf8'));
function predictWith(betCount3, betCount2, betCountAna, withOdds) {
  Object.assign(ctx, {
    programData: { [fx.sid]: { [fx.rno]: fx.program } },
    previewData: { [fx.sid]: { [fx.rno]: fx.preview } },
    oddsData: { odds: withOdds === false ? [] : [fx.odds] }, racerDB: {}, stadiumDB: {}, l2trainStep: 0,
    settings: { betCount3, betCount2, betCountAna: betCountAna === undefined ? 3 : betCountAna, betMethod: 'prob', evMode: false, kpiMode: 'balanced' },
  });
  return ctx.predictRace(fx.sid, fx.rno);
}

console.log('[_parseBetCount]');
t('0 は 0 のまま（文字列 "0" も）', () => {
  assert.strictEqual(ctx._parseBetCount(0, 10), 0);
  assert.strictEqual(ctx._parseBetCount('0', 10), 0);
});
t('通常の値はそのまま', () => {
  assert.strictEqual(ctx._parseBetCount('7', 5), 7);
  assert.strictEqual(ctx._parseBetCount(12, 10), 12);
});
t('未設定・不正・負の値は既定値', () => {
  [undefined, null, '', 'abc', -1, NaN].forEach((v) => assert.strictEqual(ctx._parseBetCount(v, 10), 10, String(v)));
});

console.log('[predictRace の買い目点数]');
t('3連単 0 点・2連単 0 点なら買い目が空（既定値に化けない）', () => {
  const b = predictWith('0', '0');
  assert.strictEqual(b.trifecta.length, 0, '3連単 ' + b.trifecta.length + ' 点');
  assert.strictEqual(b.exacta.length, 0, '2連単 ' + b.exacta.length + ' 点');
});
t('3連単だけ 0 点にしても 2連単は設定どおり', () => {
  const b = predictWith('0', '5');
  assert.strictEqual(b.trifecta.length, 0);
  assert.strictEqual(b.exacta.length, 5);
});
t('2連単の新しい選択肢（1・7・10 点）がそのまま反映される', () => {
  [1, 7, 10].forEach((n) => assert.strictEqual(predictWith('10', String(n)).exacta.length, n, n + ' 点'));
});
t('設定が無ければ従来どおり 3連単 10 点・2連単 5 点', () => {
  const b = predictWith(undefined, undefined);
  assert.strictEqual(b.trifecta.length, 10);
  assert.strictEqual(b.exacta.length, 5);
});

console.log('[穴狙いの点数]');
// オッズ有りだと「30 倍+ / 15 倍+」の条件で候補数自体が絞られるため（この fixture では 2 点）、
//   点数の上限どおりに並ぶオッズ未取得（AI 確率ベース）で確認する。
t('穴狙い 0 点なら穴の買い目が空（オッズ有り・無しとも。従来は下限 1 点に引き上げられていた）', () => {
  assert.strictEqual(predictWith('10', '5', '0').ana.length, 0);
  assert.strictEqual(predictWith('10', '5', '0', false).ana.length, 0);
});
t('穴狙い 2 点はそのまま、未設定は従来どおり 3 点、上限は 6 点', () => {
  assert.strictEqual(predictWith('10', '5', '2', false).ana.length, 2);
  assert.strictEqual(predictWith('10', '5', undefined, false).ana.length, 3);
  assert.strictEqual(predictWith('10', '5', '9', false).ana.length, 6);
});

console.log('[設定画面の選択肢]');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function options(id) {
  const m = new RegExp('<select id="' + id + '"[\\s\\S]*?</select>').exec(html);
  assert.ok(m, id + ' が無い');
  return [...m[0].matchAll(/<option value="(\d+)"/g)].map((x) => Number(x[1]));
}
t('3連単は 0〜12 点', () => assert.deepStrictEqual(options('setBetCount3'), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
t('2連単は 0〜10 点', () => assert.deepStrictEqual(options('setBetCount2'), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
t('穴狙いは 0〜6 点', () => assert.deepStrictEqual(options('setBetCountAna'), [0, 1, 2, 3, 4, 5, 6]));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);
