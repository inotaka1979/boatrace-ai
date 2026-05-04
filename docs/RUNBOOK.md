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

## 8. PAT を再設定したい場合（NG）

**禁止**。PAT は P0 で撤去済み。クライアント (PWA) から GitHub API を直接叩く設計は二度と復活させない。
GitHub Actions の dispatch が必要なら、ローカル CLI / GitHub CLI 経由で行う:

```bash
gh workflow run scrape-odds.yml
```
