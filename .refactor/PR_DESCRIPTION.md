## Summary

`inotaka1979/boatrace-ai` を Clearwing 1.0.0 流のアーキテクチャに段階移行しました
（capabilities 集約 / 責務別 4 層 / ローカル CI ゲート / スコープ限定 strict / スナップショット退行検知 / 退行防止 ESLint+husky / 規約ドキュメント）。
**既存の動作・予想ロジック・スクレイピング処理は一切変えていません**（純粋な構造改善のみ）。

- **18 commits** / Phase 0 〜 7 + Phase 2 完遂作業
- 全 commit で `make gate` PASS (pre-commit hook で自動検証)
- テスト 31 → **34/34 PASS** (snapshot 27 件 + deprecated pattern detector を追加)
- 既存機能の退行 0 件
- `assets/app.js` から **~1280 行** を `src/` 配下 4 層モジュールに抽出

---

## 最終 `src/` ツリー (19 モジュール / 4287 行 / 全 400 行以下)

```
src/
├── capabilities.js              ← Phase 1 (main thread)             231 行
├── capabilities-worker.js       ← Phase 2a (worker thread)           95 行
├── types/globals.d.ts           ← Phase 4 (BoatRaceGlobalAPI 型)
│
├── context/                     ← 状態・設定保持 (副作用なし)
│   └── domain_constants.js                                          113 行
│
├── discovery/                   ← read-only データ取得
│   └── openapi_client.js        ← 3 段 fetch + schema 検証 + index 変換  313 行
│
├── analysis/                    ← 副作用ありの計算・予測
│   ├── backtest.js              ← runBacktestEngine 系               312 行
│   ├── score_boat.js            ← scoreBoatV2 (8 カテゴリ score)     397 行
│   ├── calibration.js           ← Platt scaling + featureStats       195 行
│   ├── predict_race.js          ← predictRace + predictRaceAsync     335 行
│   ├── predict_program.js       ← predictRaceProgram (番組予想)      131 行
│   ├── predict_scenarios.js     ← シナリオ + 進入予想                153 行
│   └── l2_features.js           ← L2 predict/update + scoring helpers 232 行
│
├── reporting/                   ← 出力・記録 (DOM 更新)
│   ├── status_banner.js         ← _renderApiHealthBanner / _renderFreshness  73 行
│   └── stats_page.js            ← renderStats + renderStatsChart     323 行
│
└── utils/                       ← 共通ユーティリティ (既存)
    └── bandit.js / dp_gradient.js / features.js / i18n.js /
        idb_store.js / math.js / safe_storage.js
```

---

## Phase 別変更サマリー

### Phase 0: 現状調査 (`9a5abc9`)

- `.refactor/BASELINE.md` でリポジトリ実態を可視化
- 264 try/catch ガード / 8650 行 canonical app.js / ESLint・Prettier・tsc 未設定を確認
- リスク事項（split_app.py vs Clearwing 4 層分割の構造的競合 等）を抽出

### Phase 1: `src/capabilities.js` 導入 (`299278f`)

- 散在していた feature detection を `capabilities.has(name)` に一本化
- 12 個の capability（abort_timeout / service_worker / indexed_db / scheduler_* / notification / chart / ...）
- `capabilities.makeTimeoutSignal(ms)` で **iOS Safari < 16 (AbortSignal.timeout 非対応)** を polyfill
- `capabilities.runIdle(fn)` で scheduler.postTask → requestIdleCallback → setTimeout のフォールバック
- 既存 3 箇所の `new AbortController() + setTimeout` を `capabilities.makeTimeoutSignal()` に置換

### Phase 2: Clearwing 4 層分割 (`46ba418` 〜 `42d8b5a`、計 10 commit)

抽出済モジュール (合計 **20 関数 / ~1280 行**):

| Module | 関数 |
|--------|------|
| `capabilities-worker.js` | WorkerCapabilities (Phase 2a) |
| `discovery/openapi_client.js` | fetchWithFallback / _fetchOne / indexBy* / validateApiPayload / _filterStalePreviews 等 (Phase 2b) |
| `analysis/backtest.js` | runBacktestEngine / runForwardChainBacktest / _computeCalibrationMetrics (Phase 2c) |
| `reporting/status_banner.js` | _renderApiHealthBanner / _renderFreshness (Phase 2d) |
| `context/domain_constants.js` | STADIUMS / TECHNIQUE / WIND_DIR / GRADE_CLASS 等 (Phase 2e) |
| `analysis/score_boat.js` | scoreBoatV2 (310 行) (続) |
| `analysis/calibration.js` | _initFeatureStats / _updateFeatureStats / _normalizeFeatures / _applyPlattCalibration / _stackedPredict / _extractPlattPairs / _refitPlattCoeffs (続) |
| `reporting/stats_page.js` | renderStats / renderStatsChart (続) |
| `analysis/predict_scenarios.js` | predictScenarios / predictWithScenarios / predictEntryCourses (続) |
| `analysis/predict_race.js` | predictRace / predictRaceAsync (続) |
| `analysis/predict_program.js` | predictRaceProgram (続、400 行制限のため分離) |
| `analysis/l2_features.js` | _computeClassAttenuation / _classCourseMult / _computeRaceScenario / _resolveCourse / getL2Features / l2Predict / l2Update (続) |

