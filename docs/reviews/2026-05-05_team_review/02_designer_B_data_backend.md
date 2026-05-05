# 設計者B レビュー原本 — データパイプライン / バックエンド / 予測エンジン構造

- 担当: シニアアーキテクト（データパイプライン / バックエンド設計）
- 対象: `/home/pi/boatrace-ai`
- 日付: 2026-05-05

---

# BoatRace AI データパイプライン・バックエンド設計レビュー

## アーキテクチャ全体所見

Raspberry Pi 5上で**競艇スクレイピング → JSON蓄積 → クライアント3層予測エンジン**を統合したフルスタック設計。特筆すべきは、単一HTML PWA下で動作する予測エンジン（ルールベース8カテゴリ + ロジスティック回帰12次元 + Web Worker化）と、RPi cron + flock + atomic writeによる信頼度の高いスクレイピング基盤。ただし、以下5つの構造的課題が将来スケーリング時に顕在化する可能性がある。

---

## P0：即座に潰すべき技術負債

### 1. **localStorage DB のサイズ上限策なし**（`/data/db/racerDB.json` 1.5MB）
**現状** (`scripts/build_db.py:372-378`) — racerDB/stadiumDB を毎回フルダンプ、クライアント側でIndexedDB化・分割戦略ゼロ
**問題** — localStorage クォータ 5-50MB に対し、racerDB 1.5MB + 選手直近成績キャッシュ + L2重み + Platt係数で圧迫。クライアント初期化時に同期ロードすると大型端末でも100ms超ブロック、かつiPhone 13以下で破損リスク。
**提案** — (1) racerDB を地域・期別で分片化（`racerDB_2024Q1_west.json` 等500KB単位）、(2) IndexedDB/WebAssembly LZ4圧縮で 40% 圧縮、(3) 初回は選手6千名の最小セット（全国勝率+コース別）のみ、追加フィールドはレース開始前に遅延ロード。

### 2. **スクレイピング再試行・冪等性の部分的欠陥**（`cron_scrape.sh:56-160`）
**現状** — flock timeout 300s、git pull/push リトライ最大3回だが、`git rebase --abort` 後の次サイクルでも同一コミットが重複リトライされる可能性。また heartbeat ファイルは atomic mktemp で堅牢化済だが、JSON出力の中間ファイルが kill時に残留してシェルログが汚れる。
**問題** — GitHub Pages配信の競合コミット時、同じpreviews JSONを3回連続pushする場合がある。odds/previews/racedata並行実行時にグローバルロック(60s)でブロック→タイムアウト→スキップのサイクルが頻繁。データの遡及性が落ちる。
**提案** — (1) `atomic_write_json`をシェルまで拡張（`mktemp -d` + `mv` で同期書込確認）、(2) git操作に **idempotency key** (commit hash の crc32) を付与し、同一操作の二重実行を防止、(3) グローバルロック競合時のバックオフを指数関数化（当番制ロック変更）。

### 3. **localStorage スキーマバージョン管理の不備**（CLAUDE.md Phase A-5）
**現状** — `boatrace_racerDB` / `boatrace_stadiumDB` / `boatrace_history` / `boatrace_weights` 等7キーが固定ハードコード。A+化で `boatrace_featurestats` / `boatrace_platt` が追加されたが、移行スクリプト / 旧キー削除タイミングの定義ゼロ。
**問題** — クライアント v2.0へ更新時、旧端末の localStorage に v1.x キーが残ると、予測エンジンが統計初期化タイミングを逃す。60日削除ポリシーでは古いpredictRace結果が4月分削除→calibration学習用データ不足。
**提案** — (1) localStorage版号 (`boatrace_schema_version=2`) をkeepする、(2) SW v9で初起動時にversion check → スキーマ migration関数を逐次実行（backward-compat保証）、(3) L2重み・Platt係数は30日でリセット可能に（勾配爆発対策）。

### 4. **データ層の retention policy が時間軸で非体系的**（`data/` ディレクトリ構成）
**現状** — results: 当日のみ、racedata: 複数ファイル、odds: 3分間隔で上書き、photos: 月初だけリフレッシュ。cleanup は cron_monitor.sh で logs のみ。
**問題** — 600日後の過去predictions（需要の可能性）と現在のmodels（学習用）を区別していない。本来なら analytics用途で ≥90日保持が必要だが、RPi ストレージ 32GB では photos/ が27MB → 年単位での計画が不明。
**提案** — (1) `data/archive/YYYY/MM/` に月別snapを自動保存（tar.gz 3% 圧縮で月あたり100KB）、(2) retention policy を YAML化（`config/retention.yaml` で odds=1day, racedata=30day 等）、(3) health_check.sh で月末にarchive → rotate、古月は GitHub Releases で asset化。

