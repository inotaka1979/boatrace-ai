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
  この経路は、KV にある展示・確定結果を引き継いでから返す（2026-11-27。それまでは上流の素のデータを返して
  KV にも書いていたので、取ってあった展示が消えた。§14）。

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
  - `200` で `back3_ok: false` … 選手ページ（出場予定）は取れたが、過去 3 節のページが取れなかった。アプリは
    出場予定を出し、過去 3 節の欄に「取得できませんでした」と出す。応答の `timing.back3_status` が、過去 3 節の
    ページの HTTP 状態（`403` / `429` = 断られた、`5xx` = 一時的な失敗、`0` = 直前に断られたので取りに行かなかった）。
    この結果は edge に 10 分までしか置かない（全部取れた結果は 3 時間）。断られた時は、その isolate は過去 3 節の
    ページだけ 10 分取りに行かず、その間に開いた選手は選手ページだけ取って返す（断られているページを選手ごとに
    叩き直さない）。10 分たってから開けば、2 ページとも取り直す。
- アプリ側も、続けて 3 回失敗すると 10 分は取りに行かない。成功した結果は 30 分（ブラウザのキャッシュは
  最大 3 時間）使い回す。過去 3 節が欠けた結果は、選手詳細を開いている間 3 分ごとに取り直す（Worker が置いている
  10 分の間はブラウザのキャッシュから返るので、通信にならない）。お気に入り一覧は出場予定だけを使うので取り直さない。
- 待ち時間: edge に無い選手の初回取得は、公式サイトが応答を遅らせている間は約 10 秒かかる（§11.2。本番で
  10.9 / 10.7 / 9.4 秒を実測）。edge にある選手は 0.1 秒。Worker が公式を待つのは 20 秒（超えたら 502）、
  アプリが Worker を待つのは 25 秒。Worker は取得と edge への保存を応答の前に `waitUntil` へ載せるので、
  アプリが先に切っても最後までやる。
- デプロイのログ（Verify /racer-proxy）の読み方:
  - `N 回目: HTTP 200 (10.7 秒) / x-cache: MISS / 拠点: NRT / …` … 拠点は応答した Cloudflare の拠点
    （`cf-ray` の末尾）。edge の保存は拠点ごとなので、拠点が変わると MISS になるのは正常。
  - `公式サイトの応答（Worker が測った値）: profile 9.8 秒 / back3 9.6 秒（公式サイト自身の計測: 配信側 9.3 秒 /
    サーバ本体 0.1 秒）` … 応答の `timing`。配信側が長くサーバ本体が短ければ、§11.2 の遅延。
  - 保存の判定は最大 3 回呼んで行う: `✅ edge の保存が効いている` / `同じ拠点 (…) で 3 回とも…返らなかった`
    （warning。保存が効いていない可能性が高い）/ `呼び出しごとに Cloudflare の拠点が違った`（判定できない）。
  - 初回が 15 秒を超えると warning。
  - `選手ページは取れたが、過去 3 節のページが取れなかった (HTTP 403)` … warning。上の `back3_ok: false` の状態。
    デプロイは失敗にしない。毎回のデプロイで出るようなら、公式サイトがその経路からの過去 3 節のページを断っている。
- 403 が続くときの考え方は上の 3 と同じ（**回避の細工はしない**）。機能を止めたいときは
  `cloudflare-worker/worker.js` の `/racer-proxy` を 503 固定にすれば、アプリはカードに
  「取得できませんでした」を出すだけになる。

### 11.2 取れてはいるが遅い（1 件 8〜10 秒）

boatrace.jp は、自動取得への応答を **1 件あたり 8〜10 秒遅らせる**ことがある（2026-11-26 に確認）。
拒否ではなく、正しい内容が HTTP 200 で返る。403 を数えるブロック検知（§11）には掛からない。

- 見分け方: 応答ヘッダ `Server-Timing` が `edge; dur=8000〜10200`（配信側 = CDN で待たされた時間）、
  `origin; dur=10〜60`（サーバ本体の処理時間）。配信は Akamai で、Akamai の公開文書にある bot 向けの
  応答動作 slow（8〜10 秒待ってから応答）と値が一致する。公式サイト側の設定は見えないので、条件は分からない。
