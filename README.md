# 競艇予想AI (BoatRace Oracle)

全24場対応の競艇AI予想PWAアプリ

## 特徴
- 9要素スコアリングによるAI予想
- 全24場対応、リアルタイムデータ取得
- 3連単BOX・2連単の推奨買い目提案
- スコア内訳の透明性表示
- PWA対応（スマホホーム画面に追加可能）

## アクセス
https://inotaka1979.github.io/boatrace-ai/

## 開発

### クイックスタート

```bash
git clone git@github-boatrace:inotaka1979/boatrace-ai.git
cd boatrace-ai
make install    # npm ci (root + build/)
make gate       # lint + type + test + build:check   ← push 前必須
```

`make gate` が `✅ gate passed — safe to push` を出すまで push しないこと。

### アーキテクチャ

Clearwing 4 層パターン (`capabilities` / `context` / `discovery` / `analysis` /
`reporting` / `utils`) で構造化されています。詳細は **[docs/architecture.md](docs/architecture.md)** 参照。

### コントリビュート

新規 PR を出す前に **[CONTRIBUTING.md](CONTRIBUTING.md)** のレビュー基準と
コミット規約 (Conventional Commits) を確認してください。

### 主要コマンド

| コマンド | 内容 |
|----------|------|
| `make gate` | lint + type + test + build-check（push 前必須） |
| `make build` | esbuild bundle 注入 + minify + sw/index.html version sync |
| `make test` | 34 テストステップ（Python / Node / bash / snapshot / deprecated pattern） |
| `make snapshots-update` | スナップショット再生成（要 PR description で理由記載） |
| `make type` | tsc --noEmit -p jsconfig.json (JSDoc strict, 5 ファイル) |
