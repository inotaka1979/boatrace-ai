# Cloudflare Workers — BoatRace Oracle のリアルタイムデータ配信

このディレクトリには Worker が 2 本ある。どちらも **main への push で自動デプロイ**され、
**手動で設定する secret は無い**（下の「手動設定」を参照）。

| Worker | 役割 | cron |
|---|---|---|
| `boatrace-scrape-trigger`（`worker.js`） | 本体。openapi + boatrace.jp を取得して KV に保存し、PWA に `/api/*` で配信する | JST 8-22 時は 5 分毎、夜間は 30 分毎 |
| `boatrace-sentinel`（`sentinel/sentinel.js`） | 本体の外形監視と予備 cron。詳細は [`sentinel/README.md`](sentinel/README.md) | 5 分毎（終日） |

## 本体 Worker の動作

```
Cloudflare Cron (*/5 23,0-13 UTC / */30 14-22 UTC)
    ↓ scheduled() → refreshAll()
  Phase 1: openapi の programs / previews / results を取得 → KV に書く → heartbeat を書く
  Phase 2: boatrace.jp を直接スクレイプして展示・結果を補完（それぞれ 1 回 12 ページまで）
  Phase 3: 補完できた分だけ KV を書き直す
    ↓
PWA → GET /api/previews | /api/programs | /api/results   (KV から配信)
```

- KV（binding `BOATRACE_KV`）は内容が変わった時だけ書く（無料枠 1,000 writes/日の節約）。
- cron が止まっても、`/api/*` へのアクセス自体が `refreshAll()` を起動する（serve-heal、5 分 throttle）。
- さらに sentinel が 5 分毎に `/api/refresh-now` を叩く予備 cron として働く。

## エンドポイント

| パス | 用途 |
|---|---|
| `GET /health` | 疎通と KV 各キーの鮮度。`?strict=1&max_age_sec=N` は cron heartbeat が N 秒より古いと HTTP 500 |
| `GET /api/previews` `/api/programs` `/api/results` | PWA 用の本日データ（KV） |
| `GET /api/refresh-now` | `refreshAll()` を 1 回実行。未認証は 5 分に 1 回まで（超過は 429）。`TRIGGER_SECRET` を提示すれば無制限 |
| `GET /odds-proxy?type=&sid=&rno=&hd=` | boatrace.jp オッズの CORS プロキシ（表示中レースの実時間オッズ） |
| `GET /result-proxy?jcd=&race=&hd=` | 結果 1 レースのオンデマンド取得 |
| `GET /beforeinfo-proxy?jcd=&race=&hd=` | 直前情報 1 レースのオンデマンド取得 |
| `GET /orig-exhibition-proxy` | 各場オリジナル展示のプロキシ（対応場のみ） |
| `GET /hotpepper` | 姉妹アプリ（旅食Navi）用のホットペッパー API 中継。KV は使わない |

CORS は Origin 許可リスト方式（`https://inotaka1979.github.io` と localhost:8000/8080）。
追加したい場合だけ、環境変数 `ALLOWED_ORIGINS`（カンマ区切り）を設定する。

## デプロイ

`cloudflare-worker/**` を変更して main に push すると `.github/workflows/deploy-worker.yml` が動く。

| job | 内容 |
|---|---|
| `deploy` | 本体をデプロイし `/health` が 200 であることを確認 |
| `deploy-sentinel` | sentinel をデプロイし、`/status` が 200・Service Binding が有効であることを確認 |
| `verify-sentinel-cron` | sentinel の cron が新バージョンで実際に発火したことを確認（最大 11 分待つ） |

Cloudflare ダッシュボードで「コードを編集」する必要は無い。

## 手動設定

**必須の手動設定は、初回セットアップ時に登録済みの GitHub Actions secret 2 つだけ。**

| 場所 | 名前 | 状態 |
|---|---|---|
| GitHub → Settings → Secrets → Actions | `CLOUDFLARE_API_TOKEN` | 登録済み（デプロイに使用） |
| 同上 | `CLOUDFLARE_ACCOUNT_ID` | 登録済み |

以下は**任意**で、未設定でも全機能が動く。

| 場所 | 名前 | 入れると変わること |
|---|---|---|
| Cloudflare → boatrace-sentinel → Settings → Variables and Secrets | `GH_TOKEN` | 本体 cron 停止時の再デプロイと issue 起票が「最大 1 日後（GitHub 側 watchdog）」から「15 分後（sentinel）」に早まる。データ更新は入れなくても sentinel の予備 cron で続く |
| Cloudflare → 両 Worker の Secret + GitHub Actions secret | `TRIGGER_SECRET` | `/api/refresh-now` の 5 分 throttle を素通りできる。sentinel は throttle に当たっても短時間待って再試行するので、通常は不要 |

> 旧設計（Worker が GitHub Actions を 3 分毎に dispatch する方式）で使っていた本体の
> `GITHUB_TOKEN` secret は、現在のコードでは参照していない。ダッシュボードに残っていても害は無いが、
> 不要なので削除してよい。

## 動作確認

```bash
# 本体: KV 各キーの鮮度と cron heartbeat
curl -s https://boatrace-scrape-trigger.inotaka1979.workers.dev/health | python3 -m json.tool

# sentinel: 本体の監視結果・sentinel 自身の cron 記録・過去の失敗区間
curl -s https://boatrace-sentinel.inotaka1979.workers.dev/status | python3 -m json.tool
```

障害時の手順は `docs/RUNBOOK.md` §8。

## 新しい Cloudflare アカウントで一から作る場合

1. Cloudflare で KV namespace を作成し、`wrangler.toml` と `sentinel/wrangler.toml` の
   `[[kv_namespaces]] id` を書き換える。
2. Cloudflare の API Token（テンプレート「Edit Cloudflare Workers」）と Account ID を、GitHub の
   Actions secret `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` に登録する。
3. Actions タブで「Deploy Cloudflare Worker」を実行する（cron trigger と Service Binding は
   `wrangler.toml` から自動で登録される）。
4. `src/discovery/openapi_client.js` の `WORKER_BASE`（変更後は build が必要）、`index.html` の
   preconnect / CSP、`sentinel/wrangler.toml` の `MAIN_BASE`、各 workflow 内の `*.workers.dev` の
   URL を新しいサブドメインに合わせる。
