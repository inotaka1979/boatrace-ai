#!/usr/bin/env node
/*
 * rt-fix3 (2026-06-27) 回帰防止テスト:
 *   鮮度バッジ (_renderFreshness) は「データ世代(updated_at)」基準で色/ラベルを出し、
 *   fetch 成功時刻で stale を隠さないこと。
 *
 *   背景: rt-fix P0-1 で主表示を _lastFetchOkAt にした結果、Worker が stale な KV を
 *   200 で返すと「緑なのに中身が古い」誤認を生み「更新されない」体感の主因になった。
 *   本テストは「fetch は新しいがデータ世代が古い」ケースで赤系の警告になることを固定し、
 *   将来 rt-fix4 等で再び stale を隠さないようにするガード。
 *
 *   実行: node scripts/tests/test_status_banner_freshness.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../src/reporting/status_banner.js');
const code = fs.readFileSync(SRC, 'utf8');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error('  ❌ ' + msg);
  }
}

// --- 最小 DOM / globalThis シム ---
const el = { innerHTML: '', textContent: '' };
global.document = {
  getElementById(id) {
    if (id === 'dataFreshness') return el;
    return null;
  },
};

// status_banner.js は globalThis に _renderFreshness を export する
const evalInGlobal = eval;
evalInGlobal(code);
const render = globalThis._renderFreshness;
assert(typeof render === 'function', '_renderFreshness が export されている');

const GREEN = '#A5D6A7';
const YELLOW = '#FFCC80';
const RED = '#FF8A80';
const MIN = 60000;

function run(dataAgeMin, fetchAgeSec) {
  el.innerHTML = '';
  const now = Date.now();
  globalThis._dataLatestUpdatedAt = dataAgeMin == null ? 0 : now - dataAgeMin * MIN;
  globalThis._dataTodayConfirmedAt = 0;
  globalThis._lastFetchOkAt = fetchAgeSec == null ? 0 : now - fetchAgeSec * 1000;
  render();
  return el.innerHTML;
}

// 1) データ世代が新しい(5分) → 緑、データ世代基準のラベル(🕒)
let html = run(5, 1);
assert(html.indexOf(GREEN) >= 0, 'データ世代5分は緑');
assert(html.indexOf('🕒') >= 0, '主表示はデータ世代アイコン(🕒)');

// 2) 【中核】fetch は今(1秒前)成功しているが、データ世代が 50 分古い → 赤（stale を隠さない）
html = run(50, 1);
assert(html.indexOf(RED) >= 0, 'fetch新しくてもデータ世代50分なら赤(stale を隠さない)');
assert(html.indexOf('接続OK') >= 0, '接続は副次表示で OK と出る');

// 3) データ世代 25 分 → 黄
html = run(25, 30);
assert(html.indexOf(YELLOW) >= 0, 'データ世代25分は黄');

// 4) 接続が途絶(10分前が最後の成功) → 副次に「接続不調」
html = run(5, 600);
assert(html.indexOf('接続不調') >= 0, 'fetch成功が5分以上前なら接続不調を表示');

console.log(`\n_renderFreshness freshness semantics: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
