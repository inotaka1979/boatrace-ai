# Cloudflare Worker — boatrace-scrape-trigger

Cloudflare Workers Cron で GHA workflow_dispatch を 3 分間隔に叩き、Pi 不要かつ
GHA cron 遅延 (5–30 min) を回避して 3 分鮮度を維持する。

加えて、`/odds-proxy` エンドポイントで PWA から boatrace.jp への CORS プロキシ
を提供 (cron 障害時の保険ルート)。

## デプロイ方法

**推奨**: GitHub Actions で `cloudflare-worker/` を編集して push すれば自動デプロイ
(下記「自動デプロイ初期セットアップ」を 1 回だけ実施)。

代替: 下記「手動デプロイ」セクション参照。

## 自動デプロイ初期セットアップ (1 回のみ)

### Step 1: Cloudflare Account ID を取得

1. https://dash.cloudflare.com/ にログイン
2. 任意のドメイン or Workers & Pages を開く
3. 右サイドバーの **Account ID** をコピー
   (例: `1234567890abcdef1234567890abcdef`)

### Step 2: Cloudflare API Token を生成

1. https://dash.cloudflare.com/profile/api-tokens を開く
2. **「Create Token」** をクリック
3. テンプレ「**Edit Cloudflare Workers**」を選択 → **Use template**
4. Account Resources: **Include → 該当アカウント**
5. Zone Resources: **All zones** (default のままで OK)
6. **Continue to summary** → **Create Token**
7. 表示されたトークンをコピー (二度と見られないので注意)

### Step 3: GitHub repo に secrets を登録

1. https://github.com/inotaka1979/boatrace-ai/settings/secrets/actions を開く
2. **「New repository secret」** をクリックして 2 つ追加:
   - `CLOUDFLARE_API_TOKEN` = (Step 2 のトークン)
   - `CLOUDFLARE_ACCOUNT_ID` = (Step 1 の ID)

### Step 4: 初回デプロイをトリガー

以下のいずれかで OK:
- Actions タブ → **「Deploy Cloudflare Worker」** → **Run workflow**
- `cloudflare-worker/worker.js` を編集して main に push

Actions が緑になれば成功。`curl https://boatrace-scrape-trigger.inotaka1979.workers.dev/health`
で疎通確認。

## 以降の運用

`cloudflare-worker/worker.js` を編集 → main に push するだけで自動デプロイ。
Cloudflare ダッシュボードで「コードを編集する」する必要はもうありません。

## 動作確認

```bash
# ヘルスチェック
curl https://boatrace-scrape-trigger.inotaka1979.workers.dev/health

# 手動 dispatch (TRIGGER_SECRET 必須)
curl "https://boatrace-scrape-trigger.inotaka1979.workers.dev/trigger?secret=YOUR_SECRET&workflow=scrape-odds.yml"

# odds 実時間プロキシ (PWA から呼ばれるエンドポイント)
curl "https://boatrace-scrape-trigger.inotaka1979.workers.dev/odds-proxy?type=trifecta&sid=22&rno=5&hd=20260510"
```

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

PWA (詳細画面 open)
    ↓ /odds-proxy?type=...
Cloudflare Worker
    ↓ (CORS pass-through)
boatrace.jp/owpc/pc/race/{oddstf|odds2tf|odds3t}
```

## 既存 GHA cron との関係

Cloudflare Worker が dispatch する workflow ファイル (`scrape-*.yml`) には
`schedule:` も残しており、Cloudflare 障害時の保険として 5 分間隔で動く。

## 手動デプロイ (旧方式 / 緊急時用)

GitHub Actions 自動デプロイが使えない時のみ:

1. Workers & Pages → `boatrace-scrape-trigger` → 「コードを編集する」
2. `cloudflare-worker/worker.js` の最新内容を貼り付け
3. 「保存してデプロイ」

## 初回 Worker 作成 (新規セットアップ時のみ)

新しい Cloudflare アカウントで一から作る場合の手順は以下を順に実施:

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
