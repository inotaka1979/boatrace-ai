# CLAUDE.md — BoatRace Oracle AI予想アプリ v2

## プロジェクト概要

競艇（ボートレース）のAI予想PWAアプリを**単一HTMLファイル**で実装。
Boatrace Open API（GitHub Pages上の無料JSON API）からリアルタイムデータを取得し、
ルールベース＋ロジスティック回帰のハイブリッド予測エンジンで全24場の全レースを予想する。

- **アプリ名**: BoatRace Oracle
- **構成**: 単一 `index.html`（JS/CSS内包）+ `manifest.json` + `sw.js` + アイコン
- **デプロイ先**: GitHub Pages（リポジトリ: boatrace-ai）
- **対象ユーザー**: iPhoneでホーム画面に追加して使うPWA

## データソース

- 出走表: `https://boatraceopenapi.github.io/programs/v2/today.json`
- 直前情報: `https://boatraceopenapi.github.io/previews/v2/today.json`
- 結果: `https://boatraceopenapi.github.io/results/v2/today.json`
- 過去日付: `v2/YYYY/YYYYMMDD.json`

## ファイル構成

```
boatrace-ai/
├── index.html       ← メインアプリ（単一ファイル、全JS/CSS内包）
├── manifest.json    ← PWA設定
├── sw.js            ← Service Worker（APIキャッシュ）
├── icon-192.png     ← PWAアイコン
├── icon-512.png     ← PWAアイコン
├── .nojekyll        ← GitHub Pages用
└── CLAUDE.md        ← このファイル
```

## 画面構成（5画面）

1. **トップ**: 開催場一覧（2列グリッド）+ 本日成績サマリー + DB蓄積状況
2. **レース一覧**: 選択場の1R〜12R、レースタイプ(⚡本命/📊混戦/🔥穴)、ミニ確率バー
3. **レース詳細**: 出走表（6艇カード）+ AI予想根拠/リスク + 買い目(3方式)
4. **成績トラッカー**: 日別的中率グラフ、レースタイプ別集計
5. **設定**: 買い目点数/方式、DB管理、localStorage使用量

## AI予測エンジン v2（3層）

### Layer 1: ルールベース（8カテゴリ A〜H）
- A. コース補正: 場別勝率×35 + 級別減衰(0.55-1.0)
- B. 選手コース別実力: racerDB活用、フォールバック=全国勝率×2.5
- C. 決まり手パターン: 隣接コースの脅威度分析(差し/まくり/まくり差し)
- D. モーター・ボート: 5段階評価(超抜/好機/並機/低調/整備要)
- E. 展示総合: タイム順位+ST+複合+実力乖離+チルト整合性、コース別減衰
- F. 風・水面: 風向×コース補正、波高、水温
- G. F/Lペナルティ: F2=-25, F1=-15, L1=-5
- H. フォーム: 直近5R平均着順+連対率+トレンド

### Layer 2: ロジスティック回帰（12次元特徴量）
- SGDオンライン学習、results確定時に重み更新
- DB蓄積量に応じたL1/L2融合比自動調整(0.35:0.65 ← 0.60:0.40)

### Layer 3: 買い目生成（3方式）
- 確率順: 上位N点
- フォーメーション: 上位2×4×5からフィルタ
- BOX: 上位3-4艇のBOX

### レース3段階判定
- ⚡本命: 1着確率>40% AND top2>55%
- 📊混戦: その他
- 🔥穴: 1着確率<25% OR 波高7cm+ OR 風速5m+

## localStorage DB

- `boatrace_racerDB`: 選手別コース成績(courseStats)・決まり手(courseStyle)・直近成績(recentResults)
- `boatrace_stadiumDB`: 場別コース勝率・決まり手分布
- `boatrace_history`: 予想履歴（的中/払戻/レースタイプ）
- `boatrace_weights`: Layer2学習済み重み(12次元)
- `boatrace_settings`: ユーザー設定
- 初回起動時に過去14日分のresultsで初期DB構築
- 60日以上古いデータは自動削除

## 注意事項

- APIは非公式、約30分間隔更新
- 単一ファイル構成を維持すること
- 予想は参考情報であり、的中を保証するものではない
- previews.boatsはオブジェクト（キーは文字列"1"〜"6"）
- programs.boatsは配列

## 修正履歴 (2026-05-04: 多視点レビュー後の統合改善)

### Phase 0: 緊急セキュリティ封鎖
- S-02: GitHub PAT を index.html / localStorage から完全撤去
- S-03: Service Worker 登録コードを追加（PWA キャッシュ戦略を有効化）
- S-04: 既存 escText の活用範囲を確認、未エスケープ箇所はなしと判明
- S-05: chromium launcher を hardening
- S-01 (PAT を .git/config から SSH 化) は user の手動作業として `docs/不具合修正設計書.md §2.2` に手順記載

