/**
 * 自動更新（90 秒 poll）の再描画条件 回帰テスト（2026-08-11）
 *
 * user 報告: 更新が自動で行われない（更新ボタンを押さないと画面が変わらない）。
 *
 * 原因: poll 末尾の再描画キーが bulk (programs/previews/results/odds) の
 *   updated_at だけで構成されていた。アプリは bulk に無いデータを
 *   /result-proxy・/beforeinfo-proxy でオンデマンド取得して state に入れるが、
 *   その場合 updated_at は変わらないためキーが同一 → 再描画されなかった。
 *   bulk は 1 日数回しか更新されないので、新しく確定した結果が画面に出ず
 *   「更新を押すまで変わらない」状態になっていた。
 *
 * 修正: state が実際に良くなったとき `_dRev` を増やし、再描画キーに混ぜる。
 *
 *   node scripts/tests/test_auto_refresh_render.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

console.log('=== 自動更新の再描画条件 ===');

t('再描画キーに _dRev が含まれる', () => {
  const m = /var _rk=\(rawP[\s\S]{0,400}?;/.exec(APP);
  assert.ok(m, '再描画キーの構築箇所が見つからない');
  assert.ok(/_dRev/.test(m[0]),
    'キーが bulk の updated_at だけ = オンデマンド到着で再描画されない:\n' + m[0]);
});

t('_dRev が宣言されている', () => {
  assert.ok(/var _dRev\s*=\s*0\s*;/.test(APP), '_dRev の宣言が無い');
});

t('オンデマンド結果の改善時に _dRev が増える', () => {
  assert.ok(/if\(improved\)\s*_dRev\+\+/.test(APP),
    '_loadResultLive で improved 時に _dRev を増やしていない');
});

t('オンデマンド展示の取得時に _dRev が増える', () => {
  const i = APP.indexOf('function _loadPreviewLive');
  assert.ok(i > 0, '_loadPreviewLive が見つからない');
  const body = APP.slice(i, i + 3000);
  assert.ok(/_dRev\+\+/.test(body), '_loadPreviewLive で _dRev を増やしていない');
});

t('キー一致なら再描画しない（無駄な再描画を増やしていない）', () => {
  const m = /if\(_rk!==_lastAutoRenderKey\)\{/.exec(APP);
  assert.ok(m, '差分チェックが消えている = 毎 90 秒 全再描画になっている');
});

t('オッズは全体再描画のトリガにしない（部分更新に任せる）', () => {
  const i = APP.indexOf('function _mergeOddsSnapshot');
  const body = APP.slice(i, i + 1200);
  assert.ok(!/_dRev\+\+/.test(body),
    'オッズ更新で全体再描画すると 30 秒毎に一覧が作り直され flicker する');
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
