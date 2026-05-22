# Clearwing パターン段階導入 — Phase 0 ベースライン調査

**作業ブランチ**: `refactor/clearwing-patterns`
**調査日時**: 2026-05-21
**調査担当**: Claude (Opus 4.7)

---

## 1. ファイル構成サマリー

### トップディレクトリ

```
boatrace-ai/
├── index.html                    ← エントリポイント (HTML + 一部 inline)
├── manifest.json / sw.js         ← PWA
├── assets/                       ← 配信対象 JS (canonical app.js + 分割版)
├── src/utils/                    ← ES module 化済みヘルパ (7 ファイル)
├── scripts/                      ← Python scraper + シェル + tests/
├── build/                        ← esbuild ビルドパイプライン
├── cloudflare-worker/            ← Workers KV プロキシ
├── data/                         ← 取得済 JSON (programs/previews/results/odds/...)
├── config/ docs/ tests/          ← 設定・設計書・E2E
└── .github/workflows/            ← 17 個の workflow
```

### ⚠️ 重要発見

- **ルート `package.json` は存在しない**。npm 系は `build/package.json` のみ。
- 既に **code-splitting 済**（`scripts/split_app.py` が canonical `assets/app.js` から `app-critical.js` / `app-rest.js` を自動生成 → esbuild minify）。
- 既に **src/utils/ に 7 モジュール** ES module 化済。
- ARM Linux (RPi5) + iPhone PWA 構成、`cron_scrape.sh` で定期スクレイピング稼働中。

---

## 2. 上位 5 個の JS ファイル（行数）

| 行数 | ファイル | 種別 |
|------|----------|------|
| **8650** | `assets/app.js` | **canonical source**（編集対象） |
| 4912 | `assets/app-rest.js` | split_app.py が auto-generate |
| 4104 | `assets/app-critical.js` | split_app.py が auto-generate |
| 1557 | `assets/worker_predictor.js` | Web Worker (predictRace 専用) |
| 545 | `cloudflare-worker/worker.js` | Cloudflare Workers KV プロキシ |

その他: `src/utils/i18n.js` 382 行 / `src/utils/safe_storage.js` 299 行 / `sw.js` 227 行。

**Clearwing 4 分割の主対象は `assets/app.js`（canonical）** であり、`app-critical.js` / `app-rest.js` は分割の結果として再生成すべき。

### 関数数（top-level）

- `app-critical.js`: **285 関数** + IIFE
- `app-rest.js`: **138 関数**
- `app.js` (canonical): 上記の和集合

`/* MOVED: function ... */` コメントが大量に残る（split_app.py が片側にしか配置しなかった関数のマーカー）。

---

## 3. Feature detection 散在箇所

`try/catch` または `typeof ... === 'undefined'` で 264 箇所のガード。

| ファイル | try ブロック数 | typeof undefined |
|----------|----|----|
| `assets/app-critical.js` | 120 | 16 |
| `assets/app-rest.js` | 63 | 14 |
| `assets/worker_predictor.js` | 7 | n/a |
| `sw.js` | 3 | n/a |

### 検出対象が分散している API（Clearwing capabilities 集約候補）

| API | 箇所例 |
|-----|--------|
| `AbortController` 直接生成 | `app-critical.js:3123`, `worker_predictor.js:685`, `app.js:2391` |
| `navigator.serviceWorker` | `app-critical.js` 7 箇所 |
| `typeof indexedDB !== 'undefined'` | `app-critical.js:607,1343,1350` |
| `'caches' in window` | `app-critical.js:2950,2985` |
| `typeof scheduler !== 'undefined'` | `app-critical.js` 4 箇所 |
| `typeof requestIdleCallback === 'function'` | `app-critical.js:3560` |
| `typeof Notification === 'undefined'` | `app-rest.js:3015,3032,3041` |
| `typeof SharedArrayBuffer / crossOriginIsolated` | `app-rest.js:79,80,104` |
| `typeof Chart === 'undefined'` | `app-rest.js:4214,4238` |
| `typeof Worker === 'undefined'` | `app-rest.js:1720` |

### 仕様注意点

- **`AbortSignal.timeout()` の使用は 0 件**。すでに `AbortController + setTimeout` パターンで実装されており、指示書が指摘する iOS Safari 旧版問題は構造的には未然防止状態。capabilities 化はあくまで「集約による可読性向上」が主目的。

