// Phase 2 完遂続き (Clearwing patterns): src/analysis/predict_scenarios.js
//
// Analysis 層: 「シナリオ予想」と「進入予想」のロジック。
//   - predictScenarios / predictWithScenarios : 「逃げ成功 / 差し / まくり」3 シナリオ
//     それぞれの確率を生成し、重み付き合算で最終確率を得る (PB-? 設計)
//   - predictEntryCourses : スタート展示・気象から「枠 → 進入コース」の確率
//     分布を推定 (X3 進入予想、コース変更を扱う)
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:ANALYSIS_PREDICT_SCENARIOS:START */ ... /* BUILD:ANALYSIS_PREDICT_SCENARIOS:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS に登録 (レース詳細を開いた
// 時のみ呼ばれるため critical 入りを避ける)。
//
// 依存 (canonical assets/app.js の top-level):
//   scoreBoatV2 / softmax / safeDiv / _computeRaceScenario / getRacerCourseStyle /
//   getRacerCourseWinRate / racerDB / STADIUMS / DEFAULT_COURSE_TECHNIQUE / pf / pairwise / 等
//
// Public (globalThis に export):
//   predictScenarios / predictWithScenarios / predictEntryCourses

'use strict';

function predictScenarios(boats, preview, weather, sid, grade) {
  var prior = SCENARIO_PRIORS_BY_GRADE[grade || 0] || SCENARIO_PRIORS_BY_GRADE[0];
  var scen = Object.assign({}, prior);

  // 場別補正（場別 1コース勝率を使う）
  var sdb = stadiumDB[String(sid)];
  if (sdb && sdb.courseWinRate && sdb.courseWinRate[1]) {
    var cwr = sdb.courseWinRate[1];
    if (cwr.races >= 30) {
      var rate = cwr.win / cwr.races;
      // 1コース勝率 0.55 を基準に scen.nige を調整
      var delta = (rate - 0.55) * 0.5; // ±0.1 程度
      scen.nige = Math.max(0.2, Math.min(0.8, scen.nige + delta));
    }
  }

  // 風波で穴度合い調整
  if (weather) {
    var ws = weather.wind_speed || weather.race_wind || 0;
    var wh = weather.wave_height || weather.race_wave || 0;
    if (ws >= 5 || wh >= 7) {
      scen.nige *= 0.7;
      scen.makuri *= 1.3;
      scen.other *= 1.5;
    }
  }

  // 正規化
  var sum = 0;
  for (var k in scen) sum += scen[k];
  if (sum > 0) {
    for (var k2 in scen) scen[k2] = scen[k2] / sum;
  }
  return scen;
}

function predictWithScenarios(boats, preview, weather, sid, grade) {
  var sc = predictScenarios(boats, preview, weather, sid, grade);
  var dist = {};
  Object.keys(SCENARIO_DIST).forEach(function (scKey) {
    var w = sc[scKey] || 0;
    var template = SCENARIO_DIST[scKey];
    Object.keys(template).forEach(function (combo) {
      dist[combo] = (dist[combo] || 0) + w * template[combo];
    });
  });
  // 残りの 1-2-3 組合せに薄く確率を散らす（ゼロ確率を避ける）
  var allCombos = [];
  for (var i = 1; i <= 6; i++)
    for (var j = 1; j <= 6; j++)
      for (var k = 1; k <= 6; k++) {
        if (i !== j && j !== k && i !== k) allCombos.push(i + '-' + j + '-' + k);
      }
  var residual = 0.05 / allCombos.length;
  allCombos.forEach(function (c) {
    if (dist[c] == null) dist[c] = residual;
  });
  // 正規化
  var s = 0;
  for (var c in dist) s += dist[c];
  if (s > 0) for (var c2 in dist) dist[c2] = dist[c2] / s;
  return { dist: dist, scenarios: sc };
}

function predictEntryCourses(boats, sid) {
  // 各艇の枠→コース確率を取得
  var dists = boats.map(function (b) {
    return {
      boat: b.racer_boat_number,
      rid: b.racer_number,
      dist: getEntryDist(b.racer_number, b.racer_boat_number, sid),
    };
  });

  // ハンガリアン: 全艇 × 全コース の割当を確率最大化
  // 6 艇 6 コースなら 6! = 720 通り全列挙で十分
  var permutations = [];
  function perm(arr, current) {
    if (arr.length === 0) {
      permutations.push(current);
      return;
    }
    for (var i = 0; i < arr.length; i++) {
      var rest = arr.slice(0, i).concat(arr.slice(i + 1));
      perm(rest, current.concat([arr[i]]));
    }
  }
  perm([1, 2, 3, 4, 5, 6], []);

  var best = null,
    bestScore = -Infinity;
  permutations.forEach(function (p) {
    var s = 0;
    var valid = true;
    for (var i = 0; i < dists.length; i++) {
      var pr = dists[i].dist[String(p[i])] || 0;
      if (pr <= 0) {
        valid = false;
        break;
      }
      s += Math.log(pr);
    }
    if (valid && s > bestScore) {
      bestScore = s;
      best = p;
    }
  });

  if (!best) {
    // フォールバック: 枠通り
    var by = {};
    var c = {};
    boats.forEach(function (b) {
      by[b.racer_boat_number] = b.racer_boat_number;
      c[b.racer_boat_number] = 0.5;
    });
    return { byBoat: by, conf: c };
  }
  var byBoat = {},
    conf = {};
  for (var i = 0; i < dists.length; i++) {
    byBoat[dists[i].boat] = best[i];
    conf[dists[i].boat] = dists[i].dist[String(best[i])] || 0;
  }
  return { byBoat: byBoat, conf: conf };
}

// globalThis export (REST_ONLY)
globalThis.predictScenarios = predictScenarios;
globalThis.predictWithScenarios = predictWithScenarios;
globalThis.predictEntryCourses = predictEntryCourses;