- 確認できている範囲:
  - **時間帯に関係なく終日**（2026-11-26 の GitHub Actions の記録、`data/_status.json` の `avg_ms`）:
    08:13 オッズ 9.3 秒 / 14:20 結果 9.3 秒・オッズ 9.1 秒 / 18:01 結果 9.2 秒・オッズ 9.4 秒・翌日の出走 9.3 秒 /
    22:22 結果 9.5 秒・翌日の出走 9.5 秒 / 夜間の backfill 9.3 秒。最大はどれも 10.6 秒以下。
    開発環境からも 11/26 06:05〜08:11 と 11/27 06:26〜06:35 に同じ値（8.5〜10.8 秒）。
  - GitHub Actions・Cloudflare Worker・開発環境の 3 つの経路すべてで起きる。
    夜間の backfill（内部期限 150 秒）は 11/20 の導入以来、毎晩どの run も 16〜17 件（1 件あたり約 9 秒）だった。
  - 2026-07-05 には、日中の GitHub Actions で結果ページが 8 秒の時間切れで全滅した（`scrape_results.py` の
    `FETCH_TIMEOUT` を 25 秒にして解消）。同じ遅延だった可能性が高い。
  - 速かった記録は 1 回だけ（11/25 22:40 に開発環境から選手ページ、1 枚 0.2 秒ほど）。条件は分かっていない。
  - いまの予算で足りている: オッズは 5 件を並行（導入時からの設定）で 240 秒、結果は 4 件並行で 1200 秒。
    11/26 はどの run も、取りに行った件数 = 取れた件数だった。
- 記録:
  - scraper（odds / previews / results / backfill）は、取れたリクエストの応答時間を `data/_status.json` の
    `tasks.<名前>.avg_ms` / `max_ms` に残す。平均 5 秒以上（3 件以上）なら scrape-all の
    「Source health alert」が `::notice::boatrace.jp <名前>: 応答が遅い（…）` を出す。**issue は開かない**。
    いまは終日遅いので、この notice はどの run にも付く（付かなくなったら遅延が解けたということ）。
  - 履歴の見方: `git log --format='%cI' -p -- data/_status.json | grep -E '^\+.*avg_ms|^Date'`、
    または Actions の run 一覧で notice の付いた run を探す。
  - Worker 側は §11.1 のデプロイのログ（`timing`）。
- 対応: **遅延を避ける細工はしない**（同時に何本も送って待ち時間を重ねる、UA を変える、プロキシを通す、など）。
  1 件ずつ待つ。時間切れは遅延より長く取る（scraper 15〜25 秒、Worker 20 秒、アプリ 25 秒）。
  時間の予算内に取れる件数が数分の一になるので、足りないときは予算（待つ時間）のほうを伸ばす
  （例: 夜間の backfill は内部期限を 150 → 1200 秒にした。1 run 40 レース × 3 ページ × 約 10 秒）。
- 15 秒を超えて時間切れが続く、または 403 に変わったら §11 の扱い。

## 12. 締切前通知（Web Push）が届かない

2026-11-27 に追加。お気に入り選手の出るレースの締切 N 分前に、アプリを閉じていても通知が届く仕組み。
実装は `cloudflare-worker/push.js`（送る側）、`sw.js`（受け取る側）、`src/reporting/fav_push.js`（設定）。

### 12.1 仕組み

1. アプリの設定「閉じている間も通知」→「有効にする」で、端末が通知を許可し、ブラウザが「通知の宛先」を作る。
   アプリはその宛先と、お気に入り選手・何分前かを Worker に預ける（KV `push:subs`）。
2. Worker のデータ更新の cron が、番組表から締切時刻と出場選手だけを抜き出した索引を作る（KV `push:index`）。
3. Worker の毎分の cron が、締切の N 分前になったレースに預かっているお気に入り選手が出ていれば、
   その端末の push service（Apple / Google など）へ通知を送る。端末側は `sw.js` が受け取って表示する。

手動設定は無い（送信元の鍵は Worker が最初に自分で作る）。iPhone は、ホーム画面に追加したアプリ（iOS 16.4 以降）でだけ使える。

