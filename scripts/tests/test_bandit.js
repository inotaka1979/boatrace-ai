// Epic 15 (P2-4): mini-bandit ユニットテスト
//   Thompson sampling の収束性 + 永続化を検証
//
// 実行: node scripts/tests/test_bandit.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');
const bundleMatch = html.match(/\/\* BUILD:BANDIT:START \*\/[\s\S]*?\/\* BUILD:BANDIT:END \*\//);
if(!bundleMatch) throw new Error('BUILD:BANDIT bundle missing');

const lsMock = (function(){
  const store = new Map();
  return {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
})();

const ctx = vm.createContext({ localStorage: lsMock, Math: Math, Date: Date });
vm.runInContext(bundleMatch[0], ctx);

let pass = 0, fail = 0;
function t(name, ok){ if(ok){ console.log('  PASS:', name); pass++; } else { console.log('  FAIL:', name); fail++; } }

// 2026-05-16: Math.random を mulberry32 で deterministic seed 化、
//   CI で稀に発生する事後平均テストの flake を撲滅。
//   元の Thompson sampling アルゴリズム自体は変更しない。
(function seedRandom(){
  let s = 0xC0FFEE;
  function mulberry32(){
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  Math.random = mulberry32;
})();

console.log('[banditSelect / banditUpdate]');
const variants = [
  { id: 'A', alpha: 1, beta: 1 },
  { id: 'B', alpha: 1, beta: 1 },
];

// 偏った報酬を 400 試行投入: A=hit率 80%, B=hit率 20%
// (試行数を 200→400 に倍増、deterministic seed と合わせて安定化)
for(let i = 0; i < 400; i++){
  const chosen = ctx.banditSelect(variants);
  const reward = (chosen.id === 'A')
    ? (Math.random() < 0.8 ? 1 : 0)
    : (Math.random() < 0.2 ? 1 : 0);
  ctx.banditUpdate(variants, chosen.id, reward);
}

const means = ctx.banditMeans(variants);
t('400 試行後、A が ranking 1位', means[0].id === 'A');
t('A の事後平均 > 0.6', means[0].mean > 0.6);
t('B の事後平均 < 0.4', means.find(x=>x.id==='B').mean < 0.4);
t('A は B より多く選ばれる',
  variants.find(x=>x.id==='A').n > variants.find(x=>x.id==='B').n);

console.log('');
console.log('[永続化]');
ctx.banditSave(variants);
const loaded = ctx.banditLoad([{id:'A',alpha:1,beta:1},{id:'B',alpha:1,beta:1}]);
t('save → load で内容復元',
  loaded.length === 2
  && loaded.find(v=>v.id==='A').alpha === variants.find(v=>v.id==='A').alpha);

console.log('');
console.log('[エッジケース]');
t('空配列 → null', ctx.banditSelect([]) === null);
t('未知 id update → false', ctx.banditUpdate(variants, 'XYZ', 1) === false);
t('reward clamp [0,1]', (function(){
  const vs = [{id:'X', alpha:1, beta:1}];
  ctx.banditUpdate(vs, 'X', 5);   // 5 → 1 にクランプ
  return vs[0].alpha === 2 && vs[0].beta === 1;
})());

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
