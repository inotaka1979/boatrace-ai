# BoatRace Oracle 運用 Runbook

## 1. 緊急時の確認順序

### 1.1 アラート発火時 (alerts.log)

```bash
tail -20 /home/pi/boatrace-ai/logs/alerts.log
```

#### Case A: `heartbeat missing` または `unreadable`
- スクレイパーが一度も走っていない／ファイルシステムエラー
- 確認: `ls -la /home/pi/boatrace-ai/logs/heartbeat_*.txt`
- 修復: `bash scripts/cron_scrape.sh odds` を手動実行

#### Case B: `stale: NNNs ago`
- 9-21 時帯で 15 分以上更新が無い
- 確認:
  ```bash
  ps -ef | grep cron_scrape   # 走り続けてないか
  tail -50 logs/scrape_$(date +%Y%m%d).log
  flock /tmp/boatrace-scrape-locks/cron_scrape_odds.lock -c true && echo "lock free" || echo "lock held"
  ```
- 修復: 残骸プロセスを kill → cron 待機

#### Case C: `CRITICAL: no heartbeat for >24h`
- 営業時間外でも常時鳴る重大アラート
- crontab 自体が外れている／RPi が再起動した可能性
- 確認: `crontab -l` で `cron_scrape.sh` 行があるか

---

## 2. データ整合性の確認

```bash
cd /home/pi/boatrace-ai
python3 -c "import json; d=json.load(open('data/odds/today.json')); print('odds races:', len(d.get('odds',[])), 'updated_at:', d.get('updated_at'))"
python3 -c "import json; d=json.load(open('data/previews/today.json')); print('previews races:', len(d.get('races',[])), 'updated_at:', d.get('updated_at'))"
```

JSON が壊れている疑いがある場合:
```bash
git log --oneline -5 data/odds/today.json
git checkout HEAD~1 -- data/odds/today.json   # 1 つ前のリビジョンに戻す
```
※atomic_write_json 導入後（P2）は中断書込で壊れることはほぼ無い。

---

## 3. テスト

```bash
bash scripts/tests/run_all.sh
```

期待: 全 8 ステップ PASS、合計 39 ユニットテスト緑。

### 3.1 E2E (Playwright) をクラウド開発環境で動かす

Playwright は 1.63.0 に固定している（Chromium build 1243）。Claude Code クラウド環境に入っている
Chromium も build 1243 なので、Chromium 系 project はそのまま起動する。ただし WebKit は入っていないため
webkit-smoke は動かない。`PW_CHROMIUM_PATH` に Chromium の実行ファイルを指定すると、smoke を
Chromium で流す `chromium-smoke` project が追加される:

```bash
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium make test-e2e-local
```

- 期待: chromium-smoke 4/4 PASS（1 並列。並列だと CPU 不足で遷移待ちが timeout する）。
- iOS 固有の挙動は検証できない。正式な判定は CI の webkit-smoke。
- VRT は `--project=chromium-vrt` で実行できるが、Google Fonts が取れず代替フォントで
  描画されるため一致しない（§10、ローカル `--update-snapshots` は禁止）。
- Playwright を上げて Chromium の build が変わると、クラウド環境の build と合わなくなる。
  その場合も `PW_CHROMIUM_PATH` を指定すれば Chromium 系 project はその実行ファイルで起動する。
- `PW_CHROMIUM_PATH` 未設定（CI）では project 構成は従来と同一。

---

## 4. デプロイ

GitHub Pages 配信なので、`git push origin main` するだけで本番反映（数十秒で配信）。

```bash
git push origin main
```

`.git/config` の remote URL が SSH（`git@github.com:...`）になっていることを確認。
HTTPS + PAT 構成は P0 セキュリティ対策で撤去済み。

---

## 5. cron 再インストール

```bash
bash scripts/setup_cron.sh
crontab -l
```

---

## 6. ログローテーション確認