### 12.2 確かめる順番

1. **アプリの設定画面**: 「閉じている間も通知」のボタンが「無効にする」（= 有効）になっているか。下の説明文に
   「お気に入り選手（N 人）… M 分前」と出ているか。
   - 「通知の登録が無効になっています」→ 端末側で宛先が無くなった（通知を拒否した・アプリを入れ直した）。もう一度「有効にする」。
   - 「…『通知しない』のため、通知は届きません」→ 上の「お気に入り選手の締切前通知」で分数を選ぶ。
2. **「テスト通知」を押し、アプリを閉じて 10 秒待つ**。
   - 届く → 配達は動いている。レースの通知だけ来ないなら 3 へ。
   - 届かず、アプリに「通知サービスの応答 403」→ 宛先を作った時と Worker の鍵が違う。「無効にする」→「有効にする」。
   - 届かず、「テスト通知を送りました」と出ている → Worker から push service までは届いている。端末の設定（通知の許可・
     集中モード・おやすみモード）を確認する。
   - 「サーバに接続できませんでした」→ Worker に届いていない。§8.2 / §8.3（Worker の死活）。
     Worker には届いているのに出る場合（「有効にする」では「サーバに登録できませんでした」）は、Worker が KV を
     読めていない（応答は 503 `kv_unavailable`。読めない間は、預かっている宛先を消さないために登録・解除・テスト通知を
     受け付けない）。時間をおいて試す。
3. **Worker の状態**: `curl -s https://boatrace-scrape-trigger.inotaka1979.workers.dev/push/status`

   | 項目 | 見方 |
   |---|---|
   | `kv_readable` | `false` なら Worker が KV を読めていない（下の数は当てにならない。読めない間は、預かっている内容を消さないために登録・解除を受け付けない） |
   | `key` | `false` なら鍵がまだ無い（`/push/key` を 1 回呼べば作られる。デプロイ後の確認が呼ぶ） |
   | `subs` | 預かっている宛先の数。有効にした端末の数と合うか |
   | `index_races` | 索引のレース数。0 なら番組表がまだ届いていない（朝は 8 時ごろまで 0 のことがある） |
   | `tick_at` / `tick_age_sec` | 毎分の cron が動いた記録（6 時間に 1 回だけ書く）。6 時間 5 分より古ければ cron が止まっている |
   | `sent_today` | 今日送った数（宛先 × レース） |
   | `subs_writes_today` / `max_subs_writes` | 宛先の文書を今日書いた回数（登録・変更・解除・無くなった宛先の掃除。1 日 60 回まで。区切りは日本時間の 9 時）。上限に達すると、登録や変更は 429 になり、翌 9 時以降にアプリを開いた時に送り直される |
   | `sent_writes_today` / `max_sent_writes` | 送った記録を今日書いた回数（1 日 100 回まで）。上限に達した日は、締切 N 分前ちょうどの回の通知だけを送り、送り損ねの拾い直しはしない |

   上限は、Worker の KV の書込枠（無料枠 1 日 1,000 回。本体のデータ更新と共用）を通知が使い切らないためのもの。
   ふだんの使い方（1〜2 台、お気に入り数十人）では届かない。届いている場合は、`subs` の数に心当たりがあるかを見る
   （登録口は誰でも呼べる。覚えの無い宛先が多ければ §12.4 の「全部消す」）。

   通知は締切 N 分前ちょうどの回に送る。その回に送れなかった場合（cron が 1 回欠けた・push service が一時的に失敗した・
   直前に登録や変更をした）は、2 分後・4 分後 … の回に 1 回だけ送り直すので、「あと N−2 分」などの通知が届くことがある。
   同じレースの通知が 2 通届いた場合は、`sent_writes_today` が上限に達していないか、Worker のログ（`push:` の行の
   `sent_record_failed`）を見る。

4. **デプロイのログ**: Actions →「Deploy Cloudflare Worker」→ `deploy` の「Verify /push (Web Push)」と `verify-push-cron`。
   デプロイのたびに、暗号が標準仕様 (RFC 8291) の例と一致するか・鍵があるか・毎分の cron が動いているかを確かめている。

