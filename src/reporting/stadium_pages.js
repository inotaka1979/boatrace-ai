// Phase 2 完遂続編 (Clearwing patterns): src/reporting/stadium_pages.js
//
// Reporting 層: top ページの場一覧 (renderStadiums) と stadium 詳細ページ
// (openStadium) の DOM rendering。起動経路で呼ばれるため critical bundle 同居。
// 注: showPage は src/reporting/page_router.js に別出 (400 行制限遵守)。
//
// Public: renderStadiums / openStadium

'use strict';

function renderStadiums() {
  document.getElementById('topLoading').style.display = 'none';
  var sumDiv = document.getElementById('topSummary');
  var list = document.getElementById('stadiumList');
  // PH-5d: sumDiv は HTML で min-height で初期スペース確保済 → display 設定不要
  //   旧: sumDiv.style.display='block' は CLS の主要因 (60px 押下げ)
  list.style.display = 'grid';
  // PH-5c: list.innerHTML='' を撤去 (CLS 抑制)
  //   下記 list.innerHTML = html で atomic に置換、中間 empty 状態を作らない

  var acc = getAccuracy();
  sumDiv.innerHTML =
    '<div class="summary-bar">' +
    '<div class="summary-item"><div class="s-num" style="color:var(--accent)">' +
    acc.total +
    '</div><div class="s-label">判定済</div></div>' +
    '<div class="summary-item"><div class="s-num" style="color:var(--gold)">' +
    acc.trifectaHit +
    '</div><div class="s-label">3連単的中</div></div>' +
    '<div class="summary-item"><div class="s-num" class="c-success">' +
    acc.trifectaRate +
    '%</div><div class="s-label">的中率</div></div>' +
    '<div class="summary-item"><div class="s-num" style="color:var(--text)">' +
    Object.keys(racerDB).length +
    '</div><div class="s-label">選手DB</div></div>' +
    '</div>';

  var activeIds = {};
  if (programData) {
    for (var sid in programData) activeIds[sid] = true;
  }

  // PH-2: DocumentFragment + 単一 innerHTML join で reflow 1 回に削減
  //   従来: 24 createElement + 24 appendChild = 24 reflow
  //   新版: HTML 文字列 join + 1 回 innerHTML = 1 reflow
  //   PG-6 の event delegation が data-sid を受けるため onclick 不要
  var html = '';
  // rt-fix3 (2026-06-27): 現在レース判定を「結果(results)到着」だけでなく「締切時刻経過」も併用。
  //   results データは上流ミラーの遅延で実レースより数レース遅れることがあり、それに依存すると
  //   「次レース」ポインタが実際より後ろにずれる（例: 実 6R なのに 3R 表示）。boatrace.jp 等の
  //   サイト同様、race_closed_at(締切) を過ぎたレースは消化済とみなしてリアルタイムに進める。
  var _nowMs = Date.now();
  function _closedMs(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]) : null;
  }
  for (var id = 1; id <= 24; id++) {
    var sid = String(id);
    var name = STADIUMS[id];
    if (activeIds[sid] && programData[sid]) {
      var stadium = programData[sid];
      var raceNums = Object.keys(stadium).sort(function (a, b) {
        return parseInt(a) - parseInt(b);
      });
      var totalRaces = raceNums.length;
      // 消化済 = 結果到着 OR 締切経過。次レース = 最初の未消化レース（時刻ベースで実レースに追従）。
      var doneCount = 0;
      var nextRn = null;
      for (var rj = 0; rj < raceNums.length; rj++) {
        var rnc = raceNums[rj];
        var rsc = resultData && resultData[sid] && resultData[sid][rnc];
        var finC = !!(rsc && /** @type {any} */ (rsc).isFinished);
        var clMs = _closedMs(stadium[rnc] && stadium[rnc].race_closed_at);
        var doneC = finC || (clMs != null && clMs <= _nowMs);
        if (doneC) doneCount++;
        else if (nextRn === null) nextRn = rnc;
      }
      var firstRace = stadium[raceNums[0]];
      var gradeNum = firstRace ? firstRace.race_grade_number || 5 : 5;
      var grade = GRADE_CLASS[gradeNum] || GRADE_CLASS[5];

      // rt-fix3 (2026-06-27): 「◯日目」は出走表(racelist)タブ由来の day_label
      //   （初日 / N日目 / 最終日）を直接表示。月間カレンダー解析(壊れている)には依存しない。
      var dayInfo = '';
      if (raceData && raceData.racedata) {
        var rd = raceData.racedata.find(function (r) {
          return r.stadium === parseInt(sid);
        });
        if (rd && rd.day_label) dayInfo = rd.day_label;
        else if (rd && rd.day) dayInfo = rd.day + '日目'; // 後方互換
      }

      // rt-fix3 (2026-06-27): 他サイト同様、現在(次)レースに締切時刻も併記（例「6R 18:02」）。
      //   全レースの締切が過ぎた（次レース無し）場合は他サイト同様「発売終了」表示。
      var nextRaceInfo;
      if (nextRn) {
        var _ncClosed = stadium[nextRn] && stadium[nextRn].race_closed_at;
        var _ncHm = _ncClosed ? (String(_ncClosed).split(' ')[1] || '').slice(0, 5) : '';
        nextRaceInfo = _ncHm ? nextRn + 'R ' + _ncHm : nextRn + 'R';
      } else {
        nextRaceInfo = '発売終了';
      }

      // PH-2 + CLS 対策: stadium-day を常に 2 つレンダー（dayInfo 無くても &nbsp; placeholder）
      // PI-fix: iOS standalone PWA で event delegation が click 発火しないため
      //   inline onclick + role="button" + tabindex="0" を必ず付ける（既存の
      //   `<button onclick="showPage(...)">` 動作と同じパスを使う）
      // Epic 19: data-action delegation 化（CSP unsafe-inline 撤去）
      html +=
        '<div class="stadium-card active-stadium" data-sid="' +
        sid +
        '" ' +
        'role="button" tabindex="0" data-action="openStadium" data-arg-sid="' +
        sid +
        '">' +
        '<span class="stadium-grade ' +
        grade.cls +
        '">' +
        grade.name +
        '</span>' +
        '<span class="stadium-name">' +
        name +
        '</span>' +
        '<span class="stadium-status">' +
        doneCount +
        '/' +
        totalRaces +
        'R</span>' +
        '<span class="stadium-day">' +
        (dayInfo || '&nbsp;') +
        '</span>' +
        '<span class="stadium-day">' +
        nextRaceInfo +
        '</span>' +
        '</div>';
    } else {
      var iso = typeof _nextOpenMap === 'object' && _nextOpenMap ? _nextOpenMap[sid] || '' : '';
      var dateLabel = _formatNextOpen(iso);
      var dateHtml = dateLabel ? '<span class="stadium-next-date">' + dateLabel + '</span>' : '';
      html +=
        '<div class="stadium-card inactive-stadium"' +
        (iso ? ' data-next-open="' + iso + '"' : '') +
        '>' +
        '<span class="stadium-name">' +
        name +
        '</span>' +
        '<span class="stadium-status">次節</span>' +
        dateHtml +
        '</div>';
    }
  }
  list.innerHTML = html; // PH-2: 単一 reflow
}