### 5. **Web Worker の state同期が構造化複製で非決定的**（CLAUDE.md PG-7）
**現状** — racerDB 5MB / stadiumDB 50KB をmain → worker に postMessage、構造化複製は並行fetchで回避済だが、エラー時fallback先のmain側predictRaceが古いstateで動作。
**問題** — ネットワーク遅延時 worker fetch timeout（現在15s） → 古い同期stateで予測 → クライアント統計汚染。worker_predictor.js が50KB増加したため、Safari on iOS 15 で initializer timeout（仕様）。
**提案** — (1) Worker内キャッシュ（IndexedDB）でoldDBバージョンを持つ、(2) predictRace の予測timestamp を `_lastPredictWorkerState_ts` に記録し、古いデータとの混在を検出・警告、(3) Safari対応として critical + rest bundle を別 Worker（shared） に。

---

## P1：次フェーズで構造化すべき改善

### 1. **スクレイピング単位・品質の細分化戦略**（複数 scraper の責務競合）
**現状** — `scrape_previews.py` が展示+結果を同時取得（SmartScheduler で優先度付け）、`scrape_racedata.py` が成績推移を別途取得。データの**鮮度・遅延・精度を区別する仕組みが弱い**。
**問題** — 展示情報（15分前に確定）と結果（レース終了直後）では信頼度が異なるのに、unifiedな `data/previews/today.json` に混在。オッズの反映遅延（30分）と同期タイミングの相互影響が不明。
**提案** — (1) **Scraper質保証フレーム** — 各ファイルに `{updated_at, schema_version, reliability_score: 0-1, source_freshness_sec}` を埋込、(2) **時系列DB分離** — `data/timeseries/` に `odds_YYYYMMDD_HHMM.json` を append-only に、(3) **品質ダッシュボード** — cron_monitor で「展示更新率 / オッズ遅延分布 / 結果確定率」を集計。

### 2. **予測エンジンの責務分離が不完全**（Layer 1-3 の境界曖昧）
**現状** — Layer 1（ルール8カテゴリ）が scoreBoatV2 で540行、Layer 2 (L2学習) が l2Predict 化されているが、**特徴量エンジニアリング (12次元生成) が Layer1-2に散在**（ET_COURSE_DECAY, DEFAULT_COURSE_TECHNIQUE等40箇所）。
**問題** — 新特徴量 (例: モーター年齢×現場) を追加しようとしても、どの層で計算するか決定困難。L2重みの初期化と既存学習済重みの互換性保証がない（PB-2で LR decay追加時に過去重みが無効化）。
**提案** — (1) **特徴量パイプライン** (`src/utils/features.js` 新設) — 6カテゴリ × 2 = 12次元を宣言的に定義（`{name, fn(boat), bounds, dtype}`）、(2) **Layer分割の責務表** — Layer 1 = 競艇ドメイン知識のみ、Layer 2 = 特徴量 linear combination、Layer 3 = 買い目確率 (Plackett-Luce), (3) バージョン管理 (`FEATURE_VERSION=3`)で重みmigration自動化。

### 3. **オンライン学習の数値安定性・過学習防止が実装依存**（L2_LR, L2_LAMBDA 等）
**現状** — L2_LR=0.05 / LR_TAU=5000 / LAMBDA=1e-4 /初期重み `L2_INIT_WEIGHTS=[3, 1.5, ...]` が index.html に**魔法定数として硬コード**。Bayesian shrinkage（PB-8）で L1/L2比を自動調整するが、特徴量分散が未正規化のため上下限の根拠不明。
**問題** — 実データ蓄積500件超時点でのPlatt scaling自動refitが重い（Worker grid search 5000iter）。初期重みが不適切だと最初100レースで過学習→その後の学習率低下で局所最適に陥る可能性。
**提案** — (1) **オンライン学習設定ファイル** (`src/config/learning.json` → {lr_schedule, l2_lambda_bounds, init_strategy, warmup_steps}) で段階管理、(2) **初期重みの根拠化** — L1スコアから統計的に導出（線形回帰）、(3) **過学習検出** — validation set予約（直近10件を学習除外）、log loss 単調増加時に学習停止。

