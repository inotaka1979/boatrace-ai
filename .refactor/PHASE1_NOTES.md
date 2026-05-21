# Phase 1 完了レポート — capabilities モジュール導入

**完了日時**: 2026-05-21
**ブランチ**: `refactor/clearwing-patterns`

---

## 成果物

### 新規

- **`src/capabilities.js`** (5.5KB / 184 行)
  - `Capabilities` クラス: sync 検出 + async probe + polyfill ヘルパ集約
  - 15 個の sync capability: `abort_timeout` / `service_worker` / `indexed_db` / `cache_api` / `local_storage` / `scheduler_post_task` / `scheduler_yield` / `request_idle_callback` / `document` / `notification` / `chart` / `worker` / `shared_array_buffer` / `cross_origin_isolated` / `online`
  - async probe: `openapi_fresh`（HEAD リクエストで `last-modified` 確認）
  - ヘルパ:
    - `makeTimeoutSignal(ms)` — iOS Safari 旧版 `AbortSignal.timeout` 非対応を吸収
    - `runIdle(fn, opts)` — `scheduler.postTask > requestIdleCallback > setTimeout` の自動選択
    - `refresh(name)` — Chart 動的 import 等で状態が変わる capability の再検出
  - `online` イベントリスナを自動 attach

### 改修

- **`build/build.mjs`**: `modules` 配列に `CAPABILITIES` を追加（1 行）
- **`assets/app.js`**:
  - kill switch boot 直後に `/* BUILD:CAPABILITIES:START/END */` マーカー追加（capabilities が最初に bundle されるよう配置）
  - 13 箇所の feature detection を `capabilities.has()` / `capabilities.makeTimeoutSignal()` / `capabilities.runIdle()` に置換:
    - `_idbAvail` ローカル変数（line 787）
    - `_isSABAvailable` 関数本体（line 1339）
    - `_refreshCOIStatus` の `coi` ローカル変数（line 1361）
    - SAB 起動ログ（line 1385）
    - `hardReload` の SW/cache/SW 3 箇所（line 1495, 1512, 1517）
    - `forceRefresh` の cache 削除（line 1553）
    - `_fetchOne` の AbortController + setTimeout → `makeTimeoutSignal`（line 2391）
    - `_getAppWorker` の `typeof Worker`（line 4522）
    - `_yieldToMain` の `scheduler.postTask/yield` 2 箇所（line 5585, 5588）
    - `loadAllData` の `requestIdleCallback` → `runIdle`（line 5924）
    - `_enableNotifyPermission` / `_refreshNotifyStatus` / `_maybeNotifyNewResults` の Notification 3 箇所
    - `_loadChartLib` / `renderStatsChart` の Chart 2 箇所（capabilities.refresh も追加）
    - `_runIdleTask` の scheduler.postTask（line 8556）
    - `_setupServiceWorker` の `'serviceWorker' in navigator`（line 8567）
    - COI opt-in reload の `window.crossOriginIsolated`（line 8592）
- **`src/utils/idb_store.js`**: `_idbAvailable` 初期化を `globalThis.capabilities.has('indexed_db')` 優先に（フォールバックで `typeof indexedDB`）

### 自動生成（split_app.py + esbuild build）

- `assets/app-critical.js` / `assets/app-critical.min.js`
- `assets/app-rest.js` / `assets/app-rest.min.js`
- `assets/app.min.js`
- `index.html`(`?v=` パラメータ自動同期)
- `sw.js`(VERSION 自動同期)

---

## 検証結果

### ビルドパイプライン

```
[bundle] src/capabilities.js ... -> 6257 chars (marker: CAPABILITIES)
[budget OK] assets/app-critical.min.js = 89028B / 90000B (98.9%)
[lint OK] critical→rest 直接呼出 = 0 (Epic 27 / PJ Phase 致命バグ防止)
[syntax] assets/app.js OK
[syntax] sw.js OK
Build complete.
```

- critical bundle: 86KB → **89KB**（capabilities IIFE 約 3KB 増加、予算 90KB 内）
- rest bundle: 不変
- 再現性 (`--check`) ガード PASS
- critical→rest cross-layer lint PASS

### テストスイート

`bash scripts/tests/run_all.sh` — **31 ステップ PASS / 1 ステップ FAIL**

❌ Shell tests (cron_scrape / cron_monitor) の `T3: update_heartbeat returns non-zero on unwritable dir`
- **Phase 1 変更とは無関係**（私のコード変更を `git stash` で退避した状態でも同じく FAIL）
- 真因: 実行ユーザが root のため `chmod 555` で書込不可状態を作っても root が bypass する
- 環境依存テスト、CI (GitHub Actions の非 root runner) では PASS する

### 残存 feature detection

`grep` で残存サイトを再走査した結果、capabilities IIFE 内部（line 58-188、これは capability の **定義** そのもの）以外は全て置換済。

注: `assets/worker_predictor.js`（Web Worker 内）の `AbortController` 直接使用は Phase 1 では未対応（Worker は別 global context のため、Phase 2 で `src/capabilities-worker.js` を分離して対応予定）。

---

## 次フェーズへの引継

### Phase 2（4 層分離）への影響

- capabilities は **context 層** に属する（状態保持・設定）
- Phase 2 の `src/context/capabilities.js` への移動候補（または `src/capabilities.js` を context のルート扱いに）

### Phase 6 で予定の ESLint カスタムルール用フック

- 「`AbortSignal.timeout(...)` 直接呼出は禁止 → `capabilities.makeTimeoutSignal(...)` を強制」
- 「`typeof X === 'undefined'` を browser API について書くのは禁止 → `capabilities.has('X')` を強制」
- これらのルールが意味を持つよう、Phase 1 で前提となる関数群を全て整備した状態。

### Worker 側の対応（Phase 2 内）

- `assets/worker_predictor.js:685` の `new AbortController()` を `capabilities.makeTimeoutSignal` 相当に置き換える
- Worker は `globalThis.capabilities` を main thread と共有できないため、軽量版 `src/capabilities-worker.js` を別 bundle 化して `importScripts` で読み込む構成を予定