### データソース可用性

- **Open API**: `https://boatraceopenapi.github.io` (API_BASE 定数, `app-critical.js:52`)
- **3 段 fallback** が既に実装済（`app-critical.js:2064`〜）：
  1. Cloudflare Worker `/api/*`（KV キャッシュ、~5 分鮮度）
  2. Open API 直接
  3. localStorage cache
- **boatrace.jp 直接スクレイピング**: GHA 側 (`scripts/scrape_*.py`) でのみ実行。クライアント側で叩いていない。
- `_setApiHealth` / `_renderApiHealthBanner` で stale 判定済 → `openapi_fresh` capability の代替は既に存在。

---

## 4. 既存ツールチェーン

### npm scripts（`build/package.json`）

```json
{
  "split":       "python3 ../scripts/split_app.py",
  "build":       "node build.mjs",
  "build:check": "node build.mjs --check",
  "lint":        "echo 'lint not yet configured'",      ← 未設定
  "typecheck":   "echo 'typecheck not yet configured'", ← 未設定
  "test:smoke":  "playwright test ... webkit-smoke",
  "test:vrt":    "playwright test ... chromium-vrt",
  "test:e2e":    "playwright test"
}
```

- **devDependencies**: `esbuild ^0.24.2`, `@playwright/test ^1.48.0`
- **dependencies**: `lighthouse ^12.8.2`

### Python（`scripts/requirements.txt`）

```
requests==2.33.1
beautifulsoup4==4.14.3
lxml==6.1.0
aiohttp==3.13.5
lhafile==0.3.1
```

すべて == pin 済。

### テスト（CI 統合済）

- `scripts/tests/run_all.sh` で **20+ ステップ**（Python unittest / Node JS / bash bats）
- `.github/workflows/test.yml` で 3 job（test / typecheck (mypy advisory) / a11y (axe advisory)）
- Playwright E2E (`tests/e2e/`) は別 workflow `e2e.yml`
- Lighthouse、scrape-* (×8)、auto-rollback、deploy-worker、ios-simulator-smoke 等 **計 17 workflow**

### lint / format / type

- **ESLint 未設定**
- **Prettier 未設定**
- **TypeScript / `tsc` 未設定**（`jsconfig.json` も無し）
- mypy は CI で実行されているが advisory（`|| echo` で非 blocking）
- axe-core も advisory

### git config

- `.gitignore` に `node_modules/`、`.venv/`、`dist/`、`build/data/`、`build/playwright-report/`、`*.bak` 等あり
- ルートに `package.json` 無し → `npm install` の入口がなく、ローカルで `make gate` を作るには **ルート package.json の新設が必要**

---

## 5. 既存「層構造」の現状

| Clearwing 層 | 既存対応物 | 状態 |
|----|----|----|
| **context** | グローバル変数（`STADIUMS`, `TUNING`, `API_BASE`, current* 等） | 散在、`assets/app-critical.js` 冒頭に集中 |
| **discovery** | `fetchWithFallback` / `_fetchOne` / `_mapToWorkerUrl` / `validateApiPayload` | `app-critical.js` 中盤、関数群あり |
| **analysis** | `predictRace` / `predictRaceProgram` / `predictRaceAsync` / `scoreBoatV2` / `runBacktestEngine` 等 | `app-rest.js` + `worker_predictor.js`（既に worker 分離） |
| **reporting** | `renderStadiums` / `openStadium` / `openRace` / `showPage` / `renderStats` / persistence (`safeSet`) | `app-rest.js` + `src/utils/safe_storage.js` |

→ **論理的な分離は既に存在するが、ファイル境界として整理されていない**。

---

## 6. PJ Phase の教訓（CLAUDE.md より）

- iOS standalone PWA の `_setupStadiumDelegation` が起動しない → 真因は `app-critical.js:449` の IIFE が rest bundle にしかない `_initFeatureStats()` を呼んで silent halt
- **window.onerror bind 前の例外は完全に silent**
- code-split で関数移動するときは critical → rest 依存を **DFS で必ず検証**
- `build.mjs --check` が CI で再現性ガード稼働中

