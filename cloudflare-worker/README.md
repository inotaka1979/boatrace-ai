# Cloudflare Workers — BoatRace Oracle のリアルタイムデータ配信

このディレクトリには Worker が 2 本ある。どちらも **main への push で自動デプロイ**され、
**手動で設定する secret は無い**（下の「手動設定」を参照）。

| Worker | 役割 | cron |
|---|---|---|
| `boatrace-scrape-trigger`（`worker.js` + `push.js`） | 本体。openapi + boatrace.jp を取得して KV に保存し、PWA に `/api/*` で配信する。お気に入り選手の締切前通知（Web Push）も送る | データ更新: JST 8-22 時は 5 分毎、夜間は 30 分毎 / 通知の確認: 毎分 |
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

### 締切前通知（Web Push、2026-11-27）

アプリの設定「閉じている間も通知」を有効にした端末へ、お気に入り選手の出るレースの締切 N 分前に通知を送る。
アプリを閉じていても届く。実装は `push.js`（ライブラリなし。本文の暗号化は RFC 8291、送信元の証明は RFC 8292）。

```
アプリ → POST /push/subscribe { 通知の宛先, お気に入り選手, 何分前か } → KV push:subs
データ更新の cron → 番組表から「締切時刻と出場選手」だけを抜き出す → KV push:index（中身が変わった時だけ書く）
毎分の cron (* * * * *) → scheduled() → pushTick()
    締切の N 分前になったレースに、預かっているお気に入り選手が出ていれば、その端末の push service に送る
    送った記録 → KV push:sent:0 / push:sent:1（重ねて送らない。送り損ねは 2 分おきの回に 1 回だけ拾い直す）
```

- `scheduled()` は `event.cron` で振り分ける。毎分の cron はデータ更新（`refreshAll()`）を走らせない。
- 送信元の鍵（VAPID）は、最初の `GET /push/key` で Worker が自分で作って KV（`push:vapid`）に置く。**手動設定は無い。**
  （デプロイ後の確認が `/push/key` を呼ぶので、最初のデプロイで作られる。secret `VAPID_JWK` を入れればそちらを使う。）
- 通知の宛先として受け付けるのは、ブラウザの push service（`fcm.googleapis.com` / `*.push.apple.com` /
  `*.push.services.mozilla.com` / `*.notify.windows.com`）だけ。宛先は 30 件まで、1 宛先のお気に入りは 100 人まで。
- KV の書込（無料枠 1,000 回/日を本体と共用。使い切ると本体のデータ更新まで止まるので、どれにも上限がある）:
  索引 1〜3 回/日、cron の生存記録 4 回/日、宛先の文書（登録・変更・解除・無くなった宛先の掃除）は 1 日 60 回まで、
  送った記録は送った回だけで 1 日 100 回まで。毎分の確認そのものは読むだけ。
  送った記録が上限に達した日は、締切 N 分前ちょうどの回の通知だけを送り、拾い直しはしない
  （送ったかどうかを記録で確かめられないので、同じ通知を重ねて送らないことを優先する）。
- 同じ通知を試すのは 2 分おき（ちょうどの回・2 分後・4 分後 …）で、送った記録は分の偶奇で 2 つの文書に分けている。
  KV は、書いた内容がほかの場所から読めるようになるまで 60 秒ほどかかることがある（Cloudflare の説明では
  「60 秒かそれ以上」）。同じ文書の読み書きを 2 分以上空けることで、古い中身を読んで前の回の記録を上書きしたり、
  記録が読めずに重ねて送ったりするのを避ける。
- ちょうどの回は「送ってから記録」（記録を書けなくても通知は届ける）。拾い直し（ちょうどの回が欠けた・一時的に失敗した・
  直前に登録した）は「記録してから送る」で、記録を書けなければ送らない。KV に書けない間（書込枠を使い切った日など）に、
  isolate が替わるたびに同じ通知を送り直すことが無い。拾い直しは 1 回きり。
- push service への送信は転送 (3xx) を追わない（宛先の検証を転送で抜けさせない）。
- KV を読めなかった時（障害・読込枠切れ）は、その文書に書かない。「読めなかった」を「まだ無い」と取り違えると、
  次の書込でそれまでの中身を消してしまう（送信元の鍵を作り直す = それまでの宛先すべてに送れなくなる /
  預かっている宛先を 1 件で上書きする / 送った記録を消して送り直す）。登録・解除・テスト通知は 503 `kv_unavailable`、
  `/push/key` は 503 `no_key` を返し、毎分の確認は「ちょうどの回の通知だけ送って記録しない」に落とす。
