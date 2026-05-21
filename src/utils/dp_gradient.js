// Epic 21 (P2-6 拡張): 差分プライバシー (DP) gradient ヘルパ
//
// 目的: 真の federated learning に向けた基盤として、
//   - クライアント勾配を共有する前に L2 norm clip + Gaussian noise を加算
//   - 共有しなくても自前の SGD に DP を組み込めば「local DP」として機能
//
// 共有 endpoint なしでも価値:
//   - 自前学習に noise が乗ることで過学習リスクが軽減（regularizer 的効果）
//   - 将来 endpoint が用意されたら opt-in 共有に切替えられる
//
// API:
//   clipGradient(grad, maxNorm)              — L2 norm clipping
//   addGaussianNoise(grad, sigma)            — Gaussian mechanism
//   buildDPGradient(grad, opts)              — clip + noise を一度に適用
//   estimateDPParams(epsilon, delta, T)      — epsilon-delta DP で必要な sigma を推定
//
// 参考: Abadi et al. "Deep Learning with Differential Privacy" (CCS'16)

'use strict';

// ── Gaussian noise (Box-Muller) ──────────────────────────
function _sampleStdNormal() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── L2 ノルム計算 ────────────────────────────────────────
function _l2Norm(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) s += arr[i] * arr[i];
  }
  return Math.sqrt(s);
}

// ── L2 norm clipping ────────────────────────────────────
//   ||g|| が maxNorm を超えていれば、g を比例縮小して ||g|| = maxNorm に
//   sensitivity bound として DP の前提条件
function clipGradient(grad, maxNorm) {
  if (!Array.isArray(grad)) return grad;
  const m = Math.max(0.001, maxNorm || 1.0);
  const n = _l2Norm(grad);
  // 常に NaN/Infinity を 0 に sanitize（DP 入力の前提条件）
  if (n <= m || n === 0) return grad.map((g) => (Number.isFinite(g) ? g : 0));
  const scale = m / n;
  return grad.map((g) => (Number.isFinite(g) ? g * scale : 0));
}

// ── Gaussian noise mechanism ───────────────────────────
//   各次元に N(0, sigma^2) を加算
function addGaussianNoise(grad, sigma) {
  if (!Array.isArray(grad)) return grad;
  const s = Math.max(0, sigma || 0);
  if (s === 0) return grad.slice();
  return grad.map((g) => (Number.isFinite(g) ? g + _sampleStdNormal() * s : 0));
}

// ── 一括適用: clip → noise ───────────────────────────────
function buildDPGradient(grad, opts) {
  const o = opts || {};
  const clipped = clipGradient(grad, o.maxNorm != null ? o.maxNorm : 1.0);
  return addGaussianNoise(clipped, o.sigma != null ? o.sigma : 0.1);
}

// ── DP パラメータ推定 ───────────────────────────────────
//   (epsilon, delta) DP で T ステップ学習する場合に必要な sigma を返す。
//   分析的近似: sigma >= sqrt(2 * ln(1.25/delta)) * sensitivity / epsilon
//   T ステップ合成で moments accountant 等を本来は使うが、scaffold として簡易式。
function estimateDPParams(epsilon, delta, T) {
  const eps = Math.max(0.01, epsilon || 1.0);
  const dlt = Math.max(1e-9, delta || 1e-5);
  const t = Math.max(1, T || 100);
  const sensitivity = 1.0; // clipGradient で 1.0 に bound 済前提
  // T ステップで privacy 予算を split する素朴 composition
  const epsPerStep = eps / Math.sqrt(t);
  const sigma = (Math.sqrt(2 * Math.log(1.25 / dlt)) * sensitivity) / epsPerStep;
  return { sigma: sigma, epsPerStep: epsPerStep, T: t, epsilon: eps, delta: dlt };
}

// ── globalThis export ───────────────────────────────────
globalThis.clipGradient = clipGradient;
globalThis.addGaussianNoise = addGaussianNoise;
globalThis.buildDPGradient = buildDPGradient;
globalThis.estimateDPParams = estimateDPParams;