→ Phase 2 の 4 分割は **同じ罠を再発させない仕組みが必要**（capabilities 化と並走するなら critical 側のトップレベル即時実行で rest 依存禁止を ESLint ルール化）。

---

## 7. Phase 1〜7 で影響を受けるファイル

### Phase 1 (capabilities.js) 影響範囲

- 新規: `src/capabilities.js`
- 改修: `assets/app-critical.js`（feature detect 集約箇所）、`assets/worker_predictor.js`（AbortController 部）
- canonical の `assets/app.js` も同期必要

### Phase 2 (4 分割) 影響範囲

- 全面改修: `assets/app.js`（canonical）→ `src/context/` `src/discovery/` `src/analysis/` `src/reporting/`
- 連動: `scripts/split_app.py` の rewrite または **新ビルダー導入**（`build.mjs` 拡張）
- index.html: `<script src="...">` の参照差し替え

### Phase 3 (Makefile / gate.yml) 影響範囲

- 新規: ルート `package.json`（lint / format / test / type / build スクリプト）
- 新規: ルート `Makefile`、`.github/workflows/gate.yml`
- 既存 `test.yml` との関係整理（重複させるか統合か要判断）

### Phase 4 (JSDoc strict) 影響範囲

- 新規: `jsconfig.json`
- 改修: Phase 2 完了後のコア 5 モジュール（capabilities / 2 prediction / 2 discovery）

### Phase 5 (snapshot test) 影響範囲

- 新規: `tests/snapshots/`, `tests/fixtures/race-*.json`
- 既存テストとは別系統（既存は `scripts/tests/`）

### Phase 6 (regression guard) 影響範囲

- ESLint config に `no-restricted-syntax` / `no-restricted-globals`
- `.husky/pre-commit`
- `CONTRIBUTING.md`

### Phase 7 (docs) 影響範囲

- `docs/architecture.md`, `README.md`

---

## 8. リスク・確認事項

### 🚨 高リスク

1. **canonical = `assets/app.js` 一括方式と Clearwing 4 分割は構造的に競合**
   - 既存パイプライン: `assets/app.js` → `split_app.py` → critical/rest → esbuild minify
   - 4 分割案: `src/{context,discovery,analysis,reporting}/*.js` → esbuild bundle → critical/rest
   - **split_app.py を捨てて esbuild 主導に組み換えるのが正攻法**だが、PJ Phase の致命バグの再発リスクあり

2. **ルート `package.json` 不在** → `make install` 入口が無く Phase 3 で新規作成必須
   - ARM RPi5 上で esbuild / lint 系を root で入れると `node_modules` 重複（`build/node_modules` と並走）

3. **既存 `scripts/tests/run_all.sh`（20+ step / mostly passing）を壊さない保証** が必要
   - Phase 2 でファイル位置が変わると `_check_html_js.js` や `test_predictor_helpers.js` の `readFileSync` 参照が全滅する可能性

### ❓ ユーザー確認が必要な事項

1. **canonical 切替方針**:
   - (A) 引き続き `assets/app.js` を canonical 維持、Phase 2 は **読みやすさのための論理マーカー追加のみ**にとどめる
   - (B) `assets/app.js` を廃止し、`src/{4 層}/*.js` → esbuild bundle で `assets/app-critical.min.js` / `assets/app-rest.min.js` を直接生成

2. **既存テスト互換性**: `scripts/tests/*.js` は `readFileSync('assets/app.js')` で正規表現抽出している。これも 4 分割に追随させて全テストを書き換えるか？

3. **ARM RPi5 上の lint 依存**: ESLint 9.x / Prettier 3.x は ARM プリビルドあり。`vitest` は native でなくとも問題なし。確認済みで OK か？

4. **Phase 7 全 PR 提出時のレビュア**: ユーザー自身のみか、`/ultrareview` を併用するか？

---

## 9. Phase 0 完了状態

- ✅ ブランチ `refactor/clearwing-patterns` 作成済
- ✅ `.refactor/tree.txt` / `.refactor/loc.txt` / `.refactor/feature-detect-sites.txt` 生成済
- ✅ 本ファイル `.refactor/BASELINE.md` 作成
- ⏸ コミット待機中（commit message: `docs: add refactor baseline survey`）
- ⏸ Phase 1 着手前にユーザー確認待ち