- `logs/scrape_YYYYMMDD.log`: 7 日で自動削除（cron_scrape.sh）
- `logs/alerts.log.YYYYMMDD-HHMMSS`: 30 日で自動削除（cron_monitor.sh）
- ディスク逼迫時: `du -sh logs/` で確認

---

## 7. Service Worker キャッシュリセット (ユーザー側)

ホーム画面アイコンから起動 → 設定 → 「データキャッシュ クリア」ボタン。
内部的には:
1. `caches.delete('br-oracle-vN')`
2. `localStorage` の `bc_*` キーを削除
3. `location.reload()`

新版 SW は activate 時に古い cache を全削除する設計（P4 W-03）。

---

## 8. リアルタイム更新アーキテクチャ（rt-fix3, 2026-06-27）

### 8.1 データ供給の真の経路（重要）
PWA が画面に表示するデータの鮮度は **以下だけ**で決まる。`data/*.json`（GitHub Pages）は
**ホットパスではなく fallback / アーカイブ**である。

| データ | 主系 | 副系 | 最終手段 |
|--------|------|------|----------|
| programs/previews/results | Cloudflare Worker `/api/*`（KV, 5分・展示込み） | openapi github.io（~30分） | localStorage(<10分) |
| オッズ（表示中レース） | Worker `/odds-proxy`（boatrace.jp 直, edge cache 15s, **オンデマンド**） | `data/odds/today.json`（GH Pages） | — |

- オッズは rt-fix3 で **オンデマンド主系化**。一覧を開く / 90秒 poll / 詳細を開くたびに、
  締切ウィンドウ内（-2〜+40分）のレースへ `/odds-proxy` を発火（`_prefetchLiveOddsForUpcoming`）。
  → `data/odds/today.json` が cron 間引きで数時間 stale でも、表示中の EV/買い目は実時間オッズで計算される。
- Worker cron が死んでも、`serveFromKV` が openapi を live fetch し、さらに `/api/previews` 閲覧時に
  **少数の展示スクレイプをオンデマンド実行**（`boundedOnDemandExhibition`, 上限3）するため展示も供給継続。

### 8.2 Worker 死活監視（最重要・恒久対策の要）

**(A) 外形監視 + 予備 cron — sentinel Worker（2026-11-11、主系）**
- `cloudflare-worker/sentinel/` の第 2 Worker **boatrace-sentinel** が Cloudflare cron（5 分毎、
  GitHub schedule のように間引かれない）で本体の `/health?strict=1` を監視する。閾値は JST 08:20〜22:59 が
  1200s、それ以外は 2700s（朝 08:00〜08:19 は最後の heartbeat が 07:30 のものなので夜間扱い）。
- **手動設定（secret）は不要。** デプロイと検証は `deploy-worker.yml` が自動で行う。
- 失敗のたびに本体の `/api/refresh-now` を呼ぶ = 本体 cron が止まっている間の**予備の cron**。
  429（本体の 5 分 throttle）で残り 30 秒以内なら待って 1 回だけ再試行する。
- **連続 3 回（15 分）**で障害として記録する。本体 cron の再登録（再デプロイ）と issue 起票は次のどちらかが行う。
  どちらの場合も、データは sentinel の refresh-now で更新され続ける。
  - secret `GH_TOKEN` 未設定（既定）: (C) の `worker-watchdog.yml` が組込みトークンで行う（schedule 間引きのため最大 1 日程度）。
  - `GH_TOKEN` 設定時: sentinel が `deploy-worker.yml` を dispatch（3 時間に 1 回まで）し、issue
    （label `worker-cron-dead`）を起票、1 時間毎に経過コメント、復旧で自動クローズ（15 分で動く）。
