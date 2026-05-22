# BoatRace Oracle — Architecture Overview

このドキュメントは **Clearwing 4 層パターン** を導入した後の BoatRace Oracle の
アーキテクチャを 1 枚にまとめたものです。実装の経緯は `.refactor/BASELINE.md` /
`.refactor/PHASE2_NOTES.md` および `CLAUDE.md` の修正履歴を参照。

---

## 1. プロジェクト概要

- **何か**: 競艇 (ボートレース) の AI 予想 PWA。全 24 場の全レースを予想。
- **配信先**: GitHub Pages 単一 HTML (PWA)
- **入力データ**: Boatrace Open API (GitHub Pages JSON), Cloudflare Worker /api/*, 自前 scraped JSON
- **出力**: iPhone PWA としてホーム画面から開く 5 画面 (top / races / detail / stats / settings)
- **対象環境**: Raspberry Pi 5 (ARM Linux) で scraping cron / iPhone で PWA 利用

---

## 2. 二段予想パイプライン

```
┌─────────────────────────────────────────────────────────────────────┐
│  Cron (RPi5)                        GitHub Actions (ubuntu-latest)  │
│  scripts/cron_scrape.sh             .github/workflows/scrape-*.yml  │
│     │                                       │                       │
│     ▼                                       ▼                       │
│  boatrace.jp + Open API ──▶  data/{programs,previews,results,odds}/ │
│                                       │                             │
│                                       ▼                             │
│                              Cloudflare Worker /api/* (KV cache)    │
└──────────────────────────────────────────┬──────────────────────────┘
                                           │
                                           ▼
                            ┌────────────────────────────────┐
                            │  iPhone PWA (index.html)       │
                            │  assets/app-critical.min.js    │ defer load (~34KB)
                            │     ↓ window.load              │
                            │  assets/app-rest.min.js        │ lazy load   (~100KB)
                            │     ↓ on demand                │
                            │  assets/worker_predictor.js    │ Web Worker  (~64KB)
                            └────────────────────────────────┘
                                           │
                              ┌────────────┴───────────┐
                              ▼                        ▼
                       ┌──────────────┐         ┌──────────────┐
                       │ 番組予想     │         │ 直前予想     │
                       │ (事前データ)│         │ (展示後)     │
                       │  programs   │         │  + previews  │
                       └──────────────┘         └──────────────┘
                              │                        │
                              └────────────┬───────────┘
                                           ▼
                              買い目生成 (3 方式)
                              [確率順 / フォーメーション / BOX]
```

二段の違い:
- **番組予想**: 出走表のみ。`predictRaceProgram(sid, raceNum)` → 朝の予想。
- **直前予想**: 展示走行データ (exhibition time / start timing / weather) を加えた更新版。
  `predictRace(sid, raceNum)` → レース直前の予想。

---

## 3. ランタイム構造 (3 thread)

| Thread | Bundle | 主な仕事 | サイズ (min) |
|--------|--------|---------|--------------|
| Main (UI) | `app-critical.min.js` | 起動 / Top page render / 軽量 IO | ~34 KB |
|           | `app-rest.min.js`     | 詳細画面 / 統計 / 学習 / バックテスト | ~100 KB |
| Worker    | `worker.js` + `worker_predictor.js` | predictRace / l2Update / Platt refit | ~64 KB |

`app-rest.js` は `window.load + 50ms` で動的 import し、初回 LCP / FCP に影響させない。
`worker_predictor.js` は内部から重量 DB (racerDB ~5MB) を `fetch()` で取得し、main の
postMessage 同期負荷を排除。

---

## 4. Clearwing 4 層 + capabilities + utils

```
                ┌────────────────────────────────────────┐
                │             capabilities               │
                │  (feature detection + polyfill 集約)   │
                │  src/capabilities.js (main thread)     │
                │  src/capabilities-worker.js (worker)   │
                └─────────────────┬──────────────────────┘
                                  │ 全層が import
                                  ▼
        ┌────────────────────────────────────────────────┐
        │                                                │
        ▼                                                ▼
  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ context  │──▶│discovery │──▶│ analysis │──▶│reporting │
  │ (state)  │   │  (read)  │   │ (compute)│   │  (DOM)   │
  └──────────┘   └──────────┘   └──────────┘   └──────────┘
        ▲             │              │               │
        └─────────────┴──────────────┴───────────────┘
                          利用関係は ▶ 方向のみ
                       (循環依存 / 逆流は ESLint で検出)

  utils/
   ├── safe_storage.js   (localStorage 安全 IO)
   ├── math.js           (softmax / Plackett-Luce / safeDiv)
   ├── features.js       (12 次元特徴量パイプライン)
   ├── idb_store.js      (IndexedDB layer)
   ├── bandit.js         (Multi-armed bandit / ε-greedy)
   ├── i18n.js           (日英ロケール)
   └── dp_gradient.js    (差分プライバシ勾配)
```

### 各層の責務 (CONTRIBUTING.md と整合)

| 層 | 性質 | BoatRace Oracle 例 | 副作用 |
|----|------|--------------------|--------|
| **context** | 静的・初期状態保持 | STADIUMS / TECHNIQUE / WIND_DIR / settings | ❌ なし |
| **discovery** | read-only データ取得 | fetchWithFallback / indexByStadiumRace / _filterStalePreviews | localStorage cache write のみ |
| **analysis** | 計算・予測 | predictRace / scoreBoatV2 / runBacktestEngine / _computeCalibrationMetrics | ❌ DOM / fetch なし |
| **reporting** | 出力・記録 | renderStadiums / openRace / _renderApiHealthBanner / _renderFreshness | ✅ DOM 更新 / persistence |

### capabilities 集約の効能

iOS Safari < 16 では `AbortSignal.timeout` が無い。`indexedDB` の有無、Worker の
nested 可否、`scheduler.postTask` の対応など、ブラウザ差分が散在していた (264 箇所
の try/catch ガード) のを `capabilities.has(name)` に一本化:

```js
// 良い例
const signal = capabilities.makeTimeoutSignal(5000);
fetch(url, { signal });

// 悪い例 (ESLint no-restricted-syntax で error)
const signal = AbortSignal.timeout(5000);
```

---

## 5. ビルドパイプライン

```
[ソース]                    [pipeline]                  [配信物]

assets/app.js  ───┐
(canonical)       │
                  ▼
              scripts/split_app.py
              ├── REST_ANCHORS で DFS 分割
              └── REST_ONLY_BUILD_MARKERS で 一部を rest 強制
                  │
                  ├──▶ assets/app-critical.js  (~170 KB)
                  └──▶ assets/app-rest.js      (~200 KB)
                              │
                              ▼
src/                     build/build.mjs
├── capabilities.js    ──▶ ① 12 モジュールを IIFE bundle
├── capabilities-worker.js │
├── context/*.js              ▼
├── discovery/*.js   inject into BUILD:XXX:START/END markers
├── analysis/*.js              │
├── reporting/*.js             ▼
└── utils/*.js          esbuild minify (40% 圧縮)
                              │
                              ▼
                       ├── assets/app.min.js          (~134 KB)
                       ├── assets/app-critical.min.js (~89 KB)  budget 90 KB
                       ├── assets/app-rest.min.js     (~134 KB)
                       └── assets/worker_predictor.js (~64 KB)
                              │
                              ▼
                       index.html `?v=<sha256[:8]>` 自動更新
                       sw.js VERSION も同 hash で同期
```

### 重要な仕掛け

1. **canonical = `assets/app.js`** — 開発者が編集する単一 source。BUILD: 領域は
   `build.mjs` が `src/*.js` から自動注入するので編集禁止。

2. **`build.mjs --check`** — ビルドが冪等であることを CI で検証。差分が出れば
   `assets/app.js` がコミットし忘れているか、誰かが BUILD: 領域を直接編集している。

3. **`scripts/split_app.py REST_ONLY_BUILD_MARKERS`** — backtest 等の「使うとき
   しか必要ない」bundle を critical から除外して LCP を保護。

4. **Cross-layer lint** (Epic 27 / PJ Phase 致命バグ防止) — critical bundle が
   rest bundle の関数を typeof guard なしに呼んだ場合 `--check` が fail。iOS
   standalone PWA で silent halt する致命バグの再発を防ぐ。

---

## 6. ローカル CI ゲート

```
                  ┌─────────────────────────────┐
                  │   git commit (developer)    │
                  └──────────────┬──────────────┘
                                 │
                                 ▼
                  ┌─────────────────────────────┐
                  │ .husky/pre-commit (軽量)    │ ~15 秒
                  │  ├── npm run lint           │
                  │  ├── npm run type           │
                  │  └── build.mjs --check      │
                  └──────────────┬──────────────┘
                                 │ PASS
                                 ▼
                  ┌─────────────────────────────┐
                  │   git push                  │
                  └──────────────┬──────────────┘
                                 │
                                 ▼
                  ┌─────────────────────────────┐
                  │ .github/workflows/gate.yml  │
                  │  PR-blocking:                │
                  │  ├── npm ci                 │
                  │  ├── npm run lint           │
                  │  ├── npm run type           │
                  │  ├── npm test (34 step)    │
                  │  └── npm run build:check    │
                  └──────────────┬──────────────┘
                                 │ PASS
                                 ▼
                  ┌─────────────────────────────┐
                  │ test.yml / e2e.yml / etc.   │
                  │  (advisory: mypy / axe /   │
                  │   Lighthouse / Playwright)  │
                  └─────────────────────────────┘
```

ローカル `make gate` で同じ流れを通せる:

```
make gate
├── make lint         → eslint + prettier --check
├── make type         → tsc --noEmit -p jsconfig.json (5 ファイル strict)
├── make test         → bash scripts/tests/run_all.sh
│                       ├── Python 6 step (io / time / http / db / community / scrape)
│                       ├── Shell 2 step (cron_scrape / cron_monitor)
│                       ├── JS 24 step (helpers / pure / pairwise / backtest / ...)
│                       ├── snapshot test (27 件 byte-equal)
│                       └── deprecated pattern detector (5 規則)
└── make build-check  → assets/* の再現性 + bundle budget + cross-layer lint
```

---

## 7. 退行防止 4 層 (Phase 6)

同じバグの再混入を防ぐため、独立に動く 4 つの検出層を組み合わせている:

| Layer | 場所 | 検出範囲 | timing |
|-------|------|---------|--------|
| (1) JSDoc strict | jsconfig.json + 5 ファイル | 型 (Phase 4) | pre-commit + CI |
| (2) ESLint no-restricted-syntax | `eslint.config.mjs` | AbortSignal.timeout 直接呼出 / new AbortController | pre-commit + CI |
| (3) build.mjs Epic 27 lint | `build/build.mjs` | critical → rest 関数の直接呼出 (PJ Phase 致命バグ) | pre-commit + CI |
| (4) deprecated pattern detector | `scripts/tests/test_deprecated_patterns.js` | 層責務違反 (analysis から fetch / discovery から DOM 等) / @ts-ignore | npm test |

「1 層をすり抜けても他の 3 層で捕まる」を狙った冗長設計。

---

## 8. データソース可用性 (capability 化済)

| Tier | URL | 鮮度 | フォールバック条件 |
|------|-----|------|-------------------|
| 1 | Cloudflare Worker `/api/*` | ~5 分 (KV) | -- |
| 2 | `https://boatraceopenapi.github.io/*/v2/today.json` | ~30 分 | Worker fail / timeout 8s |
| 3 | `localStorage.bc_<hash>` (10 min まで) | 10 分 | Tier 2 も fail |

discovery 層 (`fetchWithFallback`) が自動切替を担当。capability `openapi_fresh` で
HEAD probe による更新確認も可能 (`capabilities.probe('openapi_fresh')`)。

---

## 9. 未完の課題と将来 (Phase 2 完遂 + 性能最適化)

### Phase 2 残り抽出 (analysis / reporting)

下記の関数群は依然 `assets/app.js` (canonical) に残置しており、Clearwing
4 層への完全分離には次のセッション以降で抽出が必要:

| 関数 | 行数 | 移行先 | 備考 |
|------|------|--------|------|
| `predictRace` / `predictRaceProgram` / `predictRaceAsync` | ~250 | `src/analysis/` | scoreBoatV2 に依存 |
| `openRace` | ~548 | `src/reporting/` | 最大の UI 関数、DOM 操作多数 |
| `l2Predict` / `l2Update` | ~100 | `src/analysis/` | worker_predictor.js と二重メンテ要 |
| `learnFromResults` / `learnFromResultsViaWorker` | ~150 | `src/analysis/` | worker 経由学習 |
| `_normalizeFeatures` / `_initFeatureStats` | ~50 | `src/analysis/` | Welford online algorithm |
| `_refitPlattCoeffs` / `_applyPlattCalibration` | ~80 | `src/analysis/` | Platt scaling 校正 |
| `renderStadiums` / `renderStats` / `renderStatsChart` | ~250 | `src/reporting/` | UI render |

抽出済 (Phase 2): `scoreBoatV2` (310 行) / `runBacktestEngine` 群 / discovery 各種 /
`_renderApiHealthBanner` / `_renderFreshness` / `STADIUMS` 等 context 定数。

### app-rest.min.js の lazy chunking (B 未完)

現状 rest = 134KB。本格的な分割案:

```
app-rest.min.js          (~80KB)  : 起動後 lazy load の基本層 (UI 駆動 + predictRace)
   ↓ ユーザが backtest タブを開いた時