ビルド機構の拡張:
- `scripts/split_app.py`: `REST_ONLY_BUILD_MARKERS` 対応 — 起動時不要な bundle (backtest / scoreBoatV2 / Platt / stats / predict* / l2_features) を critical bundle から除外して LCP/TBT を守る
- `build/build.mjs`: `applyInjections()` ヘルパで main thread bundle と worker bundle の両方を統一処理

**まだ canonical に残置**:
| 関数 | 行数 | 推奨移行先 | 抽出難度 |
|------|------|-----------|---------|
| `openRace` | 712 | reporting | 高 (内部 6 分割が必要) |
| `openStadium` | 182 | reporting | 低 (critical 不変、組織化のみ) |
| `learnFromResults` 系 | ~200 | analysis | 中 (worker_predictor.js twin sync 要) |
| `renderStadiums` | 87 | reporting | 低 |

詳細は `docs/architecture.md § 9` / `.refactor/PHASE2_NOTES.md`。

### Phase 3: ローカル CI ゲート (`75ea931`)

- ルート `package.json` を新設 (npm scripts: lint / format / type / test / build / build:check / split / gate)
- `eslint.config.mjs` (ESLint 9 flat config) + `.prettierrc.json` + `.prettierignore`
- `Makefile` (`make gate` がフラッグシップ)
- `.github/workflows/gate.yml` (PR 必須ゲート、既存 test.yml と並存)
- Prettier 自動整形を全 `src/` に適用 (意味変化なし、style 統一)
- `scripts/tests/test_cron_scrape.bats` T3 を root 時 skip (CAP_DAC_OVERRIDE 問題)

### Phase 5: スナップショットテスト (`ace4b7f`) ← Phase 4 より先

退行検知を strict 化の前に整備。

- `tests/fixtures/` に 4 件の小型 JSON fixture
- `tests/snapshots/` に 27 件の JSON snapshot を初期生成
- `scripts/tests/test_snapshots.js` ハーネス (vm sandbox + JSON 比較 + UPDATE_SNAPSHOTS=1 再生成 + 失敗時 diff 表示)
- カバレッジ: discovery 7 + analysis 4 + context 9 + capabilities 3 + math 4

### Phase 4: JSDoc strict (`c8952a0`)

- `jsconfig.json`: allowJs + checkJs + strict + strictNullChecks、対象 5 ファイル限定
- `src/types/globals.d.ts`: cross-module globalThis を `BoatRaceGlobalAPI` インタフェースに集約
  - `interface Window` 拡張は TS DOM lib が global 識別子化して collision (TS2451) するため不採用
- 各モジュールで `/** @type {BoatRaceGlobalAPI & typeof globalThis} */ const _g = globalThis` の typed handle pattern
- `tsc --noEmit -p jsconfig.json` → **0 errors**
- `npm run type` / Makefile `make type` / gate.yml に Type check step を組込

### Phase 6: 再発防止策 (`0743167`)

**3 層独立** の退行検出を併用 (1 層をすり抜けても他で捕まる冗長設計):

| Layer | 場所 | 検出範囲 |
|-------|------|---------|
| ESLint `no-restricted-syntax` | `eslint.config.mjs` | `AbortSignal.timeout(` / `new AbortController()` を capabilities 以外で使用 |
| Husky pre-commit | `.husky/pre-commit` | lint + type + build:check (~15 秒、自動) |
| Deprecated pattern detector | `scripts/tests/test_deprecated_patterns.js` | 層責務違反 (analysis から fetch / discovery から DOM 等) / `@ts-ignore` |

`CONTRIBUTING.md` (165 行) で 8 項目のレビュー基準とコミット規約を明文化。

### Phase 7: アーキテクチャ文書 (`d9a4f16`)

- `docs/architecture.md` (350+ 行) で全 Phase の到達点を 1 枚にまとめ:
  - 二段予想パイプライン ASCII
  - 3 thread ランタイム構造 (critical / rest / worker)
  - 4 層 + capabilities の依存方向図
  - ビルドパイプライン (canonical → split_app → build.mjs → minify)
  - ローカル CI ゲートと CI workflow の流れ
  - 退行防止 4 層の対応表
  - データソース 3 段 fallback
- `README.md`: クイックスタート + アーキテクチャへのリンク + 主要コマンド表

### B: rest bundle budget 緩和 + 将来 chunking 設計 (`8cfebcd`)