- Cloudflare Free の Cron Triggers はアカウント合計 5 本まで。本体 3 + sentinel 1 = 4 本を使っている。
- 届かない時の調べ方は `docs/RUNBOOK.md` §12。

## エンドポイント

| パス | 用途 |
|---|---|
| `GET /health` | 疎通と KV 各キーの鮮度。`?strict=1&max_age_sec=N` は cron heartbeat が N 秒より古いと HTTP 500 |
| `GET /api/previews` `/api/programs` `/api/results` | PWA 用の本日データ（KV）。previews の `boats` は艇番をキーにした形（`{"1": {...}, …, "6": {...}}`）、気象は `race_wind` などの欄（下の「展示と気象」） |
| `GET /api/refresh-now` | `refreshAll()` を 1 回実行。未認証は 5 分に 1 回まで（超過は 429）。`TRIGGER_SECRET` を提示すれば無制限 |
| `GET /odds-proxy?type=&sid=&rno=&hd=` | boatrace.jp オッズの CORS プロキシ（表示中レースの実時間オッズ） |
| `GET /result-proxy?jcd=&race=&hd=` | 結果 1 レースのオンデマンド取得 |
| `GET /beforeinfo-proxy?jcd=&race=&hd=[&close=HHMM]` | 直前情報 1 レースのオンデマンド取得。展示（艇番をキーにした `boats`）と、使える気象があれば `race_wind` などの欄を返す。`close` はそのレースの締切時刻（アプリが番組表から付ける）で、気象の計測時刻が締切前かを確かめるのに使う。展示前は `{"pending": true}` |
| `GET /orig-exhibition-proxy` | 各場オリジナル展示のプロキシ（対応場のみ） |
| `GET /racer-proxy?toban=` | 選手の今後の出場予定・過去 3 節・直近の優勝（公式の選手ページ 2 枚を解析した JSON）。アプリの選手ページを開いた時だけ呼ばれる。結果は edge に 3 時間置き（ブラウザには残り時間だけ置かせる）、edge に無い選手の取得は isolate ごとに 1 分 30 人まで（超過は 429）。公式が 403 / 429 を返したら、その isolate は 10 分取りに行かない（503）。過去 3 節のページだけが取れなかった時は、出場予定だけを `back3_ok: false` で返して 10 分まで置き、断られた（403 / 429）場合はそのページだけ 10 分取りに行かない（`timing.back3_status` = そのページの HTTP 状態、取りに行かなかった時は 0）。公式を待つのは 20 秒まで（502）。取得と保存は waitUntil で最後までやる（アプリが待ち切れずに切っても、次は edge から返る）。応答の `timing` に、公式サイトの応答にかかった時間（`profile_ms` / `back3_ms` = Worker が測った値、`edge_ms` / `origin_ms` = 公式サイトの `Server-Timing`）が入る（公式サイトが応答を遅らせているかの判別用、RUNBOOK §11.2）。KV は使わない |
| `GET /hotpepper` | 姉妹アプリ（旅食Navi）用のホットペッパー API 中継。KV は使わない |
| `GET /push/key` | 締切前通知の送信元の公開鍵（アプリがブラウザの購読を作るのに使う）。無ければ作る |
| `POST /push/subscribe` | 通知の宛先・お気に入り選手・何分前かを預かる。本文は `text/plain` の JSON（ブラウザの事前確認を起こさない）。同じ内容なら KV に書かない |
| `POST /push/unsubscribe` | 宛先の登録を消す |
| `POST /push/test` | 登録済みの宛先にテスト通知を 1 通送る（`delay` 秒後、最大 20 秒。アプリを閉じて確かめる用）。push service の応答を `status` で返す |
| `GET /push/status` | 鍵の有無・宛先の数・索引のレース数・毎分の cron が最後に動いた時刻・今日送った数（宛先そのものは出さない） |
| `GET /push/selftest` | 実行環境の暗号が RFC 8291 の例と同じ本文を作るか（デプロイ後の確認用） |

