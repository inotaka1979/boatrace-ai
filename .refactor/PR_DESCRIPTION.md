# refactor: Phase 2 完遂 — extract scoreBoatV2 / Platt / predictRace / l2_features / stats_page

## Summary — PR #45 のフォローアップ

[PR #45](https://github.com/inotaka1979/boatrace-ai/pull/45) で Phase 0〜7 (Clearwing 4 層骨格 + ローカル CI ゲート + snapshot + JSDoc strict + 退行防止 + アーキテクチャ docs) を導入しました。本 PR (#46) はその **Phase 2 完遂作業** で、当時 canonical `assets/app.js` に残置していた大型関数群を `src/{analysis,reporting}/` 配下へ追加抽出します。

- **8 commits** / 21 files changed (+4917 / -2613)
- **既存の動作・予想ロジック・スクレイピング処理は一切変えていません**（純粋な構造改善のみ）
- 全 commit で `make gate` PASS (.husky/pre-commit で自動検証)
- テスト 34/34 PASS / snapshot 27/27 (バイト同一) / build.mjs --check PASS

---

## 本 PR で追加抽出した関数 (~1000 行)

| Commit | Module | 主な関数 |
|--------|--------|---------|
| `0d75e41` | `src/analysis/score_boat.js` (397 行) | **scoreBoatV2** (8 カテゴリ score、310 行) |
| `8cfebcd` | `build/build.mjs` + `docs/architecture.md` | rest budget 125KB → 140KB + 将来 chunking 設計 |
| `7e1b4e0` | `src/analysis/calibration.js` (195 行) + `src/reporting/stats_page.js` (323 行) | Platt scaling 関連 7 関数 + renderStats / renderStatsChart |
| `686513e` | `src/analysis/predict_race.js` (335 行) + `src/analysis/predict_scenarios.js` (153 行) | predictRace / predictRaceAsync / predictScenarios / predictWithScenarios / predictEntryCourses |
| `e692b12` | `src/analysis/l2_features.js` (232 行) | _computeRaceScenario / _resolveCourse / getL2Features / l2Predict / l2Update 等 |
| `42d8b5a` | `src/analysis/predict_program.js` (131 行) | predictRaceProgram (400 行制限のため predict_race から分離) |

合計 **20 関数 / ~1000 行**を canonical から抽出。

---

## 最新 `src/` ツリー (19 モジュール / 4287 行 / 全 400 行以下)

```
src/
├── capabilities.js              ← PR #45                            231 行
├── capabilities-worker.js       ← PR #45                             95 行
├── types/globals.d.ts           ← PR #45 (BoatRaceGlobalAPI 型)
├── context/domain_constants.js  ← PR #45                            113 行
├── discovery/openapi_client.js  ← PR #45                            313 行
│
├── analysis/
│   ├── backtest.js              ← PR #45                            312 行
│   ├── score_boat.js            ← ★ 本 PR                           397 行
│   ├── calibration.js           ← ★ 本 PR                           195 行
│   ├── predict_race.js          ← ★ 本 PR                           335 行
│   ├── predict_program.js       ← ★ 本 PR                           131 行
│   ├── predict_scenarios.js     ← ★ 本 PR                           153 行
│   └── l2_features.js           ← ★ 本 PR                           232 行
│
├── reporting/
│   ├── status_banner.js         ← PR #45                             73 行
│   └── stats_page.js            ← ★ 本 PR                           323 行
│
└── utils/ (既存、本 PR 変更なし)
```

最大ファイル: `src/analysis/score_boat.js` 397 行 (Clearwing 400 行制限以下)。

---

## ビルド機構の補強 (本 PR で追加)

- `scripts/split_app.py` の `REST_ONLY_BUILD_MARKERS` を 1 → 6 個に拡張
  - `ANALYSIS_SCORE_BOAT` / `ANALYSIS_CALIBRATION` / `REPORTING_STATS_PAGE` / `ANALYSIS_PREDICT_SCENARIOS` / `ANALYSIS_PREDICT_RACE` / `ANALYSIS_PREDICT_PROGRAM` / `ANALYSIS_L2_FEATURES`
  - 起動時不要な bundle (race 詳細 / 学習 / 設定でのみ使う) を critical bundle から除外 → LCP/TBT を守る
- `eslint.config.mjs`: 大型抽出モジュール (~20 globalThis ref を許容) の例外設定
- `scripts/tests/test_features_pipeline.js`: extractFn() を IIFE bundle 内 indented function 定義に対応 (brace 深度ベース)

---

## ビルド指標 (本 PR 後)

| 項目 | 値 | 評価 |
|------|---|------|
| critical bundle | 89473B / 90000B | 99.4% **OK** |
| rest bundle | 134589B / 140000B | 96.1% **OK** (warn 予算は本 PR で 125KB → 140KB に調整済) |
| worker bundle | 63908B / 65000B | 98.3% **OK** |
| build.mjs --check 再現性 | 5/5 files match | **PASS** |
| critical → rest cross-layer lint | 違反 0 | **PASS** (PJ 致命バグ防止) |
| テスト | **34/34 step PASS** | snapshot 27 件全バイト同一 |
| make gate | ✅ gate passed | **PASS** |

---

## まだ canonical `assets/app.js` に残置している関数 (次 PR 候補)

| 関数 | 行数 | 推奨移行先 | 抽出難度 |
|------|------|-----------|---------|
| `openRace` | **712** | reporting | 高 (内部 6 分割が必要、`docs/architecture.md § 9` で設計済) |
| `openStadium` | 182 | reporting | 低 (critical 不変、組織化のみ) |
| `learnFromResults` 系 | ~200 | analysis | 中 (worker_predictor.js twin sync 要) |
| `renderStadiums` | 87 | reporting | 低 |
| `showPage` | ~30 | reporting | 低 |

---

## 内部リンク

- [PR #45](https://github.com/inotaka1979/boatrace-ai/pull/45) — Phase 0-7 骨格 (本 PR の前提)
- `CONTRIBUTING.md` — レビュー基準と緊急バイパス手順
- `.refactor/PHASE2_NOTES.md` (Phase 2 完遂進捗、最新 19 モジュール構成)
- `docs/architecture.md` (本リファクタの全体像 + 残り抽出の設計)