function openStadium(sid) {
  // PI-fix: predictRace 等は app-rest.js (lazy load) にあるため、rest 未 load
  //   で呼ばれた場合は ReferenceError で silently fail する。これを防ぐため
  //   guard + retry を入れる。
  if (typeof predictRace !== 'function' || typeof savePrediction !== 'function') {
    try {
      reportError({ type: 'info', msg: 'openStadium deferred: rest not ready', sid: sid });
    } catch (_) {}
    currentStadium = sid;
    var name0 = (typeof STADIUMS !== 'undefined' && STADIUMS[parseInt(sid)]) || '場' + sid;
    var t = document.getElementById('racesTitle');
    if (t) t.textContent = name0;
    var l = document.getElementById('racesList');
    if (l) l.innerHTML = '<div class="card">読込中... (予測モジュール待機)</div>';
    showPage('races');
    var _retry = 0;
    var _iv = setInterval(function () {
      _retry++;
      if (typeof predictRace === 'function' && typeof savePrediction === 'function') {
        clearInterval(_iv);
        try {
          openStadium(sid);
        } catch (e) {
          try {
            reportError({ type: 'error', msg: 'openStadium retry threw: ' + e.message });
          } catch (_) {}
        }
      } else if (_retry > 30) {
        clearInterval(_iv);
        if (l)
          l.innerHTML = '<div class="card">予測モジュールの読込に失敗しました。「更新」ボタンを押してください。</div>';
      }
    }, 200);
    return;
  }
  currentStadium = sid;
  var name = STADIUMS[parseInt(sid)] || '場' + sid;
  var stadium = programData[sid];
  if (!stadium) {
    document.getElementById('racesTitle').textContent = name;
    document.getElementById('racesList').innerHTML = '<div class="card">データがありません</div>';
    showPage('races');
    return;
  }

  var firstRace = stadium[Object.keys(stadium)[0]];
  var gradeNum = firstRace ? firstRace.race_grade_number || 5 : 5;
  var grade = GRADE_CLASS[gradeNum] || GRADE_CLASS[5];
  document.getElementById('racesTitle').innerHTML =
    name + ' <span class="stadium-grade ' + grade.cls + '" style="vertical-align:middle">' + grade.name + '</span>';

  var raceNums = Object.keys(stadium).sort(function (a, b) {
    return parseInt(a) - parseInt(b);
  });

  // FIX: history を 1 回だけ read して loop 内で reuse (per-race lookup は配列走査)
  var _historyForLoop = typeof safeParse === 'function' ? safeParse('boatrace_history', []) : [];
  var _todayForLoop = typeof todayStr === 'function' ? todayStr() : '';

  var html = '<table class="race-table">';
  html += '<thead><tr>';
  html += '<th class="race-col">R</th>';
  for (var b = 1; b <= 6; b++) {
    html += '<th class="boat-col boat-header-' + b + '">' + b + '</th>';
  }
  html += '</tr></thead><tbody>';

  raceNums.forEach(function (rn) {
    var race = stadium[rn];
    var pred = predictRace(sid, parseInt(rn));
    var progPred = predictRaceProgram(sid, parseInt(rn));
    var hasResult = resultData && resultData[sid] && resultData[sid][rn] && resultData[sid][rn].isFinished;

    if (pred) savePrediction(todayStr(), sid, rn, pred, hasResult ? resultData[sid][rn] : null);
    // F19c: 終了済レースは履歴の pred_snapshot を優先 (lock & 統計と一致)
    if (hasResult) {
      try {
        var _h = safeParse('boatrace_history', []);
        for (var _hi = 0; _hi < _h.length; _hi++) {
          var _e = _h[_hi];
          if (_e.date === todayStr() && _e.stadium === sid && _e.race === rn && _e.pred_snapshot) {
            // 旧 snapshot は mark フィールドを保持しないため、現 pred の mark を boat 番号で merge
            var _liveMarkByBoat = {};
            (pred && pred.marks ? pred.marks : []).forEach(function (_m) {
              if (_m && _m.boat) _liveMarkByBoat[_m.boat] = _m.mark;
            });
            var _snapMarks = (_e.pred_snapshot.marks || pred.marks || []).map(function (_m) {
              return Object.assign({}, _m, { mark: _m.mark || _liveMarkByBoat[_m.boat] || '' });
            });
            pred = {
              marks: _snapMarks,
              trifecta: _e.pred_snapshot.trifecta || pred.trifecta,
              exacta: _e.pred_snapshot.exacta || pred.exacta,
              raceType: _e.pred_snapshot.raceType || pred.raceType,
              typeCls: _e.pred_snapshot.typeCls || pred.typeCls,
              typeLabel: _e.pred_snapshot.typeLabel || pred.typeLabel,
              confidence: _e.pred_snapshot.confidence != null ? _e.pred_snapshot.confidence : pred.confidence,
              confStars: _e.pred_snapshot.confStars != null ? _e.pred_snapshot.confStars : pred.confStars,
              scenarios: _e.pred_snapshot.scenarios || pred.scenarios,
            };
            break;
          }
        }
      } catch (_) {}
    }

    // 直前予想があるか判定
    var pvData = previewData && previewData[sid] && previewData[sid][rn] ? previewData[sid][rn] : null;
    var hasRealPv = false;
    if (pvData && pvData.boats) {
      for (var pk in pvData.boats) {
        if (pvData.boats[pk] && (pvData.boats[pk].racer_exhibition_time || 0) > 0) {
          hasRealPv = true;
          break;
        }
      }
    }

    // 表示用の予想（直前あれば直前、なければ番組）
    var dispPred = hasRealPv && pred ? pred : null;
    var typeSource = dispPred || progPred;
    var typeIcon = typeSource
      ? typeSource.raceType === 'honmei'
        ? '⚡'
        : typeSource.raceType === 'ana'
          ? '🔥'
          : '📊'
      : '';
    var typeCls = dispPred ? dispPred.typeCls : progPred ? 'type-' + (progPred.raceType || 'middle') : '';

    // 番組→直前で最も上昇した艇の番号
    var riserStr = '';
    if (dispPred && progPred) {
      var diff = comparePredictions(progPred, dispPred);
      if (diff && diff.biggestRiser)
        riserStr = ' <span style="color:#43A047;font-size:9px">↑' + diff.biggestRiser.boat + '</span>';
    }

    html += '<tr data-action="openRace" data-arg-sid="' + sid + '" data-arg-rn="' + rn + '">';
    var closedAt = race.race_closed_at || '';
    var closedTime = closedAt ? closedAt.split(' ')[1] || '' : '';
    if (closedTime) closedTime = closedTime.slice(0, 5);
    var stageLabel = hasRealPv
      ? '<span style="font-size:8px;color:#E65100">直前</span>'
      : '<span style="font-size:8px;color:#1A237E">番組</span>';
    html +=
      '<td class="race-num-cell">' +
      rn +
      '<br><span style="font-size:9px;color:var(--text-dim);font-weight:400">' +
      closedTime +
      '</span><span class="race-type-icon"><span class="type-badge ' +
      typeCls +
      '">' +
      typeIcon +
      '</span></span><br>' +
      stageLabel +
      riserStr +
      '</td>';

    if (race.boats && Array.isArray(race.boats)) {
      var boatMap = {};
      // D6 (2026-05-17): race.boats に null / 不完全エントリが混入する可能性に
      //   防御。openStadium は critical bundle で常に呼ばれるので壊れると
      //   場が開けなくなる。エラーログで実機発生確認済 (2026-05-17 04:57)。
      race.boats.forEach(function (bt) {
        if (bt && bt.racer_boat_number) boatMap[bt.racer_boat_number] = bt;
      });
      var activePredMarks = dispPred ? dispPred.marks : progPred ? progPred.marks : null;
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        if (!bt) {
          html += '<td>-</td>';
          continue;
        }
        var racerName = escText(bt.racer_name || '');
        var isTop = activePredMarks && activePredMarks[0] && activePredMarks[0].boat === bn;
        var nameClass = isTop ? 'name-bold' : '';
        var markStr = isTop ? '◎ ' : '';
        html +=
          '<td class="racer-cell"><span class="' + nameClass + '">' + markStr + escText(racerName) + '</span></td>';
      }
    } else {
      for (var x = 0; x < 6; x++) html += '<td>-</td>';
    }

    html += '</tr>';

    if (hasResult && pred) {
      var res = resultData[sid][rn];
      // D8 (2026-05-17): res.results に null entry や <3 件のケースを防御。
      //   isFinished=true でも result が部分的なケースで places[2] undefined →
      //   openStadium silent halt → 場が開けなくなる事故 (蒲郡 / 若松等で実機発生)
      var _rawResults = res && Array.isArray(res.results) ? res.results : [];
      var places = _rawResults
        .filter(function (x) {
          return x && Number.isFinite(x.place) && x.racer_boat_number;
        })
        .sort(function (a, b) {
          return a.place - b.place;
        })
        .slice(0, 3);
      if (places.length < 3) return; // 結果不完全: result 行 skip (pred 行は既に出力済)
      var actualCombo =
        places[0].racer_boat_number + '-' + places[1].racer_boat_number + '-' + places[2].racer_boat_number;
      // FIX: 保存済 history entry の trifecta_bets を優先 lookup。
      //   live pred.trifecta は 設定変更 / DB 更新で picks が変動するため、
      //   成績タブのサマリ (entry.trifecta_hit ベース) と数値が乖離する。
      //   保存済 entry が無い or actual 未確定なら live にフォールバック。
      var hit;
      var _saved = null;
      for (var _hi = 0; _hi < _historyForLoop.length; _hi++) {
        var _e = _historyForLoop[_hi];
        if (_e.date === _todayForLoop && _e.stadium === sid && _e.race === rn) {
          _saved = _e;
          break;
        }
      }
      if (_saved && Array.isArray(_saved.trifecta_bets)) {
        hit = _saved.trifecta_bets.indexOf(actualCombo) >= 0;
      } else {
        hit = pred.trifecta.some(function (t) {
          return t.combo === actualCombo;
        });
      }
      html +=
        '<tr data-action="openRace" data-arg-sid="' +
        sid +
        '" data-arg-rn="' +
        rn +
        '" style="background:' +
        (hit ? '#E8F5E9' : '#FFEBEE') +
        '">';
      html += '<td class="race-result-cell ' + (hit ? 'hit' : 'miss') + '">' + (hit ? '的中' : '×') + '</td>';
      for (var bn2 = 1; bn2 <= 6; bn2++) {
        var placeNum = null;
        places.forEach(function (p, pi) {
          if (p && p.racer_boat_number === bn2) placeNum = pi + 1;
        });
        html += '<td class="race-result-cell">' + (placeNum ? placeNum + '着' : '') + '</td>';
      }
      html += '</tr>';
    }
  });

  html += '</tbody></table>';
  document.getElementById('racesList').innerHTML = html;
  document.getElementById('raceSummary').innerHTML = '';

  // rt-fix2 P1-A' (2026-06-11): 締切が近いレースの実時間オッズを先回り取得。
  //   bulk オッズ (data/odds/today.json) は GHA cron 間引きで数時間 stale になるため、
  //   /odds-proxy (edge cache 15s) で「締切 40 分以内・未確定」の直近 3 レースだけ
  //   live 取得しておく。取得後は oddsData.updated_at が進み、90 秒 poll の
  //   renderKey 変化で一覧が再描画され、買い目/EV が実時間オッズで再計算される。
  _prefetchLiveOddsForUpcoming(sid);

  showPage('races');
}