### 12.3 毎分の cron が止まっている時

- `tick_age_sec` が 6 時間 5 分を超えている、または `tick_at` が無い。
- Cloudflare dashboard → Workers & Pages → boatrace-scrape-trigger → Settings → Triggers に `* * * * *` があるか。
  無ければ再デプロイする（Actions →「Deploy Cloudflare Worker」→ Run workflow）。
- デプロイが「cron の数が上限」で失敗している場合: Cloudflare Free の Cron Triggers はアカウント合計 5 本
  （本体 3 + sentinel 1 = 4 本を使用）。同じアカウントの別の Worker が cron を持っていないか確認する。

### 12.4 預かっているデータと消し方

- 預かるのは、通知の宛先（push service の URL と暗号化用の公開鍵）、お気に入り選手の登録番号と名前、何分前か。
  KV の `push:subs` に入っている（本体と同じ namespace）。メールアドレスなどの個人を特定する情報は持たない。
- 1 台分を消す: その端末のアプリで「無効にする」。端末が手元に無くても、push service が「宛先はもう無い」(404 / 410) と
  返した時点で Worker が自動で消す。
- 全部消す: Cloudflare dashboard → KV → `push:subs` を削除。有効にしていた端末は、アプリを開いた時に 1 日 1 回行う確認で
  自動的に登録し直す（最長 1 日。すぐ戻すには、その端末で「テスト通知」を押す = 記録が無ければ登録し直す）。
- 鍵を作り直す（`push:vapid` を削除）と、それまでの宛先には送れなくなる。各端末のアプリは 1 日 1 回の確認で気付いて
  「通知の登録が無効になっています」と出すので、「有効にする」を押し直す。ふだんは触らない。

## 13. 気象（風・波・気温・水温）が出ない / 風向の読み方

レース詳細の先頭の欄。「風: 向かい風 3m　波: 2cm　気温: 11℃　水温: 18℃」と出る。展示が出る前のレースには
この欄そのものが出ない（展示も気象も無いレースは取り込まない）。展示は出ているのに計測値が無いレースは
「気象: 未取得」と出る。

### 13.1 どこから来るか

気象は公式サイトの直前情報ページ（展示と同じページ）の「水面気象情報」。上流 (openapi) の previews にも入るが、
遅れて届く。2026-11-27 は 10:55 JST まで全 168 レースが空（展示・体重・気象とも）で、11:10〜11:25 の間に、開催の
始まっていた 9 場の全 12R 分が入った（最初の展示から約 3 時間後）。上流の値は「上流が取りに行った時点の、その場の
最新の計測値」で、展示前のレースにも同じ値が入る（アプリは、展示前のレースの気象の欄にその値を出し、予想にも使う）。

| 経路 | いつ | 入り方 |
|---|---|---|
| 上流 (openapi) | 上流の更新が届いた時（遅れる。上の説明）。開催中の場の全レース | `/api/previews` の `race_wind` などの欄 |
| Worker の定期取得 | 締切の窓の中で、展示を取りに行った時（上流より先に入る。上流の値があっても置き換える） | 同上 |
| Worker `/beforeinfo-proxy` | アプリが展示の無いレースを開いた・締切が近い時 | 応答の `race_wind` などの欄 |
| GitHub Actions (`scrape_previews.py`) | 1 日数回 | `data/previews/today.json` の各レースの `weather` |
| 夜間の後追い (`backfill_archive.py`) | 過去日のアーカイブ | `data/previews/YYYYMMDD.json` の `weather`（2R 以降だけ） |

展示（展示タイム・ST・進入・チルト）も同じ 2 つの経路で届く: Worker が締切の窓の中で取り、後から上流の行に入る。
上流の行に展示が入ると Worker の KV は上流の行に置き換わるが、Worker が公式ページから足した項目（プロペラ・部品交換・
調整重量）は艇ごとに残す。調整重量の欄の名前は取得元で違う（Worker / scraper = `racer_adjust_weight`、上流 =
`racer_weight_adjustment`）。アプリはどちらの名前でも読み、両方ある時は前者（展示の時に公式ページから読んだ値）を使う。
上流が展示の後に取った行では同じ値だが、展示の前に取った値（朝の計量）とはまれに違う（2026-11-27 は 323 艇中 3 艇、0.5kg）。

