# boatrace-sentinel — 本体 Worker の外形監視・自己復旧

本体 Worker `boatrace-scrape-trigger` の cron 停止を **5 分以内に検知し、自動で復旧を試みる**
第 2 の Cloudflare Worker。

## なぜ必要か（2026-11-11）

- 本体の cron (`scheduled()`) は 9/21〜10/17 に 15 回停止した。
- 検知と復旧は GitHub Actions（`worker-watchdog.yml` 毎時 / `data-freshness-monitor.yml` 5 分）に
  載っていたが、GitHub は本リポジトリの schedule を **1 workflow あたり 1-2 回/日**まで間引く
  （実測 11/8-11/11）。検知の空白が数時間〜半日になっていた。
- Cloudflare の Cron Triggers は間引かれない。監視を Cloudflare 側に置く。

## 動作

5 分毎に `GET {MAIN_BASE}/health?strict=1&max_age_sec=<閾値>`（JST 8-22 時 1200s、夜間 2700s）。

| 状態 | 動作 |
|---|---|
| 200 | 正常。障害中だったなら issue を閉じて状態リセット |
| 非 200（毎回） | `/api/refresh-now`（`TRIGGER_SECRET` 提示）でデータを自己修復 |
| 連続 3 回失敗 | 障害。reason が `cron_heartbeat_stale/_missing` かつ本体が応答 → `deploy-worker.yml` を dispatch（cron trigger 再登録、3 時間に 1 回まで）。issue（label `worker-cron-dead`）起票、継続中は 1 時間毎に経過コメント |
| 本体が到達不能 | 再デプロイしない（Worker 全体停止は対象外）。issue で dashboard 確認を促す |

KV は本体と同じ namespace を `sentinel:` prefix で共用。書込は状態遷移時のみ（正常時 0 回/日）。

本体への呼び出しは **Service Binding**（`[[services]] binding = "MAIN"`）経由。Worker から
同一アカウントの `*.workers.dev` を公開 URL で fetch すると Cloudflare が 404 を返すため
（Worker→Worker の同一ゾーン fetch 非対応、error 1042。初回デプロイの `/status` で実測）。
`/status` の `main_binding` が true であることを確認する。

## 初期設定（1 回、ユーザー手動）

デプロイ自体は `.github/workflows/deploy-worker.yml` の `deploy-sentinel` job が
`cloudflare-worker/**` の push で自動実行する（既存の `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を使う）。

その後、Cloudflare dashboard → Workers & Pages → **boatrace-sentinel** → Settings → Variables and Secrets:

1. **`GH_TOKEN`**（Secret）— GitHub の fine-grained personal access token
   - https://github.com/settings/personal-access-tokens → Generate new token
   - Repository access: **Only select repositories → inotaka1979/boatrace-ai**
   - Permissions: **Actions: Read and write**、**Issues: Read and write**（他は不要）
   - 無くても監視と refresh-now は動く。再デプロイ dispatch と issue 起票だけが止まる。
2. **`TRIGGER_SECRET`**（Secret、任意）— 本体と同じ値。refresh-now の 5 分 throttle を素通りする。

確認:

```bash
curl -s https://boatrace-sentinel.inotaka1979.workers.dev/status | python3 -m json.tool
#   gh_token: true / trigger_secret: true / main_probe.ok: true が期待値
```

`TRIGGER_SECRET` を設定していれば、cron を待たず手で 1 回検査できる:

```bash
curl -s "https://boatrace-sentinel.inotaka1979.workers.dev/run?secret=$TRIGGER_SECRET"
```

## 無料枠

- Cron Triggers: Free は合計 5/アカウント。本体 2 + sentinel 1 = 3。
- Requests: 288 回/日（監視） + 障害時の数回。
- KV: 読み 288/日、書き 0〜数回/日。

## テスト

```bash
node scripts/tests/test_sentinel_worker.mjs
```

fetch / KV / 時刻を stub し、状態遷移（閾値、dispatch 1 回、クールダウン、コメント間隔、
issue 再利用、到達不能時の非再デプロイ、GH_TOKEN 無し、復旧クローズ）を固定している。
