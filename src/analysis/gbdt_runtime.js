// Tier 3 scaffold (2026-05-24): Gradient Boosted Decision Trees (GBDT) ランタイム
//
// 目的:
//   L1 (ルールベース) + L2 (ロジスティック回帰) の上に **第 3 層**として
//   GBDT を載せ、非線形 feature 交互作用を学習する。LightGBM 系の研究
//   (tsuyoshiyasuda: 61 features + LightGBM Ranker、daruma: 208 features
//   + multitask PyTorch) との性能ギャップを縮める設計。
//
// アーキテクチャ:
//   1. **オフライン学習** (GitHub Actions cron): scripts/train_gbdt.py が
//      collected results から trees を学習し、data/db/gbdt_model.json を
//      生成・commit する (community_weights.json と同じパイプライン)。
//   2. **JS runtime** (本ファイル): 学習済 trees を tree traversal で評価。
//      LightGBM 互換の JSON 形式を 1 ファイルで実装、外部依存ゼロ。
//   3. **予測統合**: predict_race.js / predict_program.js が
//      L1 logit + L2 logit + GBDT logit の重み付き和を softmax (現状未配線、
//      scaffold のみ)。
//
// なぜスキャフォルドか:
//   GBDT の真価は実データ ≥ 5000 races で発揮される。現状 ~900 races は
//   過学習リスク大、線形モデル (Isotonic + per-stadium Platt) の改善で
//   十分。本ファイルは「データ蓄積後に直ちに有効化」できる準備として
//   コード + JSON schema を確定させる。
//
// アクティベーション手順 (将来):
//   1. `scripts/requirements.txt` に `lightgbm==X.Y.Z` + `numpy` 追加
//   2. `scripts/train_gbdt.py` の TODO を実装
//   3. `.github/workflows/train-gbdt.yml` の cron を有効化 (現状 dispatch のみ)
//   4. `predict_race.js` で `_blendGBDTPrediction` を呼ぶよう配線
//   5. settings タブに ENABLE_GBDT トグル追加

'use strict';

/**
 * GBDT モデル JSON schema (v1):
 * {
 *   "schema": "br_gbdt_v1",
 *   "feature_dim": 24,
 *   "feature_version": 2,
 *   "n_classes": 6,                // 1..6 号艇それぞれの logit (多クラス one-vs-rest)
 *   "trees": [
 *     {
 *       "class": 0,                 // 0..5 = 1..6 号艇
 *       "nodes": [
 *         {"feat": 3, "thr": 0.5, "left": 1, "right": 2},  // 内部ノード
 *         {"value": 0.13},                                  // 葉ノード (logit 寄与)
 *         {"value": -0.07}
 *       ]
 *     },
 *     ...
 *   ],
 *   "n_trees": 100,
 *   "learning_rate": 0.1,
 *   "fitted_at": "2026-...",
 *   "n_train": 5000,
 *   "_meta": { ... }
 * }
 */

/** @type {BoatRaceGlobalAPI & typeof globalThis} */
const _g = /** @type {any} */ (globalThis);

/**
 * 単一決定木を traverse し、入力 features に対する leaf value を返す。
 * @param {{nodes: Array<{feat?: number; thr?: number; left?: number; right?: number; value?: number}>}} tree
 * @param {number[]} features - 長さ FEATURE_DIM の特徴量配列
 * @returns {number} 葉ノードの value (logit 寄与)
 */
function _traverseTree(tree, features) {
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) return 0;
  let idx = 0;
  // 最大深さガード (無限ループ防止)
  for (let depth = 0; depth < 64; depth++) {
    const node = tree.nodes[idx];
    if (!node) return 0;
    // 葉ノード判定
    if (typeof node.value === 'number' && Number.isFinite(node.value)) {
      return node.value;
    }
    // 内部ノード
    if (typeof node.feat !== 'number' || typeof node.thr !== 'number') return 0;
    const fv = features[node.feat];
    const fvNum = Number.isFinite(fv) ? fv : 0;
    idx = fvNum <= node.thr ? (node.left || 0) : (node.right || 0);
    if (idx <= 0 || idx >= tree.nodes.length) return 0;
  }
  return 0;
}

/**
 * GBDT モデル全体を評価し、6 艇それぞれの logit を返す。
 * @param {{trees: Array<{class: number; nodes: any[]}>; learning_rate?: number; n_classes?: number}} model
 * @param {number[]} features - 長さ FEATURE_DIM
 * @returns {number[]} 6 要素 logit 配列 (index 0..5 = 1..6 号艇)
 */
function gbdtPredictLogits(model, features) {
  if (!model || !Array.isArray(model.trees)) return [0, 0, 0, 0, 0, 0];
  const lr = Number.isFinite(model.learning_rate) ? model.learning_rate : 0.1;
  const nClasses = model.n_classes || 6;
  const logits = new Array(nClasses).fill(0);
  for (let t = 0; t < model.trees.length; t++) {
    const tree = model.trees[t];
    if (!tree || typeof tree.class !== 'number') continue;
    if (tree.class < 0 || tree.class >= nClasses) continue;
    logits[tree.class] += lr * _traverseTree(tree, features);
  }
  return logits;
}

/**
 * predict_race.js / predict_program.js から呼ばれる blend エントリ。
 * 現状は scaffold のため GBDT model が無い / 学習データ不足のときは何もしない。
 *
 * @param {number[]} currentLogits - L1+L2 から既に算出済の 6 艇 logit
 * @param {number[][]} features6 - 6 艇分の特徴量 (各 FEATURE_DIM 次元)
 * @param {number} [weight=0.3] - GBDT の混合比 (0=完全無視、1=GBDT のみ)
 * @returns {number[]} blend 後の 6 艇 logit (元配列は変更しない)
 */
function _blendGBDTPrediction(currentLogits, features6, weight) {
  // フラグで完全無効化 (将来 settings 経由で有効化)
  const enabled = _g.TUNING && _g.TUNING.PREDICTION && _g.TUNING.PREDICTION.ENABLE_GBDT;
  if (!enabled) return currentLogits;
  // モデル未取得 / 未学習なら no-op
  const model = _g._gbdtModel;
  if (!model || !Array.isArray(model.trees) || model.trees.length === 0) return currentLogits;
  // データ不足 (5000 件未満) なら no-op — 過学習 risk
  if (typeof model.n_train === 'number' && model.n_train < 5000) return currentLogits;

  const w = Number.isFinite(weight) ? weight : 0.3;
  const out = currentLogits.slice();
  for (let b = 0; b < out.length && b < 6; b++) {
    const gbdtLogits = gbdtPredictLogits(model, features6[b] || []);
    const gbdtSelf = gbdtLogits[b] || 0;
    out[b] = (1 - w) * out[b] + w * gbdtSelf;
  }
  return out;
}

// 注: data/db/gbdt_model.json を fetch する loadGBDTModel は no-fetch-in-analysis
//   ルールのため assets/app.js 側に置く (community_weights と同じパターン)。
//   本ファイルは pure compute (tree traversal + blend) のみに限定する設計。

// globalThis export
_g._traverseTree = _traverseTree;
_g.gbdtPredictLogits = gbdtPredictLogits;
_g._blendGBDTPrediction = _blendGBDTPrediction;
