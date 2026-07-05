// Phase 2 完遂続き (Clearwing patterns): src/reporting/stats_page.js
//
// Reporting 層: 成績タブ (#pageStats) の rendering。本日の集計サマリ + 券種別 +
// レースタイプ別 + 場別 + データ整合性警告 を組み立て、Chart.js (動的 import) で
// 日別的中率棒グラフを描画する。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:REPORTING_STATS_PAGE:START */ ... /* BUILD:REPORTING_STATS_PAGE:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS に登録 → 成績タブを開かない
// 限り評価されないため critical bundle に載せない。
//
// 依存 (canonical assets/app.js の top-level):
//   calcTodayStats / _rateColor / escText / _runLazyBackfillOnce / safeParse / _loadChartLib
//   resultData / statsChart / capabilities / Chart (動的 import 後)
//
// Public (globalThis に export):
//   renderStats / renderStatsChart

'use strict';

function renderStats() {
  // PF-3: 成績タブ open 時に backfill を即時実行（lazy 起動）
  if (typeof _runLazyBackfillOnce === 'function') _runLazyBackfillOnce('stats tab opened');
  // 設計者A P1: history 未 load 中は skeleton placeholder を出して「読込中…」放置を防ぐ
  //   resultData が空 = まだ Phase 2 lazy load 完了前と推定
  if (
    !resultData ||
    (Array.isArray(resultData) && resultData.length === 0) ||
    (typeof resultData === 'object' && Object.keys(resultData).length === 0)
  ) {
    var sumEl = document.getElementById('statSummary');
    var recEl = document.getElementById('statRecovery');
    var skel =
      '<div class="stat-card" style="background:linear-gradient(90deg,#eee 25%,#f5f5f5 50%,#eee 75%);background-size:200% 100%;animation:skel 1.2s ease-in-out infinite"><div class="stat-num">…</div><div class="stat-label">読込中</div></div>';
    if (sumEl && !sumEl.innerHTML.trim()) sumEl.innerHTML = skel + skel + skel;
    if (recEl && !recEl.innerHTML.trim()) {
      var rows = '';
      for (var i = 0; i < 3; i++)
        rows +=
          '<tr><td class="bg-light">&nbsp;</td><td class="bg-light">&nbsp;</td><td class="bg-light">&nbsp;</td><td class="bg-light">&nbsp;</td><td class="bg-light">&nbsp;</td></tr>';
      recEl.innerHTML = '<table style="width:100%"><tbody>' + rows + '</tbody></table>';
    }
    // 既存のフロー（calcTodayStats → 描画）にそのまま委ねる。result 0件でも 0件として描画される。
  }
  var s = calcTodayStats();

  // ヘッダ: 本日サマリ
  var triRate3 = s.tri.invest > 0 ? Math.round((s.tri.payout / s.tri.invest) * 100) : 0;
  var trifectaRate = s.total > 0 ? ((s.tri.hits / s.total) * 100).toFixed(1) : '0.0';
  document.getElementById('statSummary').innerHTML =
    '<div class="stat-card"><div class="stat-num" style="color:var(--accent)">' +
    s.total +
    '</div><div class="stat-label">本日 判定済</div></div>' +
    '<div class="stat-card"><div class="stat-num" style="color:var(--gold)">' +
    s.tri.hits +
    '</div><div class="stat-label">3連単的中</div></div>' +
    '<div class="stat-card"><div class="stat-num" style="color:' +
    (triRate3 >= 100 ? 'var(--success)' : 'var(--danger)') +
    '">' +
    triRate3 +
    '%</div><div class="stat-label">3連単回収率</div></div>';

  var recHtml = '';

  // 券種別 (本日)
  recHtml += '<div class="card" class="p-overflow-hidden">';
  recHtml += '<div class="card-header-row">本日 券種別</div>';
  recHtml += '<table class="recovery-table">';
  recHtml += '<thead><tr><th>券種</th><th>的中</th><th>投資</th><th>回収</th><th>回収率</th></tr></thead><tbody>';
  var triR = s.tri.invest > 0 ? Math.round((s.tri.payout / s.tri.invest) * 100) : 0;
  var exaR = s.exa.invest > 0 ? Math.round((s.exa.payout / s.exa.invest) * 100) : 0;
  var triHitRate = s.total > 0 ? ((s.tri.hits / s.total) * 100).toFixed(0) : '-';
  var exaHitRate = s.total > 0 ? ((s.exa.hits / s.total) * 100).toFixed(0) : '-';
  recHtml +=
    '<tr><td><b>3連単</b></td><td>' +
    s.tri.hits +
    ' (' +
    triHitRate +
    '%)</td><td>¥' +
    s.tri.invest.toLocaleString() +
    '</td><td>¥' +
    s.tri.payout.toLocaleString() +
    '</td><td class="' +
    _rateColor(triR) +
    '">' +
    triR +
    '%</td></tr>';
  recHtml +=
    '<tr><td><b>2連単</b></td><td>' +
    s.exa.hits +
    ' (' +
    exaHitRate +
    '%)</td><td>¥' +
    s.exa.invest.toLocaleString() +
    '</td><td>¥' +
    s.exa.payout.toLocaleString() +
    '</td><td class="' +
    _rateColor(exaR) +
    '">' +
    exaR +
    '%</td></tr>';
  // B14: 🔥穴予想 行（ana_bets が登録された R のみカウント、推奨買い目とは独立）
  if (s.ana && s.ana.races > 0) {
    var anaR = s.ana.invest > 0 ? Math.round((s.ana.payout / s.ana.invest) * 100) : 0;
    var anaHitRate = s.ana.races > 0 ? ((s.ana.hits / s.ana.races) * 100).toFixed(0) : '-';
    recHtml +=
      '<tr><td><b style="color:#FF5722">🔥穴予想</b><br><span style="font-size:9px;color:var(--text-dim)">対象 ' +
      s.ana.races +
      'R</span></td><td>' +
      s.ana.hits +
      ' (' +
      anaHitRate +
      '%)</td><td>¥' +
      s.ana.invest.toLocaleString() +
      '</td><td>¥' +
      s.ana.payout.toLocaleString() +
      '</td><td class="' +
      _rateColor(anaR) +
      '">' +
      anaR +
      '%</td></tr>';
  }
  // 合計行 (2026-07-05: 🔥穴予想も合算。旧実装は穴行を表に出しながら合計は
  //   3連単+2連単のみで、穴の的中・払戻が合計に反映されない矛盾があった)
  var anaInv = s.ana ? s.ana.invest : 0;
  var anaPay = s.ana ? s.ana.payout : 0;
  var anaHits = s.ana ? s.ana.hits : 0;
  var totInv = s.tri.invest + s.exa.invest + anaInv;
  var totPay = s.tri.payout + s.exa.payout + anaPay;
  var totRate = totInv > 0 ? Math.round((totPay / totInv) * 100) : 0;
  var net = totPay - totInv;
  recHtml +=
    '<tr style="background:#F8F8F8;font-weight:700"><td>合計</td><td>' +
    (s.tri.hits + s.exa.hits + anaHits) +
    '</td><td>¥' +
    totInv.toLocaleString() +
    '</td><td>¥' +
    totPay.toLocaleString() +
    '<br><span style="font-size:9px;color:' +
    (net >= 0 ? 'var(--success)' : 'var(--danger)') +
    '">(' +
    (net >= 0 ? '+' : '') +
    '¥' +
    net.toLocaleString() +
    ')</span></td><td class="' +
    _rateColor(totRate) +
    '">' +
    totRate +
    '%</td></tr>';
  recHtml += '</tbody></table></div>';

  // レースタイプ別 (本日)
  recHtml += '<div class="card" class="p-overflow-hidden">';
  recHtml += '<div class="card-header-row">本日 レースタイプ別 (3連単)</div>';
  recHtml += '<table class="recovery-table">';
  recHtml += '<thead><tr><th>タイプ</th><th>R数</th><th>的中</th><th>的中率</th><th>回収率</th></tr></thead><tbody>';
  var typeLabels = { honmei: '⚡本命', middle: '📊混戦', ana: '🔥穴' };
  ['honmei', 'middle', 'ana'].forEach(function (t) {
    var ts = s.typeStats[t];
    var hr = ts.total > 0 ? ((ts.hit3 / ts.total) * 100).toFixed(0) : '-';
    var rr = ts.invest > 0 ? Math.round((ts.payout3 / ts.invest) * 100) : 0;
    recHtml +=
      '<tr><td>' +
      typeLabels[t] +
      '</td><td>' +
      ts.total +
      '</td><td>' +
      ts.hit3 +
      '</td><td>' +
      hr +
      '%</td><td class="' +
      _rateColor(rr) +
      '">' +
      rr +
      '%</td></tr>';
  });
  recHtml += '</tbody></table></div>';

  // 場別 全場 (本日)
  var stadArr = [];
  for (var sid in s.stadiumStats) stadArr.push(s.stadiumStats[sid]);
  // 回収率の高い順
  stadArr.forEach(function (ss) {
    ss.rate3 = ss.invest3 > 0 ? Math.round((ss.payout3 / ss.invest3) * 100) : 0;
    ss.rate2 = ss.invest2 > 0 ? Math.round((ss.payout2 / ss.invest2) * 100) : 0;
  });
  stadArr.sort(function (a, b) {
    return b.rate3 - a.rate3;
  });

  if (stadArr.length > 0) {
    recHtml += '<div class="card" class="p-overflow-hidden">';
    recHtml += '<div class="card-header-row">本日 場別 (回収率順)</div>';
    recHtml += '<table class="recovery-table">';
    recHtml +=
      '<thead><tr><th>場</th><th>R数</th><th>3連的中</th><th>3連投資</th><th>3連回収</th><th>3連率</th></tr></thead><tbody>';
    stadArr.forEach(function (ss) {
      var hr = ss.total > 0 ? ((ss.hit3 / ss.total) * 100).toFixed(0) : '-';
      recHtml +=
        '<tr><td><b>' +
        escText(ss.name) +
        '</b></td><td>' +
        ss.total +
        '</td><td>' +
        ss.hit3 +
        ' (' +
        hr +
        '%)</td><td>¥' +
        ss.invest3.toLocaleString() +
        '</td><td>¥' +
        ss.payout3.toLocaleString() +
        '</td><td class="' +
        _rateColor(ss.rate3) +
        '">' +
        ss.rate3 +
        '%</td></tr>';
    });
    recHtml += '</tbody></table></div>';
  }

  // F18: データ整合性 警告（的中だが payout 未取得の件）
  var w = s.warnings;
  if (w.tri_zero.length > 0 || w.exa_zero.length > 0) {
    recHtml += '<div class="card" style="padding:12px;background:#FFF3E0;border-left:4px solid var(--warn)">';
    recHtml += '<div style="font-weight:700;color:#E65100;margin-bottom:6px">⚠ データ整合性の警告</div>';
    if (w.tri_zero.length > 0) {
      recHtml +=
        '<div style="font-size:11px;margin-bottom:4px">3連単的中だが払戻未取得: <b>' +
        w.tri_zero.length +
        '件</b></div>';
      recHtml += '<div style="font-size:10px;color:var(--text-sub)">' + escText(w.tri_zero.join(', ')) + '</div>';
    }
    if (w.exa_zero.length > 0) {
      recHtml +=
        '<div style="font-size:11px;margin-top:6px;margin-bottom:4px">2連単的中だが払戻未取得: <b>' +
        w.exa_zero.length +
        '件</b></div>';
      recHtml += '<div style="font-size:10px;color:var(--text-sub)">' + escText(w.exa_zero.join(', ')) + '</div>';
    }
    recHtml +=
      '<div style="font-size:9px;color:var(--text-dim);margin-top:6px">※ 該当レースの結果データが Open API / 自前スクレイパーにまだ反映されていない可能性。「更新」を押すと再取得・再補完されます。</div>';
    recHtml += '</div>';
  }

  document.getElementById('statRecovery').innerHTML = recHtml;
  // 旧 statDetail（重複情報）と statChart は空に
  var sd = document.getElementById('statDetail');
  if (sd) sd.innerHTML = '';
  var sc = document.getElementById('statsChart');
  if (sc && sc.parentNode) {
    sc.parentNode.style.display = 'none';
  }
}
function renderStatsChart() {
  var ctx = document.getElementById('chartAccuracy');
  if (!ctx) return;
  // PD-13b: Chart.js が未ロードならまず読み込んで再帰呼出
  capabilities.refresh('chart');
  if (!capabilities.has('chart')) {
    _loadChartLib().then(renderStatsChart, function (err) {
      var parent = ctx.parentNode;
      if (parent)
        parent.innerHTML =
          '<div style="padding:20px;text-align:center;color:#999;font-size:11px">グラフ描画ライブラリの読込に失敗しました</div>';
    });
    return;
  }
  if (statsChart) statsChart.destroy();
  var history = safeParse('boatrace_history', []); // PA-5
  var byDate = {};
  history.forEach(function (h) {
    if (!h.actual) return;
    if (!byDate[h.date]) byDate[h.date] = { total: 0, hit: 0 };
    byDate[h.date].total++;
    if (h.trifecta_hit) byDate[h.date].hit++;
  });
  var dates = Object.keys(byDate).sort().slice(-14);
  var rates = dates.map(function (d) {
    return byDate[d].total > 0 ? (byDate[d].hit / byDate[d].total) * 100 : 0;
  });

  statsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates.map(function (d) {
        return d.slice(4, 6) + '/' + d.slice(6);
      }),
      datasets: [
        {
          data: rates,
          backgroundColor: 'rgba(33,150,243,0.5)',
          borderColor: '#2196F3',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      plugins: {
        legend: { display: false },
        title: { display: true, text: '日別3連単的中率(%)', color: '#666', font: { size: 11 } },
      },
      scales: {
        x: { ticks: { font: { size: 9 }, color: '#999' }, grid: { display: false } },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            font: { size: 9 },
            color: '#999',
            callback: function (v) {
              return v + '%';
            },
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
      },
    },
  });
}

// globalThis export (REST_ONLY)
globalThis.renderStats = renderStats;
globalThis.renderStatsChart = renderStatsChart;
