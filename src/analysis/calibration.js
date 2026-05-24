// Phase 2 完遂続き (Clearwing patterns): src/analysis/calibration.js
//
// Analysis 層: 確率校正 (Platt scaling / Isotonic) と特徴量正規化 (Welford z-score) の
// 純粋計算ロジック。l2Predict / l2Update は二重メンテリスクのため除外
// (worker_predictor.js 側にも同じ計算が存在する)。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:ANALYSIS_CALIBRATION:START */ ... /* BUILD:ANALYSIS_CALIBRATION:END */
// に注入する。split_app.py の REST_ONLY_BUILD_MARKERS にも登録 → 学習 / 設定画面で
// しか呼ばれないため critical bundle 入りを回避。
//
// 依存 (canonical assets/app.js の top-level state / 定数):
//   _featureStats / _plattCoeffs / _plattCoeffsByStadium / _isotonicCoeffs /
//   _calibrationMethod / _stackingGamma / l2weights / l2trainStep (state)
//   FEATURE_DIM / L2_BIAS / L2_LR0 / L2_LR_TAU / L2_LAMBDA / COURSE_LOG_PRIOR (const)
//   TUNING (Object.freeze, 設定)
//   softmax / safeSet (utils, BUILD: bundle 由来)
//   _getPlattWorker (worker registration、app.js 内)
//
// Public (globalThis に export):
//   _initFeatureStats / _updateFeatureStats / _normalizeFeatures
//   _applyPlattCalibration / _applyIsotonicCalibration / _applyCalibration
//   _stackedPredict
//   _extractPlattPairs / _refitPlattCoeffs
//   _refitIsotonicCalibration / _refitPerStadiumPlatt / _chooseCalibrationMethod
//
// 2026-05-24 (v2): 校正パイプライン拡張
//   1. Isotonic regression: Pool Adjacent Violators (PAV) で非パラメトリック校正
//   2. 場別 Platt: 24 場ごとの (a, b) を別々に学習 (各場 >= 100 サンプルあれば)
//   3. Auto-select: 両者の held-out log loss を比較し優れた方を採用
//   全機能は flag で gating、既存ユーザは何もしなくても従来挙動 (global Platt) を維持

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

function _applyPlattCalibration(p, sid) {
  if (!TUNING.PREDICTION.ENABLE_PLATT) return p;
  // 2026-05-24: 場別 Platt がある場合は優先 (n >= 100 のみ)、無ければ global
  var a = _plattCoeffs.a, b = _plattCoeffs.b;
  if (sid != null && typeof _plattCoeffsByStadium === 'object' && _plattCoeffsByStadium) {
    var ps = _plattCoeffsByStadium[String(sid)];
    if (ps && Number.isFinite(ps.a) && Number.isFinite(ps.b) && ps.n >= 100) {
      a = ps.a; b = ps.b;
    }
  }
  if (a === 1 && b === 0) return p; // 高速 path: identity
  var clipped = Math.min(0.9999, Math.max(0.0001, p));
  var logit = Math.log(clipped / (1 - clipped));
  var z = a * logit + b;
  if (z > 30) return 1.0;
  if (z < -30) return 0.0;
  return 1.0 / (1.0 + Math.exp(-z));
}

// 2026-05-24: Isotonic regression による非パラメトリック校正
//   _isotonicCoeffs.points = [{x: predicted_prob_avg, y: actual_rate}, ...] (x 昇順)
//   入力 p に対し、最近の breakpoint 2 点で線形補間
function _applyIsotonicCalibration(p) {
  if (!_isotonicCoeffs || !Array.isArray(_isotonicCoeffs.points)) return p;
  var pts = _isotonicCoeffs.points;
  if (pts.length < 2) return p;
  // 範囲外は最近端の y を返す
  if (p <= pts[0].x) return pts[0].y;
  if (p >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  // 二分探索で挟む 2 点を見つける
  var lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    var mid = (lo + hi) >> 1;
    if (pts[mid].x <= p) lo = mid; else hi = mid;
  }
  var dx = pts[hi].x - pts[lo].x;
  if (dx <= 0) return pts[lo].y;
  var t = (p - pts[lo].x) / dx;
  return pts[lo].y + t * (pts[hi].y - pts[lo].y);
}

