// Phase 2 完遂 (Clearwing patterns 拡張): src/analysis/score_boat.js
//
// Analysis 層: 副作用ありの計算・予測。1 艇分の総合スコア (8 カテゴリ A〜H) を
// 計算する核関数。Layer 1 ルールベース予測の本体。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:ANALYSIS_SCORE_BOAT:START */ ... /* BUILD:ANALYSIS_SCORE_BOAT:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS にも登録済 → critical bundle
// には載らない (起動時に scoreBoatV2 は不要、レース詳細を開いた時のみ呼ばれる)。
//
// 依存 (約 20 個の app.js 内 helper / state):
//   _resolveCourse / _computeClassAttenuation / _classCourseMult
//   _computeRaceScenario / getStadiumCourseWinRate / getRacerCourseWinRate
//   getRacerCourseStyle / getRacerForm / motorScoreNormalized / pf / pairwiseScore
//   selfStyleScore / seriesAdjustmentScore / exhibitionZScore / isHeadWind / isTailWind
//   STADIUMS / COURSE_WIN_RATE / COURSE_MULTIPLIER / DEFAULT_COURSE_TECHNIQUE / ...
// これらは canonical assets/app.js の top-level 宣言なので globalThis 経由で
// runtime に届く。Phase 4 JSDoc strict 対象外 (jsconfig.json include に含めない)。
//
// 単一 export: scoreBoatV2 — globalThis 経由で他 module / app.js から参照される。

'use strict';

