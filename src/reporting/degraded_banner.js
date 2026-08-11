// Reporting 層: データ縮退の可視化バナー (S-05 / PR-6)。
//
// stadiumDB が空 / racerDB.recentResults が空でも getStadiumCourseWinRate は
// 全国平均に、getRacerForm は null に静かに落ちる（fail-safe としては正しいが
// 観測性がゼロ）。予想の根拠が一部欠けていることをユーザーに開示する。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:REPORTING_DEGRADED_BANNER:START */ ... :END */ に注入。
// split_app.py の REST_ONLY_BUILD_MARKERS 登録済 → critical には載せない。
// 呼出: loadDeferredData() の DB fetch 完了後に _renderDegradedBanner()。
//
// 依存 (globalThis): stadiumDB / racerDB / document

'use strict';

/**
 * 縮退している機能名の配列を返す（空なら正常）。
 * @returns {string[]}
 */
function _detectDegradedFeatures() {
  var out = [];
  var sdb = typeof stadiumDB !== 'undefined' && stadiumDB ? stadiumDB : {};
  var sids = Object.keys(sdb);
  // 場別コース勝率: 24 場中 20 場未満なら縮退扱い
  var withCwr = 0;
  for (var i = 0; i < sids.length; i++) {
    var cwr = sdb[sids[i]] && sdb[sids[i]].courseWinRate;
    if (cwr && Object.keys(cwr).length > 0) withCwr++;
  }
  if (withCwr < 20) out.push('場別コース傾向');

  // 直近フォーム: sample 200 選手で非空率 < 30% なら縮退扱い
  var rdb = typeof racerDB !== 'undefined' && racerDB ? racerDB : {};
  var rids = Object.keys(rdb).slice(0, 200);
  if (rids.length >= 50) {
    var withForm = 0;
    for (var j = 0; j < rids.length; j++) {
      var rr = rdb[rids[j]] && rdb[rids[j]].recentResults;
      if (Array.isArray(rr) && rr.length >= 5) withForm++;
    }
    if (withForm / rids.length < 0.3) out.push('直近フォーム');
  }
  return out;
}

/**
 * 縮退バナーを描画（#degradedBanner）。縮退が無ければ非表示。
 * silent success 撲滅のため縮退時は console.error にも出す。
 */
function _renderDegradedBanner() {
  if (typeof document === 'undefined') return;
  var el = document.getElementById('degradedBanner');
  if (!el) return;
  var missing = _detectDegradedFeatures();
  if (missing.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.textContent = '⚠ ' + missing.join(' / ') + ' のデータが未取得です。これらを除いたスコアで予想しています。';
  el.style.display = 'block';
  try {
    console.error('[degraded] unavailable features: ' + missing.join(','));
  } catch (_) {
    /* noop */
  }
}

// globalThis export (REST_ONLY)
globalThis._detectDegradedFeatures = _detectDegradedFeatures;
globalThis._renderDegradedBanner = _renderDegradedBanner;
