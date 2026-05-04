// PC-2b / PC-8: scoreBoatV2 から抽出した純粋ヘルパのテスト
//
// 実行: node scripts/tests/test_pure_helpers.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

function extract(name, src){
  const re = new RegExp(`(function\\s+${name}\\s*\\([\\s\\S]*?^\\})`, 'm');
  const m = src.match(re);
  if(!m) throw new Error('cannot extract ' + name);
  return m[1];
}

const code = [
  extract('_computeClassAttenuation', html),
  extract('_resolveCourse', html),
].join('\n');

const ctx = vm.createContext({});
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function t(name, ok){
  if(ok){ console.log('  PASS:', name); pass++; }
  else  { console.log('  FAIL:', name); fail++; }
}
function near(a,b,tol){ return Math.abs(a-b) < (tol||1e-9); }

console.log('[_computeClassAttenuation]');
// 全 A1 (class=1): avgClass=1 → 1.0
t('全 A1 (avgClass=1) → 1.0',
  ctx._computeClassAttenuation([{racer_class_number:1},{racer_class_number:1}]) === 1.0);
// 全 A2 (class=2): avgClass=2 → 1.0
t('全 A2 (avgClass=2) → 1.0',
  ctx._computeClassAttenuation([{racer_class_number:2},{racer_class_number:2}]) === 1.0);
// 全 B1 (class=3): avgClass=3 → 0.70
t('全 B1 (avgClass=3) → 0.70',
  near(ctx._computeClassAttenuation([{racer_class_number:3},{racer_class_number:3}]), 0.70));
// 全 B2 (class=4): avgClass=4 → 0.55
t('全 B2 (avgClass=4) → 0.55',
  near(ctx._computeClassAttenuation([{racer_class_number:4},{racer_class_number:4}]), 0.55));
// 平均 2.5 → 0.85
t('A2/B1 混在 (avg=2.5) → 0.85',
  near(ctx._computeClassAttenuation([{racer_class_number:2},{racer_class_number:3}]), 0.85));
// 平均 2.4 → 1.0 (3.0 未満なら無減衰)
t('A1/B1 混在 (avg=2.4 < 2.5) → 1.0',
  ctx._computeClassAttenuation([
    {racer_class_number:2},{racer_class_number:2},
    {racer_class_number:2},{racer_class_number:3},
    {racer_class_number:3}
  ]) === 1.0);
// 空配列 → 1.0
t('空配列 → 1.0', ctx._computeClassAttenuation([]) === 1.0);
// null → 1.0
t('null → 1.0', ctx._computeClassAttenuation(null) === 1.0);
// 欠損値はデフォルト 3 として扱う
t('欠損 racer_class_number は 3 (B1) として扱う',
  near(ctx._computeClassAttenuation([{}, {}, {}]), 0.70));

console.log('');
console.log('[_resolveCourse]');
// preview に course 指定 → 優先採用
t('preview.racer_course_number があれば最優先',
  (function(){
    const r = ctx._resolveCourse({racer_boat_number:1}, {racer_course_number:3}, null);
    return r.course === 3 && r.entryConf === 1.0 && r.source === 'preview';
  })());
// preview なし、predictedEntries あり
t('predictedEntries fallback',
  (function(){
    const r = ctx._resolveCourse(
      {racer_boat_number:5},
      null,
      {byBoat:{5:2}, conf:{5:0.8}}
    );
    return r.course === 2 && r.entryConf === 0.8 && r.source === 'predicted';
  })());
// 信頼度欠損 → 0.5 デフォルト
t('predictedEntries 信頼度欠損 → 0.5',
  ctx._resolveCourse({racer_boat_number:3}, null, {byBoat:{3:1}, conf:{}}).entryConf === 0.5);
// preview も predicted もない → 枠番採用
t('全て無いとき枠番が採用される',
  ctx._resolveCourse({racer_boat_number:4}, null, null).course === 4);
// preview だけあって course は無い (= boat_number 落ちにする)
t('preview あり course なし → preview.racer_boat_number',
  (function(){
    const r = ctx._resolveCourse({racer_boat_number:6}, {racer_boat_number:6}, null);
    return r.course === 6 && r.source === 'frame';
  })());

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
