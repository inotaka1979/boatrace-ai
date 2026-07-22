// src/reporting/stadium_results.js
//
// マクール風「結果一覧」ビュー: 選択した場の 1R〜12R を 1 行ずつ縦に並べ、
//   各行に着順 1-2-3（艇番カラーバッジ + 選手名）/ 三連単配当 / 決まり手を表示する。
//   未確定レースは発売中 / 締切後 と「未確定」を表示。
//
// レース一覧ページ (openStadium) の「🎯 AI予想 / 🏁 結果一覧」トグルで切替。
//   openStadium 本体は critical bundle (src/reporting/stadium_pages.js) にあるため、
//   起動 LCP/TBT を守る目的で本モジュールは rest bundle に分離
//   (scripts/split_app.py の REST_ONLY_BUILD_MARKERS)。openStadium からは
//   typeof guard 付きで呼ばれるので、rest 未 load 時は従来の AI予想ビューにフォールバックする。
//
// Public: _getRacesView / _setRacesView / _syncRacesViewToggle / _renderStadiumResultsHtml

'use strict';

// 現在の表示ビュー ('predict' | 'results')。既定は AI予想。
function _getRacesView() {
  return globalThis._racesView === 'results' ? 'results' : 'predict';
}

// トグルボタンの active / aria-selected を現在のビューに同期。
function _syncRacesViewToggle() {
  var v = _getRacesView();
  var btns = document.querySelectorAll('#racesViewToggle .races-view-btn');
  for (var i = 0; i < btns.length; i++) {
    var on = btns[i].getAttribute('data-races-view') === v;
    btns[i].classList.toggle('active', on);
    btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

// ビューを切り替えて現在の場を再描画。ACTION_HANDLERS.setRacesView から呼ばれる。
function _setRacesView(view) {
  globalThis._racesView = view === 'results' ? 'results' : 'predict';
  _syncRacesViewToggle();
  if (typeof currentStadium !== 'undefined' && currentStadium != null && typeof openStadium === 'function') {
    openStadium(currentStadium);
  }
}

// 艇番カラーバッジ (BOAT_COLORS / BOAT_TEXT は critical bundle 由来のグローバル)。
function _rlBadge(num) {
  return (
    '<span class="rl-badge" style="background:' +
    BOAT_COLORS[num] +
    ';color:' +
    BOAT_TEXT[num] +
    ';border:1px solid ' +
    (num === 1 ? '#ccc' : 'transparent') +
    '">' +
    num +
    '</span>'
  );
}

// 全角スペースで padding された選手名を「姓 名」の短縮形に圧縮。
function _rlCompactName(name) {
  if (!name) return '';
  var parts = String(name)
    .split(/[　\s]+/)
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return parts[0] + ' ' + parts[parts.length - 1];
}

// 場 sid の結果一覧 HTML を生成。programData (開催レース) と resultData (確定結果) を
//   突き合わせ、全レースを R 番号順に並べる。
function _renderStadiumResultsHtml(sid) {
  var prog = typeof programData !== 'undefined' && programData ? programData[sid] : null;
  var resAll = typeof resultData !== 'undefined' && resultData ? resultData[sid] : null;
  var rnSet = {};
  if (prog) for (var k in prog) rnSet[k] = 1;
  if (resAll) for (var k2 in resAll) rnSet[k2] = 1;
  var rns = Object.keys(rnSet).sort(function (a, b) {
    return parseInt(a) - parseInt(b);
  });
  if (rns.length === 0) return '<div class="card">結果データがありません</div>';

  var jstNow = new Date(Date.now() + 9 * 36e5);
  var nowMin = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes();
  var finishedCount = 0;
  var rows = '';

  rns.forEach(function (rn) {
    var race = prog ? prog[rn] : null;
    var res = resAll ? resAll[rn] : null;
    var finished = !!(res && res.isFinished);
    var closedAt = race && race.race_closed_at ? String(race.race_closed_at) : '';
    var closedTime = closedAt ? (closedAt.split(' ')[1] || '').slice(0, 5) : '';

    rows +=
      '<div class="result-row" data-action="openRace" data-arg-sid="' +
      sid +
      '" data-arg-rn="' +
      rn +
      '" role="button" tabindex="0">';
    rows +=
      '<div class="rl-head"><span class="rl-rn">' +
      rn +
      'R</span><span class="rl-time">' +
      closedTime +
      '</span></div>';

    if (finished) {
      finishedCount++;
      var places = (Array.isArray(res.results) ? res.results : [])
        .filter(function (p) {
          return p && Number.isFinite(p.place) && p.racer_boat_number;
        })
        .sort(function (a, b) {
          return a.place - b.place;
        })
        .slice(0, 3);
      var fin = '<div class="rl-fin">';
      places.forEach(function (p, i) {
        if (i > 0) fin += '<span class="rl-sep">-</span>';
        fin +=
          '<span class="rl-boat">' +
          _rlBadge(p.racer_boat_number) +
          '<span class="rl-name">' +
          escText(_rlCompactName(p.racer_name)) +
          '</span></span>';
      });
      fin += '</div>';
      rows += fin;

      var payout = null;
      if (res.refund && Array.isArray(res.refund.trifecta) && res.refund.trifecta[0]) {
        var tri = res.refund.trifecta[0];
        payout = tri.amount != null ? tri.amount : tri.payout;
      }
      rows += '<div class="rl-pay">' + (payout != null ? '¥' + Number(payout).toLocaleString() : '—') + '</div>';

      var tech = res.technique_number ? TECHNIQUE[res.technique_number] || '' : '';
      rows += '<div class="rl-tech">' + escText(tech) + '</div>';
    } else {
      var onSale = false;
      if (closedTime) {
        var hp = closedTime.split(':');
        var cm = parseInt(hp[0], 10) * 60 + parseInt(hp[1], 10);
        onSale = Number.isFinite(cm) && cm > nowMin;
      }
      rows += '<div class="rl-fin rl-pending">' + (onSale ? '発売中' : '締切後') + '</div>';
      rows += '<div class="rl-pay"></div>';
      rows += '<div class="rl-tech rl-unconf">未確定</div>';
    }

    rows += '</div>';
  });

  return (
    '<div class="rl-summary">確定 ' +
    finishedCount +
    ' / ' +
    rns.length +
    ' R</div><div class="result-list">' +
    rows +
    '</div>'
  );
}

// openStadium (critical) から呼ばれる委譲エントリ。トグルを同期し、現在ビューに応じて
//   結果一覧 or 予想テーブル (predictHtml) を racesList に描画する。
function _applyRacesView(sid, predictHtml) {
  _syncRacesViewToggle();
  var el = document.getElementById('racesList');
  if (!el) return;
  el.innerHTML = _getRacesView() === 'results' ? _renderStadiumResultsHtml(sid) : predictHtml;
}

// globalThis export
globalThis._applyRacesView = _applyRacesView;
globalThis._getRacesView = _getRacesView;
globalThis._setRacesView = _setRacesView;
globalThis._syncRacesViewToggle = _syncRacesViewToggle;
globalThis._renderStadiumResultsHtml = _renderStadiumResultsHtml;
