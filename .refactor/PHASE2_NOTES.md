# Phase 2 (Clearwing 4 層分割) 完遂進捗レポート

**ブランチ**: `refactor/clearwing-patterns`
**現状 (最新セッション)**: 4 層構造 + 主要関数群の抽出 大半完了。

---

## 完了済の分割

### サブフェーズ別 commit

| Sub | Commit | 内容 |
|-----|--------|------|
| 2a | 46ba418 | worker 用 capabilities |
| 2b | f9e53c2 | discovery/openapi_client.js |
| 2c | 1904cd3 | analysis/backtest.js + REST_ONLY routing |
| 2d/2e | 404eff3 | reporting/status_banner.js + context/domain_constants.js |
| (続) | 0d75e41 | analysis/score_boat.js (scoreBoatV2 310 行) |
| (続) | 8cfebcd | rest budget 緩和 + chunking 戦略 docs |
| (続) | 6cc3739 | PR description draft |
| (続) | 7e1b4e0 | analysis/calibration.js + reporting/stats_page.js |
| (続) | 686513e | analysis/predict_race.js + predict_scenarios.js |
| (続) | e692b12 | analysis/l2_features.js (scoreBoatV2 helpers + L2) |
| (続) | (本) | analysis/predict_program.js を predict_race から分離 (400 行制限遵守) |

---

## 現状の `src/` ツリー (19 モジュール / 4287 行 / 全 400 行以下)

```
src/
├── capabilities.js              ← Phase 1 (main thread)            231 lines
├── capabilities-worker.js       ← Phase 2a (worker thread)          95 lines
├── types/globals.d.ts           ← Phase 4 (BoatRaceGlobalAPI 型)
│
├── context/                     ← 状態・設定保持
│   └── domain_constants.js                                         113 lines
│
├── discovery/                   ← read-only データ取得
│   └── openapi_client.js                                           313 lines
│
├── analysis/                    ← 副作用ありの計算・予測
│   ├── backtest.js              ← runBacktestEngine 系             312 lines
│   ├── score_boat.js            ← scoreBoatV2 (8 カテゴリ score)   397 lines
│   ├── calibration.js           ← Platt scaling + featureStats     195 lines
│   ├── predict_race.js          ← predictRace + predictRaceAsync   335 lines
│   ├── predict_program.js       ← predictRaceProgram (番組予想)    131 lines
│   ├── predict_scenarios.js     ← シナリオ + 進入予想              153 lines
│   └── l2_features.js           ← L2 predict/update + helpers      232 lines
│
├── reporting/                   ← 出力・記録（DOM 更新）
│   ├── status_banner.js         ← _renderApiHealthBanner / _renderFreshness  73 lines
│   └── stats_page.js            ← renderStats + renderStatsChart   323 lines
│
└── utils/                       ← 共通ユーティリティ（既存）
    ├── bandit.js                                                   126 lines
    ├── dp_gradient.js                                               87 lines
    ├── features.js                                                 129 lines
    ├── i18n.js                                                     394 lines
    ├── idb_store.js                                                234 lines
    ├── math.js                                                      75 lines
    └── safe_storage.js                                             339 lines
```

**累計**: assets/app.js から ~1280 行を抽出 (本セッションのみ ~1000 行追加)。
**最大ファイル**: `src/analysis/score_boat.js` 397 行 (400 行制限以下)。

---

## ビルド指標 (最新)

| 項目 | 値 |
|------|---|
| critical bundle | 89473B / 90000B (99.4%) **OK** |
| rest bundle | 134597B / 140000B (96.1%) **OK** |
| worker bundle | 63908B / 65000B (98.3%) **OK** |
| `--check` 再現性 | PASS |
| critical→rest cross-layer lint | PASS |
| テスト | 34/34 PASS |
| `make gate` | ✅ gate passed |

---

## まだ canonical `assets/app.js` に残置されているもの

| 関数 | 行数 | 推奨移行先 | 抽出難度 |
|------|------|-----------|---------|
| `openRace` | **712** | reporting | 高 (単一関数で 400 行制限超え、内部 split が必須) |
| `openStadium` | 182 | reporting | 低 (critical で必要、組織化のみ) |
| `renderStadiums` | 87 | reporting | 低 (critical で必要、組織化のみ) |
| `learnFromResults` | ~150 | analysis | 中 (worker_predictor.js と twin sync 要) |
| `learnFromResultsViaWorker` | ~50 | analysis | 中 (同上) |
| `showPage` | ~30 | reporting | 低 |

### openRace 抽出案 (次セッション)

712 行は単一ファイル 400 行制約に違反するため、抽出する場合は内部を:
- `_renderRaceHeader` (~80 行)
- `_renderBoatsCard` (~150 行)
- `_renderOddsSection` (~120 行)
- `_renderBetsSection` (~140 行)
- `_renderScoreBreakdown` (~100 行)
- `openRace` 本体 (~120 行、上記を呼ぶ orchestrator)

に分割してから src/reporting/race_detail.js (~400 行) に移管。
リスク高 (UI 動作の全画面リテスト要)。

---

## Phase 2 完了条件達成度

| 完了条件 | 状態 | 備考 |
|----------|------|------|
| どの単一ファイルも 400 行を超えない | ✅ | 全 19 module、最大 397 行 |
| 各層の責務が混在していない | ✅ | discovery/analysis/reporting が明確分離 |
| 既存の機能が全て動く | ✅ | 34/34 テスト PASS |
| ASCII ツリーをユーザーに提示 | ✅ | 上記参照 |

**ただし**: `assets/app.js` 自体は依然 ~7000+ 行残置。openRace (712 行) と
openStadium (182 行) の UI 駆動が canonical に残る。これは Phase 3 以降で
段階的に進めるべき領域。

---

## 次セッション以降の TODO

優先順 (低リスク → 高リスク):

1. **openStadium 抽出** (182 行) — 組織化のみ、critical 不変
2. **showPage / renderStadiums 抽出** — 同上、critical 不変
3. **app-rest.min.js の lazy chunk 分割** — 134KB → 80KB + 30KB + 12KB + 10KB
4. **openRace 内部分割 + 抽出** — 712 行を 6 sub function に split、reporting/ へ
5. **learnFromResults / worker twin sync の解消** — main / worker で同じコードが二重に
   存在する問題を、共有 import や ESM へ移行する根本対策
6. **`scripts/tests/*.js` の `no-undef` を厳格化** — Phase 5 snapshot で蓄積が増えた後

詳細は `docs/architecture.md § 9` 参照。