- 状態の確認（誰でも読める。書込はしない）:
  `curl -s https://boatrace-sentinel.inotaka1979.workers.dev/status | python3 -m json.tool`

  | フィールド | 見方 |
  |---|---|
  | `main_binding` | `true` であること（`false` だと本体を呼べず監視が盲目になる） |
  | `main_probe` | 本体 strict health の現在値。`ok:false` + `reason:cron_heartbeat_stale` = 本体 cron 停止中 |
  | `sentinel_cron.age_sec` | sentinel 自身の cron の最終記録からの秒数。記録は 1 時間に 1 回なので 3600 前後までは正常。**10800 超 = sentinel の cron が停止** |
  | `sentinel_cron.build_recorded` | `build` と一致 = 現行版の cron が 1 回以上走った |
  | `state.streak` | 進行中の失敗区間（開始時刻、理由、refresh-now の成否） |
  | `state.history` | 終了した失敗区間（直近 10 件）。開始 / 終了、理由、開始時の heartbeat 経過秒とデータ鮮度、refresh-now の成否、再デプロイの有無 |
  | `state.writes` | sentinel のその日（UTC）の KV 書込回数。平常時 24 以下。失敗が長引いても 120 回 + 必須の保存に抑える |

- sentinel 自身の監視（自動）:
  - `deploy-worker.yml` の `verify-sentinel-cron` job が、デプロイ後に新バージョンの cron 発火を確認する（最大 11 分待つ）。
  - `worker-watchdog.yml` の「Check sentinel liveness」が、`sentinel_cron.age_sec` が 3 時間を超えていたら再デプロイを
    dispatch して issue（label `sentinel-down`）を起票、復旧で自動クローズする。`state.history` もログに出す。
- `sentinel-down` の issue が 1 日以上開いたままの場合: Cloudflare ダッシュボード → Workers & Pages →
  boatrace-sentinel → Settings → Triggers で Cron Trigger（`*/5 * * * *`）が有効か確認する。
  Actions タブから「Deploy Cloudflare Worker」を手動実行すると cron trigger は再登録される。
- 任意設定（`GH_TOKEN` / `TRIGGER_SECRET`）の入れ方と効果は `cloudflare-worker/sentinel/README.md`。
- strict health の意味（sentinel・watchdog・外部監視に共通）:
  - `/health?strict=1&max_age_sec=N` は HTTP 200 = 正常、**HTTP 500 = cron ハートビートが N 秒以上途絶
    （cron 死亡の兆候）**。
  - rt-fix3: strict は **cron 専用ハートビート(`cron_age_sec`)** で判定する。以前はデータキー
    (とくに `programs` は朝1回しか更新されない) の `wrote_at` で判定していたため、Worker が
    正常でも午後には必ず 500 を返す誤検知があった。
  - 分単位の検知は sentinel（Cloudflare cron）が担う。アプリ内検知 (B) と GHA watchdog (C) は
    間引き / タイミングで遅れる。
- healthchecks.io / UptimeRobot などの追加の外部監視は任意。やるなら
  `https://boatrace-scrape-trigger.inotaka1979.workers.dev/health?strict=1&max_age_sec=2400` を 5 分間隔で
  （夜間 cron は 30 分間隔のため、jitter を見込んで 2400 秒）。

**(B) アプリ内自動検知 — 実装済（コード）**
- PWA は 5分毎に `/health`（**非 strict**）を叩き、Worker が到達不能/エラーの時のみ画面上部へ
  「リアルタイム配信が停止中 — 直接取得に切替済み」バナーを表示（機能は fallback で継続）。
- rt-fix3: アプリ内は strict を使わない（cron 死亡の精密判定は外部監視 (A) に委ねる）。実データの
  古さは鮮度バッジ「🕒 N分前」が `updated_at` 基準で正直に表示する（緑<15分/黄<40分/赤≥40分）。

**(C) GHA watchdog — 実装済（backstop）**
- `.github/workflows/worker-watchdog.yml` が `/health?strict=1` を叩き、500 なら `/api/refresh-now` を呼ぶ。
  cron 死亡（reason=`cron_heartbeat_stale` / `_missing`）なら `deploy-worker.yml` を dispatch して cron trigger を
  再登録し、issue（label `worker-cron-dead`）で検知と復旧を記録する。
