// Phase 2 完遂続き (Clearwing patterns): src/analysis/predict_race.js
//
// Analysis 層: BoatRace Oracle の予想エンジン本体。番組予想 (predictRaceProgram)
// と直前予想 (predictRace) の二段、および Web Worker 経由の非同期版 (predictRaceAsync)。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:ANALYSIS_PREDICT_RACE:START */ ... /* BUILD:ANALYSIS_PREDICT_RACE:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS に登録 (レース詳細を開いた
// 時のみ呼ばれるため critical 入りを避ける)。
//
// 依存 (canonical assets/app.js の top-level state / 定数 / 関数):
//   programData / previewData / resultData / racerDB / stadiumDB / TUNING /
//   scoreBoatV2 (REST_ONLY src/analysis/score_boat.js) /
//   predictWithScenarios / predictEntryCourses (src/analysis/predict_scenarios.js) /
//   _applyPlattCalibration / _stackedPredict (src/analysis/calibration.js) /
//   l2Predict / _featureKeysFor / softmax / safeDiv (utils + app.js) /
//   Plackett-Luce / _runIdleTask / _getAppWorker / _syncWorkerState (worker 連携)
//
// Public (globalThis に export):
//   predictRace / predictRaceAsync / predictRaceProgram

'use strict';

function predictRaceAsync(sid, raceNum) {
  var w = _getAppWorker();
  if (!w) {
    // Worker 不可時は main thread fallback
    return Promise.resolve(predictRace(sid, raceNum));
  }
  var reqId = ++_appWorkerReqId;
  return new Promise(function (resolve, reject) {
    _appWorkerCallbacks.set(reqId, function (msg) {
      if (msg.type === 'predict_done') resolve(msg.result);
      else if (msg.type === 'error') {
        console.warn('[PG-4] worker predict error:', msg.error, msg.stack);
        // フォールバック: main thread 実行
        try {
          resolve(predictRace(sid, raceNum));
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error('unexpected worker message: ' + JSON.stringify(msg).slice(0, 200)));
      }
    });
    w.postMessage({
      type: 'predict',
      reqId: reqId,
      input: {
        sid: sid,
        raceNum: raceNum,
        // state を毎回送るのは重いので省略、init/sync_state で同期済み前提
      },
    });
  });
}