上流以外の経路（Worker と scraper）が入れるのは「展示が出ていて、欄の見出しからそのレースの締切前の計測値だと分かる時」だけ:

- 「水面気象情報　11R時点」→ そのレースより前のレースの時点の値なら使う。
- 「水面気象情報　7:45現在」→ 締切の 3 時間前〜10 分後に計測された値だけ使う（締切時刻が分からなければ使わない）。
  1R のページは、後から開くとその時点の「現在」の値を出す。過去日なら、その日の最後の計測値になる
  （2026-11-19 桐生 1R = 締切 15 時台のページが、後日は「20:34現在」）。このため後追いでは 1R に気象を入れない。
- 見出しの後ろが空白（展示前）・読めない → 使わない。

### 13.2 風向の番号

`race_wind_direction_number` / `weather.wind_direction` は**方位ではない**。公式ページの `is-windN` の番号で、
スタンドを下・1 マークを右に描いたコース図の上の矢印（風の吹いていく向き）を表す。

| 番号 | 矢印 | アプリの表示 | 採点 |
|---|---|---|---|
| 3〜7（5 = 右向き） | → | 追い風 | 風速 3m 以上で 1 コース加点 |
| 11〜15（13 = 左向き） | ← | 向かい風 | 風速 3m 以上で 1 コース減点・外コース加点 |
| 16・1・2（1 = 上向き） | ↑ | 右横風（スタンド側から） | 変えない |
| 8〜10（9 = 下向き） | ↓ | 左横風（バック側から） | 変えない |
| 17 | － | 無風 | 変えない |

艇はホームストレッチを左 → 右に走るので、右向きが追い風になる。確かめ方（2026-11-27）: 公式の矢印の画像
(`/static_extra/pc/images/icon_wind1_N.png`) と、方位の画像 (`is-directionN`、1 = 北が上で時計回り) を合わせて
実測と照合した（2026-11-19 桐生・11-20 宮島は、どちらも冬型の西風）。

2026-11-27 までは、この番号を「1 = 北 … 16 = 北北西」の方位と仮定していた（7 場だけ場別の表、残りは全場共通の表）。
上流の気象が届いたレース（§13.1）では、その読み方で追い風・向かい風を判定していた。全場共通の表は 3〜5（追い風）と
11（向かい風）が正しい番号と重なっていたが、12〜14 を向かい風と見ず、15・16・1・2 を追い風、7〜10 を向かい風としていた。
気象が届く前のレースは風速 0 で、判定そのものが働いていなかった。

### 13.3 確かめる順番

1. **Worker が配っているか**（気象の入ったレース数）:
   ```bash
   curl -s https://boatrace-scrape-trigger.inotaka1979.workers.dev/api/previews | python3 -c "
   import json,sys
   d=json.load(sys.stdin); rows=d['previews']
   ex=[r for r in rows if any((b or {}).get('racer_exhibition_time') for b in (r['boats'].values() if isinstance(r['boats'],dict) else r['boats']))]
   wx=[r for r in rows if (r.get('race_temperature') or 0)>0 or (r.get('race_water_temperature') or 0)>0]
   print('展示あり', len(ex), '/ 気象あり', len(wx), '/ 全', len(rows), '| boats の形:', {type(r['boats']).__name__ for r in rows})"
   ```
   展示ありのレースのほとんどに気象があれば正常（1 日の最初のうち、修正前に展示を取ったレースには入らない）。
   `boats の形` は `{'dict'}` が正常。`list` が混ざるのは、修正前の Worker が書いた KV が残っている間だけ（次の定期取得で消える）。
2. **展示は増えるのに気象が 0 のまま**: 公式ページの気象の欄の形が変わった可能性。
   `curl -s "https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=1&jcd=14&hd=YYYYMMDD" | grep -n "weather1_"` で、
   `weather1_title` / `weather1_bodyUnitLabelTitle` / `weather1_bodyUnitLabelData` / `is-windN` があるかを見る
   （1 件ずつ。応答は 1 件 8〜10 秒かかる）。形が変わっていたら、`scripts/tests/fixtures/beforeinfo_*.html` を取り直して
   Worker (`parseBeforeinfoWeather` / `parseWeatherAsOf`) と `scripts/scrape_previews.py` (`parse_weather` / `weather_as_of`) を直す。
