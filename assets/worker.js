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

// FIX (2026-05-22): Worker 内の error / unhandledrejection を捕捉して
//   詳細を main に postMessage する。main 側の Worker.onerror は cross-origin
//   セキュリティで filename/line/col/message を空にされるため、worker 内で
//   情報を保存して送り返すのが唯一の方法。
//   boatrace_errors に "worker_error: unknown (cross-origin or load fail)"
//   が出ていた問題への対処。
self.addEventListener('error', function (ev) {
  try {
    self.postMessage({
      type: 'worker_self_error',
      msg: (ev && ev.message) || 'worker error',
      filename: (ev && ev.filename) || '',
      line: (ev && ev.lineno) || 0,
      col: (ev && ev.colno) || 0,
      stack: ev && ev.error && ev.error.stack ? String(ev.error.stack).slice(0, 2000) : '',
    });
  } catch (_) {}
});
self.addEventListener('unhandledrejection', function (ev) {
  try {
    var reason = ev && ev.reason;
    self.postMessage({
      type: 'worker_self_error',
      msg: 'unhandled rejection: ' + (reason && reason.message ? reason.message : String(reason).slice(0, 500)),
      filename: '',
      line: 0,
      col: 0,
      stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : '',
    });
  } catch (_) {}
});

// 予測ロジック本体を読込（assets/worker_predictor.js）
try {
  importScripts('worker_predictor.js');
} catch (e) {
  // importScripts 失敗 (load fail) を main に通知
  try {
    self.postMessage({
      type: 'worker_self_error',
      msg: 'importScripts failed: ' + (e && e.message ? e.message : String(e)),
      filename: 'worker_predictor.js',
      line: 0,
      col: 0,
      stack: e && e.stack ? String(e.stack).slice(0, 2000) : '',
    });
  } catch (_) {}
  console.error('[worker] failed to load predictor:', e);
}

// =============================================================================
// state holders (init メッセージで main から受信)
// =============================================================================
// 2026-11-19: state はすべて main から sync_state で受け取る（racerDB / stadiumDB を含む）。
//   旧 PG-7 の worker 自前 fetch (load_heavy_dbs) は /assets/data/db/ を取りに行って 404 になり、
//   worker の DB が常に空だったため撤去した。
function _syncState(state) {
  if (!state || typeof state !== 'object') return;
  // 軽量項目は post で受信
  if (state.pairwiseDB) pairwiseDB = state.pairwiseDB;
  if (state.stadiumMotorStats) stadiumMotorStats = state.stadiumMotorStats;
  if (state.stadiumExhibitionStats) stadiumExhibitionStats = state.stadiumExhibitionStats;
  if (Array.isArray(state.l2weights)) l2weights = state.l2weights;
  if (state.featureStats) _featureStats = state.featureStats;
  // S-01 (2026-07-26): 融合比 α = N0/(N0+l2trainStep)。main と同じ n を持たないと
  //   Worker 経路と main fallback で予測が食い違う。
  if (typeof state.trainStep === 'number') l2trainStep = state.trainStep;
  if (state.plattCoeffs) _plattCoeffs = state.plattCoeffs;
  // 2026-11-19: 校正 3 種と settings も main と揃える（未同期だと worker 経路だけ
  //   場別 Platt / isotonic が効かず、買い目点数・EV モードも既定値のままになる）。
  if (state.plattCoeffsByStadium) _plattCoeffsByStadium = state.plattCoeffsByStadium;
  if (state.isotonicCoeffs !== undefined) _isotonicCoeffs = state.isotonicCoeffs;
  if (typeof state.calibrationMethod === 'string') _calibrationMethod = state.calibrationMethod;
  if (state.settings && typeof state.settings === 'object') settings = state.settings;
  if (typeof state.stackingGamma === 'number') _stackingGamma = state.stackingGamma;
  if (state.tideData !== undefined) tideData = state.tideData;
  // programData / previewData / oddsData は予測時点で送られる input
  if (state.programData) programData = state.programData;
  if (state.previewData) previewData = state.previewData;
  if (state.oddsData !== undefined) oddsData = state.oddsData;
  if (state.racerDB) racerDB = state.racerDB;
  // 2026-11-20: オリジナル展示（score_boat が globalThis._origExhibIndex を読む）。未同期だと worker 経路だけ
  //   対応 5 場の一周・まわり足の加点が無く、main と予想が食い違っていた（test_worker_sync_list.mjs で検出）。
  if (state.origExhibIndex && typeof state.origExhibIndex === 'object') _origExhibIndex = state.origExhibIndex;
  if (state.stadiumDB) stadiumDB = state.stadiumDB;
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
    if (msg.type === 'batch_learn') {
      // PG-9: 学習バッチを Worker で実行
      const reqId = msg.reqId;
      if (typeof batchLearnFromResults !== 'function') {
        self.postMessage({ type: 'error', reqId, error: 'batchLearnFromResults not loaded' });
        return;
      }
      const result = batchLearnFromResults(msg.input);
      self.postMessage({ type: 'batch_learn_done', reqId, result });
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