function scoreBoatV2(boat, preview, weather, allBoats, allPreviews, sid, predictedEntries) {
  var score = 0;
  var reasons = [];
  var risks = [];
  var bn = boat.racer_boat_number;
  // PC-2b: 進入コース解決を _resolveCourse に委譲
  var resolved = _resolveCourse(boat, preview, predictedEntries);
  var course = resolved.course;
  var entryConf = resolved.entryConf;
  if (resolved.source === 'predicted' && course !== bn && entryConf >= 0.6) {
    reasons.push('進入予想: ' + bn + '枠→' + course + 'コース(' + (entryConf * 100).toFixed(0) + '%)');
  }
  var rid = boat.racer_number || 0;

  var scwr = getStadiumCourseWinRate(String(sid), course);
  var baseCoursePt = scwr * COURSE_MULTIPLIER;

  // PC-2b: 階級減衰係数を _computeClassAttenuation に委譲
  var attn = _computeClassAttenuation(allBoats);
  // P0-1: 自艇の class × course の相互作用係数を追加（A1の1コースとB2の1コースを区別）
  var classCM = _classCourseMult(boat.racer_class_number, course);
  var coursePt;
  // P1-A2: 進入予想の二値判定をやめ、entryConf による加重平均化
  //   予想コースと枠コースの coursePt を信頼度で smooth に補間。
  //   データ蓄積に応じて段階的に予想を反映できる（旧: 0.6閾値で binary 切替）
  if (resolved.source === 'predicted' && course !== bn && entryConf > 0 && entryConf < 1) {
    var scwrFrame = getStadiumCourseWinRate(String(sid), bn);
    var classCMFrame = _classCourseMult(boat.racer_class_number, bn);
    var ptPred = scwr * COURSE_MULTIPLIER * attn * classCM;
    var ptFrame = scwrFrame * COURSE_MULTIPLIER * attn * classCMFrame;
    coursePt = ptPred * entryConf + ptFrame * (1 - entryConf);
  } else {
    coursePt = baseCoursePt * attn * classCM;
  }
  score += coursePt;

  // P0-2 + P1-A5: 1コースのみ「レース全体の逃げ成功確率」を log_odds 換算で加算。
  //   sid と raceHour（programData 経由で取得試行）を渡し、潮汐補正も活かす。
  if (course === 1 && allBoats) {
    var _rh = null;
    try {
      if (typeof programData !== 'undefined' && programData && programData[String(sid)]) {
        var _races = programData[String(sid)];
        var _firstKey = Object.keys(_races)[0];
        var _ca = _firstKey ? _races[_firstKey].race_closed_at || '' : '';
        if (_ca) {
          var _hh = _ca.split(' ')[1] || '';
          if (_hh) _rh = parseInt(_hh.split(':')[0], 10);
        }
      }
    } catch (_) {}
    var sc = _computeRaceScenario(allBoats, allPreviews, sid, _rh);
    if (sc && Number.isFinite(sc.nigeSuccess)) {
      var lodd = Math.log(sc.nigeSuccess / (1 - sc.nigeSuccess));
      score += lodd * 4;
      if (sc.nigeSuccess >= 0.65) reasons.push('逃げ成功率推定 ' + Math.round(sc.nigeSuccess * 100) + '%');
      else if (sc.nigeSuccess <= 0.35) risks.push('逃げ阻止リスク(' + Math.round((1 - sc.nigeSuccess) * 100) + '%)');
    }
  }

  if (preview && preview.racer_course_number != null) {
    if (bn > course) {
      score += 3;
      reasons.push('前付け成功(' + bn + '→' + course + 'コース)');
    } else if (bn < course) {
      score -= 2;
      risks.push('押し出され(' + bn + '→' + course + 'コース)');
    }
  }
  if (course === 1) reasons.push(course + 'コース(場勝率' + Math.round(scwr * 100) + '%)');

  var racerCWR = getRacerCourseWinRate(rid, course);
  if (racerCWR !== null) {
    score += racerCWR * 25;
    var rdb = racerDB[rid];
    if (rdb && rdb.courseStats && rdb.courseStats[course]) {
      var cs = rdb.courseStats[course];
      score += (cs.top3 / cs.races) * 0.08 * 100;
      if (racerCWR > 0.5 && course <= 2) reasons.push('コース別1着率' + Math.round(racerCWR * 100) + '%');
    }
  } else {
    var wr = pf(boat.racer_national_top_1_percent);
    score += wr * 2.5;
    var lr = pf(boat.racer_local_top_2_percent);
    score += lr * 0.15;
  }
  // F13: 自分のコース別決まり手プロファイル
  var selfStyle = selfStyleScore(rid, course);
  if (selfStyle.score !== 0) {
    score += selfStyle.score;
    if (selfStyle.reason) reasons.push(selfStyle.reason);
    if (selfStyle.risk) risks.push(selfStyle.risk);
  }
  var classBonus = { 1: 6, 2: 3, 3: 0, 4: -3 };
  score += classBonus[boat.racer_class_number] || 0;

  if (allPreviews && allPreviews.boats) {
    for (var ci = 1; ci <= 6; ci++) {
      if (ci === bn) continue;
      var cpv = allPreviews.boats[String(ci)];
      var cCourse = cpv && cpv.racer_course_number != null ? cpv.racer_course_number : ci;
      var cBoat = allBoats.find(function (b) {
        return b.racer_boat_number === ci;
      });
      if (!cBoat) continue;
      var cRid = cBoat.racer_number || 0;
      var style = getRacerCourseStyle(cRid, cCourse);
      if (!style) {
        style = DEFAULT_COURSE_TECHNIQUE[cCourse];
      }
      if (!style) continue;
      var total = style.nige + style.sashi + style.makuri + style.makuriSashi + style.nuki + (style.megumare || 0);
      if (total < 3) continue;
      var sashiRate = style.sashi / total;
      var makuriRate = style.makuri / total;
      var makuriSashiRate = style.makuriSashi / total;

      if (cCourse === 2 && course === 1) {
        if (sashiRate > 0.5) {
          score += 3;
          reasons.push('2コース差し主体→逃げ残りやすい');
        } else if (makuriRate > 0.3) {
          score -= 5;
          risks.push('2コースまくり傾向(脅威)');
        }
      }
      if (cCourse === 3) {
        if (course === 1 && makuriRate > 0.3) {
          score -= 3;
          risks.push('3コースまくり傾向');
        }
        if (course === 2 && makuriSashiRate > 0.3) {
          score -= 4;
        }
        if (course === 1 && sashiRate > 0.4) score += 2;
      }
      if (cCourse === 4 && makuriRate > 0.3) {
        if (course <= 3) score -= 3;
      }
      if (cCourse >= 5 && makuriRate > 0.4) {
        if (course <= 2) score -= 2;
      }
    }
  }

  // X2 R-05: 場別 z-score でモーター評価（フォールバック付き）
  var motorRate = pf(boat.racer_assigned_motor_top_2_percent);
  var motorEval = motorScoreNormalized(motorRate, sid);
  score += motorEval.score;
  var motorLabel = motorEval.label;
  var motorEmoji = motorEval.emoji;
  if (motorEval.label === '超抜')
    reasons.push('超抜モーター(' + motorRate + '%' + (motorEval.z != null ? ' z=' + motorEval.z.toFixed(1) : '') + ')');
  else if (motorEval.label === '整備要') risks.push('モーター不調(' + motorRate + '%)');
  var boatRate = pf(boat.racer_assigned_boat_top_2_percent);
  score += boatRate * 0.08;

  var etRank = 5,
    etTime = 99;
  if (allPreviews && allPreviews.boats) {
    var times = [];
    for (var ei = 1; ei <= 6; ei++) {
      var epv = allPreviews.boats[String(ei)];
      var etime =
        epv && epv.racer_exhibition_time != null && epv.racer_exhibition_time > 0 ? pf(epv.racer_exhibition_time) : 99;
      times.push({ boat: ei, time: etime });
    }
    times.sort(function (a, b) {
      return a.time - b.time;
    });
    etRank = times.findIndex(function (t) {
      return t.boat === bn;
    });
    var myPv = allPreviews.boats[String(bn)];
    etTime = myPv ? pf(myPv.racer_exhibition_time) : 99;
    var bestTime = times[0].time;

    var decay = ET_COURSE_DECAY[course] || 1;
    var etBonus = 0;
    if (etRank === 0) etBonus = 6;
    else if (etRank === 1) etBonus = 4;
    else if (etRank === 2) etBonus = 2;
    else if (etRank >= 4) {
      var diff = etTime - bestTime;
      if (diff >= 0.08) etBonus = -5;
      else if (diff >= 0.03) etBonus = -Math.round(diff * 60);
    }
    score += etBonus * decay;
    if (etRank === 0) reasons.push('展示タイム最速(' + etTime + 's)');
    // X2 R-06: 展示タイム場別 z-score 補助（速いほど負 → +スコア）
    var ezAux = exhibitionZScore(etTime, sid);
    if (ezAux !== 0) score += -ezAux * 2 * decay;
    if (ezAux <= -1.0) reasons.push('展示タイム場相対的に超速(z=' + ezAux.toFixed(1) + ')');

    if (myPv && myPv.racer_start_timing != null) {
      var st = pf(myPv.racer_start_timing);
      // X2 R-08: 絶対値判定 + 個人平均との乖離（max を取る）
      var absScore = st < 0 ? -6 : st <= 0.05 ? 4 : st <= 0.1 ? 2 : st >= 0.2 ? -2 : 0;
      var perScore = stDivergenceScore(st, rid, course);
      var stScore = Math.max(absScore, perScore);
      score += stScore;
      if (stScore >= 4) reasons.push('ST鋭い(' + st + 's)');
      else if (stScore <= -2 && st > 0) risks.push('ST出遅れ(' + st + 's)');
      else if (st < 0) risks.push('Fスタート気味(' + st + 's)');

      if (etRank <= 1 && st > 0 && st <= 0.1) score += 3;
      else if (etRank <= 1 && st > 0.15) score += 1;
      else if (etRank >= 4 && st > 0 && st <= 0.1) score += 1;
      else if (etRank >= 4 && st >= 0.15) score -= 3;

      var tilt = pf(myPv.racer_tilt_adjustment);
      if (course <= 2 && tilt <= -0.5) score += 2;
      else if (course >= 4 && tilt >= 0.5) score += 2;
      else if (course <= 2 && tilt >= 0.5) score -= 1;
      else if (course >= 4 && tilt <= -0.5) score -= 1;

      // F12: 調整重量（規定体重未達の重り）
      // > 0 で重い荷物 → ボート加速悪化、特にアウトコースで影響大
      var adjW = pf(myPv.racer_adjust_weight);
      if (adjW >= 1.0) {
        if (course >= 4) {
          score -= 3;
          risks.push('調整重量+' + adjW.toFixed(1) + 'kg(アウト不利)');
        } else {
          score -= 1;
          risks.push('調整重量+' + adjW.toFixed(1) + 'kg');
        }
      } else if (adjW >= 0.5) {
        if (course >= 4) score -= 1;
      }

      // F12: 部品交換（ペラ調整等）
      // 当たれば +、外せば - で読みにくい → 既存スコアには加減せず情報のみ表示
      // ただし「ペラ」交換はモーター不調シグナルとしてマイルドな - を付与
      var partsTxt = String(myPv.racer_parts_replaced || '');
      if (partsTxt.indexOf('ペラ') >= 0) {
        score -= 1;
        risks.push('レース直前ペラ交換(' + escText(partsTxt) + ')');
      } else if (partsTxt) {
        // ペラ以外の部品交換 → 整備内容を reasons に表示のみ
        reasons.push('整備実施: ' + escText(partsTxt));
      }
    }

    if (boat.racer_class_number === 1 && etRank >= 4) {
      score -= 4;
      risks.push('A1だが展示下位(モーター不安)');
    }
    if ((boat.racer_class_number === 3 || boat.racer_class_number === 4) && etRank === 0) {
      score += 3;
      reasons.push('好モーター発見(展示1位)');
    }

    if (weather) {
      var wt = weather.water_temperature || weather.race_water_temperature || 20;
      if (wt <= 15) score += etBonus * 0.2 * decay;
      else if (wt >= 25) score -= etBonus * 0.2 * decay;
    }
  }

  if (weather) {
    var ws = weather.wind_speed || weather.race_wind || 0;
    var wd = weather.wind_direction || weather.race_wind_direction_number || 0;
    // X4 R-10: 場別風向プロファイルを使用
    var isHead = isHeadWind(wd, sid);
    var isTail = isTailWind(wd, sid);
    if (isHead && ws >= 5) {
      if (course === 1) {
        score -= 8;
        risks.push('向かい風' + ws + 'm(イン不利)');
      } else if (course === 2) score -= 3;
      else if (course >= 4) score += 4;
    } else if (isHead && ws >= 3) {
      if (course === 1) score -= 4;
      if (course >= 4) score += 2;
    }
    if (isTail && ws >= 3) {
      if (course === 1) {
        score += 4;
        reasons.push('追い風' + ws + 'm(イン有利)');
      }
      if (course >= 4) score -= 2;
    }
    var wh = weather.wave_height || weather.race_wave || 0;
    if (wh >= 7 && course <= 2) {
      score -= 4;
      risks.push('波高' + wh + 'cm(荒れ模様)');
    } else if (wh >= 4 && course <= 2) score -= 2;
    // X4 R-14: 風×波交差項
    var stormDelta = stormBonus(ws, wh, course);
    if (stormDelta !== 0) {
      score += stormDelta;
      if (stormDelta <= -4) risks.push('荒天交差項' + stormDelta);
      else if (stormDelta >= 4) reasons.push('荒れ展開で恩恵+' + stormDelta);
    }
  }
  // X4 R-02: 潮汐補正（海水場のみ、preview から race_closed_at の時刻を取得）
  if (preview && preview.race_closed_at) {
    try {
      var hour = parseInt(String(preview.race_closed_at).split(' ')[1].split(':')[0], 10);
      var tideDelta = tideScore(sid, course, hour);
      if (tideDelta !== 0) {
        score += tideDelta;
        if (tideDelta >= 4) reasons.push('潮位がコース有利(+' + tideDelta + ')');
        else if (tideDelta <= -4) risks.push('潮位不利(' + tideDelta + ')');
      }
    } catch (_) {}
  }

  // X6 R-07/R-13: 節間調整スコア + モーター急変警告
  var seriesAdj = seriesAdjustmentScore(rid, sid);
  if (seriesAdj.score !== 0) {
    score += seriesAdj.score;
    if (seriesAdj.score >= 3) reasons.push('節間モーター上昇中(slope+' + seriesAdj.slope.toFixed(1) + ')');
    else if (seriesAdj.score <= -3) risks.push('節間モーター下降中(slope' + seriesAdj.slope.toFixed(1) + ')');
  }
  // X6 R-09: 対戦相性
  if (allBoats && allBoats.length > 0) {
    var oppRids = allBoats
      .map(function (b) {
        return b.racer_number;
      })
      .filter(function (o) {
        return o && o !== rid;
      });
    var pair = pairwiseScore(rid, sid, oppRids);
    if (Math.abs(pair.score) >= 0.5) {
      score += pair.score;
      if (pair.score >= 1) reasons.push('対戦相性◎(+' + pair.score.toFixed(1) + ', ' + pair.hits + '件)');
      else if (pair.score <= -1) risks.push('対戦相性×(' + pair.score.toFixed(1) + ', ' + pair.hits + '件)');
    }
  }

  var fc = boat.racer_flying_count || 0; // P3 L-02: 自己参照typo修正
  var lc = boat.racer_late_start_count_in_current_term || boat.racer_late_count || 0;
  if (fc >= 2) {
    score -= 25;
    risks.push('F2持ち');
  } else if (fc >= 1) {
    score -= 15;
    risks.push('F1持ち');
  }
  if (lc >= 1) score -= 5;

  var form = getRacerForm(rid);
  if (form) {
    score += form.score;
    if (form.avg <= 2.5) reasons.push('好調(直近5R平均' + form.avg.toFixed(1) + '着)');
    if (form.avg >= 4.0) risks.push('不調(直近5R平均' + form.avg.toFixed(1) + '着)');
    if (form.trend > 0.5) reasons.push('上り調子');
    if (form.trend < -0.5) risks.push('下り調子');
  }

  return {
    boat: bn,
    score: Math.max(0, score),
    course: course,
    etRank: etRank,
    etTime: etTime,
    reasons: reasons,
    risks: risks,
    motorLabel: motorLabel,
    motorEmoji: motorEmoji,
    motorRate: motorRate,
    boatRate: boatRate,
    form: form,
    classNum: boat.racer_class_number,
    fc: fc,
    lc: lc, // P1-A4: F/L 確率乗数で使用
  };
}

// globalThis export (REST_ONLY bundle なので app-rest.js IIFE 内で globalThis.scoreBoatV2 を提供)
globalThis.scoreBoatV2 = scoreBoatV2;