function predictRace(sid, raceNum) {
  if (!programData) return null;
  var stadiumProg = programData[String(sid)];
  if (!stadiumProg) return null;
  var race = stadiumProg[String(raceNum)];
  if (!race || !race.boats) return null;

  var preview = null,
    weather = null;
  if (previewData && previewData[String(sid)] && previewData[String(sid)][String(raceNum)]) {
    preview = previewData[String(sid)][String(raceNum)];
    weather = preview.weather || preview;
  }

  var boats = race.boats;
  if (!Array.isArray(boats)) return null;

  // X3: preview の進入が無ければ予測を使う
  var predictedEntries = null;
  if (
    !preview ||
    !preview.boats ||
    Object.keys(preview.boats).every(function (k) {
      return preview.boats[k].racer_course_number == null;
    })
  ) {
    predictedEntries = predictEntryCourses(boats, sid);
  }
  var l1scores = [];
  boats.forEach(function (b) {
    var pv = preview && preview.boats ? preview.boats[String(b.racer_boat_number)] : null;
    var s = scoreBoatV2(b, pv, weather, boats, preview, sid, predictedEntries, raceNum);
    l1scores.push(s);
  });

  var l1total = l1scores.reduce(function (a, s) {
    return a + Math.exp(s.score / 15);
  }, 0);
  var l1probs = l1scores.map(function (s) {
    return Math.exp(s.score / 15) / l1total;
  });

  var stRanks = [];
  if (preview && preview.boats) {
    var sts = [];
    for (var si = 1; si <= 6; si++) {
      var spv = preview.boats[String(si)];
      var stVal = spv && spv.racer_start_timing != null ? pf(spv.racer_start_timing) : 99;
      sts.push({ boat: si, st: stVal });
    }
    sts.sort(function (a, b) {
      return a.st - b.st;
    });
    for (var sr = 0; sr < sts.length; sr++) stRanks[sts[sr].boat] = sr;
  }

  var features6 = boats.map(function (b) {
    var pv = preview && preview.boats ? preview.boats[String(b.racer_boat_number)] : null;
    var l1s = l1scores.find(function (s) {
      return s.boat === b.racer_boat_number;
    });
    return getL2Features(b, pv, weather, l1s ? l1s.etRank : 5, stRanks[b.racer_boat_number] || 5, sid);
  });
  var l2probs = l2Predict(features6);

  // Tier 3 (2026-05-24): GBDT 第 3 層の blend (model が placeholder なら no-op)
  //   _blendGBDTPrediction は ENABLE_GBDT + n_train >= GBDT_MIN_TRAIN を内部で check
  //   結果は logit 空間で blend されるため、ここでは softmax 適用前の確率を一度
  //   logit 化してから blend → softmax で再正規化する。
  if (typeof _blendGBDTPrediction === 'function' && typeof TUNING !== 'undefined'
        && TUNING.PREDICTION && TUNING.PREDICTION.ENABLE_GBDT) {
    try {
      var l2logits = l2probs.map(function (p) {
        var clipped = Math.min(0.9999, Math.max(0.0001, p));
        return Math.log(clipped / (1 - clipped));
      });
      var blended = _blendGBDTPrediction(l2logits, features6, TUNING.PREDICTION.GBDT_BLEND_WEIGHT);
      if (Array.isArray(blended) && blended.length === l2probs.length) {
        // softmax で再正規化 (Σ=1)
        var maxL = -Infinity;
        for (var bi = 0; bi < blended.length; bi++) if (blended[bi] > maxL) maxL = blended[bi];
        var sumE = 0;
        var expL = blended.map(function (l) { var e = Math.exp(l - maxL); sumE += e; return e; });
        if (sumE > 0) l2probs = expL.map(function (e) { return e / sumE; });
      }
    } catch (e) {
      // GBDT 失敗は致命にしない (L1+L2 のみで続行)
    }
  }

  // PB-8: Bayesian shrinkage で L1/L2 融合比を連続化
  //       α = N0 / (N0 + n)  ─ n が 0 なら α=1（L1 のみ）、n→∞ で α→0（L2 のみ）
  //       N0=300 は「L1 を 300 サンプル相当として信用する」事前
  var dbSize = Object.keys(racerDB).length;
  var alpha = 300 / (300 + dbSize);
  var beta = 1 - alpha;

  var finalProbs = boats.map(function (b, i) {
    var l1s = l1scores.find(function (s) {
      return s.boat === b.racer_boat_number;
    });
    var idx = boats.indexOf(b);
    var fp = alpha * l1probs[idx] + beta * l2probs[idx];
    return {
      boat: b.racer_boat_number,
      prob: fp,
      score: l1s.score,
      course: l1s.course,
      etRank: l1s.etRank,
      etTime: l1s.etTime,
      reasons: l1s.reasons,
      risks: l1s.risks,
      motorLabel: l1s.motorLabel,
      motorEmoji: l1s.motorEmoji,
      motorRate: l1s.motorRate,
      boatRate: l1s.boatRate,
      form: l1s.form,
      classNum: l1s.classNum,
    };
  });
  // PB-6: Platt scaling で確率を post-hoc 校正（identity 初期では no-op）
  //       fitting 後は ECE が改善する想定。再正規化で Σp=1 を維持
  finalProbs.forEach(function (p) {
    // 2026-05-24 (Tier 2): _applyCalibration が method (Platt/Isotonic) を自動選択
    //   sid を渡すと場別 Platt が利用可能 (場内 100 サンプル以上ある場合のみ、無ければ global)
    p.prob = (typeof _applyCalibration === 'function')
      ? _applyCalibration(p.prob, sid)
      : _applyPlattCalibration(p.prob, sid);
  });
  // P1-A4: F/L ペナルティを 1着確率乗数として post-hoc 適用
  //   既存の score 減点 (-25/-15/-5) は L1 段階の減衰、本層は確率の心理的補正:
  //   F2 持ちは斡旋停止リスクで 2 着狙いに走り、1 着確率は更に 0.75 倍程度になる経験則。
  //   l1scores から fc/lc を引き、p.prob に乗算（再正規化で Σp=1 を維持）
  finalProbs.forEach(function (p) {
    var l1 = l1scores.find(function (s) {
      return s.boat === p.boat;
    });
    var fc = l1 ? l1.fc || 0 : 0;
    var lc = l1 ? l1.lc || 0 : 0;
    var mult = fc >= 2 ? 0.75 : fc >= 1 ? 0.85 : lc >= 1 ? 0.95 : 1.0;
    p.prob *= mult;
  });
  var _sumCalib = finalProbs.reduce(function (a, p) {
    return a + p.prob;
  }, 0);
  if (_sumCalib > 0 && Math.abs(_sumCalib - 1) > 1e-6) {
    finalProbs.forEach(function (p) {
      p.prob = p.prob / _sumCalib;
    });
  }
  finalProbs.sort(function (a, b) {
    return b.prob - a.prob;
  });

  var marks = finalProbs.map(function (p, i) {
    p.mark = i === 0 ? '◎' : i === 1 ? '○' : i === 2 ? '▲' : i === 3 ? '△' : '×';
    return p;
  });

  var topProb = marks[0].prob;
  var top2Prob = marks[0].prob + marks[1].prob;
  var raceType, typeLabel, typeCls;
  var wh = weather ? weather.wave_height || weather.race_wave || 0 : 0;
  var ws2 = weather ? weather.wind_speed || weather.race_wind || 0 : 0;
  // PC-3: TUNING.RACE_TYPE 集約定数を使用
  var RT = TUNING.RACE_TYPE;
  if (topProb > RT.HONMEI_TOP1_MIN && top2Prob > RT.HONMEI_TOP2_MIN) {
    raceType = 'honmei';
    typeLabel = '本命';
    typeCls = 'type-honmei';
  } else if (topProb < RT.ANA_TOP1_MAX || wh >= RT.ANA_WAVE_HEIGHT_CM || ws2 >= RT.ANA_WIND_SPEED_MS) {
    raceType = 'ana';
    typeLabel = '穴';
    typeCls = 'type-ana';
  } else {
    raceType = 'middle';
    typeLabel = '混戦';
    typeCls = 'type-middle';
  }

  var betCount3 = parseInt(settings.betCount3) || 10;
  var betCount2 = parseInt(settings.betCount2) || 5;
  var method = settings.betMethod || 'auto';
  // X1: EV モード優先（オッズが揃っていれば）
  var evMode = settings.evMode === true || settings.evMode === 'true';
  // P0-3: KPI モードによる race_type 別 evMin/maxBets プリセット（off で従来挙動）
  var kpiMode = settings.kpiMode || 'balanced';
  var TYPE_EVMIN = {
    roi: { honmei: 1.2, middle: 1.25, ana: 1.35 },
    balanced: { honmei: 1.1, middle: 1.15, ana: 1.25 },
    hit: { honmei: 1.0, middle: 1.05, ana: 1.1 },
  };
  var TYPE_MAXBETS = {
    roi: { honmei: 4, middle: 5, ana: 3 },
    balanced: { honmei: 6, middle: 8, ana: 5 },
    hit: { honmei: 10, middle: 12, ana: 8 },
  };
  var defEvMin = parseFloat(settings.evMin) || 1.15;
  var modeEvMin = kpiMode !== 'off' && TYPE_EVMIN[kpiMode] ? TYPE_EVMIN[kpiMode][raceType] : null;
  var modeMaxBets = kpiMode !== 'off' && TYPE_MAXBETS[kpiMode] ? TYPE_MAXBETS[kpiMode][raceType] : null;
  var evOpt = {
    evMin: modeEvMin != null ? modeEvMin : defEvMin,
    maxBets: modeMaxBets != null ? modeMaxBets : betCount3,
    kellyFrac: parseFloat(settings.kellyFrac) || 0.5,
    bankroll: parseInt(settings.bankroll) || 10000,
  };
  // 当該レースのオッズを取得
  var raceOddsForEV = null;
  if (oddsData && oddsData.odds) {
    var found = oddsData.odds.find(function (o) {
      return o.stadium === parseInt(sid) && o.race === parseInt(raceNum);
    });
    if (found) raceOddsForEV = found;
  }
  if (method === 'auto') {
    if (evMode && raceOddsForEV && raceOddsForEV.trifecta) method = 'ev';
    else if (raceType === 'honmei') method = 'prob';
    else if (raceType === 'ana') method = 'box';
    else method = 'formation';
  }

  // X5: シナリオ展開予測（局面別 1-2-3 着分布）
  var grade = race.race_grade_number || 0;
  var scenarioRes = predictWithScenarios(boats, preview, weather, sid, grade);

  var bets = generateBetsV2(marks, method, betCount3, betCount2, raceOddsForEV, evOpt);
  bets.marks = marks;
  bets.evApplied = method === 'ev';
  bets.scenarios = scenarioRes.scenarios; // {nige:0.55, sashi:0.18, ...}
  bets.scenarioDist = scenarioRes.dist; // {"1-2-3": 0.18, ...}
  bets.grade = grade;
  // X1: 単勝オッズ乖離を計算
  if (raceOddsForEV && raceOddsForEV.win) {
    var aiByBoat = [];
    for (var bi = 1; bi <= 6; bi++) {
      var fp = finalProbs.find(function (p) {
        return p.boat === bi;
      });
      aiByBoat.push(fp ? fp.prob : 0);
    }
    bets.divergence = calcOddsDivergence(aiByBoat, raceOddsForEV.win);
  }
  bets.raceType = raceType;
  bets.typeLabel = typeLabel;
  bets.typeCls = typeCls;
  bets.weather = weather;
  bets.method = method;
  bets.features6 = features6;

  var conf = Math.round(topProb * 100);
  bets.confidence = conf;
  bets.confStars = conf >= 40 ? 5 : conf >= 30 ? 4 : conf >= 22 ? 3 : conf >= 15 ? 2 : 1;

  // B14 (2026-05-17): 詳細画面で表示される 🔥穴予想 (高EV chip) を bets.ana に
  //   組込んで savePrediction で履歴追跡できるようにする。EV>=1.0 が無ければ
  //   AI 確率分布の top N (1コース絡み以外) を fallback で入れる。
  bets.ana = (function () {
    var anaTopN = parseInt(settings.betCountAna) || 3;
    if (anaTopN < 1) anaTopN = 1;
    else if (anaTopN > 6) anaTopN = 6;
    var excludeCombos = (bets.trifecta || []).map(function (t) {
      return t.combo;
    });
    if (raceOddsForEV && raceOddsForEV.trifecta && Object.keys(raceOddsForEV.trifecta).length > 0) {
      var anaRes = _pickAnaCandidates(marks, raceOddsForEV.trifecta, {
        minOdds: 30,
        minEV: 1.0,
        minOddsLoose: 15,
        topN: anaTopN,
        excludeCombos: excludeCombos,
      });
      var picks = anaRes.primary.length > 0 ? anaRes.primary : anaRes.fallback;
      return picks.map(function (p) {
        return p.combo;
      });
    }
    // オッズ未取得: AI 確率分布の上位（1着が1番人気でないもの）を穴候補に
    if (marks && marks.length >= 3) {
      var dist = buildTrifectaProbDist(marks);
      var top1Boat = marks[0].boat;
      var excludeSet = {};
      excludeCombos.forEach(function (c) {
        if (c) excludeSet[String(c)] = true;
      });
      var cands = [];
      for (var k in dist) {
        if (!Object.prototype.hasOwnProperty.call(dist, k)) continue;
        if (k.split('-')[0] === String(top1Boat)) continue;
        if (excludeSet[k]) continue;
        cands.push({ combo: k, prob: dist[k] });
      }
      cands.sort(function (a, b) {
        return b.prob - a.prob;
      });
      return cands.slice(0, anaTopN).map(function (c) {
        return c.combo;
      });
    }
    return [];
  })();

  return bets;
}

// globalThis export (REST_ONLY)
globalThis.predictRace = predictRace;
globalThis.predictRaceAsync = predictRaceAsync;