// 2026-05-24: 統一エントリ — 選択された method (Platt | Isotonic | none) で校正
//   呼出側はこれを通せば method 切替の影響を受けない。sid は Platt 場別用。
function _applyCalibration(p, sid) {
  var method = (typeof _calibrationMethod === 'string') ? _calibrationMethod : 'platt';
  if (method === 'isotonic') return _applyIsotonicCalibration(p);
  if (method === 'none') return p;
  return _applyPlattCalibration(p, sid);
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
// 2026-05-24 (Tier 2): refit の最後に Isotonic + 場別 Platt + auto-select も実行
async function _refitPlattCoeffs(history) {
  var pairs = _extractPlattPairs(history);
  if (pairs.length < 100) return null;
  var w = typeof _getPlattWorker === 'function' ? _getPlattWorker() : null;
  var globalResult;
  if (w) {
    globalResult = await new Promise(function (resolve) {
      var onMsg = function (e) {
        if (!e.data || e.data.type !== 'platt_refit_done') return;
        w.removeEventListener('message', onMsg);
        resolve(e.data.result);
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'platt_refit', samples: pairs });
    });
  }
  if (!globalResult) {
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
    globalResult = { a: bestA, b: bestB, n: pairs.length };
  }
  _plattCoeffs = { a: globalResult.a, b: globalResult.b, fittedAt: Date.now(), n: globalResult.n };
  safeSet('boatrace_platt', _plattCoeffs);

  // 2026-05-24 (Tier 2): 場別 Platt も同時に fit
  try {
    _plattCoeffsByStadium = _refitPerStadiumPlatt(history);
    safeSet('boatrace_platt_perstadium', _plattCoeffsByStadium);
  } catch (_) { /* 場別失敗は致命にしない */ }

  // 2026-05-24 (Tier 2): Isotonic も同時に fit
  try {
    var iso = _refitIsotonicCalibration(history);
    if (iso) {
      _isotonicCoeffs = iso;
      safeSet('boatrace_isotonic', _isotonicCoeffs);
    }
  } catch (_) {}

  // 2026-05-24 (Tier 2): auto-select (Platt vs Isotonic) — held-out log loss が低い方
  try {
    var chosen = _chooseCalibrationMethod(history);
    _calibrationMethod = chosen;
    try { localStorage.setItem('boatrace_calib_method', chosen); } catch (_) {}
  } catch (_) {}

  return _plattCoeffs;
}

// ─────────────────────────────────────────────
// 2026-05-24: Isotonic regression refit (PAV: Pool Adjacent Violators)
// ─────────────────────────────────────────────
//   pairs = [{p, y}] (y in {0,1}) を p 昇順に並べ替え、PAV で単調非減少な
//   piece-wise constant 関数を作る。連続点を merge して breakpoints に圧縮。
//   既存 _extractPlattPairs を再利用 (同じデータ形式)。

function _refitIsotonicCalibration(history) {
  var pairs = _extractPlattPairs(history);
  if (pairs.length < 200) return null;
  // 1) p 昇順ソート
  pairs.sort(function (a, b) { return a.p - b.p; });
  // 2) PAV (pool adjacent violators)
  //    各点を (sum_y, count) の block として開始、隣接で逆順 (mean が前 block より低い) なら merge
  var blocks = pairs.map(function (pi) {
    return { x: pi.p, sumY: pi.y, sumX: pi.p, count: 1 };
  });
  var changed = true;
  while (changed) {
    changed = false;
    for (var i = 0; i < blocks.length - 1; i++) {
      var meanI = blocks[i].sumY / blocks[i].count;
      var meanJ = blocks[i + 1].sumY / blocks[i + 1].count;
      if (meanI > meanJ) {
        // merge i+1 into i
        blocks[i].sumY += blocks[i + 1].sumY;
        blocks[i].sumX += blocks[i + 1].sumX;
        blocks[i].count += blocks[i + 1].count;
        blocks.splice(i + 1, 1);
        changed = true;
        if (i > 0) i--; // 戻って再検査
      }
    }
  }
  // 3) breakpoints 化 (x = block の平均 p、y = block の hit 率)
  //    UI / 推論時の linear interpolation で滑らかに繋ぐ
  var points = blocks.map(function (b) {
    return { x: b.sumX / b.count, y: b.sumY / b.count };
  });
  // 4) 圧縮: 連続して y が等しい点を端点だけ残す
  var compressed = [];
  for (var k = 0; k < points.length; k++) {
    if (k > 0 && k < points.length - 1
        && Math.abs(points[k].y - points[k - 1].y) < 1e-9
        && Math.abs(points[k].y - points[k + 1].y) < 1e-9) {
      continue;
    }
    compressed.push(points[k]);
  }
  return { points: compressed, fittedAt: Date.now(), n: pairs.length };
}

