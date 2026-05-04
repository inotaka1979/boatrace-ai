// PB-4 / PC-8: Plackett–Luce 確率モデルの単体テスト
//
// 実行: node scripts/tests/test_plackett_luce.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

function extract(name, src){
  // column 0 限定（bundle 内の indent 付き同名関数を除外）
  const re = new RegExp(`(^function\\s+${name}\\s*\\([\\s\\S]*?^\\})`, 'm');
  const m = src.match(re);
  if(!m) throw new Error('cannot extract ' + name);
  return m[1];
}

const code = [
  extract('_plackettLuceTrifectaProb', html),
  extract('_plackettLuceExactaProb', html),
  extract('buildTrifectaProbDist', html),
  extract('buildExactaProbDist', html),
].join('\n');

const ctx = vm.createContext({});
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function t(name, ok){
  if(ok){ console.log('  PASS:', name); pass++; }
  else  { console.log('  FAIL:', name); fail++; }
}
function near(a, b, tol){ return Math.abs(a - b) < (tol || 1e-6); }

console.log('[_plackettLuceTrifectaProb]');

// ---- 正規性: 全 6P3=120 通りの確率の合計は 1 ----
const p = [0.55, 0.14, 0.12, 0.11, 0.06, 0.02]; // 全国コース勝率近似
let sum = 0;
for(let i=0;i<6;i++) for(let j=0;j<6;j++) for(let k=0;k<6;k++){
  if(i===j||j===k||i===k) continue;
  sum += ctx._plackettLuceTrifectaProb(p, i, j, k);
}
t('全 120 通りの 3連単確率の合計が 1 ± 1e-9', near(sum, 1.0, 1e-9));

// ---- 単純例: p=[0.5, 0.3, 0.2] の 1-2-3 ----
const p3 = [0.5, 0.3, 0.2];
const expected123 = 0.5 * (0.3 / 0.5) * (0.2 / 0.2);   // = 0.3
t('p=[0.5,0.3,0.2] の 1-2-3 確率 = 0.3',
  near(ctx._plackettLuceTrifectaProb(p3, 0, 1, 2), expected123));

// ---- 確率 0 の組合せ ----
t('確率 0 の艇を含むと 0',
  ctx._plackettLuceTrifectaProb([0.5, 0, 0.5], 0, 1, 2) === 0);

// ---- 完全均等の場合 1/120 ----
const eq = [1/6, 1/6, 1/6, 1/6, 1/6, 1/6];
t('均等確率の任意 3連単 = 1/120',
  near(ctx._plackettLuceTrifectaProb(eq, 0, 1, 2), 1/120, 1e-9));

console.log('');
console.log('[_plackettLuceExactaProb]');

// ---- 2連単の正規性: 全 6P2=30 通りの合計が 1 ----
let sum2 = 0;
for(let i=0;i<6;i++) for(let j=0;j<6;j++){
  if(i===j) continue;
  sum2 += ctx._plackettLuceExactaProb(p, i, j);
}
t('全 30 通りの 2連単確率の合計が 1 ± 1e-9', near(sum2, 1.0, 1e-9));

t('p=[0.5,0.3,0.2] の 1-2 = 0.3',
  near(ctx._plackettLuceExactaProb(p3, 0, 1), 0.5 * 0.3 / 0.5));

t('p=[0.5,0.3,0.2] の 2-1 = 0.3',
  near(ctx._plackettLuceExactaProb(p3, 1, 0), 0.3 * 0.5 / 0.7));

// ---- 旧式 (p_i*p_j*2) との比較 ----
// 旧: 0.5*0.3*2 = 0.30
// 新: 0.5*(0.3/0.5) = 0.30 (たまたま一致)
// よりはっきり違う例: p=[0.4, 0.4, 0.2]
const p4 = [0.4, 0.4, 0.2];
const old12 = 0.4 * 0.4 * 2;        // = 0.32
const new12 = ctx._plackettLuceExactaProb(p4, 0, 1);  // = 0.4 * 0.4/0.6
t('旧式と PL モデルが異なる事を確認 (p=[.4,.4,.2]: old=0.32 new≈0.267)',
  Math.abs(old12 - new12) > 0.05);

console.log('');
console.log('[buildTrifectaProbDist]');

const marks = [
  {boat: 1, prob: 0.5},
  {boat: 2, prob: 0.3},
  {boat: 3, prob: 0.2},
];
const dist = ctx.buildTrifectaProbDist(marks);
t('3 マークから 6 通りの 3連単分布が出る (3P3=6)',
  Object.keys(dist).length === 6);
t('1-2-3 が dist に存在', dist['1-2-3'] !== undefined);
t('1-2-3 の値が PL 計算と一致', near(dist['1-2-3'], 0.3));

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
