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

**(A) 外部死活監視 — 必須・ユーザー手動（5分）**
- https://healthchecks.io か UptimeRobot（無料）に登録し、以下を **5分間隔**で監視:
  ```
  https://boatrace-scrape-trigger.inotaka1979.workers.dev/health?strict=1&max_age_sec=2400
  ```
- HTTP 200 = 正常。**HTTP 500 = cron ハートビートが 40分以上途絶（cron 死亡の兆候）→ メール通知**。
- rt-fix3: strict は **cron 専用ハートビート(`cron_age_sec`)** で判定する。以前はデータキー
  (とくに `programs` は朝1回しか更新されない) の `wrote_at` で判定していたため、Worker が
  正常でも午後には必ず 500 を返す誤検知があった。`max_age_sec` は夜間 cron 30分間隔 + jitter を
  見込み **2400(40分)** 推奨。
- これが Worker cron の静かな死を「分単位」で検知する唯一確実な手段。アプリ内検知・GHA watchdog は
  間引き/タイミングで遅れるため、外部監視が最後の砦。

**(B) アプリ内自動検知 — 実装済（コード）**
- PWA は 5分毎に `/health`（**非 strict**）を叩き、Worker が到達不能/エラーの時のみ画面上部へ
  「リアルタイム配信が停止中 — 直接取得に切替済み」バナーを表示（機能は fallback で継続）。
- rt-fix3: アプリ内は strict を使わない（cron 死亡の精密判定は外部監視 (A) に委ねる）。実データの
  古さは鮮度バッジ「🕒 N分前」が `updated_at` 基準で正直に表示する（緑<15分/黄<40分/赤≥40分）。

**(C) GHA watchdog — 実装済（backstop）**
- `.github/workflows/worker-watchdog.yml` が `/health?strict=1` を叩き、500 なら
  `/api/refresh-now` を呼んで KV 再生成を促す。schedule 間引きの影響を受けるため backstop 扱い。

### 8.3 Worker が完全停止した時の復旧手順
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