### Phase 1: 監視・運用基盤修復
- M-01: heartbeat 書込を mktemp+mv で atomic 化、失敗時 ERROR ログ
- M-03: flock に timeout 追加、cron 重複起動を防止
- M-04: run_scrape の $? 取得タイミング修正
- M-05: rebase 失敗時 reset --hard / checkout --theirs を撤去（データロス防止）
- M-09: 失敗を非ゼロ終了で外に伝播
- M-02: cron_monitor の stat 失敗握り潰しを排除
- M-06: 24h 無更新は時間外でも CRITICAL alert
- M-07: stat -c%s に統一（Linux 互換）
- M-08: cron PATH 補強

### Phase 2: データ整合性・並行性
- 共通 `scripts/io_utils.py` (atomic_write_json) / `scripts/time_utils.py` (utc_iso_seconds, first_of_next_month) 新設
- D-01〜10/D-12: 全 scraper の JSON 書込を atomic、datetime API 統一、scrape merge 健全化
- D-09: scripts/scrape_odds.py（旧版）削除、GitHub Actions fallback も scrape_odds_fast.py に切替
- D-13: グローバル git lock で odds/previews の git 操作衝突を排除

### Phase 3: JS ロジックバグ撲滅
- 共通ヘルパ追加: safeParse / safeSet / softmax / safeDiv / jstYmd / setManagedInterval
- L-01/02: コピペ typo 修正
- L-04/05: localStorage の安全 parse / Quota リトライ
- L-06/10: softmax NaN/Infinity 耐性
- L-11/12: JST 日付計算を 1 関数に集約、二重 new Date 廃止
- L-17: oddsHistory / getOddsTrend 死コード削除
- L-18: setInterval を一元管理、beforeunload で clear

### Phase 4: PWA / SW / manifest
- sw.js v3 → v4: caches.put await / data/ 503 fallback / skipWaiting message-driven / cache key 正規化
- manifest.json: id / scope / start_url / maskable purpose
- index.html: CSP メタタグ、validateApiPayload で API スキーマ最小検証

### Phase 5: テスト / RUNBOOK / CI
- scripts/tests/{test_io_time.py, test_predictor_helpers.js, test_cron_scrape.bats, run_all.sh}
- 合計 39 ユニットテスト全 PASS（Python 16 / JS 15 / Shell 8）
- .github/workflows/test.yml で CI 化
- docs/RUNBOOK.md（運用障害対応手順）
- docs/不具合修正設計書.md（86 件改善の設計書）

## 修正履歴 (2026-05-04: A+ 化統合実装 4 Phase 完了)

設計書: `docs/A_PLUS_化設計書.md` v1.0（5 Phase / 45 件 / 52h）
専門家レビュー結果（Security:D / Prediction:C- / Code:B / PWA:B-）を A+ に引き上げる統合実装。

### Phase A: Security A+ 化（PA-2..9 完了、PA-1 は user 手動）
- PA-2: CSP 強化 — object-src 'none' / base-uri 'self' / frame-ancestors 'none' / form-action 'self' / upgrade-insecure-requests 追加
- PA-3: SRI（Chart.js 4.4.1 SHA-384）+ preconnect / referrerpolicy
- PA-4: 全 workflow を contents:read 既定 + job 内 write、persist-credentials:false、push 時のみ token 注入、scrape-odds の repository_dispatch 撤去
- PA-5: localStorage スキーマバリデータ `_validateLS`、破損データの自動隔離、5 箇所の raw JSON.parse を safeParse に統一
- PA-6: requirements.txt を == pin、.github/dependabot.yml 新設（pip + actions 週次）
- PA-7: SW fetch handler に origin allowlist、GET 以外 / 未許可 origin はバイパス
- PA-8: CLAUDE.md.bak 削除、.gitignore に .icon_backup / *.bak / dist / .venv 追加
- PA-9: Referrer-Policy / X-Content-Type-Options / Permissions-Policy meta 追加
- PA-1（PAT 失効 + SSH 化 + history scrub）: docs/A_PLUS_化設計書.md §2.2 に手順記載、user 手動

### Phase C: Code Quality A+ 化（PC-1/3/4/5/6/7/8/9/10/12 完了、PC-2 後 Phase 委譲）
- PC-1: scripts/http_utils.py 新設、sync HTTP を集約（fetch_text/bytes/json + 共通 UA + 指数バックオフ + 404 即時 raise）。scrape_results / scrape_racedata / scrape_schedule を切替
- PC-3: TUNING (Object.freeze) で RACE_TYPE / KELLY / L2 のしきい値集約
- PC-4: 主要 Python 関数 9 個に `dict | None` / `list[...]` 等を付与
- PC-5: index.html inline script 先頭に 'use strict'
- PC-6: window.onerror / unhandledrejection で boatrace_errors に最大 100 件循環保存、設定画面に表示・コピー・削除 UI
- PC-7: build パイプライン設計骨子 `build/README.md`（esbuild IIFE bundle、CSP nonce / SRI 自動付与の段階導入計画）
- PC-8: 新規 34 テスト追加（test_http_utils.py 11 件、test_storage_validator.js 23 件、test_plackett_luce.js 11 件で合計 45 件追加）
- PC-9: silent fail 5 箇所を log.warning / log.debug / print に置換
- PC-10: datetime.utcnow を utc_iso_seconds に統一（build_db / scrape_results 計 3 箇所）
- PC-12: 公開関数 docstring を Google Style で整備
- PC-2（長関数分割）: openRace 548 / scoreBoatV2 287 / _applyLiveDataMerge 227 はテスト基盤拡充とビルドパイプライン導入後に着手すべきため build/README.md に分割計画を記載して委譲