function _prefetchLiveOddsForUpcoming(sid) {
  try {
    if (typeof _kickOffLiveOddsRefresh !== 'function') return;
    var races = typeof programData !== 'undefined' && programData ? programData[sid] : null;
    if (!races) return;
    // race_closed_at は JST 壁時計 "YYYY-MM-DD HH:MM" — JST の分に直して比較
    var jst = new Date(Date.now() + 9 * 3600000);
    var nowMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
    var candidates = [];
    for (var rn in races) {
      var race = races[rn];
      if (!race || !race.race_closed_at) continue;
      var rs = typeof resultData !== 'undefined' && resultData && resultData[sid] && resultData[sid][rn];
      if (rs && /** @type {any} */ (rs).isFinished) continue;
      var hm = String(race.race_closed_at).split(' ')[1];
      if (!hm) continue;
      var hp = hm.split(':');
      var closeMin = parseInt(hp[0], 10) * 60 + parseInt(hp[1], 10);
      if (!Number.isFinite(closeMin)) continue;
      var delta = closeMin - nowMin;
      if (delta >= -2 && delta <= 40) candidates.push({ rn: rn, delta: delta });
    }
    candidates.sort(function (a, b) {
      return a.delta - b.delta;
    });
    // rt-fix3 P0-1 (2026-06-27): 締切間近 3 レース固定 → ウィンドウ内全レースへ拡張。
    //   bulk オッズ (data/odds/today.json) は GHA cron 間引きで数時間 stale になるため、
    //   これを唯一の供給源にすると一覧の EV/買い目が古いオッズで計算される。/odds-proxy
    //   (edge cache 15s, クライアント解析, KV write ゼロ) で締切ウィンドウ内 (-2..+40分) の
    //   未確定レースを全件 live 取得し、bulk は cold-start / fallback に降格する。
    //   一斉発火を避けるため 400ms 間隔で stagger（_kickOffLiveOddsRefresh は 30s/レース
    //   throttle + in-flight dedupe 済なので再入安全）。90 秒 poll からも再呼出される。
    candidates.forEach(function (c, i) {
      setTimeout(function () {
        try {
          _kickOffLiveOddsRefresh(sid, c.rn);
        } catch (_) {}
      }, i * 400);
    });
  } catch (_) {}
}

// globalThis export
globalThis.renderStadiums = renderStadiums;
globalThis.openStadium = openStadium;
