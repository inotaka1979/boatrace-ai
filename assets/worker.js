// PG-3: Web Worker — 予測計算をメインスレッドから分離
//
// プロトコル:
//   main → worker:
//     { type: 'sync_state', state: {racerDB, stadiumDB, l2weights, ...} }
//     { type: 'predict', input: {sid, raceNum, programs, previews, weather, ...}, reqId }
//     { type: 'platt_refit', samples }   (PF-9 既存)
//   worker → main:
//     { type: 'predict_done', reqId, result }
//     { type: 'platt_refit_done', result }
//     { type: 'error', error, reqId? }
//
// 拡張余地:
//   - batch predict (backfill 高速化)
//   - learn step delegation

'use strict';

// 予測ロジック本体を読込（assets/worker_predictor.js）
try {
  importScripts('worker_predictor.js');
} catch (e) {
  console.error('[worker] failed to load predictor:', e);
}

// =============================================================================
// state holders (init メッセージで main から受信)
// =============================================================================
function _syncState(state) {
  if (!state || typeof state !== 'object') return;
  if (state.racerDB) racerDB = state.racerDB;
  if (state.stadiumDB) stadiumDB = state.stadiumDB;
  if (state.pairwiseDB) pairwiseDB = state.pairwiseDB;
  if (state.stadiumMotorStats) stadiumMotorStats = state.stadiumMotorStats;
  if (state.stadiumExhibitionStats) stadiumExhibitionStats = state.stadiumExhibitionStats;
  if (Array.isArray(state.l2weights)) l2weights = state.l2weights;
  if (state.featureStats) _featureStats = state.featureStats;
  if (state.plattCoeffs) _plattCoeffs = state.plattCoeffs;
  if (typeof state.stackingGamma === 'number') _stackingGamma = state.stackingGamma;
  if (state.tideData !== undefined) tideData = state.tideData;
  if (state.programData) programData = state.programData;
  if (state.previewData) previewData = state.previewData;
  if (state.oddsData !== undefined) oddsData = state.oddsData;
}

// =============================================================================
// Platt scaling refit (PF-9 既存、互換維持)
// =============================================================================
function platRefit(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 100) return null;
  let bestA = 1.0, bestB = 0.0, bestLoss = Infinity;
  for (let a = 0.5; a <= 2.0; a += 0.1) {
    for (let b = -1.0; b <= 1.0; b += 0.1) {
      let loss = 0;
      for (let i = 0; i < pairs.length; i++) {
        const pi = pairs[i];
        const clipped = Math.min(0.9999, Math.max(0.0001, pi.p));
        const logit = Math.log(clipped / (1 - clipped));
        const z = a * logit + b;
        let pp = (z > 30) ? 1.0 : (z < -30) ? 0.0 : 1.0 / (1.0 + Math.exp(-z));
        pp = Math.min(0.9999, Math.max(0.0001, pp));
        loss += pi.y ? -Math.log(pp) : -Math.log(1 - pp);
      }
      if (loss < bestLoss) { bestLoss = loss; bestA = a; bestB = b; }
    }
  }
  return { a: bestA, b: bestB, loss: bestLoss, n: pairs.length };
}

// =============================================================================
// message handler
// =============================================================================
self.addEventListener('message', (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'sync_state') {
      _syncState(msg.state);
      self.postMessage({ type: 'sync_done' });
      return;
    }
    if (msg.type === 'predict') {
      const reqId = msg.reqId;
      // input.programData / previewData / weather などを state に注入
      if (msg.input && msg.input.state) _syncState(msg.input.state);
      if (typeof predictRace !== 'function') {
        self.postMessage({ type: 'error', reqId, error: 'predictRace not loaded' });
        return;
      }
      const sid = msg.input.sid;
      const raceNum = msg.input.raceNum;
      const result = predictRace(sid, raceNum);
      self.postMessage({ type: 'predict_done', reqId, result });
      return;
    }
    if (msg.type === 'platt_refit') {
      const result = platRefit(msg.samples);
      self.postMessage({ type: 'platt_refit_done', result });
      return;
    }
    self.postMessage({ type: 'unknown', echo: msg });
  } catch (err) {
    self.postMessage({
      type: 'error',
      reqId: msg && msg.reqId,
      error: (err && err.message) || String(err),
      stack: (err && err.stack) || ''
    });
  }
});
