/**
 * S-02 / PR-3: generateBetsV2 を Plackett–Luce に一本化したことの検証。
 *
 * 旧実装は 3連単を p_i*p_j*p_k*6 として計算し、Σp が race shape 依存で
 * 0.82〜3.33 に振れていた（uniform 3.33 / konsen 3.05 / honmei 1.75 /
 * chogeki 0.82）。PL 化で全パターン Σ=1 になることを不変条件として固定する。
 *
 *   node scripts/tests/test_bet_generation.js
 */

'use strict';

const assert = require('assert');
const { makeCtx } = require('./_vm_harness');

const ctx = makeCtx();

function marksOf(probs) {
  return probs.map((p, i) => ({ boat: i + 1, prob: p }));
}
const PATTERNS = {
  uniform: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6],
  honmei: [0.55, 0.15, 0.12, 0.08, 0.06, 0.04],
  chogeki: [0.72, 0.1, 0.07, 0.05, 0.04, 0.02],
  konsen: [0.28, 0.2, 0.18, 0.16, 0.1, 0.08],
};

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}
function sum(arr) { return arr.reduce((a, b) => a + b.prob, 0); }

console.log('[invariant: Σp = 1 for all bet types across race shapes]');
Object.keys(PATTERNS).forEach((key) => {
  t(`${key}: trifecta(120) Σ=1`, () => {
    const bets = ctx.generateBetsV2(marksOf(PATTERNS[key]), 'prob', 120, 30);
    assert.strictEqual(bets.trifecta.length, 120);
    assert.ok(Math.abs(sum(bets.trifecta) - 1) < 1e-9, `Σ=${sum(bets.trifecta)}`);
  });
  t(`${key}: exacta(30) Σ=1`, () => {
    const bets = ctx.generateBetsV2(marksOf(PATTERNS[key]), 'prob', 120, 30);
    assert.strictEqual(bets.exacta.length, 30);
    assert.ok(Math.abs(sum(bets.exacta) - 1) < 1e-9, `Σ=${sum(bets.exacta)}`);
  });
  t(`${key}: quinella(15) Σ=1`, () => {
    const bets = ctx.generateBetsV2(marksOf(PATTERNS[key]), 'prob', 120, 30);
    assert.strictEqual(bets.quinella.length, 15);
    assert.ok(Math.abs(sum(bets.quinella) - 1) < 1e-9, `Σ=${sum(bets.quinella)}`);
  });
});

console.log('[mode consistency: prob and ev give the same combo probability]');
t('same combo prob in prob-mode and ev-mode', () => {
  const marks = marksOf(PATTERNS.honmei);
  const probBets = ctx.generateBetsV2(marks, 'prob', 120, 30);
  const probMap = {};
  probBets.trifecta.forEach((b) => { probMap[b.combo] = b.prob; });
  // 全 combo に十分なオッズを与えて EV フィルタを通す
  const odds = {};
  Object.keys(probMap).forEach((c) => { odds[c] = 50; });
  const evBets = ctx.generateBetsV2(marks, 'ev', 120, 30, { trifecta: odds }, { evMin: 0, maxBets: 120 });
  assert.ok(evBets.trifecta.length > 0);
  evBets.trifecta.forEach((b) => {
    assert.ok(Math.abs(b.prob - probMap[b.combo]) < 1e-12, `combo ${b.combo}: ${b.prob} vs ${probMap[b.combo]}`);
  });
});

console.log('[definition: quinella(i=j) = exacta(i-j) + exacta(j-i)]');
t('quinella 1=2 equals exacta 1-2 + 2-1', () => {
  const marks = marksOf(PATTERNS.konsen);
  const bets = ctx.generateBetsV2(marks, 'prob', 120, 30);
  const exa = {};
  bets.exacta.forEach((b) => { exa[b.combo] = b.prob; });
  const qui = {};
  bets.quinella.forEach((b) => { qui[b.combo] = b.prob; });
  assert.ok(Math.abs(qui['1=2'] - (exa['1-2'] + exa['2-1'])) < 1e-12);
  assert.ok(Math.abs(qui['3=5'] - (exa['3-5'] + exa['5-3'])) < 1e-12);
});
t('all probabilities in [0,1] and finite', () => {
  Object.keys(PATTERNS).forEach((key) => {
    const bets = ctx.generateBetsV2(marksOf(PATTERNS[key]), 'prob', 120, 30);
    ['trifecta', 'exacta', 'quinella'].forEach((typ) => {
      bets[typ].forEach((b) => {
        assert.ok(Number.isFinite(b.prob) && b.prob >= 0 && b.prob <= 1, `${key}/${typ}/${b.combo}=${b.prob}`);
      });
    });
  });
});

console.log('[degenerate inputs do not throw]');
t('a boat with prob=0 → no throw, combos with it are 0', () => {
  const marks = marksOf([0.5, 0.3, 0.2, 0.0, 0.0, 0.0]);
  const bets = ctx.generateBetsV2(marks, 'prob', 120, 30);
  bets.trifecta.forEach((b) => {
    const parts = b.combo.split('-');
    if (parts.includes('4') || parts.includes('5') || parts.includes('6')) {
      assert.strictEqual(b.prob, 0, `combo ${b.combo} should be 0`);
    }
  });
});
t('marks.length < 3 → trifecta empty, no throw', () => {
  const bets = ctx.generateBetsV2(marksOf([0.6, 0.4]).slice(0, 2), 'prob', 120, 30);
  assert.strictEqual(bets.trifecta.length, 0);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);
