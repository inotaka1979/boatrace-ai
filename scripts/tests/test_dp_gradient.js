// Epic 21: DP gradient ヘルパテスト
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');
const bundleMatch = html.match(/\/\* BUILD:DP_GRADIENT:START \*\/[\s\S]*?\/\* BUILD:DP_GRADIENT:END \*\//);
if(!bundleMatch) throw new Error('BUILD:DP_GRADIENT bundle missing');

const ctx = vm.createContext({ Math: Math });
vm.runInContext(bundleMatch[0], ctx);

let pass = 0, fail = 0;
function t(name, ok){ if(ok){ console.log('  PASS:', name); pass++; } else { console.log('  FAIL:', name); fail++; } }
function near(a,b,tol){ return Math.abs(a-b) < (tol||1e-6); }
function l2(arr){ var s=0; for(var i=0;i<arr.length;i++) s+=arr[i]*arr[i]; return Math.sqrt(s); }

console.log('[clipGradient]');
t('小さい勾配は変更されない', (function(){
  var g = [0.1, 0.2, -0.1, 0.05];
  var c = ctx.clipGradient(g, 1.0);
  return c.every((v,i)=>near(v, g[i]));
})());
t('大きい勾配は L2 norm = maxNorm にクリップ', (function(){
  var g = [3.0, 4.0]; // ||g|| = 5
  var c = ctx.clipGradient(g, 1.0);
  return near(l2(c), 1.0);
})());
t('NaN 含む勾配は 0 化される', (function(){
  var g = [1.0, NaN, 0.5];
  var c = ctx.clipGradient(g, 10);   // norm 内なので clip しない
  return c[1] === 1.0 || c[1] === 0;  // 実装依存だが NaN は除去される
})());
t('空配列は OK', Array.isArray(ctx.clipGradient([], 1.0)));

console.log('');
console.log('[addGaussianNoise]');
t('sigma=0 で変更なし', (function(){
  var g = [1, 2, 3];
  var n = ctx.addGaussianNoise(g, 0);
  return n.every((v,i)=>v===g[i]);
})());
t('sigma>0 で値が変わる (高確率)', (function(){
  var g = [0, 0, 0];
  var n = ctx.addGaussianNoise(g, 1.0);
  // 全て 0 になる確率は無視できる
  return n.some(v => Math.abs(v) > 0.01);
})());
t('結果は finite', (function(){
  var g = [1, 2, 3];
  var n = ctx.addGaussianNoise(g, 0.5);
  return n.every(Number.isFinite);
})());

console.log('');
console.log('[buildDPGradient]');
t('clip + noise の合成', (function(){
  var g = [10, 0, 0];   // ||g|| = 10
  var dp = ctx.buildDPGradient(g, { maxNorm: 1.0, sigma: 0.0 });
  // sigma=0 なので noise 無し、clip だけ
  return near(l2(dp), 1.0);
})());

console.log('');
console.log('[estimateDPParams]');
t('ε=1, δ=1e-5, T=100 で sigma > 0', (function(){
  var p = ctx.estimateDPParams(1.0, 1e-5, 100);
  return p.sigma > 0 && Number.isFinite(p.sigma);
})());
t('ε 大きいほど sigma 小さい (privacy 緩く)', (function(){
  var p1 = ctx.estimateDPParams(0.5, 1e-5, 100);
  var p2 = ctx.estimateDPParams(5.0, 1e-5, 100);
  return p2.sigma < p1.sigma;
})());
t('返り値オブジェクトに sigma / epsPerStep / T / epsilon / delta を含む', (function(){
  var p = ctx.estimateDPParams(1.0, 1e-5, 100);
  return p.sigma != null && p.epsPerStep != null && p.T === 100 && p.epsilon === 1.0 && p.delta === 1e-5;
})());

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