3. **GitHub Actions 側**: `data/_status.json` の `tasks.previews`。`attempted` = 取りに行ったレース、`updated` = ページを
   読めたレース（展示前で中身の無いページを含む）、`exhibition` / `weather` = その回に展示 / 気象が取れたレース。
   2026-11-27 までは、この記録が一度も書かれていなかった（scraper がファイルを書いた直後に毎回例外で終了していた）。
4. **アプリ側**: レース詳細の欄が「気象: 未取得」のまま → 展示は取れているが気象が入っていない。1〜3 を見る。
   入らないのが正常な場合: 計測時刻がそのレースの締切前のものと確かめられなかった時（§13.1。後から開いた 1R のページなど）、
   気象の読み取りを入れた日（2026-11-27）に、それより前に展示を取ったレース。

## 14. 取ってあった展示・結果が Worker から消える（2026-11-27）

**症状**: レース一覧や詳細で、出ていた展示（タイム・ST・進入・部品交換）が、締切を過ぎたレースからまとめて消える。
アプリを開いたままの端末では残って見える（アプリは表示済みの展示を保つ）ので、開き直した時・別の端末で気付く。
鮮度の監視は緑のまま（Worker は応答していて、データの時刻も新しい）。

### 14.1 何が起きたか（2026-11-27 14:50 JST）

Worker の `/api/previews` で、展示のあるレースが 90 → 38 に減った。消えたのは、この Worker が公式ページから取った
57 レース分すべて。残ったのは、上流 (openapi) が自分で展示を持っていた 33 レースと、直後の定期更新が取り直した
締切前の 5 レースだけ。部品交換の記載は 27 艇 → 3 艇。cron は動いていた（`/health` は正常）。

原因は、KV の文書が「古い」と判定された時の経路（`serveFromKV`）:
- `/api/previews` は、KV の文書の `updated_at` が 12 分より古いと上流を取り直す。当時は、取り直した**上流の素のデータ**を
  そのまま返し、KV にも書いていた。上流の previews には、この Worker が取った展示が無い。
- 展示を取り直すのは締切の窓（締切 30 分前〜5 分後）の中のレースだけなので、窓を過ぎたレースの展示は戻らない。
- KV は中身が変わった時しか書かない。cron が 5 分おきに動いていても、展示が 2 回続けて出なければ、文書は 12 分より
  古くなる（昼の開催が終わる頃・夜の開催の合間・夜間）。そこへ取得が 1 回来ると上書きされた。

その時刻の書込そのものは記録に残っていない（`/health` に出るのは、文書ごとの最後の書込だけ）。上の説明は、
残ったレースの組み合わせ（14:50 の時点で締切の窓の中にあった 5 レースだけが取り直されていた）と、同じ手順で同じ
消え方を再現できること（`scripts/tests/test_worker_serve_stale.mjs`、実行環境 workerd でも確認）に基づく。

この経路は 2026-06 からあった。2026-11-20 に「表示されていた展示が消える」の報告を受けて、定期更新（cron）の側は
前回の KV を引き継ぐようにしたが、取得の経路は上流の素のデータを書くままだった。11/27 より前の日にも起きていた
可能性が高い（記録が無いので、頻度は分からない。この日は朝から 14:15 までは 1 度も起きていない: その時点で、
朝からの展示がすべて残っていた）。
results にも同じ形があった（後ろで動く結果の補完が「上流の素の結果 + 取れた数レース」を書いていた）。結果は
締切後 6 時間まで取り直すので、数回の定期更新で戻っていた。

### 14.2 直し方（Worker の決まり）

`cloudflare-worker/README.md` の「KV の文書が古い時と、KV に書く時の決まり」の 4 つ:
前回の KV を引き継いでから返す・書く / KV を読めなかった時は書かない / 取り直して返す経路は previews・results を
そのまま書かない / cron が動いている間は「古い」と判定されない（中身が同じでも 7 分で時刻を書き直す）。