- schedule 間引きの影響を受ける（2026-11-11 実測で 1-2 回/日）ため遅いが、組込みトークンで動くので手動設定が
  要らない。sentinel (A) に `GH_TOKEN` を入れていない構成では、これが本体 cron の再登録役になる
  （それまでの間のデータ更新は sentinel の refresh-now が担う）。
- 同じ run で sentinel 自身の死活（`sentinel_cron.age_sec`）を確認し、sentinel が記録した失敗履歴をログに出す。

### 8.3 Worker が完全停止した時の復旧手順

**2026-09-06 以降は 2 段の自動復旧が入っている**（実障害: 9/5 22:36 JST に cron が停止し翌朝まで放置）:
- **serve-heal（Worker 内）**: `/api/*` を叩く通常のアプリ通信で `health:heartbeat` が閾値
  （JST 8-22 時は 15 分、夜間は 45 分）より古ければ、`refresh-now` と同じ 5 分 throttle の下で
  `refreshAll()` を裏で回す。cron が死んでいてもデータ鮮度は 5-6 分に保たれる。
  `/health` の `serve_heal.last_at` で発火を確認できる（isolate ローカルの値）。
- **watchdog の自動再デプロイ**: `reason=cron_heartbeat_stale/_missing` かつ Worker が応答する
  （refresh-now 200/429）場合、`deploy-worker.yml` を dispatch して cron trigger を再登録し、
  issue（label `worker-cron-dead`）を開く。復旧すると自動クローズ。直近 3 時間に deploy 済なら
  再デプロイを見送り、issue でダッシュボード確認を促す。

- **base-first 書込（Worker 内、2026-09-06 同日 2 件目）**: `refreshAll` は「upstream 取得 → 最大 40 ページの
  HTML スクレイプ → 最後に KV 書込 → heartbeat」の順だったため、日中の重い run が CPU/実行時間で途中 kill
  されると **KV も heartbeat も残らず**、cron が「発火していない」ように見えていた（9/6 実測: heartbeat は
  夜間の軽い run でしか進まず、日中は keys が `src=ondemand` のまま）。upstream base を先に KV へ書き、
  heartbeat もその直後に打ち、スクレイプ上限を 20→12/run に下げた。heartbeat の意味は
  「cron が発火し base データを配信した」。スクレイプ成否は Cloudflare Logs の `refresh:` 行で追う。

**issue `worker-cron-dead` が数時間開いたままなら、以下を手動で行う:**
1. `/health` を確認: `curl 'https://boatrace-scrape-trigger.inotaka1979.workers.dev/health'`
   - `cron_age_sec` が大きい（> 40分）→ cron 死亡。`/api/refresh-now` を 1 回叩くとデータは更新
     されるが cron は復活しない（ハートビートは cron run のみ更新）。3 で再デプロイして cron 再登録。
   - `cron_heartbeat` が null → 新 Worker 未デプロイ or 一度も cron 未実行。3 を実施。
   - そもそも応答しない → Worker 自体停止。Cloudflare ダッシュボードを確認。
2. **Cloudflare ダッシュボード確認（ユーザー手動・最重要）**:
   - Workers > boatrace-scrape-trigger > Settings > Triggers > **Cron Events** で発火履歴。
   - **Observability で CPU time が 10ms を超えていないか**（超過すると scheduled が途中 kill）。
     超過時は `MAX_HTML_SCRAPES_PER_RUN`（worker.js）を下げる。
3. cron を再登録するには再デプロイ: `cloudflare-worker/**` を変更して push（`deploy-worker.yml` 自動デプロイ）、
   または Actions タブから "Deploy Cloudflare Worker" を手動 dispatch。
