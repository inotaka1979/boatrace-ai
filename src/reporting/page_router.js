// Phase 2 完遂続編 (Clearwing patterns): src/reporting/page_router.js
//
// Reporting 層: ページ切替の router (showPage) + lazy sub-chunk loader。
// stadium_pages.js から分離 (400 行制限遵守)。critical bundle 同居。
//
// 依存: stopOddsAutoRefresh / startOddsAutoRefresh / renderStats / loadSettings /
//       _persistNavState / currentStadium / currentRace
//
// Public: showPage, _ensureStatsChunk

'use strict';

// ─────────────────────────────────────────────
// Lazy sub-chunk loader (Phase 2 完遂続編)
// 成績タブ / バックテストタブを開いた時に assets/app-rest-stats.min.js を動的 load。
// 起動時の rest bundle download を ~12KB 縮小 (TBT / LCP 改善)。
// ─────────────────────────────────────────────
var _statsChunkState = { loaded: false, promise: null };

function _ensureStatsChunk() {
  if (_statsChunkState.loaded) return Promise.resolve();
  if (_statsChunkState.promise) return _statsChunkState.promise;
  // 既に DOM に script が存在する (showPage 連打) なら共通 Promise を返す
  _statsChunkState.promise = new Promise(function (resolve, reject) {
    // version は app-rest.min.js の `?v=...` と同期 (build.mjs が両方を sha256 で更新)
    var ver = '';
    try {
      // index.html の <script src="assets/app-rest.min.js?v=XXXX"> から取得
      var existing = document.querySelector('script[src*="app-rest.min.js"]');
      if (existing && existing.src) {
        var m = existing.src.match(/\?v=([\w]+)/);
        if (m) ver = '?v=' + m[1];
      }
    } catch (_) {}
    var s = document.createElement('script');
    s.src = 'assets/app-rest-stats.min.js' + ver;
    s.defer = true;
    s.onload = function () {
      _statsChunkState.loaded = true;
      resolve();
    };
    s.onerror = function (e) {
      _statsChunkState.promise = null; // 再試行可能に
      reject(new Error('Failed to load app-rest-stats.min.js: ' + (e && e.message ? e.message : 'unknown')));
    };
    document.head.appendChild(s);
  });
  return _statsChunkState.promise;
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(function (p) {
    p.classList.remove('active');
  });
  // PD-7: aria-current は nav の active 状態と同期
  document.querySelectorAll('.nav-btn').forEach(function (b) {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  if (page !== 'detail') stopOddsAutoRefresh();

  function _setActive(navId) {
    var el = document.getElementById(navId);
    if (el) {
      el.classList.add('active');
      el.setAttribute('aria-current', 'page');
    }
  }

  if (page === 'top') {
    document.getElementById('pageTop').classList.add('active');
    _setActive('navTop');
  } else if (page === 'races') {
    document.getElementById('pageRaces').classList.add('active');
    _setActive('navTop');
  } else if (page === 'detail') {
    document.getElementById('pageDetail').classList.add('active');
    _setActive('navTop');
    startOddsAutoRefresh();
  } else if (page === 'stats') {
    document.getElementById('pageStats').classList.add('active');
    _setActive('navStats');
    // Phase 2 完遂続編: stats chunk を動的 load してから renderStats 呼出
    _ensureStatsChunk().then(
      function () {
        if (typeof renderStats === 'function') renderStats();
      },
      function (err) {
        try {
          if (typeof reportError === 'function') reportError({ type: 'chunk-load', msg: String(err) });
        } catch (_) {}
        // load 失敗時は静かに諦める (next click で再試行される)
      }
    );
  } else if (page === 'backtest') {
    document.getElementById('pageBacktest').classList.add('active');
    _setActive('navBacktest');
    // Phase 2 完遂続編: stats chunk を先読みするだけ (runBacktest はユーザがボタン押下時)
    _ensureStatsChunk().catch(function () {
      /* silent */
    });
  } else if (page === 'settings') {
    document.getElementById('pageSettings').classList.add('active');
    _setActive('navSettings');
    loadSettings();
  }
  window.scrollTo(0, 0);
  // P0-5: ナビ状態を sessionStorage に保存（PWA 自動更新リロード後の位置復元用）
  try {
    _persistNavState(page, currentStadium, currentRace);
  } catch (_) {}
}

// globalThis export
globalThis.showPage = showPage;
globalThis._ensureStatsChunk = _ensureStatsChunk;