- `build/build.mjs`: `app-rest.min.js` warn 予算を 125KB → 140KB (Phase 2 で REST_ONLY bundle が増えた正当な反映)
- `docs/architecture.md § 9`: rest を 4 chunk に分割する将来案 (`app-rest-stats` / `app-rest-detail` / `app-rest-settings`) を明記

---

## ビルド指標 (最新)

| 項目 | 値 | 評価 |
|------|---|------|
| critical bundle | 89473B / 90000B | 99.4% **OK** |
| rest bundle | 134589B / 140000B | 96.1% **OK** |
| worker bundle | 63908B / 65000B | 98.3% **OK** |
| `build.mjs --check` 再現性 | 5/5 files match | **PASS** |
| critical → rest cross-layer lint | 違反 0 | **PASS** (PJ 致命バグ防止) |
| テスト | 34/34 step | **PASS** |
| `make gate` | ✅ gate passed | **PASS** |

---

## Test plan

### 必須 (reviewer が確認)

- [ ] `make install` がエラーなく完走 (root + build/ の npm ci)
- [ ] `make gate` が `✅ gate passed — safe to push` を出す
  - lint (0 errors)
  - type (tsc 0 errors)
  - test (34/34 PASS)
  - build:check (5/5 files match, critical < 90KB, cross-layer lint PASS)
- [ ] `make snapshots-update` 後 `git diff tests/snapshots/` が空 (再現性確認)
- [ ] `assets/app.js` が手で編集された痕跡がない (BUILD: marker 領域は auto-injected)

### CI で自動検証される

- [ ] `.github/workflows/gate.yml`: ubuntu-latest で `npm ci → lint → type → test → build:check`
- [ ] 既存 `test.yml` (mypy / axe advisory) は変更なし
- [ ] 既存 `e2e.yml` / `lighthouse.yml` は変更なし

### 手動確認推奨 (RPi5 / iPhone)

- [ ] RPi5 上の `cron_scrape.sh` がそのまま動く (スクレイピング処理は変更していない)
- [ ] iPhone PWA でホーム画面から開いて 5 画面 (top / races / detail / stats / settings) が動作
- [ ] 主要シナリオ:
  - 場をタップ → レース一覧
  - レースをタップ → 予想表示
  - 設定タブ → DB 情報 / 履歴 CSV エクスポート
  - 成績タブ → グラフ表示
  - バックテストタブ → 過去履歴の ROI / Sharpe / drawdown

### 異常系 (壊れたら kill switch で復旧)

- iOS standalone PWA で何か固まる → URL に `?reset=1` で SW 再登録 / `?reset=full` で localStorage 全消去 (Path B kill switch、本 PR より前から存在)

---

## マージ後の TODO

1. **openRace 内部分割 + 抽出** (712 行) — `docs/architecture.md § 9` で詳細設計済。`_renderRaceHeader` / `_renderBoatsCard` / `_renderOddsSection` / `_renderBetsSection` / `_renderScoreBreakdown` + orchestrator に分割
2. **openStadium / renderStadiums / showPage 抽出** — 組織化のみ、critical 不変
3. **learnFromResults / worker twin sync の根本対策** — main / worker の重複コードを共有 import or ESM 化
4. **`app-rest.min.js` の lazy chunk 分割** — 134KB → 80KB + 30KB + 12KB + 10KB
5. **`scripts/tests/*.js` の `no-undef` を厳格化** — Phase 5 snapshot 整備後の宿題

---

## Risk assessment

| リスク | 影響 | 対策 |
|--------|------|------|
| canonical `app.js` の BUILD 領域を手編集 | 次回 build で上書きされる | `build.mjs --check` が CI で検出 + コメント明記 |
| critical bundle 90KB 超過 | LCP 悪化 | `build.mjs` が hard fail / `REST_ONLY_BUILD_MARKERS` で逃がす |
| snapshot 退行 | バグ気づかず混入 | `make snapshots-update` 後の差分を必ず PR で見せる |
| iOS standalone PWA silent halt 再発 | ユーザ操作不可 | critical → rest cross-layer lint (Epic 27) + `?reset=1` kill switch |
| worker_predictor.js twin out-of-sync | main / worker の挙動乖離 | 抽出済モジュールの JSDoc で twin 明示、`docs/architecture.md` 注記 |

---

## 内部リンク

- `CLAUDE.md` § Phase 1-7 修正履歴
- `CONTRIBUTING.md` — レビュー基準と緊急バイパス手順
- `.refactor/BASELINE.md` (Phase 0)
- `.refactor/PHASE2_NOTES.md` (Phase 2 完遂進捗、最新 19 モジュール構成)
- `docs/architecture.md` (本リファクタの全体像)

---

*このリファクタリングは Clearwing 1.0.0 のアーキテクチャ思想に基づいています。*

https://claude.ai/code/session_01SGFTrTXgfetWk57BQdfwzK