4. repo secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` が有効か確認（失効するとデプロイ不可）。

### 8.4 GitHub Actions schedule は信頼しない
- GitHub の schedule cron は本リポジトリで **1 workflow あたり 4-6 回/日**しか発火せず、数時間の空白が出る
  （宣言密度と無相関。config では直せない既知の制約）。`scrape-all` は **アーカイブ + 障害時 fallback** と割り切る。
- 即時にデータを更新したい時は **`workflow_dispatch`（間引かれない）**:
  ```bash
  gh workflow run scrape-all.yml -f force_all=true
  ```

---

## 9. PAT を再設定したい場合（NG）

**禁止**。PAT は P0 で撤去済み。クライアント (PWA) から GitHub API を直接叩く設計は二度と復活させない。
GitHub Actions の dispatch が必要なら、ローカル CLI / GitHub CLI 経由で行う:

```bash
gh workflow run scrape-odds.yml
```

## 10. VRT (Playwright スナップショット) が赤いとき

E2E ワークフローの `vrt` ジョブが fail したときの判断手順。

### 10.1 まず「stale baseline か本物の退行か」を切り分ける

VRT は「前回 commit した PNG」と現在のレンダリングを比較するだけなので、
**意図的な UI 変更でも必ず赤くなる**。差分画像を見て判断する:

1. 失敗した run の artifact `playwright-vrt-report` をダウンロード
2. `*-diff.png` を開き、差分が「今回入れた変更そのもの」かを確認
   - 差分＝意図した変更 → **10.2 で baseline を再生成**
   - 差分＝身に覚えのない崩れ → 本物の退行。コードを直す

サイズ違い（`Expected an image 390px by 140px, received 390px by 190px` のような
メッセージ）は要素が増減したサインで、レンダリング揺らぎではない。

### 10.2 baseline の再生成

ローカルで `--update-snapshots` して commit してはいけない。
開発機と GitHub Actions の ubuntu-latest ではフォントとレンダリングが違い、
ローカル生成の PNG は CI で必ず落ちる。**必ず CI 上で再生成する**。

#### (a) 見た目を変える PR を出すとき — 申告すれば自動（2026-11-25〜）

1. 変わるのが正しい VRT テストのタイトルを `tests/e2e/vrt-baseline-request` に書いて PR に含める
   （1 行に 1 つ。Playwright の `--grep` に渡す正規表現。前回の分は消して書き換える）
2. その PR の `vrt` ジョブは、申告されたテストだけ比較せず撮り直し、**それ以外は通常どおり比較する**
   （撮り直した PNG は artifact `vrt-regenerated-snapshots` で確認できる）
3. マージすると、main への push で `update-snapshots` ジョブが申告分の baseline を撮り直し、
   `vrt: regenerate snapshots (…)` として自動 commit + push する。手動操作は無い

判定は `scripts/vrt_request.sh`（申告ファイルが「その PR / push で変更されたとき」だけ有効）。
申告ファイルを触らない PR は、従来どおり全テストを比較する。

#### (b) 申告を忘れて main が赤くなったとき — 手動

1. GitHub → Actions → 「E2E (Playwright)」
2. 「Run workflow」→ ブランチに `main` を選んで実行（`update-snapshots` ジョブが全スナップショットを撮り直す）
3. ジョブが `tests/e2e/screens.vrt.spec.mjs-snapshots/` を再生成し、
   `vrt: regenerate snapshots (…)` として自動 commit + push する

### 10.3 経緯

- 2026-05-10 (`88460479`) 以降、意図した UI 変更（`#racesViewToggle` の追加、i18n による nav ラベル変更）が
  baseline に反映されず、main を含む全 run で同じ 2 件が 3 か月赤いままだった。
  **恒常的に赤い＝本物の退行が混ざっても気付けない**。2026-08-11 (`bb5ee1c7`) に (b) の手順で解消。
- 2026-11-25: 下メニューに「選手」を追加（6 → 7 ボタン）。同じことを繰り返さないよう (a) の申告方式を追加し、
  この変更自体を最初の申告にした（テスト `nav: bottom navigation`）。

