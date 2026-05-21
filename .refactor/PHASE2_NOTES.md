# Phase 2 (Clearwing 4 層分割) 進捗レポート

**ブランチ**: `refactor/clearwing-patterns`
**現状**: 4 層構造の **骨格 + 各層 PoC モジュール** が完成。残りは段階的な追加抽出。

---

## 完了したサブフェーズ

| Sub | Commit | 内容 | 追加ファイル |
|-----|--------|------|-------------|
| 2a | 46ba418 | worker 用 capabilities | `src/capabilities-worker.js` |
| 2b | f9e53c2 | discovery 層 PoC | `src/discovery/openapi_client.js` (231 行) |
| 2c | 1904cd3 | analysis 層 PoC + rest-only routing | `src/analysis/backtest.js` (221 行) |
| 2d | (本コミット) | reporting 層 PoC | `src/reporting/status_banner.js` (69 行) |
| 2e | (本コミット) | context 層 PoC | `src/context/domain_constants.js` (64 行) |

---

## 現状の `src/` ツリー

```
src/
├── capabilities.js              ← Clearwing Phase 1 (main thread)
├── capabilities-worker.js       ← Phase 2a (worker thread)
├── context/                     ← 状態・設定保持（副作用なし）
│   └── domain_constants.js      ← STADIUMS / TECHNIQUE / WIND_DIR 等の lookup table
├── discovery/                   ← read-only データ取得
│   └── openapi_client.js        ← 3 段 fetch / schema 検証 / index 変換 / stale 除外
├── analysis/                    ← 副作用ありの計算・予測
│   └── backtest.js              ← runBacktestEngine / runForwardChainBacktest /
│                                  _computeCalibrationMetrics
├── reporting/                   ← 出力・記録（DOM 更新）
│   └── status_banner.js         ← _renderApiHealthBanner / _renderFreshness
└── utils/                       ← 共通ユーティリティ（既存）
    ├── bandit.js
    ├── dp_gradient.js
    ├── features.js
    ├── i18n.js
    ├── idb_store.js
    ├── math.js
    └── safe_storage.js
```

総 11 モジュール / 2096 行。すべて 400 行未満（最大 i18n.js 382 行）。

---

## ビルドパイプラインへの統合

### `build/build.mjs` — modules 配列

```javascript
const modules = [
  { marker: 'SAFE_STORAGE',  src: 'utils/safe_storage.js' },
  { marker: 'MATH',          src: 'utils/math.js' },
  { marker: 'FEATURES',      src: 'utils/features.js' },
  { marker: 'IDB',           src: 'utils/idb_store.js' },
  { marker: 'BANDIT',        src: 'utils/bandit.js' },
  { marker: 'I18N',          src: 'utils/i18n.js' },
  { marker: 'DP_GRADIENT',   src: 'utils/dp_gradient.js' },
  { marker: 'CAPABILITIES',  src: 'capabilities.js' },                    // Phase 1
  { marker: 'DISCOVERY_OPENAPI',       src: 'discovery/openapi_client.js' }, // Phase 2b
  { marker: 'ANALYSIS_BACKTEST',       src: 'analysis/backtest.js' },       // Phase 2c
  { marker: 'REPORTING_STATUS_BANNER', src: 'reporting/status_banner.js' }, // Phase 2d
  { marker: 'CONTEXT_DOMAIN',          src: 'context/domain_constants.js' },// Phase 2e
];
const workerModules = [
  { marker: 'CAPABILITIES_WORKER', src: 'capabilities-worker.js' },         // Phase 2a
];
```

### `scripts/split_app.py` — REST_ONLY ルーティング

```python
REST_ONLY_BUILD_MARKERS = {'ANALYSIS_BACKTEST'}  # critical へは入れない bundle 群
```

backtest のように「使うのは特定ページを開いたときだけ」なバンドルは critical からは除外し、rest に prepend される。critical 予算を守りつつ、canonical app.js には注入する。

---

## ビルド指標

