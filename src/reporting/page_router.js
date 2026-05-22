// Phase 2 完遂続編 (Clearwing patterns): src/reporting/page_router.js
//
// Reporting 層: ページ切替の router (showPage) + lazy sub-chunk loader。
// stadium_pages.js から分離 (400 行制限遵守)。critical bundle 同居。
//
// 依存: stopOddsAutoRefresh / startOddsAutoRefresh / renderStats / loadSettings /
//       _persistNavState / currentStadium / currentRace
//
// Public: showPage, _ensureStatsChunk, _ensureRaceDetailChunk

'use strict';

// ─────────────────────────────────────────────
// Lazy sub-chunk loader (Phase 2 完遂続編)
//   - stats:  成績タブ / バックテストタブ open 時 (app-rest-stats.min.js)
//   - detail: レース詳細ページ open 時 (app-rest-detail.min.js)
// 起動時 rest bundle を ~50KB 縮小 (TBT/LCP 改善)。SW cache 後は 2 回目以降即時。
// ─────────────────────────────────────────────

// 各 chunk の load 状態 (重複 load 防止)
var _chunkStates = {
  stats: { loaded: false, promise: null },
  detail: { loaded: false, promise: null },
};

/**
 * 任意の lazy chunk を動的 load する汎用ヘルパ。
 * app-rest.min.js の URL から `?v=XXXX` を読み取って同じ version を chunk URL に付与する
 * (build.mjs が複数 chunk の sha256 を 1 つの version に合成しているため stale risk なし)。
 */
function _loadChunk(stateKey, filename) {
  var st = _chunkStates[stateKey];
  if (!st) {
    return Promise.reject(new Error('unknown chunk: ' + stateKey));
  }
  if (st.loaded) return Promise.resolve();
  if (st.promise) return st.promise;
  st.promise = new Promise(function (resolve, reject) {
    var ver = '';
    try {
      var existing = document.querySelector('script[src*="app-rest.min.js"]');
      if (existing && existing.src) {
        var m = existing.src.match(/\?v=([\w]+)/);
        if (m) ver = '?v=' + m[1];
      }
    } catch (_) {}
    var s = document.createElement('script');
    s.src = 'assets/' + filename + ver;
    s.defer = true;
    s.onload = function () {
      st.loaded = true;
      resolve();
    };
    s.onerror = function (e) {
      st.promise = null; // 再試行可能に
      reject(new Error('Failed to load ' + filename + ': ' + (e && e.message ? e.message : 'unknown')));
    };
    document.head.appendChild(s);
  });
  return st.promise;
}

function _ensureStatsChunk() {
  return _loadChunk('stats', 'app-rest-stats.min.js');
}

function _ensureRaceDetailChunk() {
  return _loadChunk('detail', 'app-rest-detail.min.js');
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
    // 場一覧表示時に detail chunk を pre-fetch (実際の race click を高速化)
    _ensureRaceDetailChunk().catch(function () {});
  } else if (page === 'detail') {
    document.getElementById('pageDetail').classList.add('active');
    _setActive('navTop');
    startOddsAutoRefresh();
  } else if (page === 'stats') {
    document.getElementById('pageStats').classList.add('active');
    _setActive('navStats');
    _ensureStatsChunk().then(
      function () {
        if (typeof renderStats === 'function') renderStats();
      },
      function (err) {
        try {
          if (typeof reportError === 'function') reportError({ type: 'chunk-load', msg: String(err) });
        } catch (_) {}
      }
    );
  } else if (page === 'backtest') {
    document.getElementById('pageBacktest').classList.add('active');
    _setActive('navBacktest');
    _ensureStatsChunk().catch(function () {});
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
globalThis._ensureRaceDetailChunk = _ensureRaceDetailChunk;
