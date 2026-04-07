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
