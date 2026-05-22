// Phase 2 完遂続き (Clearwing patterns): src/analysis/calibration.js
//
// Analysis 層: 確率校正 (Platt scaling) と特徴量正規化 (Welford z-score) の
// 純粋計算ロジック。l2Predict / l2Update は二重メンテリスクのため除外
// (worker_predictor.js 側にも同じ計算が存在する)。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:ANALYSIS_CALIBRATION:START */ ... /* BUILD:ANALYSIS_CALIBRATION:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS にも登録 → 学習 / 設定画面で
// しか呼ばれないため critical bundle 入りを回避。
//
// 依存 (canonical assets/app.js の top-level state / 定数):
//   _featureStats / _plattCoeffs / _stackingGamma / l2weights / l2trainStep (state)
//   FEATURE_DIM / L2_BIAS / L2_LR0 / L2_LR_TAU / L2_LAMBDA / COURSE_LOG_PRIOR (const)
//   TUNING (Object.freeze, 設定)
//   softmax / safeSet (utils, BUILD: bundle 由来)
//   _getPlattWorker (worker registration、app.js 内)
//
// Public (globalThis に export):
//   _initFeatureStats / _updateFeatureStats / _normalizeFeatures
//   _applyPlattCalibration / _stackedPredict
//   _extractPlattPairs / _refitPlattCoeffs

'use strict';

// ─────────────────────────────────────────────
// 特徴量 rolling statistics (Welford online algorithm)
// ─────────────────────────────────────────────

function _initFeatureStats() {
  return { mean: new Array(FEATURE_DIM).fill(0), m2: new Array(FEATURE_DIM).fill(0), n: 0 };
}

// PB-7: Welford's online algorithm で 特徴量 mean/variance を更新
function _updateFeatureStats(featRow) {
  if (!Array.isArray(featRow)) return;
  _featureStats.n += 1;
  var n = _featureStats.n;
  for (var i = 0; i < FEATURE_DIM; i++) {
    var x = Number.isFinite(featRow[i]) ? featRow[i] : 0;
    var delta = x - _featureStats.mean[i];
    _featureStats.mean[i] += delta / n;
    var delta2 = x - _featureStats.mean[i];
    _featureStats.m2[i] += delta * delta2;
  }
}

// PB-7 + PF-5: 特徴量を z-score 正規化（warmup 前は identity）
//   PF-5: divisor を pre-compute、Number.isFinite 呼出を || 0 に置換
function _normalizeFeatures(featRow) {
  if (!TUNING.PREDICTION.ENABLE_ZSCORE) return featRow;
  var n = _featureStats.n;
  if (n < TUNING.PREDICTION.ZSCORE_WARMUP_N) return featRow;
  var means = _featureStats.mean;
  var m2s = _featureStats.m2;
  var divisor = n > 1 ? n - 1 : 1;
  var out = new Array(FEATURE_DIM);
  for (var i = 0; i < FEATURE_DIM; i++) {
    var variance = m2s[i] / divisor;
    var std = Math.sqrt(variance + 1e-6);
    var x = featRow[i] || 0;
    out[i] = (x - means[i]) / std;
  }
  return out;
}

// ─────────────────────────────────────────────
// Platt scaling — 確率の post-hoc 校正
//   p' = sigmoid(a * logit(p) + b)
// 既定 a=1, b=0 で identity (no calibration)。データ蓄積後 _refitPlattCoeffs で auto-tune
// ─────────────────────────────────────────────

function _applyPlattCalibration(p) {
  if (!TUNING.PREDICTION.ENABLE_PLATT) return p;
  var a = _plattCoeffs.a,
    b = _plattCoeffs.b;
  if (a === 1 && b === 0) return p; // 高速 path: identity
  var clipped = Math.min(0.9999, Math.max(0.0001, p));
  var logit = Math.log(clipped / (1 - clipped));
  var z = a * logit + b;
  if (z > 30) return 1.0;
  if (z < -30) return 0.0;
  return 1.0 / (1.0 + Math.exp(-z));
}

