// Phase 2 完遂続編 (Clearwing patterns): src/reporting/race_detail.js
//
// Reporting 層: レース詳細ページ (#pageDetail) の完全 DOM rendering。
// 単一 712 行の openRace 関数:
//   1. ヘッダ (タイトル / ⭐ / 戻る)
//   2. 天候・水面カード
//   3. 結果カード (確定済の場合)
//   4. 出走表 (6 艇カード)
//   5. 展示カード (展示走行データ)
//   6. AI 予想カード (8 カテゴリ score breakdown + 買い目)
//   7. オッズセクション (renderOddsSection に委譲)
//
// ⚠️ 400 行制限超過 (712 行):
//   Clearwing 規約「単一ファイル 400 行以下」に違反する。
//   理由: 7 セクションは強く coupled (shared locals: pred / result / preview /
//         race / boats / sid / rn / settings 等を多数共有)。安全に内部分割するには
//         data flow を全 sub-function に props として渡す大改修が必要 (~+200 行
//         の signature 拡張)。「先に extract、内部 split は別 PR で安全に進める」
//         戦略を採用 (docs/architecture.md § 9 設計済)。
//   ファイル単独で 712 行残置するが:
//     - canonical assets/app.js から 712 行が外れた (~700 行スリム化)
//     - reporting 層へ責務集約 (分析・データ取得との混在解消)
//     - 退行検知が 1 ファイル完結 (snapshot より大きな変更を検出しやすい)
//
// 次 PR の内部分割案 (docs/architecture.md § 9):
//   _renderRaceHeader (~50)、_renderWeatherCard (~30)、_renderResultCard (~25)、
//   _renderBoatsCard (~210)、_renderExhibitionCard (~70)、_renderPredictionCard (~270)、
//   openRace 本体 (~80) ─ orchestrator として呼出のみ。
//   各 sub-function は明示的に { pred, result, preview, race, boats, sid, rn, settings }
//   を受け取る形に refactor。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:REPORTING_RACE_DETAIL:START */ ... /* BUILD:REPORTING_RACE_DETAIL:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS に登録 — レース詳細を開いた
// 時のみ呼ばれるため critical bundle 入りを避ける。
//
// 依存: あまりに多いため省略 (canonical assets/app.js / 他 src/{analysis,reporting}/
//        bundle / utils の関数・状態を多数参照)。
//
// Public: openRace

'use strict';

