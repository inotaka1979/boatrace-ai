# CLAUDE.md — BoatRace Oracle AI予想アプリ

## プロジェクト概要

競艇（ボートレース）のAI予想PWAアプリを**単一HTMLファイル**で実装。
Boatrace Open API（GitHub Pages上の無料JSON API）からリアルタイムデータを取得し、
ルールベース＋軽量MLのハイブリッド予測エンジンで全24場の全レースを予想する。

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

1. **トップ**: 開催場一覧（2列グリッド）+ 本日成績サマリー
2. **レース一覧**: 選択場の1R〜12R、予想ステータス、ミニ確率バー
3. **レース詳細**: 出走表（6艇カード）+ AI予想 + 買い目
4. **成績トラッカー**: 日別的中率、本命vs穴、場別ランキング
5. **設定**: 買い目点数、資金配分、予算、DBリセット

## AI予測エンジン（3層）

- **Layer 1**: ルールベース（A〜Hの8カテゴリスコアリング）
- **Layer 2**: ロジスティック回帰（12次元特徴量、SGDオンライン学習）
- **Layer 3**: 買い目生成（条件付き確率、3連単/2連単）

## localStorage DB

- `boatrace_racerDB`: 選手別コース成績・決まり手・フォーム
- `boatrace_stadiumDB`: 場別コース勝率・決まり手分布
- `boatrace_history`: 予想履歴（的中/払戻）
- `boatrace_weights`: Layer2学習済み重み
- `boatrace_settings`: ユーザー設定
- 初回起動時に過去7日分のresultsで初期DB構築
- 30日以上古いデータは自動削除

## デプロイ手順

```bash
git add -A && git commit -m "変更内容" && git push origin main
# → GitHub Pages自動デプロイ
```

## 注意事項

- APIは非公式、約30分間隔更新
- 単一ファイル構成を維持すること
- 予想は参考情報であり、的中を保証するものではない
- previews.boatsはオブジェクト（キーは文字列"1"〜"6"）
