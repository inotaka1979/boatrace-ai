// 2026-11-20: 選手・モーター長期集計（scripts/aggregate_racer_stats.py → data/db/racer_stats_view.json）の取得。
//   Discovery 層（network IO はここだけ）。reporting 層 (race_detail_boats.js) は
//   globalThis._racerStatsView を読むだけで、未取得なら _loadRacerStatsView() を呼ぶ。
//   レース詳細の lazy chunk (app-rest-detail) に同梱。
//
// Public: _loadRacerStatsView / _racerStatsView (globalThis)

'use strict';

var _racerStatsLoading = false;

// 初回だけ取りに行き、届いたら onLoaded() を呼ぶ（開いている画面の描き直し用）。
function _loadRacerStatsView(onLoaded) {
  if (globalThis._racerStatsView || _racerStatsLoading || typeof fetch !== 'function') return;
  _racerStatsLoading = true;
  fetch('data/db/racer_stats_view.json', { cache: 'no-cache' })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      if (!j || !j.racers) return;
      globalThis._racerStatsView = j;
      if (typeof onLoaded === 'function') onLoaded();
    })
    .catch(function () {})
    .then(function () {
      _racerStatsLoading = false;
    });
}

globalThis._loadRacerStatsView = _loadRacerStatsView;
