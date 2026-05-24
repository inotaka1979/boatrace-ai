// Phase 2 完遂続き (Clearwing patterns): src/analysis/predict_program.js
//
// Analysis 層: 番組予想 (展示走行前) のロジック。出走表データだけで予想する
// 朝段階の予想。直前予想 (src/analysis/predict_race.js の predictRace) と
// 分離されている理由:
//   - 番組予想は preview / weather / 展示タイム / ST を持たない
//   - スコア構成が異なる (L1 のみ、L2 はスタート展示を要求するため未使用)
//   - レース時刻が近づくと predictRace が上書きする
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:ANALYSIS_PREDICT_PROGRAM:START */ ... /* BUILD:ANALYSIS_PREDICT_PROGRAM:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS に登録。
//
// 依存 (canonical assets/app.js / src/analysis/score_boat.js):
//   programData / scoreBoatV2 / predictEntryCourses /
//   TUNING / _applyPlattCalibration / 等
//
// Public (globalThis に export):
//   predictRaceProgram

'use strict';

function predictRaceProgram(sid, raceNum) {
  if (!programData) return null;
  var stadiumProg = programData[String(sid)];
  if (!stadiumProg) return null;
  var race = stadiumProg[String(raceNum)];
  if (!race || !race.boats) return null;
  var boats = race.boats;
  if (!Array.isArray(boats)) return null;

  // preview=null, weather=null で scoreBoatV2 を呼ぶ → E(展示)とF(風)がスキップ
  // X3: 出走表段階でも進入予測を効かせる
  var predictedEntries = predictEntryCourses(boats, sid);
  var l1scores = [];
  boats.forEach(function (b) {
    var s = scoreBoatV2(b, null, null, boats, null, sid, predictedEntries);
    l1scores.push(s);
  });

  var l1total = l1scores.reduce(function (a, s) {
    return a + Math.exp(s.score / 15);
  }, 0);
  var l1probs = l1scores.map(function (s) {
    return Math.exp(s.score / 15) / l1total;
  });

  // Layer2（展示なしの特徴量）
  var features6 = boats.map(function (b) {
    var l1s = l1scores.find(function (s) {
      return s.boat === b.racer_boat_number;
    });
    return getL2Features(b, null, null, l1s ? l1s.etRank : 5, 5, sid);
  });
  var l2probs = l2Predict(features6);

  // PB-8: Bayesian shrinkage（番組予想は展示情報なしのため L1 比率高め: N0=600）
  var dbSize = Object.keys(racerDB).length;
  var alpha = 600 / (600 + dbSize);
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
      reasons: l1s.reasons,
      risks: l1s.risks,
      motorLabel: l1s.motorLabel,
      motorEmoji: l1s.motorEmoji,
      motorRate: l1s.motorRate,
      classNum: l1s.classNum,
    };
  });
  // PB-6 + Tier 2: 統一 calibration (Platt/Isotonic auto-select、場別あり)
  finalProbs.forEach(function (p) {
    p.prob = (typeof _applyCalibration === 'function')
      ? _applyCalibration(p.prob, sid)
      : _applyPlattCalibration(p.prob, sid);
  });
  // P1-A4: F/L 1着確率乗数（番組予想にも適用）
  finalProbs.forEach(function (p) {
    var l1 = l1scores.find(function (s) {
      return s.boat === p.boat;
    });
    var fc = l1 ? l1.fc || 0 : 0;
    var lc = l1 ? l1.lc || 0 : 0;
    var mult = fc >= 2 ? 0.75 : fc >= 1 ? 0.85 : lc >= 1 ? 0.95 : 1.0;
    p.prob *= mult;
  });
  var _sum2 = finalProbs.reduce(function (a, p) {
    return a + p.prob;
  }, 0);
  if (_sum2 > 0 && Math.abs(_sum2 - 1) > 1e-6) {
    finalProbs.forEach(function (p) {
      p.prob = p.prob / _sum2;
    });
  }
  finalProbs.sort(function (a, b) {
    return b.prob - a.prob;
  });
  finalProbs.forEach(function (p, i) {
    p.mark = i === 0 ? '◎' : i === 1 ? '○' : i === 2 ? '▲' : i === 3 ? '△' : '×';
  });

  var topProb = finalProbs[0].prob;
  var top2Prob = finalProbs[0].prob + finalProbs[1].prob;
  var raceType, typeLabel;
  // PC-3: TUNING.RACE_TYPE 集約定数を使用（環境補正は呼出側で済んでいる前提）
  var RT2 = TUNING.RACE_TYPE;
  if (topProb > RT2.HONMEI_TOP1_MIN && top2Prob > RT2.HONMEI_TOP2_MIN) {
    raceType = 'honmei';
    typeLabel = '本命';
  } else if (topProb < RT2.ANA_TOP1_MAX) {
    raceType = 'ana';
    typeLabel = '穴';
  } else {
    raceType = 'middle';
    typeLabel = '混戦';
  }

  return { marks: finalProbs, raceType: raceType, typeLabel: typeLabel, confidence: Math.round(topProb * 100) };
}

// globalThis export (REST_ONLY)

globalThis.predictRaceProgram = predictRaceProgram;
