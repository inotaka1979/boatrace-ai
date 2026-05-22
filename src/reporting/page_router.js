// Phase 2 完遂続編 (Clearwing patterns): src/reporting/page_router.js
//
// Reporting 層: ページ切替の router (showPage)。stadium_pages.js から分離
// (400 行制限遵守、stadium_pages.js が renderStadiums + openStadium を保持)。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:REPORTING_PAGE_ROUTER:START */ ... /* BUILD:REPORTING_PAGE_ROUTER:END */
// に注入する。critical bundle に同居 (起動時から必要)。
//
// 依存:
//   stopOddsAutoRefresh / startOddsAutoRefresh / renderStats / loadSettings /
//   _persistNavState / currentStadium / currentRace
//
// Public: showPage

'use strict';

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
    renderStats();
  } else if (page === 'backtest') {
    document.getElementById('pageBacktest').classList.add('active');
    _setActive('navBacktest');
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
