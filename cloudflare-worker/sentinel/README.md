# boatrace-sentinel — 本体 Worker の外形監視と予備 cron

本体 Worker `boatrace-scrape-trigger` の cron 停止を 5 分毎に監視し、止まっていれば
**本体の更新処理を代わりに起動し続ける**第 2 の Cloudflare Worker。

**手動設定（secret）は不要。** デプロイも検証も `.github/workflows/deploy-worker.yml` が自動で行う。

## なぜ必要か（2026-11-11）

- 本体の cron (`scheduled()`) は 9/21〜10/17 に 15 回停止した。
- 検知と復旧は GitHub Actions（`worker-watchdog.yml` 毎時 / `data-freshness-monitor.yml` 5 分）に
  載っていたが、GitHub は本リポジトリの schedule を **1 workflow あたり 1-2 回/日**まで間引く
  （実測 11/8-11/11）。検知の空白が数時間〜半日になっていた。
- Cloudflare の Cron Triggers は間引かれない。監視を Cloudflare 側に置く。

## 動作

5 分毎に `GET /health?strict=1&max_age_sec=<閾値>` を本体へ送る。
閾値は JST 08:20〜22:59 が 1200 秒（5 分 cron の 4 回分）、それ以外は 2700 秒（30 分 cron）。
朝 08:00〜08:19 を夜間扱いにしているのは、08:00 時点の最後の heartbeat が 07:30 のもの
（30 分前）で正常だから（日中閾値にすると毎朝必ず誤検知する）。

| 状態 | 動作 |
|---|---|
| 200 | 正常。失敗区間の途中だったなら履歴に確定し、状態をリセット |
| 非 200（毎回） | 本体の `/api/refresh-now` を呼ぶ = **予備の cron**。429（本体の 5 分 throttle）で残りが 30 秒以内なら待って 1 回だけ再試行 |
| 連続 3 回失敗 | 「障害」として記録。`GH_TOKEN` がある場合のみ、`deploy-worker.yml` を dispatch（3 時間に 1 回まで）し issue（label `worker-cron-dead`）を起票・更新・クローズ |
| 本体が到達不能 | 再デプロイしない（Worker 全体停止は対象外） |

### `GH_TOKEN` が無い場合（既定）

| 何が起きるか | 誰がやるか | 所要 |
|---|---|---|
| 本体 cron 停止の検知 | sentinel | 20〜25 分（heartbeat が閾値を超えた最初の tick） |
| データ更新の継続 | sentinel が 5 分毎に `refresh-now` | 検知と同時に開始 |
| 本体 cron の再登録（再デプロイ）と issue | GitHub 側 `worker-watchdog.yml`（組込みトークン） | schedule 間引きのため最大 1 日程度 |

つまり `GH_TOKEN` を入れて変わるのは 3 行目が「15 分」になることだけで、アプリから見える
データ鮮度は変わらない。

### 本体への呼び出しは Service Binding

`[[services]] binding = "MAIN"` 経由で呼ぶ。Worker から同一アカウントの `*.workers.dev` を
公開 URL で fetch すると Cloudflare が 404 を返すため（Worker→Worker の同一ゾーン fetch 非対応、
error 1042。初回デプロイの `/status` で実測）。`/status` の `main_binding` が true であること。

## 自己観測

sentinel は KV（本体と同じ namespace、キー `sentinel:state`）に次を残す。

| 項目 | 内容 | KV 書込 |
|---|---|---|
| `cron_last_at` / `build` | sentinel 自身の cron が走った時刻と、その時のデプロイ ID | 1 時間に 1 回 + デプロイ直後の初回 tick |
| `streak` | 進行中の失敗区間（開始時刻、理由、heartbeat 経過秒、データキーの鮮度、refresh-now の成否） | 失敗中の各 tick（1 日の予算内） |
| `history` | 終了した失敗区間の直近 10 件 | 復旧時 |
| `writes` | sentinel がその日（UTC）に行った KV 書込回数 | — |

