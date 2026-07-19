// 2026-07-19: src/reporting/daily_stats_page.js
//
// Reporting 層: 日別成績ページ (#pageDaily)。boatrace_history を日付ごとに集計し、
// 日々の的中率 (3連単/2連単) と回収率の推移をテーブル + Chart.js で表示する。
// 成績タブ (calcTodayStats) が「本日詳細」なのに対し、本ページは「日をまたいだ推移」。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:REPORTING_DAILY_STATS:START */ ... /* BUILD:REPORTING_DAILY_STATS:END */
// に注入する。split_app.py で stats sub-chunk (app-rest-stats.min.js) 行き —
// 日別タブを開かない限り download/parse されない。
//
// 依存 (canonical assets/app.js の top-level):
//   safeParse / settings / _rateColor / capabilities / _loadChartLib / Chart (動的 import 後)
//
// Public (globalThis に export):
//   calcDailyStats / renderDailyStats

'use strict';

// 型付き globalThis ハンドル
/** @type {BoatRaceGlobalAPI & typeof globalThis} */
const _g = /** @type {any} */ (globalThis);

/**
 * boatrace_history を日付ごとに集計する (純関数)。
 *
 * 投資額は calcTodayStats と同じ規約 (1R あたり betCount3/betCount2 点 × ¥100、
 * 穴予想は ana_bets.length × ¥100)。過去日も現在の設定点数で計算するため、
 * 設定を変更した場合は過去日の投資額も新しい点数で再計算される (本日詳細と同一の割り切り)。
 *
 * @param {Array<any>} history - boatrace_history の配列
 * @param {number} betCount3 - 3連単の購入点数
 * @param {number} betCount2 - 2連単の購入点数
 * @param {number} [maxDays] - 直近何日分を返すか (既定 30)
 * @returns {Array<{date:string,total:number,hit3:number,hit2:number,anaRaces:number,anaHits:number,
 *           invest:number,payout:number,rate3:number,rate2:number,recovery:number}>} 日付昇順
 */
function calcDailyStats(history, betCount3, betCount2, maxDays) {
  var unitBet = 100;
  var byDate = {};
  (history || []).forEach(function (h) {
    if (!h || !h.date || !h.actual || !h.actual.length) return;
    var d = byDate[h.date];
    if (!d) {
      d = byDate[h.date] = {
        date: h.date, total: 0, hit3: 0, hit2: 0,
        anaRaces: 0, anaHits: 0, invest: 0, payout: 0,
      };
    }
    d.total++;
    d.invest += (betCount3 + betCount2) * unitBet;
    if (h.trifecta_hit) { d.hit3++; d.payout += h.payout3 || 0; }
    if (h.exacta_hit) { d.hit2++; d.payout += h.payout2 || 0; }
    if (Array.isArray(h.ana_bets) && h.ana_bets.length > 0) {
      d.anaRaces++;
      d.invest += h.ana_bets.length * unitBet;
      if (h.ana_hit) { d.anaHits++; d.payout += h.ana_payout || 0; }
    }
  });
  var days = Object.keys(byDate).sort().slice(-(maxDays || 30));
  return days.map(function (k) {
    var d = byDate[k];
    d.rate3 = d.total > 0 ? (d.hit3 / d.total) * 100 : 0;
    d.rate2 = d.total > 0 ? (d.hit2 / d.total) * 100 : 0;
    d.recovery = d.invest > 0 ? (d.payout / d.invest) * 100 : 0;
    return d;
  });
}

function _fmtDate(yyyymmdd) {
  var s = String(yyyymmdd);
  return s.length === 8 ? s.slice(4, 6) + '/' + s.slice(6) : s;
}

