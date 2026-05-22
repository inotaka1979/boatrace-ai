// Phase 2 完遂続編 (Clearwing): race detail #detailPrediction セクション。
// race_detail.js から内部分割 (400 行制限)。番組予想 + 直前予想 + 買い目 + 穴予想。
// REST_ONLY (詳細ページ開いた時のみ)。
// 呼出: _renderRaceDetailPrediction({sid, rn, race, pred, preview, result, popularity, raceOdds})

'use strict';

function _renderRaceDetailPrediction(ctx) {
  var sid = ctx.sid,
    rn = ctx.rn,
    race = ctx.race,
    pred = ctx.pred;
  var preview = ctx.preview,
    result = ctx.result,
    popularity = ctx.popularity,
    raceOdds = ctx.raceOdds;

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

  // ========= 買い目 + 穴予想 → src/reporting/race_detail_bets.js に外出し =========
  predHtml += _renderRaceDetailBets({
    sid: sid,
    rn: rn,
    race: race,
    pred: pred,
    progPred: progPred,
    hasRealPreview: hasRealPreview,
    raceOdds: raceOdds,
  });
  // P2-3: pairwise matchup 表示（pairwiseDB に十分なデータがある対戦のみ TOP3）
  if (typeof _renderPairwiseSummary === 'function' && race && race.boats) {
    var pwHtml = _renderPairwiseSummary(race.boats);
    if (pwHtml) predHtml += pwHtml;
  }
  document.getElementById('detailPrediction').innerHTML = predHtml;
}

globalThis._renderRaceDetailPrediction = _renderRaceDetailPrediction;