// PB-5: Stacking 予測 — L2 が L1 確率を補正する形式
//   p_stacked[b] = softmax( logit(L1[b]) + γ * residual_b ) where residual_b は L2 の輸出 logit
//   既定 γ=0 で stacking 無効（純粋に L1 を返す）。STACKING_MODE='residual' で active
function _stackedPredict(features6, l1probs) {
  if (TUNING.PREDICTION.STACKING_MODE !== 'residual') return l1probs;
  var feats = features6.map(_normalizeFeatures);
  var l2Logits = feats.map(function (feat, b) {
    var z = L2_BIAS + (COURSE_LOG_PRIOR[b] || 0);
    for (var i = 0; i < feat.length; i++) z += feat[i] * (l2weights[i] || 0);
    return z;
  });
  var combinedLogits = l1probs.map(function (p, b) {
    var clipped = Math.min(0.9999, Math.max(0.0001, p));
    var l1Logit = Math.log(clipped / (1 - clipped));
    return l1Logit + _stackingGamma * l2Logits[b];
  });
  return softmax(combinedLogits);
}

// ─────────────────────────────────────────────
// Platt re-fit (grid search、Worker 委譲対応)
// ─────────────────────────────────────────────

// 履歴から Platt scaling の入力 pairs を抽出
function _extractPlattPairs(history) {
  if (!Array.isArray(history)) return [];
  var samples = history.filter(function (h) {
    return h.actual && h.actual.length > 0 && Array.isArray(h.mark_probs);
  });
  if (samples.length < TUNING.PREDICTION.PLATT_MIN_SAMPLES) return [];
  var pairs = [];
  samples.forEach(function (h) {
    var winner = h.actual[0];
    var probs = {};
    h.mark_probs.forEach(function (mp) {
      probs[mp.boat] = mp.prob;
    });
    var pWin = probs[winner];
    if (!Number.isFinite(pWin) || pWin <= 0 || pWin >= 1) return;
    pairs.push({ p: pWin, y: 1 });
    for (var b = 1; b <= 6; b++) {
      if (b === winner) continue;
      var pb = probs[b];
      if (Number.isFinite(pb) && pb > 0 && pb < 1) pairs.push({ p: pb, y: 0 });
    }
  });
  return pairs;
}

// PB-6 + PF-9 + PG-3: Web Worker への分離 (失敗時は main thread fallback)
async function _refitPlattCoeffs(history) {
  var pairs = _extractPlattPairs(history);
  if (pairs.length < 100) return null;
  var w = typeof _getPlattWorker === 'function' ? _getPlattWorker() : null;
  if (w) {
    return new Promise(function (resolve) {
      var onMsg = function (e) {
        if (!e.data || e.data.type !== 'platt_refit_done') return;
        w.removeEventListener('message', onMsg);
        var r = e.data.result;
        if (!r) {
          resolve(null);
          return;
        }
        _plattCoeffs = { a: r.a, b: r.b, fittedAt: Date.now(), n: r.n };
        safeSet('boatrace_platt', _plattCoeffs);
        resolve(_plattCoeffs);
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'platt_refit', samples: pairs });
    });
  }
  // フォールバック: main thread で実行
  var bestA = 1.0,
    bestB = 0.0,
    bestLoss = Infinity;
  for (var a = 0.5; a <= 2.0; a += 0.1) {
    for (var b = -1.0; b <= 1.0; b += 0.1) {
      var loss = 0;
      for (var i = 0; i < pairs.length; i++) {
        var pi = pairs[i];
        var clipped = Math.min(0.9999, Math.max(0.0001, pi.p));
        var logit = Math.log(clipped / (1 - clipped));
        var z = a * logit + b;
        var pp = z > 30 ? 1.0 : z < -30 ? 0.0 : 1.0 / (1.0 + Math.exp(-z));
        pp = Math.min(0.9999, Math.max(0.0001, pp));
        loss += pi.y ? -Math.log(pp) : -Math.log(1 - pp);
      }
      if (loss < bestLoss) {
        bestLoss = loss;
        bestA = a;
        bestB = b;
      }
    }
  }
  _plattCoeffs = { a: bestA, b: bestB, fittedAt: Date.now(), n: pairs.length };
  safeSet('boatrace_platt', _plattCoeffs);
  return _plattCoeffs;
}

// ─────────────────────────────────────────────
// globalThis export (REST_ONLY)
// ─────────────────────────────────────────────
globalThis._initFeatureStats = _initFeatureStats;
globalThis._updateFeatureStats = _updateFeatureStats;
globalThis._normalizeFeatures = _normalizeFeatures;
globalThis._applyPlattCalibration = _applyPlattCalibration;
globalThis._stackedPredict = _stackedPredict;
globalThis._extractPlattPairs = _extractPlattPairs;
globalThis._refitPlattCoeffs = _refitPlattCoeffs;