app-rest-stats.min.js    (~30KB)  : runBacktestEngine + runForwardChainBacktest +
                                     _computeCalibrationMetrics + UI driver
   ↓ ユーザが race detail を開いた時
app-rest-detail.min.js   (~12KB)  : scoreBoatV2 (現状 ANALYSIS_SCORE_BOAT bundle)
   ↓ ユーザが設定画面を開いた時
app-rest-settings.min.js (~10KB)  : Platt refit / shareLearnedWeights / 設定永続化
```

実装には以下が必要:
- `scripts/split_app.py` を 3-way 分割対応に拡張
- `build/build.mjs` で minify 対象を増やす
- `index.html` に chunk-specific dynamic import (Promise.all)
- SW cache 戦略の更新 (`sw.js`)
- CSP `script-src` の更新

現在は実装コスト > 効果 (LCP は既に 1.5s, FCP 1.5s で Good 圏内) のため deferred。
真に必要になったら別 PR で取り組む。

---

## 10. 参考ファイル

- `CLAUDE.md` — リポジトリ全体の修正履歴 (PJ / PG / PI / Phase 1-7)
- `CONTRIBUTING.md` — 開発時のレビュー基準・トラブルシューティング
- `.refactor/BASELINE.md` — Phase 0 (現状調査) 結果
- `.refactor/PHASE2_NOTES.md` — Phase 2 (4 層骨格) 完了レポート
- `docs/A_PLUS_化設計書.md` — 旧設計書 (Security A+ 化 etc, refactor 前)
- `docs/RUNBOOK.md` — 運用障害対応手順 (RPi5 / cron / Cloudflare Worker)
- `build/README.md` — esbuild ビルド設計骨子
