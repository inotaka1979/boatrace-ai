// Phase 2 完遂続き (Clearwing patterns): src/analysis/l2_features.js
//
// Analysis 層: Layer 2 (logistic regression) の特徴量生成 / 予測 / 学習、および
// scoreBoatV2 が呼び出す pure 補助関数群。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:ANALYSIS_L2_FEATURES:START */ ... /* BUILD:ANALYSIS_L2_FEATURES:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS に登録 (l2Predict はレース
// 詳細 / 学習 / 設定画面のみで呼ばれる)。
//
// 注: worker_predictor.js にも _resolveCourse / getL2Features / l2Predict /
//     l2Update の twin がある (Web Worker context)。本ファイルの編集後は
//     worker_predictor.js 側も同期する必要があるか確認すること
//     (現状: scoreBoatV2 の依存補助のため main thread 用、worker copy 独立)。
//
// 依存 (canonical assets/app.js の top-level state / 定数 / 関数):
//   CLASS_NAME (Phase 2 で freeze 済) / getStadiumCourseWinRate / getRacerCourseStyle /
//   getRacerCourseWinRate / motorScoreNormalized / exhibitionZScore /
//   pf / safeDiv / softmax / safeSet / _normalizeFeatures / _updateFeatureStats /
//   l2weights / l2trainStep / _featureStats / L2_BIAS / L2_LR0 / L2_LR_TAU /
//   L2_LAMBDA / FEATURE_DIM / COURSE_LOG_PRIOR / TUNING / racerDB / stadiumDB
//
// Public (globalThis に export):
//   _computeClassAttenuation / _classCourseMult / _computeRaceScenario / _resolveCourse
//   getL2Features / l2Predict / l2Update

'use strict';