KV の書込は、時刻の書き直しのぶん増える: 中身が変わらない間、previews / results それぞれ 10 分に 1 回
（展示・結果が出続ける時間帯は増えない。1 日あたり数十回の見込みで、実測はしていない。無料枠は 1,000 回/日。
書込数は Cloudflare のダッシュボードの KV の画面で見られ、枠切れは `/health` の `kv_put_failures` に出る）。

### 14.3 確かめる順番

1. **`/health`**（`/api/previews` を直接叩いて確かめない。古いと判定された時の経路を、その取得が踏む）:
   ```bash
   curl -s https://boatrace-scrape-trigger.inotaka1979.workers.dev/health | python3 -m json.tool
   ```
   - `keys.previews` / `keys.results` の `age_sec` は、cron が動いている間（`cron_age_sec` が 900 未満）は
     600 前後までにしかならない（10 分おきに書き直す）。720（12 分）を超えているなら、定期更新がその文書を
     書けていない: `kv_put_failures`（KV の書込枠切れ）と、Cloudflare のログの `refresh:` の行
     （`kv_write_skipped` / `kv_carry_err` / `kv_merge_err` = KV を読めなかった回）を見る。
   - `keys.previews.src` / `keys.results.src` は `cron` か `ondemand`（補完で増えた時）。`serve` は programs だけ。
2. **アプリの取得に `_source: "live"` が付いているか**（ブラウザの開発者ツールで `/api/previews` の応答を見る）。
   付いているのは、古いと判定されて上流を取り直した応答。cron が動いているのに続くなら 1 を見る。
   2026-11-27 以降は、この応答にも KV の展示・確定結果が入っている。
3. **消えた日のデータ**: KV には戻らない（窓を過ぎた展示は取り直さない）。アプリは、開いたレースに展示が無ければ
   そのレースだけ取り直す（`/beforeinfo-proxy`）。日次アーカイブ（`data/previews/`）は GitHub Actions の scraper が
   別に取っているので影響を受けない。

---

## 15. 朝、全場が「次節」と出る / 番組表が届かない（2026-11-28）

**症状**: TOP の場カードが、開催している場も含めてすべて「次節 M/D」になる（レース一覧に入れない）。
2026-11-28 以降のアプリでは、今日開催すると分かる場は「本日開催 / 番組表待ち」と出る。

### 15.1 何が起きたか（2026-11-28 の朝）

8:43 に報告。Worker の `/api/programs` は 8:44 から 9:21 まで（3 分おきに確認）11/27 の番組表を返していた。
上流 (openapi) の previews / results は 8:47〜9:15 の間に、programs は 9:21〜9:24 の間に 11/28 の分へ切り替わり、
9:24 にアプリの表示が戻った（前日は 8:29 の時点で切り替わっていた）。この日は 14 場が開催で、鳴門 1R の締切は 8:35。

当時、朝の番組表は上流だけが頼りだった:
- 自前の番組表（`scripts/scrape_programs.py` → `data/programs/today.json`）は朝の窓（8:30 以降）の run で取るが、
  GitHub の定時実行は数時間遅れる（11/27 の実績: 番組表専用の「Scrape Programs (official)」は、7:00〜10:00 の
  5 回の予定が 12:50〜18:15 に届いた。この日の最初の番組表の commit は 11:39 で、PR のマージで起動した
  scrape-all によるもの）。
- アプリは、日付が今日でない番組表の行を使わない。1 場も残らないと、全場を「開催していない場」として描く。

### 15.2 仕組み（2026-11-28 から）

1. **前の晩に翌日の番組表を取る**: scrape-all の夕方〜夜の run（15〜23 時）が、明日の出走の一覧
   （`data/schedule/tomorrow.json`）に載っているレースの出走表を 1 件ずつ取り、
   `data/schedule/programs_tomorrow.json` に置く（`scripts/scrape_programs_tomorrow.py`）。
   - 第 1 レースの締切が早い場から。1 回の run で約 120 レース（1 件 9〜10 秒かかる日。内部期限 20 分）。
     取り切れなかった分は次の run が続きから取る。0 時を過ぎて届いた run（朝の窓の前まで）も続きを取る。
   - 公式の出走表は、昼の開催が前日の 18 時ごろまでに、夜の開催が 18〜22 時半の間に公開される
     （2026-11-26 の観測）。公開前の場は一覧に無いので取りに行かない。