function openRace(sid, rn) {
  currentStadium = sid;
  currentRace = rn;
  var name = STADIUMS[parseInt(sid)] || '場' + sid;
  var race = programData[sid][rn];
  var closedAt = race ? race.race_closed_at || '' : '';
  var closedTime = closedAt ? closedAt.split(' ')[1] || '' : '';
  if (closedTime) closedTime = closedTime.slice(0, 5);
  // P2-2: お気に入り（⭐）状態をタイトル横に表示し、トグル可能に
  var _watched = typeof _isRaceWatched === 'function' ? _isRaceWatched(sid, rn) : false;
  var _starHtml =
    '<button id="raceStarBtn" aria-label="お気に入り切替" ' +
    'style="margin-left:8px;background:transparent;border:0;font-size:18px;cursor:pointer;padding:0 4px" ' +
    'data-action="toggleRaceWatched" data-arg-sid="' +
    sid +
    '" data-arg-rn="' +
    rn +
    '">' +
    (_watched ? '⭐' : '☆') +
    '</button>';
  document.getElementById('detailTitle').innerHTML =
    name +
    ' ' +
    rn +
    'R' +
    (closedTime
      ? ' <span style="font-size:12px;color:var(--text-dim);font-weight:400">締切 ' + closedTime + '</span>'
      : '') +
    _starHtml;
  document.getElementById('detailBack').onclick = function () {
    openStadium(sid);
  };
  // P0-4: 詳細画面を開く度にデフォルトタブ（出走表）にリセット
  if (typeof _showDetailTab === 'function') _showDetailTab('lineup');

  var preview = previewData && previewData[sid] && previewData[sid][rn] ? previewData[sid][rn] : null;
  var result = resultData && resultData[sid] && resultData[sid][rn] ? resultData[sid][rn] : null;
  var pred = predictRace(sid, parseInt(rn));
  // F19c: 終了済レースは履歴の pred_snapshot を優先 (lock & 統計と一致)
  if (result && result.isFinished) {
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
  var raceOdds = getOddsForRace(sid, rn);
  var popularity = calcPopularity(raceOdds);
  var rdForRace = getRaceDataForRace(sid, rn);

  document.getElementById('oddsRefreshBtn').style.display = 'inline-block';
  updateOddsUI();

  // Weather
  var weatherHtml = '';
  if (preview) {
    var w = preview.weather || preview;
    var windDir = WIND_DIR[w.wind_direction || w.race_wind_direction_number] || '---';
    var ws = w.wind_speed || w.race_wind || 0;
    var wh = w.wave_height || w.race_wave || 0;
    var temp = w.temperature || w.race_temperature || '--';
    var wtemp = w.water_temperature || w.race_water_temperature || '--';
    weatherHtml =
      '<div class="weather-bar">' +
      '<span class="weather-item">風: ' +
      windDir +
      ' ' +
      ws +
      'm</span>' +
      '<span class="weather-item">波: ' +
      wh +
      'cm</span>' +
      '<span class="weather-item">気温: ' +
      temp +
      '℃</span>' +
      '<span class="weather-item">水温: ' +
      wtemp +
      '℃</span>' +
      '</div>';
  }
  // FIX: オッズデータの実スクレイプ経過を詳細画面トップに警告表示
  //   "0秒前" は GitHub Pages からの fetch 時刻であり、cron が止まると
  //   JSON 内のオッズは何時間も古い可能性がある（ユーザの混乱の主因）
  if (oddsData && oddsData.updated_at) {
    var _ot = Date.parse(oddsData.updated_at);
    if (!isNaN(_ot)) {
      var _osm = Math.round((Date.now() - _ot) / 60000);
      if (_osm >= 30) {
        var _hh = _osm >= 60 ? Math.floor(_osm / 60) + '時間' + (_osm % 60) + '分' : _osm + '分';
        weatherHtml =
          '<div style="background:#FFEBEE;border:2px solid #D32F2F;border-radius:8px;padding:10px;margin:8px 0;color:#D32F2F;font-weight:700;font-size:13px;text-align:center">⚠ オッズが ' +
          _hh +
          '前のスナップショットです<br><span style="font-size:11px;font-weight:400">レース直前の市場と乖離している可能性があります</span></div>' +
          weatherHtml;
      }
    }
  }
  document.getElementById('detailWeather').innerHTML = weatherHtml;

  // Result
  var resHtml = '';
  if (result && result.isFinished && result.results && result.results.length > 0) {
    var places = result.results.slice().sort(function (a, b) {
      return a.place - b.place;
    });
    resHtml = '<div class="result-box"><div class="result-title">レース結果</div>';
    resHtml += '<div class="result-places">';
    places.slice(0, 3).forEach(function (p) {
      resHtml += p.place + '着' + boatBadge(p.racer_boat_number) + ' ';
    });
    resHtml += '</div>';
    if (result.technique_number)
      resHtml +=
        '<div style="font-size:11px;margin-bottom:6px">決まり手: <b>' +
        (TECHNIQUE[result.technique_number] || '---') +
        '</b></div>';
    if (result.refund) {
      ['trifecta', 'trio', 'exacta'].forEach(function (type) {
        var label = type === 'trifecta' ? '3連単' : type === 'trio' ? '3連複' : '2連単';
        if (result.refund[type]) {
          result.refund[type].forEach(function (r) {
            resHtml +=
              '<div class="refund-row"><span class="refund-label">' +
              label +
              ' ' +
              r.combination +
              '</span><span class="refund-val">\\' +
              (r.amount || r.payout || 0).toLocaleString() +
              '</span></div>';
          });
        }
      });
    }
    if (pred) {
      var actualCombo =
        places[0].racer_boat_number + '-' + places[1].racer_boat_number + '-' + places[2].racer_boat_number;
      var hit = pred.trifecta.some(function (t) {
        return t.combo === actualCombo;
      });
      resHtml +=
        '<div style="margin-top:8px;font-size:14px;font-weight:700;text-align:center" class="' +
        (hit ? 'hit' : 'miss') +
        '">' +
        (hit ? '3連単 的中!' : '不的中') +
        '</div>';
    }
    resHtml += '</div>';
  }
  document.getElementById('detailResult').innerHTML = resHtml;

  // ==========================================
  // 3a. Macour-style 出走表テーブル (horizontal, label column on right, sticky)
  // ==========================================
  var boatsHtml = '';
  if (race && race.boats && Array.isArray(race.boats)) {
    var boatMap = {};
    // D8 (2026-05-17): D6 と同様の null guard。race.boats に null entry 混入時の防御
    race.boats.forEach(function (bt) {
      if (bt && bt.racer_boat_number) boatMap[bt.racer_boat_number] = bt;
    });
    var pvMap = {};
    if (preview && preview.boats) {
      for (var pi = 1; pi <= 6; pi++) {
        if (preview.boats[String(pi)]) pvMap[pi] = preview.boats[String(pi)];
      }
    }

    // Compute ET/ST ranks for highlighting
    var etTimes = [],
      stTimes = [];
    for (var ri = 1; ri <= 6; ri++) {
      var pvi = pvMap[ri];
      etTimes.push({
        boat: ri,
        val:
          pvi && pvi.racer_exhibition_time != null && pvi.racer_exhibition_time > 0
            ? pf(pvi.racer_exhibition_time)
            : 999,
      });
      stTimes.push({ boat: ri, val: pvi && pvi.racer_start_timing != null ? pf(pvi.racer_start_timing) : 999 });
    }
    etTimes.sort(function (a, b) {
      return a.val - b.val;
    });
    stTimes.sort(function (a, b) {
      return a.val - b.val;
    });
    var etRankMap = {},
      stRankMap = {};
    etTimes.forEach(function (e, i) {
      etRankMap[e.boat] = i;
    });
    stTimes.forEach(function (e, i) {
      stRankMap[e.boat] = i;
    });

    boatsHtml = '<div class="section-title">出走表</div>';
    boatsHtml += '<div class="detail-table-wrap"><table class="detail-table">';

    // Row 0: 枠番ヘッダー (boat colors)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      boatsHtml +=
        '<td class="boat-col-header" style="background:' +
        BOAT_COLORS[bn] +
        ';color:' +
        BOAT_TEXT[bn] +
        ';border:1px solid ' +
        (bn === 1 ? '#ccc' : 'transparent') +
        '">' +
        bn +
        '号艇</td>';
    }
    boatsHtml += '<th>枠</th></tr>';

    // Row 1: 級別
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var cn = bt.racer_class_number || 4;
      boatsHtml +=
        '<td><span style="background:' +
        CLASS_COLOR[cn] +
        ';color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700">' +
        CLASS_NAME[cn] +
        '</span></td>';
    }
    boatsHtml += '<th>級</th></tr>';

    // Row 2: 登番 + 期(unavailable, show "-")
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var rid = bt.racer_number || 0;
      boatsHtml += '<td><b>' + rid + '</b> <span class="fs-9 c-dim">-期</span></td>';
    }
    boatsHtml += '<th>登番</th></tr>';

    // Row 3: 選手名 (bold, colored by boat number, 16px)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var nameColor = bn === 1 ? 'var(--text)' : BOAT_COLORS[bn];
      if (bn === 5) nameColor = '#B8860B';
      var m = pred
        ? pred.marks.find(function (x) {
            return x.boat === bn;
          })
        : null;
      var markStr = m ? ' <span style="font-size:10px;color:var(--accent)">' + m.mark + '</span>' : '';
      var rid = bt.racer_number || 0;
      var photoHtml = rid
        ? '<img class="racer-photo" src="data/photos/' +
          rid +
          '.jpg" loading="lazy" alt="" onerror="this.dataset.broken=\'1\'">'
        : '';
      boatsHtml +=
        '<td>' +
        photoHtml +
        '<span style="font-weight:700;font-size:13px;color:' +
        nameColor +
        '">' +
        escText(bt.racer_name || '') +
        '</span>' +
        markStr +
        '</td>';
    }
    boatsHtml += '<th>選手</th></tr>';

    // Row 4: 年齢 + 支部 + 体重
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var age = bt.racer_age || '-';
      var branch = bt.racer_branch_name || '-';
      var weight = bt.racer_weight || '-';
      boatsHtml += '<td style="font-size:10px">' + age + '歳/' + escText(branch) + '<br>' + weight + 'kg</td>';
    }
    boatsHtml += '<th>年齢等</th></tr>';

    // Row 5: バッジ
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var form = getRacerForm(bt.racer_number || 0);
      // X1: 妙味バッジ用に divergence を渡す
      var div = pred && pred.divergence ? pred.divergence[bn] : null;
      var badges = racerBadges(bt, form, div);
      boatsHtml += '<td>' + (badges || '-') + '</td>';
    }
    boatsHtml += '<th>特徴</th></tr>';

    // Row 6: モーター評価 A-E
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var mr = pf(bt.racer_assigned_motor_top_2_percent);
      var me = motorEvalGrade(mr);
      boatsHtml +=
        '<td><span class="' +
        me.cls +
        '">' +
        me.grade +
        '</span> <span style="font-size:9px;color:var(--text-sub)">' +
        me.label +
        '</span></td>';
    }
    boatsHtml += '<th>モーター</th></tr>';

    // Row 7: 全国勝率 + 2連率 (highlight pink if >=6.0)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var wr = pf(bt.racer_national_top_1_percent);
      var t2 = pf(bt.racer_national_top_2_percent);
      var hlCls = wr >= 6.0 ? 'hl-pink' : '';
      boatsHtml +=
        '<td class="' +
        hlCls +
        '"><b>' +
        wr.toFixed(2) +
        '</b><br><span class="fs-9">2連:' +
        t2.toFixed(1) +
        '%</span></td>';
    }
    boatsHtml += '<th>全国勝率</th></tr>';

    // Row 8: 当地勝率 + 2連率
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var lwr = pf(bt.racer_local_top_1_percent);
      var lt2 = pf(bt.racer_local_top_2_percent);
      var hlCls = lwr >= 6.0 ? 'hl-pink' : '';
      boatsHtml +=
        '<td class="' +
        hlCls +
        '"><b>' +
        lwr.toFixed(2) +
        '</b><br><span class="fs-9">2連:' +
        lt2.toFixed(1) +
        '%</span></td>';
    }
    boatsHtml += '<th>当地勝率</th></tr>';

    // Row 9: 平均ST
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var avgSt = pf(bt.racer_average_start_timing);
      boatsHtml += '<td>' + (bt.racer_average_start_timing != null ? avgSt.toFixed(2) : '---') + '</td>';
    }
    boatsHtml += '<th>平均ST</th></tr>';

    // Row 10: モーター番号 + 2連率 (highlight pink if >=40%)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var mNum = bt.racer_assigned_motor_number || '-';
      var mr2 = pf(bt.racer_assigned_motor_top_2_percent);
      var hlCls = mr2 >= 40 ? 'hl-pink' : '';
      boatsHtml +=
        '<td class="' + hlCls + '"><b>' + mNum + '</b><br><span class="fs-9">' + mr2.toFixed(1) + '%</span></td>';
    }
    boatsHtml += '<th>モーター</th></tr>';

    // Row 11: ボート番号 + 2連率 (highlight pink if >=40%)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var bNum = bt.racer_assigned_boat_number || '-';
      var br2 = pf(bt.racer_assigned_boat_top_2_percent);
      var hlCls = br2 >= 40 ? 'hl-pink' : '';
      boatsHtml +=
        '<td class="' + hlCls + '"><b>' + bNum + '</b><br><span class="fs-9">' + br2.toFixed(1) + '%</span></td>';
    }
    boatsHtml += '<th>ボート</th></tr>';

    // Row 12: F/L count
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var fc = bt.racer_flying_count || 0;
      var lc = bt.racer_late_start_count_in_current_term || 0;
      var flStr = 'F' + fc + '/L' + lc;
      if (fc > 0) flStr = '<span style="color:var(--danger);font-weight:700">F' + fc + '</span>/L' + lc;
      boatsHtml += '<td>' + flStr + '</td>';
    }
    boatsHtml += '<th>F/L</th></tr>';

    // F16: 今節成績 (Macool 風) — 14 cells (= 7 days × 2 slots) を縦並べ
    if (rdForRace && rdForRace.boats) {
      var boatsSeries = [];
      var maxNonNull = 0;
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        var rid = bt ? bt.racer_number || 0 : 0;
        var rdBoat = rdForRace.boats
          ? rdForRace.boats.find(function (rb) {
              return rb.boat_number === bn || rb.racer_number === rid;
            })
          : null;
        var arr = rdBoat ? rdBoat.current_series_results || [] : [];
        boatsSeries.push(arr);
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] != null && i + 1 > maxNonNull) maxNonNull = i + 1;
        }
      }
      if (maxNonNull > 0) {
        var pairs = Math.ceil(maxNonNull / 2);
        var DAY_LABELS = ['初日', '2日目', '3日目', '4日目', '5日目', '準優', '最終'];
        for (var p = 0; p < pairs; p++) {
          for (var slot = 0; slot < 2; slot++) {
            var idx = p * 2 + slot;
            if (idx >= maxNonNull) break;
            boatsHtml += '<tr>';
            for (var bi = 0; bi < 6; bi++) {
              boatsHtml += renderSeriesCell(boatsSeries[bi][idx]);
            }
            if (slot === 0) {
              var rs = idx + 1 < maxNonNull ? 2 : 1;
              boatsHtml +=
                '<th rowspan="' + rs + '" class="series-day-th">' + (DAY_LABELS[p] || p + 1 + '日目') + '</th>';
            }
            boatsHtml += '</tr>';
          }
        }
      }
    }

    boatsHtml += '</table></div>';
  }
  document.getElementById('detailBoats').innerHTML = boatsHtml;

  // ==========================================
  // 3b. 展示情報テーブル
  // ==========================================
  var exhHtml = '';
  if (preview && preview.boats) {
    exhHtml = '<div class="section-title">展示情報</div>';
    exhHtml += '<div class="detail-table-wrap"><table class="exhibition-table">';
    // F12: 展示テーブルに「持ペラ / 部品交換 / 調整重量」を追加
    exhHtml +=
      '<thead><tr><th>枠</th><th>ST</th><th>展示</th><th>チルト</th><th>整備</th><th>調整</th></tr></thead><tbody>';

    for (var bn = 1; bn <= 6; bn++) {
      var pv = pvMap[bn];
      var stVal = pv && pv.racer_start_timing != null ? pv.racer_start_timing : null;
      var etVal =
        pv && pv.racer_exhibition_time != null && pv.racer_exhibition_time > 0 ? pv.racer_exhibition_time : null;
      var tiltVal = pv && pv.racer_tilt_adjustment != null ? pv.racer_tilt_adjustment : null;
      var propVal = pv && pv.racer_propeller ? pv.racer_propeller : '';
      var partsVal = pv && pv.racer_parts_replaced ? pv.racer_parts_replaced : '';
      var adjVal = pv && pv.racer_adjust_weight != null ? pv.racer_adjust_weight : 0;

      // Rank coloring for ET
      var etRk = etRankMap[bn];
      var etCls = etRk === 0 ? 'hl-rank1' : etRk === 1 ? 'hl-rank2' : etRk === 2 ? 'hl-rank3' : '';
      // Rank coloring for ST
      var stRk = stRankMap[bn];
      var stCls = stRk === 0 ? 'hl-rank1' : stRk === 1 ? 'hl-rank2' : stRk === 2 ? 'hl-rank3' : '';

      var stDisp = stVal !== null ? '.' + String(Math.abs(pf(stVal) * 100).toFixed(0)).padStart(2, '0') : '---';
      if (stVal !== null && pf(stVal) < 0) stDisp = 'F' + stDisp;

      // 整備表示: プロペラと部品交換の合成
      var maintDisp = '';
      if (propVal)
        maintDisp +=
          '<span style="background:#FFF3E0;color:#E65100;padding:1px 4px;border-radius:2px;font-size:9px">P' +
          escText(propVal) +
          '</span> ';
      if (partsVal)
        maintDisp +=
          '<span style="background:#E3F2FD;color:#1565C0;padding:1px 4px;border-radius:2px;font-size:9px;font-weight:700">⚙' +
          escText(partsVal) +
          '</span>';
      if (!maintDisp) maintDisp = '<span style="color:#CCC">-</span>';

      // 調整重量: > 0 なら警告色
      var adjDisp =
        adjVal > 0
          ? '<span style="color:var(--warn);font-weight:700">+' + adjVal.toFixed(1) + '</span>'
          : '<span style="color:#CCC">-</span>';

      exhHtml += '<tr>';
      exhHtml +=
        '<td style="background:' +
        BOAT_COLORS[bn] +
        ';color:' +
        BOAT_TEXT[bn] +
        ';font-weight:700;border:1px solid ' +
        (bn === 1 ? '#ccc' : 'transparent') +
        '">' +
        bn +
        '</td>';
      exhHtml += '<td class="' + stCls + '">' + stDisp + '</td>';
      exhHtml += '<td class="' + etCls + '">' + (etVal !== null ? etVal : '---') + '</td>';
      exhHtml += '<td>' + (tiltVal !== null ? tiltVal : '---') + '</td>';
      exhHtml += '<td class="fs-9">' + maintDisp + '</td>';
      exhHtml += '<td>' + adjDisp + '</td>';
      exhHtml += '</tr>';
    }
    exhHtml += '</tbody></table></div>';
    // 注記: 公式に存在しない情報（まわり足/直線/1周/ピット）は専門紙でのみ取得可能
    exhHtml +=
      '<div style="font-size:9px;color:var(--text-dim);margin-top:4px">※ まわり足・1周・直線・ピット離れは boatrace.jp 公式に非公開（マクール等専門紙のみ）</div>';

    // Course entry grid
    if (preview.boats) {
      var courseEntries = [];
      var hasCourse = false;
      for (var ci = 1; ci <= 6; ci++) {
        var cpv = preview.boats[String(ci)];
        var cn = cpv && cpv.racer_course_number != null ? cpv.racer_course_number : ci;
        if (cpv && cpv.racer_course_number != null) hasCourse = true;
        courseEntries.push({ boat: ci, course: cn });
      }
      if (hasCourse) {
        courseEntries.sort(function (a, b) {
          return a.course - b.course;
        });
        exhHtml +=
          '<div style="margin:8px 0;text-align:center;font-size:11px;font-weight:700;color:var(--text-sub)">進入コース</div>';
        exhHtml += '<div class="course-grid">';
        courseEntries.forEach(function (e) {
          exhHtml +=
            '<div class="course-entry" style="background:' +
            BOAT_COLORS[e.boat] +
            ';color:' +
            BOAT_TEXT[e.boat] +
            ';border:1px solid ' +
            (e.boat === 1 ? '#ccc' : 'transparent') +
            '">' +
            e.boat +
            '</div>';
        });
        exhHtml += '</div>';
      }
    }
  }
  document.getElementById('detailExhibition').innerHTML = exhHtml;

  // ==========================================
  // 3c. 2段階AI予想セクション（番組予想 + 直前予想）
  // ==========================================
  var predHtml = '';
  var progPred = predictRaceProgram(sid, parseInt(rn));
  var boats = race && race.boats ? race.boats : [];

  // ========= 番組予想 =========
  if (progPred) {
    predHtml +=
      '<div style="background:#F0F4FF;border:1px solid #C5CAE9;border-radius:10px;padding:12px;margin:8px 0">';
    predHtml +=
      '<div style="font-weight:700;font-size:14px;color:#1A237E;margin-bottom:8px">番組予想 <span style="font-size:11px;color:#666;font-weight:400">出走表データのみ</span></div>';
    progPred.marks.forEach(function (m, i) {
      if (i >= 4) return;
      var boatInfo = boats.find(function (b) {
        return b.racer_boat_number === m.boat;
      });
      var nm = boatInfo ? (boatInfo.racer_name || '').split(/\s|\u3000/)[0] : '';
      var probPct = Math.round(m.prob * 100);
      predHtml += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px">';
      predHtml += '<span style="font-weight:700;width:20px">' + m.mark + '</span>';
      predHtml += boatBadge(m.boat);
      predHtml += '<span>' + escText(nm) + '</span>';
      predHtml +=
        '<span style="font-family:monospace;color:#1A237E;font-weight:700;margin-left:auto">' + probPct + '%</span>';
      predHtml += '</div>';
    });
    var progTypeIcon = progPred.raceType === 'honmei' ? '⚡' : progPred.raceType === 'ana' ? '🔥' : '📊';
    predHtml +=
      '<div class="note-orange">' + progTypeIcon + progPred.typeLabel + '  信頼度: ' + progPred.confidence + '%</div>';
    if (progPred.marks[0].reasons && progPred.marks[0].reasons.length > 0) {
      predHtml +=
        '<div style="font-size:11px;color:#555;margin-top:6px;padding:6px;background:#E8EAF6;border-radius:6px">';
      progPred.marks[0].reasons.slice(0, 3).forEach(function (r) {
        predHtml += '<div>・' + escText(r) + '</div>';
      });
      predHtml += '</div>';
    }
    predHtml += '</div>';
  }

  // ========= 直前予想 =========
  var hasRealPreview = false;
  if (preview && preview.boats) {
    for (var pk in preview.boats) {
      if (preview.boats[pk] && (preview.boats[pk].racer_exhibition_time || 0) > 0) {
        hasRealPreview = true;
        break;
      }
    }
  }

  predHtml += '<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;padding:12px;margin:8px 0">';
  predHtml +=
    '<div style="font-weight:700;font-size:14px;color:#E65100;margin-bottom:8px">直前予想 <span style="font-size:11px;color:#666;font-weight:400">展示航走反映</span></div>';

  if (hasRealPreview && pred) {
    var diff = comparePredictions(progPred, pred);
    pred.marks.forEach(function (m, i) {
      if (i >= 4) return;
      var boatInfo = boats.find(function (b) {
        return b.racer_boat_number === m.boat;
      });
      var nm = boatInfo ? (boatInfo.racer_name || '').split(/\s|\u3000/)[0] : '';
      var probPct = Math.round(m.prob * 100);
      var change = diff
        ? diff.changes.find(function (c) {
            return c.boat === m.boat;
          })
        : null;
      var diffStr = '';
      if (change && change.rankDiff !== 0) {
        // B19 (2026-05-17): 旧コードは ↑+{val}% 固定だったため probDiff<0 で「↑+-3%」
        //   のような "+-" 表記バグが発生。↑↓ は順位変動 (rankDiff)、符号は
        //   確率変動 (probDiff) の符号に従う形に分離。
        var p = Math.round(change.probDiff * 100);
        var pSign = p > 0 ? '+' : p < 0 ? '' : ''; // 負値は Math.round が自動で "-" を付ける
        var arrow = change.rankDiff > 0 ? '↑' : '↓';
        var color = change.rankDiff > 0 ? '#43A047' : '#E53935';
        diffStr = ' <span style="color:' + color + ';font-size:11px;font-weight:700">' + arrow + pSign + p + '%</span>';
      }
      predHtml += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px">';
      predHtml += '<span style="font-weight:700;width:20px">' + m.mark + '</span>';
      predHtml += boatBadge(m.boat);
      predHtml += '<span>' + escText(nm) + '</span>';
      predHtml +=
        '<span style="font-family:monospace;color:#E65100;font-weight:700;margin-left:auto">' + probPct + '%</span>';
      predHtml += diffStr;
      predHtml += '</div>';
    });
    var liveTypeIcon = pred.raceType === 'honmei' ? '⚡' : pred.raceType === 'ana' ? '🔥' : '📊';
    predHtml +=
      '<div class="note-orange">' +
      liveTypeIcon +
      pred.typeLabel +
      '  信頼度: ' +
      starsHtml(pred.confStars) +
      ' ' +
      pred.confidence +
      '%</div>';
    // X5: シナリオ確率表示
    if (pred.scenarios) {
      var scen = pred.scenarios;
      var scenLabels = { nige: '逃げ', sashi: '差し', makuri: 'まくり', makuriSashi: 'まくり差し', other: '穴' };
      var scenStr = '';
      Object.keys(scen).forEach(function (k) {
        if (scen[k] >= 0.05) {
          var pct = (scen[k] * 100).toFixed(0);
          scenStr += '<span style="margin-right:8px"><b>' + scenLabels[k] + '</b> ' + pct + '%</span>';
        }
      });
      predHtml +=
        '<div style="font-size:10px;color:#666;margin-top:4px;padding:4px 6px;background:#F5F5F5;border-radius:4px">想定展開: ' +
        scenStr +
        '</div>';
    }

    // 展示による変動サマリー
    if (diff) {
      var hasChange = diff.changes.some(function (c) {
        return c.rankDiff !== 0;
      });
      if (hasChange) {
        predHtml += '<div style="font-size:11px;margin-top:8px;padding:6px;background:#FFF3E0;border-radius:6px">';
        predHtml += '<div style="font-weight:700;color:#E65100;margin-bottom:4px">展示による変動</div>';
        diff.changes.forEach(function (c) {
          if (c.rankDiff > 0) {
            var reasons = c.addedReasons.length > 0 ? c.addedReasons.slice(0, 2).join(', ') : '展示好調';
            predHtml += '<div style="color:#2E7D32">↑ ' + c.boat + '号艇: ' + escText(reasons) + '</div>';
          } else if (c.rankDiff < 0) {
            var risks = c.addedRisks.length > 0 ? c.addedRisks.slice(0, 2).join(', ') : '展示不調';
            predHtml += '<div style="color:#C62828">↓ ' + c.boat + '号艇: ' + escText(risks) + '</div>';
          }
        });
        if (diff.typeChanged) {
          predHtml +=
            '<div style="color:#D84315;font-weight:700;margin-top:4px">⚠ ' +
            diff.progType +
            ' → ' +
            diff.liveType +
            ' に変化</div>';
        }
        predHtml += '</div>';
      }
    }

    // AI vs popularity divergence
    if (popularity && pred.marks.length > 0) {
      var aiTop = pred.marks[0].boat;
      var popTop = popularity[0] ? popularity[0].boat : 0;
      if (aiTop !== popTop && popTop > 0) {
        predHtml +=
          '<div style="font-size:11px;color:var(--warn);margin:6px 0;padding:6px;background:#FFF8E1;border:1px solid #FFE0B2;border-radius:6px">AI予想◎' +
          aiTop +
          '号艇 vs 1番人気' +
          popTop +
          '号艇 -- 逆張り注目</div>';
      }
    }
  } else {
    // 直前情報なし — 状態を明示分岐（2026-05-16 改修）
    //   1) レース終了済 → 「展示データ未取得」と明示（スクレイプ漏れ）
    //   2) レース前 → 「番組予想は上に表示されています」と誘導
    var _finished = !!(result && result.isFinished);
    predHtml +=
      '<div style="text-align:center;padding:16px;color:#666;background:#FAFAFA;border:1px dashed #DDD;border-radius:8px">';
    if (_finished) {
      predHtml += '<div style="font-size:20px;margin-bottom:6px">📋</div>';
      predHtml += '<div style="font-size:13px;font-weight:700;color:#C62828">展示データ未取得のレースです</div>';
      predHtml +=
        '<div style="font-size:11px;color:#888;margin-top:4px">展示窓時刻にスクレイプが届かず、直前予想は生成されませんでした<br>上の<b>番組予想</b>と<b>レース結果</b>をご確認ください</div>';
    } else {
      predHtml += '<div style="font-size:20px;margin-bottom:6px">⏳</div>';
      predHtml += '<div style="font-size:13px;font-weight:700">展示航走の反映待ち</div>';
      predHtml +=
        '<div style="font-size:11px;color:#888;margin-top:4px">レース開始約 15 分前の展示で更新されます<br>それまでは上の<b>番組予想</b>をご参照ください</div>';
    }
    predHtml += '</div>';
  }
  predHtml += '</div>';

  // ========= 買い目（直前予想ベースを優先） =========
  var activePred = hasRealPreview && pred ? pred : null;
  var activePredLabel = hasRealPreview ? '直前予想' : '番組予想';
  if (activePred || progPred) {
    predHtml +=
      '<div style="background:var(--card-bg);border:2px solid var(--accent);border-radius:10px;padding:12px;margin:8px 0">';
    predHtml +=
      '<div style="font-weight:700;font-size:14px;color:var(--accent);margin-bottom:8px">推奨買い目 <span style="font-size:10px;color:var(--text-dim);font-weight:400">★' +
      activePredLabel +
      'ベース</span></div>';

    if (activePred && activePred.trifecta) {
      // 直前予想の買い目
      predHtml +=
        '<div class="bet-label">3連単推奨 <span class="bet-method">[' +
        escText(activePred.methodLabel || '') +
        ']</span></div><div class="bet-combos">';
      activePred.trifecta.forEach(function (t) {
        // FIX: 表示時は常に raceOdds (最新 API) を優先 lookup、
        //   t.odds は predict 時の snapshot で stale になりうるため fallback のみに
        var liveOdds = raceOdds && raceOdds.trifecta ? raceOdds.trifecta[t.combo] : null;
        var odds3 = liveOdds != null ? liveOdds : t.odds != null ? t.odds : null;
        var ev3 = odds3 != null ? calcEV(t.prob, odds3) : t.ev != null ? t.ev : null;
        var evHtml = evBadge(ev3);
        // FIX: 表示書式を .toFixed(1) に統一（穴予想 / オッズテーブルと整合）
        var oddsStr = odds3 != null ? '<span class="odds-val"> ' + Number(odds3).toFixed(1) + '倍</span>' : '';
        // X1: EV モードの場合、Kelly 配分（円）を表示
        var stakeStr = t.stakeYen
          ? '<span style="font-size:9px;color:var(--accent);font-weight:700;margin-left:4px">¥' +
            t.stakeYen.toLocaleString() +
            '</span>'
          : '';
        predHtml +=
          '<span class="bet-chip">' +
          t.combo +
          ' <span class="fs-9 c-dim">' +
          (t.prob * 100).toFixed(1) +
          '%</span>' +
          oddsStr +
          evHtml +
          stakeStr +
          '</span>';
      });
      predHtml += '</div>';
      // X1: EV モード時の合計投資額表示
      if (activePred.evApplied) {
        var totalStake = activePred.trifecta.reduce(function (a, t) {
          return a + (t.stakeYen || 0);
        }, 0);
        predHtml +=
          '<div style="font-size:10px;color:var(--accent);margin-top:4px">EV ベース投資合計: ¥' +
          totalStake.toLocaleString() +
          '</div>';
      }
      if (!raceOdds)
        predHtml +=
          '<div style="font-size:9px;color:var(--text-dim);margin-bottom:6px">オッズ未取得 -- 確率ベースの推定値</div>';
      predHtml += '<div class="bet-label">2連単推奨</div><div class="bet-combos">';
      activePred.exacta.forEach(function (t) {
        predHtml += '<span class="bet-chip">' + t.combo + '</span>';
      });
      predHtml += '</div>';
    } else if (progPred) {
      // 番組予想ベースの買い目
      var betCount3 = parseInt(settings.betCount3) || 10;
      var betCount2 = parseInt(settings.betCount2) || 5;
      var method = settings.betMethod || 'auto';
      if (method === 'auto') {
        if (progPred.raceType === 'honmei') method = 'prob';
        else if (progPred.raceType === 'ana') method = 'box';
        else method = 'formation';
      }
      var progBets = generateBetsV2(progPred.marks, method, betCount3, betCount2);
      predHtml += '<div class="bet-label">3連単推奨</div><div class="bet-combos">';
      progBets.trifecta.forEach(function (t) {
        predHtml +=
          '<span class="bet-chip">' +
          t.combo +
          ' <span class="fs-9 c-dim">' +
          (t.prob * 100).toFixed(1) +
          '%</span></span>';
      });
      predHtml += '</div>';
      predHtml += '<div class="bet-label">2連単推奨</div><div class="bet-combos">';
      progBets.exacta.forEach(function (t) {
        predHtml += '<span class="bet-chip">' + t.combo + '</span>';
      });
      predHtml += '</div>';
      predHtml +=
        '<div style="font-size:10px;color:#FF9800;margin-top:6px">※展示航走後に最終版の買い目に更新されます</div>';
    }

    // 🔥 穴予想: レースタイプ非依存、常に表示
    //   primary: オッズ30倍+ かつ EV>=1.0（高 EV 推奨）
    //   fallback: primary 0 件のとき オッズ15倍+ から EV 降順で topN（EV<1 でも提示）
    //   オッズ未取得時は AI 確率のみで穴コンビ候補を表示
    //   B13 (2026-05-16): 推奨買い目に含まれる combo は穴からは除外し重複表示を防止
    var anaSrc = activePred || progPred;
    if (anaSrc && anaSrc.marks) {
      var anaTopN = parseInt(settings.betCountAna) || 3;
      if (anaTopN < 1) anaTopN = 1;
      else if (anaTopN > 6) anaTopN = 6;
      var hasAnaOdds = !!(raceOdds && raceOdds.trifecta && Object.keys(raceOdds.trifecta).length > 0);
      // B13: 推奨買い目の combo 一覧を抽出 (excludeCombos に渡す)
      var _recommendedCombos = [];
      if (activePred && Array.isArray(activePred.trifecta)) {
        _recommendedCombos = activePred.trifecta.map(function (t) {
          return t.combo;
        });
      } else if (progPred && progPred.marks) {
        // 番組予想 fallback: 上で組み立てた progBets から取得
        try {
          var _pm = typeof progBets !== 'undefined' && progBets && progBets.trifecta ? progBets.trifecta : [];
          _recommendedCombos = _pm.map(function (t) {
            return t.combo;
          });
        } catch (_) {
          _recommendedCombos = [];
        }
      }
      var anaHtmlBlock = '';
      if (hasAnaOdds) {
        var anaRes = _pickAnaCandidates(anaSrc.marks, raceOdds.trifecta, {
          minOdds: 30,
          minEV: 1.0,
          minOddsLoose: 15,
          topN: anaTopN,
          excludeCombos: _recommendedCombos, // B13
        });
        var picks = anaRes.primary.length > 0 ? anaRes.primary : anaRes.fallback;
        var isPrimary = anaRes.primary.length > 0;
        if (picks.length > 0) {
          var subTitle = isPrimary
            ? 'オッズ30倍+ かつ EV≥1.0'
            : '高 EV 候補なし — 高オッズ TOP' + picks.length + ' を参考表示';
          anaHtmlBlock =
            '<div style="margin-top:12px;padding:8px;background:rgba(255,87,34,0.08);border-left:3px solid #FF5722;border-radius:6px">';
          anaHtmlBlock +=
            '<div class="bet-label" style="color:#FF5722">🔥 穴予想 <span style="font-size:9px;color:var(--text-dim);font-weight:400">' +
            subTitle +
            '</span></div>';
          anaHtmlBlock += '<div class="bet-combos">';
          picks.forEach(function (p) {
            var evColor = p.ev >= 1.0 ? '#FF5722' : '#999';
            anaHtmlBlock +=
              '<span class="bet-chip">' +
              p.combo +
              ' <span class="fs-9 c-dim">' +
              (p.prob * 100).toFixed(2) +
              '%</span>' +
              '<span class="odds-val"> ' +
              p.odds.toFixed(1) +
              '倍</span>' +
              '<span style="font-size:9px;color:' +
              evColor +
              ';font-weight:700;margin-left:4px">EV ' +
              p.ev.toFixed(2) +
              '</span>' +
              '</span>';
          });
          anaHtmlBlock += '</div></div>';
        }
      } else if (anaSrc.marks.length >= 3) {
        // オッズ未取得: AI 確率分布の中で「1コース絡み以外」の上位 N を 穴候補として提示
        // B13: 推奨買い目との重複を除外
        var dist = buildTrifectaProbDist(anaSrc.marks);
        var top1Boat = anaSrc.marks[0].boat;
        var _recoSet = {};
        _recommendedCombos.forEach(function (c) {
          if (c) _recoSet[String(c)] = true;
        });
        var anaCands = [];
        for (var k in dist) {
          if (!Object.prototype.hasOwnProperty.call(dist, k)) continue;
          if (k.split('-')[0] === String(top1Boat)) continue; // 1着が1番人気以外
          if (_recoSet[k]) continue; // B13: 推奨と重複する combo は除外
          anaCands.push({ combo: k, prob: dist[k] });
        }
        anaCands.sort(function (a, b) {
          return b.prob - a.prob;
        });
        anaCands = anaCands.slice(0, anaTopN);
        if (anaCands.length > 0) {
          anaHtmlBlock =
            '<div style="margin-top:12px;padding:8px;background:rgba(255,87,34,0.08);border-left:3px solid #FF5722;border-radius:6px">';
          anaHtmlBlock +=
            '<div class="bet-label" style="color:#FF5722">🔥 穴予想 <span style="font-size:9px;color:var(--text-dim);font-weight:400">オッズ未取得 — AI 穴コンビ候補</span></div>';
          anaHtmlBlock += '<div class="bet-combos">';
          anaCands.forEach(function (p) {
            anaHtmlBlock +=
              '<span class="bet-chip">' +
              p.combo +
              ' <span class="fs-9 c-dim">' +
              (p.prob * 100).toFixed(2) +
              '%</span>' +
              '</span>';
          });
          anaHtmlBlock += '</div>';
          anaHtmlBlock +=
            '<div style="font-size:9px;color:var(--text-dim);margin-top:4px">※オッズ取得後に EV 評価へ自動更新</div>';
          anaHtmlBlock += '</div>';
        }
      }
      predHtml += anaHtmlBlock;
    }

    predHtml += '</div>';
  }
  // P2-3: pairwise matchup 表示（pairwiseDB に十分なデータがある対戦のみ TOP3）
  if (typeof _renderPairwiseSummary === 'function' && race && race.boats) {
    var pwHtml = _renderPairwiseSummary(race.boats);
    if (pwHtml) predHtml += pwHtml;
  }
  document.getElementById('detailPrediction').innerHTML = predHtml;

  // ==========================================
  // 3d + 3e + 3f. Odds sections
  // ==========================================
  document.getElementById('detailOdds').innerHTML = renderOddsSection(sid, rn, raceOdds, pred, race);

  showPage('detail');

  // FIX: GH Pages のオッズが古い時 (>5min)、Cloudflare Worker 経由で
  //   boatrace.jp から実時間オッズを取得して oddsData に上書き＆再描画。
  //   throttle / inflight ガードで重複呼出を抑止。
  try {
    var _shouldLive = false;
    if (!oddsData || !oddsData.updated_at) {
      _shouldLive = true;
    } else {
      var _t = Date.parse(oddsData.updated_at);
      if (!isNaN(_t)) {
        var _ageMin = (Date.now() - _t) / 60000;
        if (_ageMin >= 5) _shouldLive = true;
      }
    }
    if (_shouldLive) _kickOffLiveOddsRefresh(sid, rn);
  } catch (_) {}
}

// globalThis export (REST_ONLY)
globalThis.openRace = openRace;