### 4. **Service Worker のキャッシュ戦略が fetch pattern に依存**（v9：3ファイル）
**現状** — `sw.js:STATIC_ASSETS` に app-critical.min.js / app-rest.min.js / worker.js を cache-first、周辺 `data/db/*.json` は network-first (stale-while-revalidate)。しかし worker内 fetch (racerDB) と main fetch の二重キャッシュ。
**問題** — GitHub Pages CDN から data/*.json が deploy直後に反映されるまで 10-60s ラグ → クライアント古いDB使用。app-critical.min.js がCSP nonce化（非 cache 対象）になると bust戦略が複雑化。
**提案** — (1) **キャッシュ層の整理** — STATIC (`app-*.min.js`, icon等): v-URL, DATA (`data/db/*.json`): smart freshness check（サーバETag比較→不要なら再利用）, (2) **CDN同期検証** — preload Link header で ETa を先読み、(3) Worker内 IndexedDB cache で redundancy排除。

### 5. **プリレンダリング (prerender_top.py) とJS renderの重複・不整合**（stadium-card HTML）
**現状** — prerender_top.py が24場カード HTML を注入 → JS renderStadiums が同じ場所を innerHTML置換（ちらつき防止が目的）。しかし prerender と JS render の属性（class, aria-*, tabindex）が不完全に一致。
**問題** — デバイス遠新度による差異（古iPad でもprerender表示 → JS遅延でリフロー）。アクセシビリティ（a11y）的には prerender HTMLは screen reader無視か、描画順序と tabindex に不整合。
**提案** — (1) **Template化** — stadium-card を `<template id="stadium-template">` で shared（prerender と JS 同一 template.content.cloneNode()），(2) **Hydration** — prerender済cardに data-hydrated="true" を付与、JS renderで既存要素を in-place update（置換ではなく），(3) a11y検証を dev時に CI化（axe-core / Pa11y）。

---

## P2：将来の拡張ポイント

### 1. **多言語・地域化サポート（国際展開に向けた抽象化）**
**現状** — すべてのテキスト・定数が日本語に依存（STADIUMS{}, TECHNIQUE{}, etc）。タイムゾーン手硬 JST。
**提案** — (1) i18n フレーム (fluent.js / next-intl)、(2) locale-aware date formatter、(3) KPI （例：勝率4.5→国別フォーマット）の内国化。

### 2. **Prediction Model の A/B テスト・メタ学習フレーム**
**現状** — Layer 1 / 2 / 3 の係数が静的決定。複数モデルの weighted ensemble が無い。
**提案** — (1) `_modelRegistry` でモデル variant を登録可能に（L2_LAMBDA=1e-4 vs 1e-3 の並行運用），(2) クライアント側で mini-bandit（Thompson sampling）で最適variant自動選択，(3) calibrationmetrics を variant 別に集計。

---

## 関連ファイル

- **スクレイピング・運用**: `/home/pi/boatrace-ai/scripts/cron_scrape.sh` (atomic write, idempotency)、`build_db.py` (racerDB/stadiumDB構築)、`http_utils.py` (共通HTTP層)
- **データレイアウト**: `/home/pi/boatrace-ai/data/` (db/, odds/, results/, etc)、retention policy は docs に記載無し
- **予測エンジン**: `assets/app-critical.min.js` + `app-rest.min.js`（Layer分離）、`assets/worker_predictor.js` (オンライン学習)
- **ストレージ**: localStorage 7キー、schema validation (CLAUDE.md PA-5)
- **キャッシュ**: `sw.js` v9（3ファイル STATIC_ASSETS）
- **プリレンダ**: `scripts/prerender_top.py`
- **運用**: `docs/RUNBOOK.md`、`scripts/health_check.sh` (15分監視)、`docs/POWER_MANAGEMENT.md`

---

**総合評価**: Security A+ / Prediction A / Code Quality A+ / PWA/UX A（Lighthouse 70-85/100）は達成。次は「スケーラビリティ（データ容量・複雑性管理）」「運用の可観測性（メトリクス可視化）」へ進化させる段階。