function renderDailyStats() {
  var history = _g.safeParse('boatrace_history', []);
  var st = _g.settings || {};
  var b3 = parseInt(st.betCount3) || 10;
  var b2 = parseInt(st.betCount2) || 5;
  var daily = calcDailyStats(history, b3, b2, 30);

  // サマリ: 直近 7 日の合算
  var last7 = daily.slice(-7);
  var t = { races: 0, hit3: 0, invest: 0, payout: 0 };
  last7.forEach(function (d) {
    t.races += d.total; t.hit3 += d.hit3; t.invest += d.invest; t.payout += d.payout;
  });
  var sumRate = t.races > 0 ? ((t.hit3 / t.races) * 100).toFixed(1) : '0.0';
  var sumRec = t.invest > 0 ? Math.round((t.payout / t.invest) * 100) : 0;
  var sumEl = document.getElementById('dailySummary');
  if (sumEl) {
    sumEl.innerHTML =
      '<div class="stat-card"><div class="stat-num" style="color:var(--accent)">' + t.races +
      '</div><div class="stat-label">直近7日 判定R</div></div>' +
      '<div class="stat-card"><div class="stat-num" style="color:var(--gold)">' + sumRate +
      '%</div><div class="stat-label">3連単的中率</div></div>' +
      '<div class="stat-card"><div class="stat-num" style="color:' +
      (sumRec >= 100 ? 'var(--success)' : 'var(--danger)') + '">' + sumRec +
      '%</div><div class="stat-label">回収率</div></div>';
  }

  // 日別テーブル (新しい日が上)
  var el = document.getElementById('dailyTable');
  if (el) {
    if (!daily.length) {
      el.innerHTML =
        '<div class="card" style="padding:16px;text-align:center;color:var(--text-dim);font-size:12px">' +
        'まだ判定済みのレースがありません。<br>予想を開いた日のレースが確定すると自動で集計されます。</div>';
    } else {
      var html = '<div class="card" class="p-overflow-hidden">';
      html += '<div class="card-header-row">日別 的中率・回収率 (直近30日)</div>';
      html += '<table class="recovery-table">';
      html += '<thead><tr><th>日付</th><th>判定R</th><th>3連単</th><th>2連単</th><th>収支</th><th>回収率</th></tr></thead><tbody>';
      daily.slice().reverse().forEach(function (d) {
        var rec = Math.round(d.recovery);
        var net = d.payout - d.invest;
        html +=
          '<tr><td><b>' + _fmtDate(d.date) + '</b></td><td>' + d.total +
          '</td><td>' + d.hit3 + ' (' + d.rate3.toFixed(0) + '%)' +
          '</td><td>' + d.hit2 + ' (' + d.rate2.toFixed(0) + '%)' +
          '</td><td style="color:' + (net >= 0 ? 'var(--success)' : 'var(--danger)') + '">' +
          (net >= 0 ? '+' : '') + '¥' + net.toLocaleString() +
          '</td><td class="' + _g._rateColor(rec) + '">' + rec + '%</td></tr>';
      });
      html += '</tbody></table>';
      html += '<div style="font-size:9px;color:var(--text-dim);padding:6px 10px">' +
        '※ 投資額は現在の設定点数 (3連単' + b3 + '点+2連単' + b2 + '点+穴買い目、各¥100) で算出</div>';
      html += '</div>';
      el.innerHTML = html;
    }
  }

  _renderDailyChart(daily);
}

// 的中率 (棒・左軸) + 回収率 (折線・右軸) の複合チャート
function _renderDailyChart(daily) {
  var ctx = document.getElementById('chartDaily');
  if (!ctx) return;
  var box = ctx.parentNode;
  if (!daily || daily.length < 2) {
    if (box) box.style.display = 'none';
    return;
  }
  if (box) box.style.display = '';
  _g.capabilities.refresh('chart');
  if (!_g.capabilities.has('chart')) {
    _g._loadChartLib().then(function () { _renderDailyChart(daily); }, function () {
      if (box)
        box.innerHTML =
          '<div style="padding:20px;text-align:center;color:#999;font-size:11px">グラフ描画ライブラリの読込に失敗しました</div>';
    });
    return;
  }
  if (_g._dailyChart) { try { _g._dailyChart.destroy(); } catch (_) {} }
  var last14 = daily.slice(-14);
  _g._dailyChart = new _g.Chart(ctx, {
    data: {
      labels: last14.map(function (d) { return _fmtDate(d.date); }),
      datasets: [
        {
          type: 'bar', label: '3連単的中率',
          data: last14.map(function (d) { return Math.round(d.rate3 * 10) / 10; }),
          backgroundColor: 'rgba(25,118,210,0.45)', borderColor: '#1976D2',
          borderWidth: 1, borderRadius: 4, yAxisID: 'y',
        },
        {
          type: 'line', label: '回収率',
          data: last14.map(function (d) { return Math.round(d.recovery); }),
          borderColor: '#A56A00', backgroundColor: '#A56A00',
          borderWidth: 2, pointRadius: 3, tension: 0.25, yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      plugins: {
        legend: { display: true, labels: { font: { size: 10 }, color: '#666', boxWidth: 12 } },
        title: { display: true, text: '日別 的中率と回収率 (直近14日)', color: '#666', font: { size: 11 } },
      },
      scales: {
        x: { ticks: { font: { size: 9 }, color: '#999' }, grid: { display: false } },
        y: {
          beginAtZero: true, max: 100, position: 'left',
          title: { display: true, text: '的中率%', font: { size: 9 }, color: '#1976D2' },
          ticks: { font: { size: 9 }, color: '#999' },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
        y1: {
          beginAtZero: true, position: 'right',
          title: { display: true, text: '回収率%', font: { size: 9 }, color: '#A56A00' },
          ticks: { font: { size: 9 }, color: '#999' },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

// globalThis export (REST_STATS chunk)
_g.calcDailyStats = calcDailyStats;
_g.renderDailyStats = renderDailyStats;
