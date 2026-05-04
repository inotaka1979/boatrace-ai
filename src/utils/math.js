// PE-10 (PC-7 Step 3): math モジュール
//
// 共通数値計算ヘルパ:
//   - softmax (PB-4 のオンライン softmax 実装)
//   - sigmoid (PB-6 Platt scaling 用)
//   - safeDiv (P3 L-06 の 0 除算ガード)
//   - _plackettLuceTrifectaProb / _plackettLuceExactaProb (PB-4)
//
// グローバル export してインライン JS の同名関数を上書き

'use strict';

// 数値安定化版 softmax (NaN/Infinity 入力でも崩れない)
function softmax(logits) {
  if (!Array.isArray(logits) || logits.length === 0) return [];
  const clean = logits.map((v) => (Number.isFinite(v) ? v : 0));
  let max = clean.reduce((a, b) => (b > a ? b : a), -Infinity);
  if (!Number.isFinite(max)) max = 0;
  const exps = clean.map((v) => Math.exp(Math.min(v - max, 50)));
  const sum = exps.reduce((a, b) => a + b, 0);
  if (sum === 0 || !Number.isFinite(sum)) return clean.map(() => 1 / clean.length);
  return exps.map((x) => x / sum);
}

// sigmoid (overflow 安全)
function sigmoid(z) {
  if (z > 30) return 1.0;
  if (z < -30) return 0.0;
  return 1.0 / (1.0 + Math.exp(-z));
}

// safeDiv: 0 除算 / NaN 入力で fallback (既定 0) を返す
function safeDiv(num, den, fallback) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return (fallback == null) ? 0 : fallback;
  }
  return num / den;
}

// PB-4: Plackett–Luce 3 連単確率
function _plackettLuceTrifectaProb(p, i, j, k) {
  const pi = p[i] || 0, pj = p[j] || 0, pk = p[k] || 0;
  if (pi <= 0 || pj <= 0 || pk <= 0) return 0;
  const denom1 = 1 - pi;
  if (denom1 <= 1e-9) return 0;
  const denom2 = 1 - pi - pj;
  if (denom2 <= 1e-9) return 0;
  const prob = pi * (pj / denom1) * (pk / denom2);
  return Number.isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0;
}

function _plackettLuceExactaProb(p, i, j) {
  const pi = p[i] || 0, pj = p[j] || 0;
  if (pi <= 0 || pj <= 0) return 0;
  const denom = 1 - pi;
  if (denom <= 1e-9) return 0;
  const prob = pi * (pj / denom);
  return Number.isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0;
}

// グローバル export
globalThis.softmax = softmax;
globalThis.sigmoid = sigmoid;
globalThis.safeDiv = safeDiv;
globalThis._plackettLuceTrifectaProb = _plackettLuceTrifectaProb;
globalThis._plackettLuceExactaProb = _plackettLuceExactaProb;
