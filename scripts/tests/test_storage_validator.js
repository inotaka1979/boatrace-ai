// PA-5 / PC-8: localStorage スキーマバリデータ単体テスト
// index.html から _validateLS / safeParse を抽出して検証
//
// 実行:
//   node scripts/tests/test_storage_validator.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

// L2_INIT_WEIGHTS と _validateLS の定義を抽出
//   バンドル後の indent 付き同名関数を避けるため、column 0 限定
function extract(name, src){
  const re = new RegExp(`(^var\\s+${name}\\s*=[^\\n]+;)`, 'm');
  const m = src.match(re);
  if(m) return m[1];
  // function 形式（^ で column 0 限定、bundle 内の indent 付きを除外）
  const fre = new RegExp(`(^function\\s+${name}\\s*\\([\\s\\S]*?^\\})`, 'm');
  const fm = src.match(fre);
  if(fm) return fm[1];
  throw new Error(`could not extract ${name}`);
}

const code = [
  extract('L2_INIT_WEIGHTS', html),
  extract('_validateLS', html),
].join('\n');

const ctx = vm.createContext({});
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function t(name, ok){
  if(ok){ console.log('  PASS:', name); pass++; }
  else  { console.log('  FAIL:', name); fail++; }
}

console.log('[_validateLS]');
const v = ctx._validateLS;

// ---- settings ----
t('settings 正常 object → 返す',
  v('boatrace_settings', {betCount3:10, betCount2:5, betMethod:'auto'}) !== null);
t('settings 配列 → null', v('boatrace_settings', [1,2,3]) === null);
t('settings 数値 → null',  v('boatrace_settings', 42) === null);
t('settings null → null',  v('boatrace_settings', null) === null);

// ---- racerDB / stadiumDB ----
t('racerDB 空オブジェクト → 返す',
  v('boatrace_racerDB', {}) !== null);
t('racerDB 通常 → 返す',
  v('boatrace_racerDB', {'1234': {courseStats: [], recentResults: []}}) !== null);
t('racerDB 配列 → null', v('boatrace_racerDB', [1,2,3]) === null);
t('racerDB 巨大 (10001 keys) → null DoS ガード',
  (function(){
    const big = {};
    for(let i=0;i<10001;i++) big[i] = 1;
    return v('boatrace_racerDB', big) === null;
  })());

t('stadiumDB 正常 → 返す',
  v('boatrace_stadiumDB', {'1':{}}) !== null);

t('motorStats 正常 → 返す', v('boatrace_motorStats', {}) !== null);
t('exhibitionStats 正常 → 返す', v('boatrace_exhibitionStats', {}) !== null);
t('pairwiseDB 正常 → 返す', v('boatrace_pairwiseDB', {}) !== null);

// ---- weights ----
t('weights 正常 12 要素 → 返す',
  Array.isArray(v('boatrace_weights', ctx.L2_INIT_WEIGHTS.slice())));
t('weights 長さ違い → null',
  v('boatrace_weights', [1,2,3]) === null);
t('weights NaN 含む → null',
  (function(){
    const w = ctx.L2_INIT_WEIGHTS.slice(); w[0] = NaN;
    return v('boatrace_weights', w) === null;
  })());
t('weights Infinity 含む → null',
  (function(){
    const w = ctx.L2_INIT_WEIGHTS.slice(); w[0] = Infinity;
    return v('boatrace_weights', w) === null;
  })());
t('weights 異常巨大値 (>1000) → null',
  (function(){
    const w = ctx.L2_INIT_WEIGHTS.slice(); w[0] = 9999;
    return v('boatrace_weights', w) === null;
  })());
t('weights オブジェクト → null',
  v('boatrace_weights', {a:1}) === null);

// ---- history ----
t('history 空配列 → 返す',
  Array.isArray(v('boatrace_history', [])));
t('history 通常 → 返す',
  Array.isArray(v('boatrace_history', [{date:'20260101', stadium:'1', race:1}])));
t('history オブジェクト → null',
  v('boatrace_history', {a:1}) === null);
t('history 異常巨大 (>50000) → 末尾 1000 件で trim',
  (function(){
    const big = []; for(let i=0;i<60000;i++) big.push({i});
    const out = v('boatrace_history', big);
    return Array.isArray(out) && out.length === 1000 && out[0].i === 59000;
  })());

// ---- 未知キー（pass-through）----
t('未知キー → そのまま返す',
  v('unknown_key', {x:1}) !== null);

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
