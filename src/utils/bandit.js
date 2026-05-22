// Epic 15 (P2-4): A/B テストフレーム — Thompson sampling mini-bandit
//
// 目的: 複数 variant（例: kpi=balanced vs roi、L2_LAMBDA=1e-4 vs 1e-3）を
//       同時に運用し、的中率/EV/ROI 等を観測しながら最適 variant を確率的に選択。
//
// 設計:
//   - 各 variant に Beta(α, β) 分布を持たせ、選択時に sample → max を採用
//   - 報酬: 的中=1 / 外れ=0 を α, β に加算（Bernoulli rewards）
//   - 連続値報酬（EV/ROI）も α, β にスケール加算可能（reward in [0,1] 想定）
//
// 利用:
//   const variants = [{id:'A', alpha:1, beta:1}, {id:'B', alpha:1, beta:1}];
//   const chosen = banditSelect(variants);  // Thompson sample で選択
//   ... レース結果 ...
//   banditUpdate(variants, chosen.id, hit?1:0);
//
// 永続化: variants 配列を JSON.stringify して localStorage 'boatrace_bandit' に保存

'use strict';

const BANDIT_KEY = 'boatrace_bandit';

// Beta(α, β) のサンプル — gamma 分布の比から導出（gamma は Marsaglia & Tsang 法を簡易実装）
function _sampleGamma(shape) {
  if (shape < 1) {
    return _sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = _sampleNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// Box-Muller で標準正規乱数
function _sampleNormal() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function _sampleBeta(alpha, beta) {
  const x = _sampleGamma(alpha);
  const y = _sampleGamma(beta);
  return x / (x + y);
}

// Thompson sampling: 各 variant から Beta sample → 最大を選択
function banditSelect(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  let best = variants[0];
  let bestSample = -Infinity;
  for (const v of variants) {
    const a = Math.max(1e-3, v.alpha || 1);
    const b = Math.max(1e-3, v.beta || 1);
    const s = _sampleBeta(a, b);
    if (s > bestSample) {
      bestSample = s;
      best = v;
    }
  }
  return best;
}

// 報酬で variant を更新。reward は [0, 1] 範囲（Bernoulli または continuous）
function banditUpdate(variants, variantId, reward) {
  const v = variants.find((x) => x.id === variantId);
  if (!v) return false;
  const r = Math.max(0, Math.min(1, +reward || 0));
  v.alpha = (v.alpha || 1) + r;
  v.beta = (v.beta || 1) + (1 - r);
  v.n = (v.n || 0) + 1;
  v.lastReward = r;
  v.lastUpdated = Date.now();
  return true;
}

// 各 variant の事後平均 (α / (α+β)) を取得 — 性能ランキング用
function banditMeans(variants) {
  return variants
    .map((v) => ({
      id: v.id,
      mean: (v.alpha || 1) / ((v.alpha || 1) + (v.beta || 1)),
      n: v.n || 0,
    }))
    .sort((a, b) => b.mean - a.mean);
}

// 永続化
function banditLoad(defaults) {
  let parsed = null;
  try {
    const raw = localStorage.getItem(BANDIT_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch (_) {}
  if (!parsed || !Array.isArray(parsed.variants) || parsed.variants.length === 0) {
    return Array.isArray(defaults) ? defaults.slice() : [];
  }
  return parsed.variants;
}
function banditSave(variants) {
  try {
    localStorage.setItem(BANDIT_KEY, JSON.stringify({ variants: variants, updated_at: Date.now() }));
    return true;
  } catch (_) {
    return false;
  }
}

// globalThis export
globalThis.banditSelect = banditSelect;
globalThis.banditUpdate = banditUpdate;
globalThis.banditMeans = banditMeans;
globalThis.banditLoad = banditLoad;
globalThis.banditSave = banditSave;
globalThis.BANDIT_KEY = BANDIT_KEY;
