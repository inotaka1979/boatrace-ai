# Cloudflare Worker — boatrace-scrape-trigger

Cloudflare Workers Cron で GHA workflow_dispatch を 3 分間隔に叩き、Pi 不要かつ
GHA cron 遅延 (5–30 min) を回避して 3 分鮮度を維持する。

## セットアップ手順

### 1. GitHub Fine-grained PAT 作成

https://github.com/settings/personal-access-tokens/new

- **Token name**: `boatrace-cloudflare-worker-dispatch`
- **Expiration**: 1 year
- **Repository access**: Only select repositories → `inotaka1979/boatrace-ai`
- **Repository permissions** → **Actions**: Read and write
- 「Generate token」→ コピー（あとで Cloudflare に貼る）

### 2. Cloudflare Worker のシークレット登録

Workers & Pages → `boatrace-scrape-trigger` → 設定 → 環境変数 → Secret 追加

- `GITHUB_TOKEN` = (1) で生成した PAT
- `TRIGGER_SECRET` = 任意のランダム文字列（手動 /trigger エンドポイント用）

### 3. Cron トリガー追加

設定 → トリガー → Cron トリガー → 追加

- `*/3 * * * *` (3 分間隔、24/7。JST 時刻判定は Worker 内部で実施)

### 4. コード差し替え

「コードを編集する」→ `worker.js` の内容を貼り付けて 保存 + デプロイ。

## 動作確認

```bash
# ヘルスチェック
curl https://boatrace-scrape-trigger.inotaka1979.workers.dev/health

# 手動 dispatch
curl "https://boatrace-scrape-trigger.inotaka1979.workers.dev/trigger?secret=YOUR_SECRET&workflow=scrape-odds.yml"
```

GHA Actions タブで対応する workflow が `workflow_dispatch` で起動していれば成功。

## 動作フロー

```
Cloudflare Cron (*/3 * * * *)
    ↓ scheduled()
JST 時刻判定
    ├─ 08-22: odds + previews dispatch
    ├─ 10-23 (6分毎): results dispatch
    └─ 08:00 ちょうど: tide dispatch
    ↓
GHA workflow_dispatch API
    ↓
GitHub Actions runner (即時起動)
    ↓
既存 scrape_*.py 実行 → commit & push
```

## 既存 GHA cron との関係

Cloudflare Worker が dispatch する workflow ファイル (`scrape-*.yml`) には
`schedule:` が残っている。**Cloudflare 化後は schedule を削除しても良いし、
低頻度のフォールバックとして残しても良い**（Cloudflare が落ちた時の保険）。

推奨: 既存 schedule を低頻度（例 30 分間隔）に下げて保険化。
