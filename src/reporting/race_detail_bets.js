// Phase 2 完遂続編 (Clearwing): race detail #detailPrediction 内「買い目」セクション。
// race_detail_prediction.js から内部分割 (400 行制限)。
// 確率順 / フォーメーション / BOX + 穴予想 + 着順内訳を含む。
// REST_ONLY。
// 呼出: html = _renderRaceDetailBets({sid, rn, race, pred, progPred, hasRealPreview, raceOdds})
//   呼出側で predHtml += <返り値> する形。

'use strict';

function _renderRaceDetailBets(ctx) {
  var sid = ctx.sid,
    rn = ctx.rn,
    race = ctx.race;
  var pred = ctx.pred,
    progPred = ctx.progPred;
  var hasRealPreview = ctx.hasRealPreview,
    raceOdds = ctx.raceOdds;
  var predHtml = '';

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

  return predHtml;
}

globalThis._renderRaceDetailBets = _renderRaceDetailBets;