`history` の `data`（`previews` / `results` の `age_sec` と `src`）を見ると、
「cron の heartbeat だけ止まっていた（データは別経路で更新されていた）」のか
「データ更新ごと止まっていた」のかを後から判別できる。

### KV 書込の予算

KV の無料枠（1,000 writes/日、UTC 0 時にリセット）は本体と共用で、本体は平常時に約 700 回/日使う。
失敗中に毎 tick 保存すると本体 cron が丸 1 日止まった日に 288 回書くことになるため、
sentinel の書込は **1 日 120 回**（`DAILY_WRITE_BUDGET`、10 時間分の tick）を超えたら次の
「必須の保存」だけに絞る。

- 生存記録（1 時間に 1 回）
- 復旧（履歴の確定と状態のリセット）
- GitHub 側に副作用を出した tick（再デプロイの dispatch、issue の起票・コメント）。保存し損ねると
  次の tick で同じ操作を繰り返すため

絞っている間も `refresh-now` は毎 tick 呼ぶ（予備 cron は止まらない）。記録できなかった tick の数は
`streak.unrecorded_ticks` / `history[].unrecorded_ticks` に残る。その区間の `failures` と `refresh` は
「記録できた tick」の数になる。

確認方法（`/status` は誰でも読める。書込はしない）:

```bash
curl -s https://boatrace-sentinel.inotaka1979.workers.dev/status | python3 -m json.tool
```

| フィールド | 期待値 |
|---|---|
| `main_binding` | `true` |
| `main_probe.ok` | `true`（本体 cron が正常） |
| `sentinel_cron.age_sec` | 3600 前後まで（書込が 1 時間に 1 回のため）。**10800 を超えたら sentinel の cron が止まっている** |
| `sentinel_cron.build_recorded` | `build` と同じ = 現行版の cron が 1 回以上走った |
| `state.history` | 過去の失敗区間 |
| `state.writes.n` | 平常時は 24 以下。120 を超えていたら、その日は長い失敗区間があった |

人が見に行かなくても、次の 2 つが自動で確認する。

- `deploy-worker.yml` の `verify-sentinel-cron` job: デプロイ後、新バージョンの cron が発火するのを最大 11 分待つ。
- `worker-watchdog.yml` の「Check sentinel liveness」: `sentinel_cron.age_sec` が 3 時間を超えていたら
  再デプロイを dispatch し、issue（label `sentinel-down`）を起票する。履歴もログに出す。

## 任意設定

未設定で全機能が動く。入れる場合は Cloudflare dashboard → Workers & Pages → **boatrace-sentinel** →
Settings → Variables and Secrets に Secret として追加する。

- **`GH_TOKEN`** — GitHub の fine-grained personal access token。
  Repository access は `inotaka1979/boatrace-ai` のみ、Permissions は **Actions: Read and write** と
  **Issues: Read and write**。効果は上の表のとおり（再デプロイと issue が 15 分に早まる）。
- **`TRIGGER_SECRET`** — 本体と同じ値。`refresh-now` の throttle を素通りし、
  `GET /run?secret=...` で cron を待たずに 1 回検査できる。

## 無料枠

- Cron Triggers: Free は合計 5/アカウント。本体 2 + sentinel 1 = 3。
- Requests: 288 回/日（監視）+ 失敗時の `refresh-now`。
- KV: 読み 288/日。書きは平常時 24 回/日（生存記録）、失敗区間がある日でも 120 回 + 必須の保存
  （上の「KV 書込の予算」）。本体（約 700 回/日）と合わせて無料枠 1,000 writes/日に収まる。

## テスト

```bash
node scripts/tests/test_sentinel_worker.mjs
```

fetch / KV / 時刻 / sleep を stub し、状態遷移（閾値と朝の境界、dispatch 1 回、クールダウン、
コメント間隔、issue 再利用、到達不能時の非再デプロイ、GH_TOKEN 無し、復旧クローズ、
Service Binding 経由、生存記録の書込頻度、履歴の確定と上限、429 の再試行、KV 書込の予算と
予算超過中の必須保存、KV 書込失敗時の挙動）を固定している。