function _computeClassAttenuation(allBoats) {
  if (!Array.isArray(allBoats) || !allBoats.length) return 1.0;
  var avgClass = 0;
  allBoats.forEach(function (b) {
    avgClass += (b && b.racer_class_number) || 3;
  });
  avgClass /= allBoats.length;
  if (avgClass >= 3.5) return 0.55;
  if (avgClass >= 3.0) return 0.7;
  if (avgClass >= 2.5) return 0.85;
  return 1.0;
}
function _classCourseMult(classNum, course) {
  var c = classNum || 3,
    k = course || 3;
  if (c < 1) c = 1;
  if (c > 4) c = 4;
  if (k < 1) k = 1;
  if (k > 6) k = 6;
  return CLASS_COURSE_MULT[k - 1][c - 1];
}
function _computeRaceScenario(allBoats, allPreviews, sid, raceHour) {
  if (!Array.isArray(allBoats)) return null;
  var attackProbs = [0, 0, 0, 0, 0, 0, 0]; // index 1..6
  for (var c = 2; c <= 6; c++) {
    var bt = allBoats.find(function (b) {
      return b.racer_boat_number === c;
    });
    if (!bt) {
      attackProbs[c] = 0.1;
      continue;
    }
    var rid = bt.racer_number || 0;
    var style = getRacerCourseStyle(rid, c) || DEFAULT_COURSE_TECHNIQUE[c];
    if (!style) {
      attackProbs[c] = 0.08;
      continue;
    }
    var total =
      (style.nige || 0) +
      (style.sashi || 0) +
      (style.makuri || 0) +
      (style.makuriSashi || 0) +
      (style.nuki || 0) +
      (style.megumare || 0);
    if (total < 3) {
      attackProbs[c] = 0.08;
      continue;
    }
    var sashiRate = (style.sashi || 0) / total;
    var makuriComboRate = ((style.makuri || 0) + (style.makuriSashi || 0)) / total;
    var threat =
      c === 2
        ? sashiRate * 0.7 + makuriComboRate * 0.4
        : c === 3
          ? makuriComboRate * 0.6 + sashiRate * 0.3
          : makuriComboRate * 0.5; // 4-6コースは外側まくりが主脅威
    if (threat < 0.02) threat = 0.02;
    if (threat > 0.55) threat = 0.55;
    attackProbs[c] = threat;
  }
  // P1-A5: 潮汐×まくり相互作用（プロ B-02）。
  //   既存 TIDE_COURSE_BIAS は score 加算（コース別係数）と独立し、attack_probs を
  //   乗算で調整。満潮は流れが内側強で外側まくりが届きにくく、干潮で逆。
  //   1コース有利／不利の方向は TIDE_COURSE_BIAS が既定（場別キャリブレーション済）、
  //   ここは「外側 4-6 のまくり成功率」だけを補正することで二重カウントを避ける。
  if (sid != null && raceHour != null && typeof tideData !== 'undefined' && tideData && tideData.stadiums) {
    var tideEntry = tideData.stadiums[String(sid)];
    if (tideEntry && typeof classifyTidePhase === 'function') {
      var phase = classifyTidePhase(tideEntry, raceHour);
      // 4-6 外側まくり攻撃の成功率調整（最大 ±15%）
      var outsideMakuriFactor = phase === 'high' ? 0.85 : phase === 'low' ? 1.15 : 1.0;
      if (outsideMakuriFactor !== 1.0) {
        for (var k = 4; k <= 6; k++) {
          attackProbs[k] *= outsideMakuriFactor;
          if (attackProbs[k] < 0.02) attackProbs[k] = 0.02;
          if (attackProbs[k] > 0.55) attackProbs[k] = 0.55;
        }
      }
    }
  }
  var nigeSuccess = 1;
  for (var i = 2; i <= 6; i++) nigeSuccess *= 1 - attackProbs[i];
  if (nigeSuccess < 0.02) nigeSuccess = 0.02;
  if (nigeSuccess > 0.95) nigeSuccess = 0.95;
  return { nigeSuccess: nigeSuccess, attackProbs: attackProbs };
}
function _resolveCourse(boat, preview, predictedEntries) {
  var bn = boat.racer_boat_number;
  if (preview && preview.racer_course_number != null) {
    return { course: preview.racer_course_number, entryConf: 1.0, source: 'preview' };
  }
  if (predictedEntries && predictedEntries.byBoat && predictedEntries.byBoat[bn]) {
    return {
      course: predictedEntries.byBoat[bn],
      entryConf: predictedEntries.conf[bn] || 0.5,
      source: 'predicted',
    };
  }
  return { course: preview ? preview.racer_boat_number : bn, entryConf: 1.0, source: 'frame' };
}
function getL2Features(boat, preview, weather, etRank, stRank, sid) {
  var course =
    preview && preview.racer_course_number != null
      ? preview.racer_course_number
      : preview
        ? preview.racer_boat_number
        : boat.racer_boat_number;
  var rid = boat.racer_number || 0;
  var racerCWR = getRacerCourseWinRate(rid, course);
  var stadCWR = getStadiumCourseWinRate(String(sid), course);
  var myPv = preview || {};
  var st = myPv.racer_start_timing != null ? pf(myPv.racer_start_timing) : 99;
  var tilt = pf(myPv.racer_tilt_adjustment);

  var windCourse = 0;
  if (weather) {
    var ws = weather.wind_speed || weather.race_wind || 0;
    var wd = weather.wind_direction || weather.race_wind_direction_number || 0;
    var isHead = wd >= 7 && wd <= 11;
    if (isHead && course === 1) windCourse = -ws / 10;
    else if (isHead && course >= 4) windCourse = ws / 20;
  }

  var etComp = 0;
  if (etRank <= 1 && st > 0 && st <= 0.1) etComp = 1;
  else if (etRank >= 4 && st >= 0.15) etComp = -1;

  var formScore = 0;
  var form = getRacerForm(rid);
  if (form) formScore = form.score / 10;

  var tiltAlign = 0;
  if (course <= 2 && tilt <= -0.5) tiltAlign = 1;
  else if (course >= 4 && tilt >= 0.5) tiltAlign = 1;
  else if ((course <= 2 && tilt >= 0.5) || (course >= 4 && tilt <= -0.5)) tiltAlign = -1;

  return [
    pf(boat.racer_national_top_1_percent) / 10,
    pf(boat.racer_assigned_motor_top_2_percent) / 100,
    (etRank + 1) / 6,
    course / 6,
    (boat.racer_class_number || 3) / 4,
    windCourse,
    racerCWR || pf(boat.racer_national_top_1_percent) / 100,
    (stRank + 1) / 6,
    etComp,
    formScore,
    tiltAlign,
    stadCWR,
  ];
}
function l2Predict(features6) {
  // PF-5: ホットパス最適化 — for ループ + 一時配列削減
  //   従来: map で new array x2 + closure 6 回 = ~12 オブジェクト生成
  //   新版: for で in-place 計算、logits 配列のみ生成 = ~1 オブジェクト
  var enableZ = TUNING.PREDICTION.ENABLE_ZSCORE;
  var warmupOk = enableZ && _featureStats.n >= TUNING.PREDICTION.ZSCORE_WARMUP_N;
  var w = l2weights;
  var wlen = w.length;
  var prior = COURSE_LOG_PRIOR;
  var bias = L2_BIAS;
  var logits = new Array(6);
  for (var b = 0; b < 6; b++) {
    var feat = features6[b];
    if (warmupOk) feat = _normalizeFeatures(feat);
    var z = bias + (prior[b] || 0);
    for (var i = 0; i < wlen; i++) {
      var fi = feat[i];
      if (fi) z += fi * (w[i] || 0); // PF-5: 0 値は早期 skip（ホットループ短縮）
    }
    logits[b] = z;
  }
  return softmax(logits);
}
function l2Update(features6, winnerIdx) {
  var probs = l2Predict(features6);
  // PB-2: LR を t で減衰、L2 正則化を加算
  var lr = L2_LR0 / (1 + l2trainStep / L2_LR_TAU);
  for (var b = 0; b < 6; b++) {
    var target = b === winnerIdx ? 1 : 0;
    var err = probs[b] - target;
    for (var i = 0; i < l2weights.length; i++) {
      var grad = err * (features6[b][i] || 0) + L2_LAMBDA * l2weights[i];
      l2weights[i] -= lr * grad;
    }
    // PB-7: 各艇の特徴量を rolling 統計に追加
    _updateFeatureStats(features6[b]);
  }
  l2trainStep += 1;
  safeSet('boatrace_weights', l2weights); // P3 L-05
  safeSet('boatrace_trainstep', l2trainStep); // PB-2
  // PB-7: rolling stats を永続化（毎回 save は重いので 50 step に 1 回）
  if (l2trainStep % 50 === 0) safeSet('boatrace_featurestats', _featureStats);
}

// globalThis export (REST_ONLY)
globalThis._computeClassAttenuation = _computeClassAttenuation;
globalThis._classCourseMult = _classCourseMult;
globalThis._computeRaceScenario = _computeRaceScenario;
globalThis._resolveCourse = _resolveCourse;
globalThis.getL2Features = getL2Features;
globalThis.l2Predict = l2Predict;
globalThis.l2Update = l2Update;