// ─────────────────────────────────────────────
// 2026-05-24: 場別 Platt refit (24 場ごとに別 (a, b))
// ─────────────────────────────────────────────
//   各場で >= 100 サンプル取れる場合のみ場別を学習。それ未満は global で代用。
//   既存 _refitPlattCoeffs と同じ grid search を場別に適用。
//   Worker 委譲は global のみ (場別 24 × grid search はメインで十分高速)。

function _refitPerStadiumPlatt(history) {
  if (!Array.isArray(history)) return {};
  // history を場別に group 化
  var bySid = {};
  history.forEach(function (h) {
    if (!h || !h.stadium) return;
    var sid = String(h.stadium);
    if (!bySid[sid]) bySid[sid] = [];
    bySid[sid].push(h);
  });
  var out = {};
  for (var sid in bySid) {
    var subPairs = _extractPlattPairs(bySid[sid]);
    if (subPairs.length < 100) continue; // 場別は 100 サンプル下限 (global は 200)
    var bestA = 1.0, bestB = 0.0, bestLoss = Infinity;
    for (var a = 0.5; a <= 2.0; a += 0.1) {
      for (var b = -1.0; b <= 1.0; b += 0.1) {
        var loss = 0;
        for (var i = 0; i < subPairs.length; i++) {
          var pi = subPairs[i];
          var clipped = Math.min(0.9999, Math.max(0.0001, pi.p));
          var logit = Math.log(clipped / (1 - clipped));
          var z = a * logit + b;
          var pp = z > 30 ? 1.0 : z < -30 ? 0.0 : 1.0 / (1.0 + Math.exp(-z));
          pp = Math.min(0.9999, Math.max(0.0001, pp));
          loss += pi.y ? -Math.log(pp) : -Math.log(1 - pp);
        }
        if (loss < bestLoss) { bestLoss = loss; bestA = a; bestB = b; }
      }
    }
    out[sid] = { a: bestA, b: bestB, n: subPairs.length, fittedAt: Date.now() };
  }
  return out;
}

// 2026-05-24: Platt vs Isotonic の自動選択 — held-out log loss が低い方を採用
//   履歴を 80/20 で時系列 split、後ろ 20% で評価。
function _chooseCalibrationMethod(history) {
  var pairs = _extractPlattPairs(history);
  if (pairs.length < 300) return 'platt'; // データ不足時は安定な Platt
  // pairs は extract 内で順序保持されている (sort はしない)、time-based 順
  var split = Math.floor(pairs.length * 0.8);
  var heldOut = pairs.slice(split);
  if (heldOut.length < 50) return 'platt';
  var plattLoss = 0, isoLoss = 0;
  var iso = _isotonicCoeffs;
  for (var i = 0; i < heldOut.length; i++) {
    var pi = heldOut[i];
    var pPlatt = _applyPlattCalibration(pi.p);
    var pIso = iso ? _applyIsotonicCalibration(pi.p) : pi.p;
    pPlatt = Math.min(0.9999, Math.max(0.0001, pPlatt));
    pIso = Math.min(0.9999, Math.max(0.0001, pIso));
    plattLoss += pi.y ? -Math.log(pPlatt) : -Math.log(1 - pPlatt);
    isoLoss += pi.y ? -Math.log(pIso) : -Math.log(1 - pIso);
  }
  return isoLoss < plattLoss ? 'isotonic' : 'platt';
}

// ─────────────────────────────────────────────
// globalThis export (REST_ONLY)
// ─────────────────────────────────────────────
globalThis._initFeatureStats = _initFeatureStats;
globalThis._updateFeatureStats = _updateFeatureStats;
globalThis._normalizeFeatures = _normalizeFeatures;
globalThis._applyPlattCalibration = _applyPlattCalibration;
globalThis._applyIsotonicCalibration = _applyIsotonicCalibration;
globalThis._applyCalibration = _applyCalibration;
globalThis._stackedPredict = _stackedPredict;
globalThis._extractPlattPairs = _extractPlattPairs;
globalThis._refitPlattCoeffs = _refitPlattCoeffs;
globalThis._refitIsotonicCalibration = _refitIsotonicCalibration;
globalThis._refitPerStadiumPlatt = _refitPerStadiumPlatt;
globalThis._chooseCalibrationMethod = _chooseCalibrationMethod;