## 11. boatrace.jp からデータが取れない（issue `source-blocked`）

scrape-all の「Source health alert」が、各 scraper の記録（`data/_status.json` の
`tasks.<名前>` = 取りに行った件数 / 取れた件数 / HTTP 403 の件数）から判定して issue を開く。
取得が戻れば次の run で自動クローズする。

1. issue 本文の run を開き、どのタスクが 403 か確認する。
   - 成功 0 件のまま 403 が 5 回続くと、その run の残りのリクエストは送らない
     （`http_utils.SourceBlockDetector`）。アクセスを重ねて状況を悪化させないため。
2. 切り分け: 別ネットワークから同じ UA（`http_utils.USER_AGENT`）で curl / urllib を試す。
   - 2026-11-18 の事例: boatrace.jp が **aiohttp のリクエストだけ** を 403 で拒否するようになり、
     同じ UA の urllib / curl は 200 だった。odds / previews を共通の urllib クライアント
     (`http_utils.fetch_once`) に揃えて解消した（2026-11-20）。
3. どのクライアントでも 403 なら、取得元が当サービスのアクセスを止めている。
   **ブラウザ UA の偽装やプロキシ経由など、拒否を回避する細工はしない。**
   UA の連絡先（リポジトリ URL）を正直に保ったまま、頻度を下げて様子を見るか、
   提供元に問い合わせる。その間アプリはオッズ未取得・展示なしの表示になる（結果と出走表は別経路）。

### 11.1 選手の出場予定・過去 3 節（Worker `/racer-proxy`）が出ない

選手詳細の「今後の出場予定」「過去 3 節」は、Worker が公式の選手ページ（1 人 2 ページ）を取って返す
（2026-11-25）。取れないときは選手詳細に「取得できませんでした」と出るだけで、ほかの表示には影響しない
（プロフィール・成績・コース別はファン手帳と出走表から出す）。

- まとめて確認: `bash scripts/verify_racer_proxy.sh https://boatrace-scrape-trigger.<account>.workers.dev`
  （デプロイのたびに deploy-worker.yml の「Verify /racer-proxy」が同じものを実行し、結果をログに残す。
  経路がデプロイされていなければ失敗、公式から取れない・edge の保存が効かない は記録だけ）
- 個別に確認: `curl -i "https://boatrace-scrape-trigger.<account>.workers.dev/racer-proxy?toban=4320"`
  - `200` + `x-cache: MISS / HIT` … 正常。`found: false` は公式に選手ページが無い登録番号（引退など）。
  - `502 {"error":"upstream"}` … 公式が 5xx / 通信失敗。置かずに返すので、次の人が取り直す。
  - `503 {"error":"blocked"}` … 公式が 403 / 429 を返したので、その isolate は 10 分取りに行かない
    （拒否されている間に叩き続けない）。edge に置いてある選手はその間も返る。
  - `429 {"error":"busy"}` … edge に無い選手の取得が 1 分 30 人を超えた（総なめの抑止）。
- アプリ側も、続けて 3 回失敗すると 10 分は取りに行かない。成功した結果は 30 分（ブラウザのキャッシュは
  最大 3 時間）使い回す。
- 待ち時間: edge に無い選手の初回取得は公式サイトの応答待ちで長くなる（本番で 10.9 秒を実測、2 回目以降は
  0.1 秒）。Worker が公式を待つのは 20 秒（超えたら 502）、アプリが Worker を待つのは 25 秒。アプリが待ち切れずに
  切っても Worker は取得と edge への保存を最後までやるので、次に開いた時は即座に出る。
  デプロイのログ（Verify /racer-proxy）に毎回の秒数が出る。15 秒を超えると warning。
- 403 が続くときの考え方は上の 3 と同じ（**回避の細工はしない**）。機能を止めたいときは
  `cloudflare-worker/worker.js` の `/racer-proxy` を 503 固定にすれば、アプリはカードに
  「取得できませんでした」を出すだけになる。
