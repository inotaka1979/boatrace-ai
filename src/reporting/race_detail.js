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
  // 直前情報(展示情報テーブル)のオンデマンド補完: bulk previews が朝の一斉展示で
  //   一部の場(三国/唐津/児島 等)を覆えず「展示情報」が丸ごと出ないため、展示窓内で
  //   preview が欠けるレースを開いた瞬間に Worker /beforeinfo-proxy で取り直す。
  if (typeof globalThis._loadPreviewLive === 'function' && typeof globalThis._isPreviewIncomplete === 'function') {
    var _pv = (globalThis.previewData || {})[sid] || {};
    var _pclosed = programData && programData[sid] && programData[sid][rn] && programData[sid][rn].race_closed_at;
    var _pcMs = 0;
    if (_pclosed) {
      var _pm = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(_pclosed);
      if (_pm) _pcMs = Date.UTC(+_pm[1], +_pm[2] - 1, +_pm[3], +_pm[4] - 9, +_pm[5], +_pm[6]);
    }
    // 展示窓(締切-45分〜+15分)で、展示が欠けていれば取りに行く。
    if (_pcMs && Date.now() > _pcMs - 45 * 60000 && Date.now() < _pcMs + 15 * 60000 && globalThis._isPreviewIncomplete(_pv[rn] || null)) {
      globalThis._loadPreviewLive(sid, rn);
    }
  }
  // オリジナル展示(一周/まわり足/直線)を Worker 経由でオンデマンド取得(対応場のみ)。
  //   GHA schedule では鮮度不足のため、閲覧した瞬間に最新を取りに行き、取得後に再描画する。
  if (typeof globalThis._loadOrigExhibitionLive === 'function') globalThis._loadOrigExhibitionLive(sid, rn);
  // レース結果のオンデマンド補完: 締切を過ぎたのに結果/払戻が欠けるレースを開いた瞬間に
  //   Worker /result-proxy で取り直す(bulk が夜に止まっても閲覧レースは必ず最新化)。
  if (typeof globalThis._loadResultLive === 'function' && typeof globalThis._isResultIncomplete === 'function') {
    var _rd = (globalThis.resultData || {})[sid] || {};
    var _closed = programData && programData[sid] && programData[sid][rn] && programData[sid][rn].race_closed_at;
    var _closedMs = 0;
    if (_closed) {
      var _m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(_closed);
      if (_m) _closedMs = Date.UTC(+_m[1], +_m[2] - 1, +_m[3], +_m[4] - 9, +_m[5], +_m[6]);
    }
    if (_closedMs && Date.now() > _closedMs + 3 * 60000 && globalThis._isResultIncomplete(_rd[rn] || null)) {
      globalThis._loadResultLive(sid, rn);
    }
  }
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
    // 2026-05-24 fix: places.length < 3 で places[2].racer_boat_number が
    //   TypeError → openRace が途中 throw して詳細画面が完成しない事故。
    //   stadium_pages.js の D8 fix と同じパターン。filter + slice で防御。
    var _rawPlaces = Array.isArray(result.results) ? result.results : [];
    var places = _rawPlaces
      .filter(function (p) {
        return p && Number.isFinite(p.place) && p.racer_boat_number;
      })
      .sort(function (a, b) {
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
    // 2026-05-24 fix: places.length >= 3 のときのみ 的中判定
    //   (1-2 着までしか取れていない部分 result では 3 連単判定不能)
    if (pred && places.length >= 3) {
      var actualCombo =
        places[0].racer_boat_number + '-' + places[1].racer_boat_number + '-' + places[2].racer_boat_number;
      var hit = pred.trifecta.some(function (t) {
        return t.combo === actualCombo;
      });
      // 2026-07-05: 🔥穴予想の的中も判定・表示する(旧実装は 3 連単買い目のみ判定で、
      //   穴予想が的中しても「不的中」と表示されていた)
      var anaHit = Array.isArray(pred.ana) && pred.ana.indexOf(actualCombo) >= 0;
      var banner = hit && anaHit ? '3連単 的中! ＋ 🔥穴予想 的中!'
        : hit ? '3連単 的中!'
        : anaHit ? '🔥穴予想 的中!'
        : '不的中';
      resHtml +=
        '<div style="margin-top:8px;font-size:14px;font-weight:700;text-align:center" class="' +
        (hit || anaHit ? 'hit' : 'miss') +
        '">' +
        banner +
        '</div>';
    } else if (pred && places.length < 3) {
      resHtml +=
        '<div style="margin-top:8px;font-size:11px;color:var(--text-dim);text-align:center">' +
        '結果データ取得中 (着順 ' + places.length + '/3 件)</div>';
    }
    resHtml += '</div>';
  }
  document.getElementById('detailResult').innerHTML = resHtml;

  // ==========================================
  // 3a. Macour-style 出走表 → src/reporting/race_detail_boats.js に外出し
  //    (boatMap / pvMap / etRankMap / stRankMap を ctx 経由で書き戻し、
  //     続く exhibition section が共有して使用)
  // ==========================================
  var _ctxBoats = {
    race: race,
    preview: preview,
    pred: pred,
    rdForRace: rdForRace,
  };
  _renderRaceDetailBoats(_ctxBoats);
  var boatMap = _ctxBoats.boatMap;
  var pvMap = _ctxBoats.pvMap;
  var etRankMap = _ctxBoats.etRankMap;
  var stRankMap = _ctxBoats.stRankMap;

  // ==========================================
  // 3b. 展示情報テーブル
  // ==========================================
  // オリジナル展示（各場サイト由来の一周/まわり足/直線、対応場のみ）。waku -> {lap,turn,straight}
  var _oeRace = ((globalThis._origExhibIndex || {})[sid] || {})[rn] || null;
  var _hasOe = false;
  if (_oeRace) {
    for (var _ob in _oeRace) {
      var _oeb = _oeRace[_ob];
      if (_oeb && ((_oeb.lap_time || 0) > 0 || (_oeb.turn_time || 0) > 0 || (_oeb.straight_time || 0) > 0)) {
        _hasOe = true;
        break;
      }
    }
  }

  // オリジナル展示(一周/まわり足/直線)の順位マップ。展示タイム同様、値が小さい
  //   (速い)ほど上位。waku -> rank(0,1,2,...)。上位3つを hl-rank1/2/3 で色付け。
  function _oeRankMap(field) {
    var arr = [];
    for (var b = 1; b <= 6; b++) {
      var v = (_oeRace && _oeRace[b] && _oeRace[b][field]) || 0;
      if (v > 0) arr.push([b, v]);
    }
    arr.sort(function (a, c) {
      return a[1] - c[1];
    });
    var m = {};
    for (var i = 0; i < arr.length; i++) m[arr[i][0]] = i;
    return m;
  }
  var _lapRk = _hasOe ? _oeRankMap('lap_time') : {};
  var _turnRk = _hasOe ? _oeRankMap('turn_time') : {};
  var _strRk = _hasOe ? _oeRankMap('straight_time') : {};
  function _oeCls(rk) {
    return rk === 0 ? 'hl-rank1' : rk === 1 ? 'hl-rank2' : rk === 2 ? 'hl-rank3' : '';
  }

  var exhHtml = '';
  if (preview && preview.boats) {
    exhHtml = '<div class="section-title">展示情報</div>';
    exhHtml += '<div class="detail-table-wrap"><table class="exhibition-table">';
    // F12: 展示テーブルに「持ペラ / 部品交換 / 調整重量」を追加
    // オリジナル展示対応場では 一周/まわり足/直線 列を追加（boatrace.jp 公式には無い実測値）
    // 桐生(1)は周回タイムを「半周」で独自計測する（値が ~18s で他場の一周 ~37s と桁が違う）。
    //   lap_time に格納しているが見出しは実態に合わせて「半周」と表示し誤認を防ぐ。
    var _lapLabel = String(sid) === '1' ? '半周' : '一周';
    exhHtml +=
      '<thead><tr><th>枠</th><th>ST</th><th>展示</th><th>チルト</th>' +
      (_hasOe ? '<th>' + _lapLabel + '</th><th>まわり足</th><th>直線</th>' : '') +
      '<th>整備</th><th>調整</th></tr></thead><tbody>';

    for (var bn = 1; bn <= 6; bn++) {
      var pv = pvMap[bn];
      // 一部の場(住之江等)は boatrace.jp 直前情報が未取得でも、オリジナル展示ページ側に
      //   ST/展示タイムがある。preview が欠ければ OE 由来の値でフォールバックする。
      var _oebST = (_oeRace && _oeRace[bn]) || {};
      var stVal = pv && pv.racer_start_timing != null ? pv.racer_start_timing
        : (_oebST.st_time != null ? _oebST.st_time : null);
      var etVal =
        pv && pv.racer_exhibition_time != null && pv.racer_exhibition_time > 0 ? pv.racer_exhibition_time
        : ((_oebST.ex_time || 0) > 0 ? _oebST.ex_time : null);
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
      if (_hasOe) {
        var _oeb2 = _oeRace[bn] || {};
        var _lap = (_oeb2.lap_time || 0) > 0 ? _oeb2.lap_time.toFixed(2) : '---';
        var _turn = (_oeb2.turn_time || 0) > 0 ? _oeb2.turn_time.toFixed(2) : '---';
        var _str = (_oeb2.straight_time || 0) > 0 ? _oeb2.straight_time.toFixed(2) : '---';
        exhHtml +=
          '<td class="' + _oeCls(_lapRk[bn]) + '">' + _lap + '</td>' +
          '<td class="' + _oeCls(_turnRk[bn]) + '">' + _turn + '</td>' +
          '<td class="' + _oeCls(_strRk[bn]) + '">' + _str + '</td>';
      }
      exhHtml += '<td class="fs-9">' + maintDisp + '</td>';
      exhHtml += '<td>' + adjDisp + '</td>';
      exhHtml += '</tr>';
    }
    exhHtml += '</tbody></table></div>';
    // オリジナル展示(各場サイトの実測 一周/まわり足/直線)が取れた場はその旨、未対応場は注記。
    if (_hasOe) {
      exhHtml +=
        '<div style="font-size:9px;color:var(--text-dim);margin-top:4px">' +
        _lapLabel +
        '・まわり足・直線は当該場オフィシャルサイトのオリジナル展示（実測）</div>';
    } else {
      exhHtml +=
        '<div style="font-size:9px;color:var(--text-dim);margin-top:4px">※ この場は一周・まわり足・直線のオリジナル展示に未対応（boatrace.jp 公式には非掲載）</div>';
    }

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
  // 3c. 2段階AI予想セクション → src/reporting/race_detail_prediction.js に外出し
  // ==========================================
  _renderRaceDetailPrediction({
    sid: sid,
    rn: rn,
    race: race,
    pred: pred,
    preview: preview,
    result: result,
    popularity: popularity,
    raceOdds: raceOdds,
  });

  // ==========================================
  // 3d + 3e + 3f. Odds sections
  // ==========================================
  document.getElementById('detailOdds').innerHTML = renderOddsSection(sid, rn, raceOdds, pred, race);

  showPage('detail');

  // rt-fix3 P0-2 (2026-06-27): 閲覧中レースは常に live オッズ取得を試みる。
  //   従来は bulk oddsData.updated_at が 5 分以内なら skip だったが、bulk 全体が新しくても
  //   「いま開いたこの 1 レース」が live オッズを持つとは限らない（bulk は GH Pages 由来で
  //   cron 間引きにより数時間 stale のことも）。_kickOffLiveOddsRefresh は 30s/レース throttle
  //   + in-flight dedupe 済、/odds-proxy は edge cache 15s なので常時発火で安全。
  try {
    _kickOffLiveOddsRefresh(sid, rn);
  } catch (_) {}
}

// globalThis export (REST_ONLY)
globalThis.openRace = openRace;
