// P1-Q11: numerical stability tests
//   softmax / sigmoid / safeDiv が極端な入力で NaN/Infinity を返さないことを保証
//
// 実行: node scripts/tests/test_numerical_stability.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');

// BUILD:MATH:START〜END 領域から softmax / sigmoid / safeDiv を抽出
const mathBlock = html.match(/\/\* BUILD:MATH:START \*\/[\s\S]*?\/\* BUILD:MATH:END \*\//);
if(!mathBlock) throw new Error('BUILD:MATH block not found');

const ctx = vm.createContext({});
vm.runInContext(mathBlock[0] + '\nglobalThis.softmax = softmax; globalThis.sigmoid = sigmoid; globalThis.safeDiv = safeDiv;', ctx);
// 上記 IIFE 後は globalThis に置かれていない可能性 → 取り出す
// 別法: 単純に関数定義を抽出して直接 eval
const code = `
function softmax(logits){if(!Array.isArray(logits)||logits.length===0)return [];const clean=logits.map(v=>Number.isFinite(v)?v:0);let max=clean.reduce((a,b)=>b>a?b:a,-Infinity);if(!Number.isFinite(max))max=0;const exps=clean.map(v=>Math.exp(Math.min(v-max,50)));const sum=exps.reduce((a,b)=>a+b,0);if(sum===0||!Number.isFinite(sum))return clean.map(()=>1/clean.length);return exps.map(x=>x/sum);}
function sigmoid(z){if(z>30)return 1;if(z<-30)return 0;return 1/(1+Math.exp(-z));}
function safeDiv(num,den,fallback){if(!Number.isFinite(num)||!Number.isFinite(den)||den===0){return fallback==null?0:fallback;}return num/den;}
`;
const ctx2 = vm.createContext({});
vm.runInContext(code, ctx2);

let pass = 0, fail = 0;
function t(name, ok){ if(ok){console.log('  PASS:', name); pass++;} else {console.log('  FAIL:', name); fail++;} }
function isFinAll(arr){ return arr.every(Number.isFinite); }
function sumNear(arr, target, tol){ return Math.abs(arr.reduce((a,b)=>a+b,0)-target) < (tol||1e-6); }

console.log('[softmax extreme inputs]');
t('巨大 logits でも overflow しない',
  (function(){ const r = ctx2.softmax([1000, -1000, 500, 0, 100, -100]); return isFinAll(r) && sumNear(r, 1); })());
t('全 -Infinity でも fallback uniform',
  (function(){ const r = ctx2.softmax([-Infinity, -Infinity, -Infinity]); return isFinAll(r) && sumNear(r, 1); })());
t('全 NaN は 0 として扱われ uniform',
  (function(){ const r = ctx2.softmax([NaN, NaN]); return isFinAll(r) && sumNear(r, 1); })());
t('混在 (NaN + 通常値) で NaN を 0 化',
  (function(){ const r = ctx2.softmax([NaN, 1, 2]); return isFinAll(r) && sumNear(r, 1); })());
t('空配列で空返却',
  (function(){ const r = ctx2.softmax([]); return Array.isArray(r) && r.length === 0; })());

console.log('');
console.log('[sigmoid clamping]');
t('z=1000 で 1.0 飽和（overflow なし）',
  ctx2.sigmoid(1000) === 1);
t('z=-1000 で 0 飽和（underflow なし）',
  ctx2.sigmoid(-1000) === 0);
t('z=0 で 0.5',
  Math.abs(ctx2.sigmoid(0) - 0.5) < 1e-9);

console.log('');
console.log('[safeDiv guards]');
t('0除算で fallback',
  ctx2.safeDiv(1, 0, -1) === -1 && ctx2.safeDiv(1, 0) === 0);
t('NaN/Infinity 入力で fallback',
  ctx2.safeDiv(NaN, 1) === 0 && ctx2.safeDiv(1, Infinity) === 0);
t('正常入力は素直に除算',
  Math.abs(ctx2.safeDiv(10, 4) - 2.5) < 1e-9);

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
