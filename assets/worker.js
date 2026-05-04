// PF-9: Web Worker — メインスレッドから重い計算を分離
//
// 現状の対象:
//   - Platt scaling 再校正の grid search (a × b の 2 次元探索、~5000 iteration)
//     これがメインスレッドで動くと、user 操作中にハングする恐れ
//
// 拡張余地:
//   - scoreBoatV2 / l2Predict のバッチ実行（要 racerDB / stadiumDB / l2weights 同期）
//   - learnFromResults のバッチ学習
//
// プロトコル:
//   main → worker: { type: 'platt_refit', samples: [{p, y}, ...] }
//   worker → main: { type: 'platt_refit_done', a: number, b: number, loss: number, n: number }

'use strict';

// Platt 係数の grid search (assets/app.js の _refitPlattCoeffs から移植)
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

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'platt_refit') {
    const result = platRefit(msg.samples);
    self.postMessage({ type: 'platt_refit_done', result });
  } else {
    self.postMessage({ type: 'unknown', echo: msg });
  }
});