### 展示と気象（previews）

- **boats の形**: 上流 (openapi) の previews は `boats` を配列（位置 0 = 1 号艇）で配る。この Worker とアプリは
  `boats[艇番]` で読み書きするので、取得の入口（`fetchPreviewsBase` → `normalizePreviewsDoc`）で艇番をキーにした形に
  そろえる。2026-11-27 までは配列のまま `boats[艇番]` に書いていて、取得した 1 号艇の値が位置 1（艇番の欄は 2）に入り、
  6 号艇の分は 7 番目の要素になっていた。その形の KV は `racer_propeller`（Worker が足した要素だけが持つ項目）で見分けて
  読み替える。
- **気象**: 上流の気象の欄（`race_wind` など）は遅れて届く（2026-11-27 は 10:55 JST まで全場が空で、11:10〜11:25 の間に
  開催中の 9 場の全 12R 分が入った。上流の値は、上流が取りに行った時点のその場の最新の計測値で、展示前のレースにも
  同じ値が入る）。上流を待たずに入れるため、展示の補完で取っている公式の直前情報ページの「水面気象情報」からも読む
  （`parseBeforeinfoWeather`。追加の取得は無い）。上流の行に気象が入っていても、Worker が読めた気象で置き換える。
  Worker が入れるのは、展示が出ていて、欄の見出しからそのレースの締切前の計測値だと分かる時だけ:
  - 「◯R時点」= そのレースより前のレースの時点の値 → 使う
  - 「HH:MM現在」= その時刻の値 → 締切の 3 時間前〜10 分後のものだけ使う（締切時刻が分からなければ使わない）。
    1R のページは、後から開くとその時点の「現在」の値を出す（過去日なら、その日の最後の計測値）
  - 見出しが空白（展示前）・読めない → 使わない
- **風向の番号** (`race_wind_direction_number`) は方位ではない。公式ページの `is-windN` をそのまま入れる:
  スタンドを下・1 マークを右に描いたコース図の上の矢印で、風の吹いていく向き。1 = 上向き（スタンド側 → バック側）から
  時計回りに 22.5° 刻み、17 = 無風。艇はホームストレッチを左 → 右に走るので、5（右向き）が追い風、13（左向き）が向かい風。
- 一度入れた展示・気象は、同じ日の間は次の回に引き継ぐ（`carryRicherExhibitions`。上流の行に展示・気象が入るのは
  遅れるため）。上流の行に展示が入ったら（展示の艇数が同じになったら）上流の行を使う。その時も、Worker が公式ページから
  足した項目のうち上流の行に無いもの（`racer_propeller` / `racer_parts_replaced` / `racer_adjust_weight`）は艇ごとに残す。
  調整重量は、上流では `racer_weight_adjustment` という名前。アプリはどちらの名前でも読み、両方ある時は Worker が
  展示の時に読んだ値を使う（上流が展示の前に取った値とは、まれに 0.5kg ほど違う）。
- `refreshAll()` の結果の `exhibition_scrape.weather` は、その回に気象も入れられたレース数。展示は入るのに 0 が続く時は、
  公式ページの気象の欄の形が変わった可能性がある（`scripts/tests/test_preview_weather.mjs` のフィクスチャを取り直す）。

CORS は Origin 許可リスト方式（`https://inotaka1979.github.io` と localhost:8000/8080）。
追加したい場合だけ、環境変数 `ALLOWED_ORIGINS`（カンマ区切り）を設定する。

## デプロイ

`cloudflare-worker/**` を変更して main に push すると `.github/workflows/deploy-worker.yml` が動く。

| job | 内容 |
|---|---|
| `deploy` | 本体をデプロイし `/health` が 200 であることを確認。続けて `/racer-proxy` を確認する（`scripts/verify_racer_proxy.sh`: 経路があること = 必須、公式から取れるか・応答時間・応答した拠点・edge の保存 = 記録のみ）。締切前通知は `scripts/verify_push.sh` で確認する（暗号が RFC の例と一致・鍵がある・決まった push service 以外の宛先を断る・登録の無い宛先に送らない = すべて必須） |
| `verify-push-cron` | 毎分の cron（締切前通知の確認）が動いている記録を確認（最大 4 分待つ。確認できなければ warning） |
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