### Phase B: Prediction A+ 化（PB-1/2/3/4/8/9/10/11 完了、PB-5/6/7 後 Phase 委譲）
CRITICAL fix: L2 学習則の二重学習バグ修正と calibration / leakage 対策。
- PB-1: 学習ガード `boatrace_learned`（date_sid_rno で 1 レース 1 回、上限 10000）→ 起動毎の重複学習で重みが暴走する CRITICAL バグを撲滅
- PB-2: LR decay `lr=LR0(0.05)/(1+t/TAU(5000))` + L2 正則化 `λ=1e-4`、boatrace_trainstep を永続化
- PB-11: COURSE_LOG_PRIOR を l2Predict logit に加算（全国コース別 1 着率を Bayesian 風に反映）
- PB-4: Plackett–Luce 三連単 / 二連単確率モデル（`p_i*p_j*p_k*6` の系統バイアス撲滅、Σ=1.0±1e-9 検証）
- PB-8: Bayesian shrinkage で L1/L2 融合比連続化（α=N0/(N0+n)、N0=300/600）
- PB-9: 排他事象 Kelly — ∑f_i > KELLY.MAX_STAKE_RATIO で比例縮小
- PB-3: runForwardChainBacktest 関数追加（warmup 後の logloss/brier/ECE 評価、leakageNote 明示）
- PB-10: _computeCalibrationMetrics で log loss / Brier / ECE を 10 bin で集計
- PB-5/6/7（stacking / Platt scaling / z-score 正規化）: 実データ蓄積後の独立 PR、設計書 §3 に詳細

### Phase D: PWA / UX A+ 化（PD-1〜13 完了）
- PD-1: manifest 拡充 — categories / lang / dir / shortcuts (成績 / 検証) / description
- PD-2: SW v6 — CDN（cdnjs / gstatic / Google Fonts）を別 cache 名 `cdn-v1` で cache-first + Stale-While-Revalidate
- PD-3: 更新通知トースト + SKIP_WAITING + controllerchange による自動リロード、SW から NEW_VERSION メッセージ
- PD-4: apple-touch-icon に sizes=180x180 を追加
- PD-5: viewport から user-scalable=no / maximum-scale=1 を撤去（a11y 違反解消）
- PD-6: body に min-height:100dvh、左右 safe-area-inset、header に上端 safe-area、apple-mobile-web-app-status-bar-style を black-translucent に
- PD-7: ランドマーク `header role="banner"` / `nav role="navigation"`、aria-label / aria-current="page" を showPage と同期、絵文字に aria-hidden、sr-only クラス
- PD-8: focus-visible で 3px outline
- PD-9: nav-btn 48x48pt、action-btn 44pt、refresh-btn 44pt、文字 11-13px に統一
- PD-10: 二段確認 `_confirmDestructive`（confirm + DELETE 入力プロンプト）を clearHistory / rebuildDB / resetWeights に適用
- PD-11/13: index.html に preconnect 4 箇所追加（Google Fonts / cdnjs / boatraceopenapi）。innerHTML→template 化と Chart.js 動的 import は PC-7 ビルド導入後の段階拡張で着手予定
- PD-12: visibilitychange でタブ非表示時 setInterval を停止、復帰時に再開＋即時 1 回実行（バッテリー / ネットワーク節約）

### 検証結果
- テスト: 19/19 全 PASS（合計 84 件: 旧 39 + 新 45）
- JS 構文: node --check 緑、'use strict' 有効
- Python: 7 モジュール import OK
- manifest / sw 構文 OK
- セキュリティ: CSP 全項目目視確認 OK、SRI 付与済、workflow contents:read 既定

### 残タスク（後 Phase 委譲、A_PLUS_化設計書 §6 PE）
- PA-1: PAT 失効 + .git/config から削除 + SSH 化（user 手動、最優先）
- PB-5/6/7: stacking / Platt scaling / z-score 正規化（実データ 500 サンプル蓄積後）
- PC-2: 長関数分割（openRace / scoreBoatV2 / _applyLiveDataMerge）— PC-7 ビルド導入と統合
- PC-7: esbuild ビルドパイプライン本格実装（CSP nonce 化と統合）
- PE: 統合検証 + Lighthouse / semgrep / pip-audit を CI ゲートに組込