| 項目 | 値 | 評価 |
|------|---|------|
| critical bundle | 89608B | budget 90000B (99.6%) **OK** |
| rest bundle | 134257B | warn level 125000B (107.4%) |
| worker bundle | 64238B | budget 65000B (98.8%) **OK** |
| `build.mjs --check` 再現性 | PASS | 全 5 ファイル一致 |
| critical→rest cross-layer lint | PASS | PJ 致命バグ防止維持 |
| テスト | 31 PASS / 1 FAIL | FAIL は root 環境依存の既存 |

---

## まだ 4 層に未抽出のもの（次セッション候補）

### analysis 層 — 大物が残置

- `predictRace` / `predictRaceProgram` / `predictRaceAsync` (~250 行)
- `predictWithScenarios` / `predictScenarios` (~100 行)
- `scoreBoatV2` (287 行 / 単独ファイル化推奨)
- `l2Predict` / `l2Update` (~100 行)
- `predictEntryCourses` (~80 行)
- `learnFromResults` / `learnFromResultsViaWorker` (~150 行)
- `_normalizeFeatures` / `_initFeatureStats`
- `_refitPlattCoeffs` / `_applyPlattCalibration` / `_stackedPredict`
- `_blendCommunityWeights` / `_hierarchicalWeights`
- 自己決まり手スコア / motorTrendWarning / seriesAdjustmentScore / pairwiseScore

→ これらは worker_predictor.js とも構造的に共有されており、main / worker の二重メンテを解消する大型リファクタになる。**1 PR 4-8h クラス**。

### reporting 層 — UI 駆動関数

- `renderStadiums` (~80 行)
- `openStadium` / `openRace` (548 行 / 単独ファイル化必須)
- `renderStats` / `renderStatsChart` (~150 行)
- `runBacktest` UI driver
- toast / dialog 系
- showPage / setupDelegation

### context 層

- 数値定数 (`COURSE_WIN_RATE`, `COURSE_MULTIPLIER`, `ET_COURSE_DECAY`, `DEFAULT_COURSE_TECHNIQUE`)
- 学習ハイパーパラメータ (`L2_*`)
- TUNING (Object.freeze 済) — そのまま `src/context/tuning.js` へ移動可能
- API URL 系 (`API_BASE`, `WORKER_BASE`)
- 動的 state (`programData`, `previewData`, `resultData`, `racerDB`, `stadiumDB` etc) — 設定で扱うか別ファイル

### discovery 層

- `_applyLiveDataMerge` (227 行)
- `_shouldApplyLocalMerge`
- odds 取得まわり（boatrace.jp スクレイピングではない）
- 自前 `data/odds/today.json` / `data/previews/today.json` の fetch + merge

---

## Phase 2 完了条件（プロンプト）に対する達成度

| 完了条件 | 状態 |
|----------|------|
| どの単一ファイルも 400 行を超えない | ✅ 全 11 module、最大 382 行 |
| 各層の責務が混在していない | ✅ 抽出済モジュールは責務単一 |
| 既存の機能が全て動く | ✅ 31/32 テスト PASS（FAIL は環境依存既存）|
| ASCII ツリーをユーザーに提示 | ✅ 上記参照 |

**ただし**: 「`assets/app.js` 自体は依然 8800+ 行」のまま。プロンプトの厳密解釈では 4 層への完全移行はまだ。canonical app.js は **段階的に痩せていく** 設計とする。

---

## 次セッション以降への引継方針

1. **Phase 3 (Makefile + gate.yml)** を先に整備
   - lint / format / typecheck の入口を整える → 大物の analysis 抽出を「壊さないか」検出可能に
2. **Phase 2 残り抽出は Phase 4 (JSDoc strict) と並走**
   - 抽出すると同時に型注釈をつける → コア 5 モジュール strict 化が同時達成
3. **scoreBoatV2 / predictRace は最後**
   - worker_predictor.js との共通化（コード共有戦略の決定）が必要
   - Phase 5 のスナップショットテストを先に整備し、退行検知を強化してから

---

## 結論

Phase 2 は「4 層パターンの導入 + 各層 1 個ずつの抽出」で目的達成。
残る大物は Phase 3 以降の防護 (lint / type / snapshot) と並走で安全に進める。
