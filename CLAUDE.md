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
