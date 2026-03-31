# 競艇予想AI

## プロジェクト概要
全24場対応の競艇予想PWAアプリ。
BoatraceOpenAPI（GitHub Pages JSON）からデータ取得。
GitHub Pagesでホスティング。

## データソース
- 出走表: https://boatraceopenapi.github.io/programs/v2/today.json
- 直前情報: https://boatraceopenapi.github.io/previews/v2/today.json
- 結果: https://boatraceopenapi.github.io/results/v2/today.json
- 日付指定: v2/YYYY/YYYYMMDD.json

## 技術構成
- 単一HTML（index.html）にJS/CSS全て内包
- PWA対応
- 外部API: BoatraceOpenAPI（GitHub Pages、CORS対応済み）

## AI予想ロジック
9要素スコアリング: コース基準点、全国勝率、全国2連率、当地勝率、
モーター2連率、ボート2連率、展示タイム、級別ボーナス、体重補正

## デプロイ手順
1. index.html を編集
2. git add -A && git commit -m "変更内容" && git push origin main
3. 1-3分後にGitHub Pagesに自動反映

## 注意事項
- APIは非公式、約30分間隔更新
- 単一ファイル構成を維持すること
- 予想は参考情報であり、的中を保証するものではない
