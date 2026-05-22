// Phase 2 完遂続編 (Clearwing patterns): src/analysis/learning.js
//
// Analysis 層: results 受信時の L2 学習バッチ処理 (main thread + Web Worker
// オフロード)。learnFromResults は Worker が利用可能なら learnFromResultsViaWorker
// に委譲、失敗時は main thread でフォールバック学習を実行する。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:ANALYSIS_LEARNING:START */ ... /* BUILD:ANALYSIS_LEARNING:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS に登録 — 学習は
// loadDeferredData の中で実行されるため critical 起動には不要。
//
// ⚠️ Twin maintenance 注意:
//   worker_predictor.js の batchLearnFromResults() (~130 行) と
//   ロジック等価。Worker context は postMessage 経由で input を受け取り
//   ローカル l2weights / _featureStats / l2learnedKeys を更新する。
//   本ファイルの learnFromResults を編集する場合、worker 側も同期する。
//   抜本対策 (共有 ESM import 化) は次次 PR の課題 (docs/architecture.md § 9)。
//
// 依存 (canonical / 他 bundle の globals):
//   _getAppWorker / _appWorkerReqId / _appWorkerCallbacks (worker registration)
//   resultData / programData / previewData / l2weights / _featureStats /
//     l2trainStep / l2learnedKeys (state)
//   L2_KEY_LIMIT (定数)
//   getL2Features / l2Update / _yieldToMain (analysis bundle / 既存)
//   pf / jstYmd / safeSet (util)
//
// Public (globalThis に export):
//   learnFromResults / learnFromResultsViaWorker

'use strict';

async function learnFromResultsViaWorker() {
  var w = _getAppWorker();
  if (!w || !resultData || !programData || !previewData) return null;
  return new Promise(function (resolve) {
    var reqId = ++_appWorkerReqId;
    _appWorkerCallbacks.set(reqId, function (msg) {
      if (msg.type !== 'batch_learn_done' || !msg.result) {
        resolve(null);
        return;
      }
      var r = msg.result;
      // worker からの更新を main state に反映
      if (Array.isArray(r.l2weights)) l2weights = r.l2weights;
      if (r.featureStats) _featureStats = r.featureStats;
      if (typeof r.trainStep === 'number') l2trainStep = r.trainStep;
      if (r.learnedKeys) l2learnedKeys = r.learnedKeys;
      // 永続化
      try {
        safeSet('boatrace_weights', l2weights);
      } catch (_) {}
      try {
        safeSet('boatrace_trainstep', l2trainStep);
      } catch (_) {}
      try {
        safeSet('boatrace_featurestats', _featureStats);
      } catch (_) {}
      try {
        safeSet('boatrace_learned', l2learnedKeys);
      } catch (_) {}
      console.log('[PG-9] worker learned ' + r.learnedThisCall + ' new races');
      resolve(r);
    });
    w.postMessage({
      type: 'batch_learn',
      reqId: reqId,
      input: {
        resultData: resultData,
        programData: programData,
        previewData: previewData,
        state: {
          l2weights: l2weights,
          featureStats: _featureStats,
          trainStep: l2trainStep,
          learnedKeys: l2learnedKeys,
        },
      },
    });
  });
}

async function learnFromResults() {
  if (!resultData || !programData || !previewData) return;
  // PG-9: Worker 利用可能なら Worker 経由
  if (_getAppWorker()) {
    var workerResult = await learnFromResultsViaWorker();
    if (workerResult) return;
    // Worker 失敗時は main thread fallback (下に続く)
  }
  // PB-1: 当日（programData の race_date）を学習キーの一部に採用
  var dateKey = (function () {
    try {
      for (var s in programData) {
        var stadiums = programData[s];
        for (var r in stadiums) {
          var pgm = stadiums[r];
          if (pgm && pgm.race_date) return String(pgm.race_date).replace(/-/g, '');
        }
      }
    } catch (_) {}
    return jstYmd(0);
  })();
  var learnedThisCall = 0;
  var iterCount = 0; // PE-9: yield カウンタ
  for (var sid in resultData) {
    var races = resultData[sid];
    for (var rn in races) {
      var race = races[rn];
      if (!race || !race.isFinished || !race.results || !race.results.length) continue;
      var prog = programData[sid] && programData[sid][rn];
      var prev = previewData[sid] && previewData[sid][rn];
      if (!prog || !prog.boats || !Array.isArray(prog.boats)) continue;

      // PB-1: 同レースの二重学習を防ぐ
      var key = dateKey + '_' + sid + '_' + rn;
      if (l2learnedKeys[key]) continue;

      var sorted = race.results.slice().sort(function (a, b) {
        return a.place - b.place;
      });
      var winnerBoat = sorted[0].racer_boat_number;

      var stRanks = {};
      if (prev && prev.boats) {
        var sts = [];
        for (var si = 1; si <= 6; si++) {
          var spv = prev.boats[String(si)];
          var stVal = spv && spv.racer_start_timing != null ? pf(spv.racer_start_timing) : 99;
          sts.push({ boat: si, st: stVal });
        }
        sts.sort(function (a, b) {
          return a.st - b.st;
        });
        sts.forEach(function (s, idx) {
          stRanks[s.boat] = idx;
        });
      }

      var etRanks = {};
      if (prev && prev.boats) {
        var ets = [];
        for (var ei = 1; ei <= 6; ei++) {
          var epv = prev.boats[String(ei)];
          var etVal = epv && epv.racer_exhibition_time != null ? pf(epv.racer_exhibition_time) : 99;
          ets.push({ boat: ei, et: etVal });
        }
        ets.sort(function (a, b) {
          return a.et - b.et;
        });
        ets.forEach(function (e, idx) {
          etRanks[e.boat] = idx;
        });
      }

      var weather = prev && prev.weather ? prev.weather : null;
      var features6 = prog.boats.map(function (b) {
        var pv = prev && prev.boats ? prev.boats[String(b.racer_boat_number)] : null;
        return getL2Features(
          b,
          pv,
          weather,
          etRanks[b.racer_boat_number] != null ? etRanks[b.racer_boat_number] : 5,
          stRanks[b.racer_boat_number] != null ? stRanks[b.racer_boat_number] : 5,
          sid
        );
      });
      var winnerIdx = prog.boats.findIndex(function (b) {
        return b.racer_boat_number === winnerBoat;
      });
      if (winnerIdx >= 0) {
        l2Update(features6, winnerIdx);
        l2learnedKeys[key] = 1;
        learnedThisCall++;
      }
      // PE-9: 6 レース毎にメインスレッドへ譲る (TBT/INP 改善)
      iterCount++;
      if (iterCount % 6 === 0) await _yieldToMain();
    }
  }
  if (learnedThisCall > 0) {
    // PB-1: 上限超過時は古いキーから切り捨て（FIFO 風: 単純に keys[].slice）
    var keys = Object.keys(l2learnedKeys);
    if (keys.length > L2_KEY_LIMIT) {
      var keep = keys.slice(-L2_KEY_LIMIT);
      var trimmed = {};
      for (var i = 0; i < keep.length; i++) trimmed[keep[i]] = 1;
      l2learnedKeys = trimmed;
    }
    safeSet('boatrace_learned', l2learnedKeys); // PB-1
    console.log(
      '[L2] learned ' +
        learnedThisCall +
        ' new races (total t=' +
        l2trainStep +
        ', tracked keys=' +
        Object.keys(l2learnedKeys).length +
        ')'
    );
  }
}

// globalThis export (REST_ONLY)
globalThis.learnFromResults = learnFromResults;
globalThis.learnFromResultsViaWorker = learnFromResultsViaWorker;