2. **Worker**: 自前の当日分が無い間は、上流の今日の行 + 前の晩に取った分の今日の行を配る
   （`cloudflare-worker/README.md` の「番組表の出どころと、日付の違う行」）。0 時を過ぎた最初の定期更新から
   今日の番組表になる。上流の previews / results が前日のままでも、展示・結果は Worker が公式ページから取る。
3. **アプリ**: 番組表が届いていない場のうち、今日開催すると分かる場は「本日開催 / 番組表待ち」と出す。
   根拠は、開催日タブ（`data/schedule/day_labels.json`。今日の分、または前日までの分の日程に今日がある）と、
   どの場の番組表も届いていない時に限り、次回開催日（`next_open.json`）が今日であること。

### 15.3 確かめる順番

1. **Worker が配っている番組表の日付と出どころ**:
   ```bash
   curl -s https://boatrace-scrape-trigger.inotaka1979.workers.dev/api/programs | python3 -c "
   import json,sys,collections; d=json.load(sys.stdin); r=d.get('programs') or []
   print(dict(collections.Counter(p.get('race_date') for p in r)), 'base =', d.get('_source_base') or 'openapi', 'updated_at =', d.get('updated_at'))"
   ```
   - 今日の日付で `base = official`: 自前の当日分（通常の昼以降）。`official_eve` / `openapi+eve`: 前の晩に取った分を
     使っている（朝）。`openapi`: 上流の文書そのまま。
   - 前日の日付のまま: 上流が切り替わっておらず、前の晩の分も無い。2 と 3 を見る。
2. **前の晩の分があるか**（`race_date` が今日か・何レースか・`partial`）:
   ```bash
   curl -s https://raw.githubusercontent.com/inotaka1979/boatrace-ai/main/data/schedule/programs_tomorrow.json | python3 -c "
   import json,sys; d=json.load(sys.stdin); print(d.get('race_date'), len(d.get('programs') or []), '/', d.get('expected'), 'partial =', d.get('partial'), d.get('updated_at'))"
   ```
   - 無い・日付が古い: 前の晩（15〜23 時）に scrape-all の run が 1 回も届かなかったか、取得元に止められた。
     `data/_status.json` の `tasks.programs_tomorrow`（attempted / updated / races / missing / http_403）と、
     Actions の「Scrape All」の夕方の run のログを見る。
   - `partial = True`: まだ取れていないレースがある（夜の開催が後から公開された、時間切れ、など）。
     0 時以降の run が続きを取る。足りない場は、上流が切り替わるか自前の当日分が届くまで「番組表待ち」。
3. **すぐ直したい時**: Actions → **「Scrape Programs (official)」** → Run workflow（番組表だけを取る。約 10 分）。
   終わると `data/programs/today.json` が今日の分になり、Worker が次の定期更新（5 分おき）で配る。
   「Scrape All」でも取れるが、ほかの取得も走るので 30 分以上かかる。

### 15.4 限界

- 前の晩の run が 1 回も届かず、0 時〜朝の run も届かなかった日は、従来どおり上流の切り替わり待ちになる
  （その間、今日開催する場は「番組表待ち」と出る）。sentinel に `GH_TOKEN` を登録すると、scrape-all が
  16:00 / 19:00 / 22:00 の定時に起動するので、前の晩の分が確実に取れる（`cloudflare-worker/sentinel/README.md`）。
- 前の晩に取った番組表は、その後に変わった項目を含まない（前日の最終レースでの F、当日朝の欠場・選手変更）。
  上流の今日の行があるレースは上流の行を使い、朝の窓の run が公式ページから取り直した後は、その内容に置き換わる。
- 0 時を過ぎると、Worker は前日のレースの結果の取り直し（締切後 6 時間まで）をやめる（番組表が今日の分に
  替わるため）。アプリも 0 時以降は前日の行を使わないので、表示には影響しない。
