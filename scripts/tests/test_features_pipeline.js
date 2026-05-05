// Epic 12 (P1-B1): 特徴量パイプライン回帰テスト
//   buildL2Features (新パイプライン) と 旧 getL2Features の数値出力が
//   厳密に同一であることを検証する。妥協は禁物（重みの互換性に直結）。
//
// 実行: node scripts/tests/test_features_pipeline.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');

// 旧 getL2Features を抽出（function 宣言）
function extractFn(name, src){
  const re = new RegExp(`(^function\\s+${name}\\s*\\([\\s\\S]*?^\\})`, 'm');
  const m = src.match(re);
  if(!m) throw new Error('cannot extract ' + name);
  return m[1];
}

// BUILD:FEATURES bundle 領域を抽出
const bundleMatch = html.match(/\/\* BUILD:FEATURES:START \*\/[\s\S]*?\/\* BUILD:FEATURES:END \*\//);
if(!bundleMatch) throw new Error('BUILD:FEATURES bundle missing');

// global helpers のスタブ
const ctx = vm.createContext({
  pf: (v) => parseFloat(v) || 0,
  // racerDB / stadiumDB が空想定 → null/0 fallback
  getRacerCourseWinRate: () => null,
  getStadiumCourseWinRate: () => 0,
  getRacerForm: () => null,
});

// bundle 注入（globalThis.getL2Features / buildL2Features を定義）
vm.runInContext(bundleMatch[0], ctx);

// 旧 inline 版を別名で読み込み（衝突回避）
const oldFnSrc = extractFn('getL2Features', html).replace('function getL2Features', 'function getL2Features_OLD');
vm.runInContext(oldFnSrc, ctx);

let pass = 0, fail = 0;
function t(name, ok){ if(ok){ console.log('  PASS:', name); pass++; } else { console.log('  FAIL:', name); fail++; } }
function near(a,b,tol){ return Math.abs(a-b) < (tol||1e-9); }

function arraysEqual(a, b){
  if(a.length !== b.length) return { ok:false, idx:-1, a:a.length, b:b.length };
  for(let i=0;i<a.length;i++){
    if(!near(a[i], b[i])) return { ok:false, idx:i, a:a[i], b:b[i] };
  }
  return { ok:true };
}

console.log('[FEATURE_PIPELINE 構造]');
t('FEATURE_DIM_FEATURES === 12', ctx.FEATURE_DIM_FEATURES === 12);
t('FEATURE_PIPELINE.length === 12', ctx.FEATURE_PIPELINE.length === 12);
t('FEATURE_VERSION === 1', ctx.FEATURE_VERSION === 1);

console.log('');
console.log('[新旧 getL2Features 数値同一性]');
const samples = [
  // (boat, preview, weather, etRank, stRank, sid)
  [
    { racer_boat_number: 1, racer_number: 4444, racer_class_number: 1,
      racer_national_top_1_percent: 5.5, racer_assigned_motor_top_2_percent: 38 },
    { racer_course_number: 1, racer_start_timing: 0.13, racer_tilt_adjustment: -0.5 },
    { wind_speed: 3, wind_direction: 8 },
    0, 0, '01'
  ],
  [
    { racer_boat_number: 4, racer_number: 5555, racer_class_number: 3,
      racer_national_top_1_percent: 4.2, racer_assigned_motor_top_2_percent: 32 },
    { racer_course_number: 4, racer_start_timing: 0.18, racer_tilt_adjustment: 0.5 },
    { wind_speed: 5, wind_direction: 9 },
    3, 4, '02'
  ],
  [
    // weather/preview 欠損のケース
    { racer_boat_number: 6, racer_number: 6666, racer_class_number: 4,
      racer_national_top_1_percent: 3.8, racer_assigned_motor_top_2_percent: 28 },
    null, null, 5, 5, '03'
  ],
  [
    // class_number 欠損 → デフォルト 3 扱い
    { racer_boat_number: 2, racer_number: 7777,
      racer_national_top_1_percent: 4.8, racer_assigned_motor_top_2_percent: 35 },
    { racer_course_number: 2 },
    { wind_speed: 0 },
    1, 2, '04'
  ],
];

samples.forEach((args, i) => {
  const newOut = ctx.getL2Features.apply(null, args);
  const oldOut = ctx.getL2Features_OLD.apply(null, args);
  const eq = arraysEqual(newOut, oldOut);
  t(`sample ${i+1}: 新パイプラインと旧実装の数値完全一致`,
    eq.ok || (console.log(`  diff at idx=${eq.idx}: new=${eq.a} old=${eq.b}`), false));
});

console.log('');
console.log('[NaN/Infinity 安定性]');
const badSample = [
  { racer_boat_number: 1, racer_number: 0, racer_class_number: NaN,
    racer_national_top_1_percent: NaN, racer_assigned_motor_top_2_percent: undefined },
  null, null, NaN, NaN, ''
];
const badOut = ctx.getL2Features.apply(null, badSample);
t('全要素が finite (NaN/Infinity を含まない)',
  badOut.every(v => Number.isFinite(v)));

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
