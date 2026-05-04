# RPi5 電源管理ガイド (PE-1)

## 結論

| 運用モード | 推奨度 | 月額電気代 | 自動起動 |
|------------|--------|-----------|----------|
| **24/7 常時稼働 + 健康監視** | ⭐ 推奨 | ~65 円 | 不要 |
| 22:30 シャットダウン + スマートプラグで朝通電 | ⭐ 推奨 (省エネ重視) | ~30 円 | スマートプラグ |
| 22:30 シャットダウン + RTC battery + rtcwake | △ 上級 | ~30 円 | RTC battery 必要 |
| 22:30 シャットダウン + 手動朝起動 | × 非推奨 | ~30 円 | 手動 |

## 現状の RPi5 ハードウェア状態（このシステム）

```
Suspend (S3): NONE        ← /sys/power/state が空 = サスペンド非サポート
RTC battery_voltage: 0    ← RTC バッテリー未搭載
EEPROM POWER_OFF_ON_HALT: 1  ← shutdown は完全 power-off
```

→ **ソフトウェアのみで自動起動は不可能**。外部要因（スマートプラグ / 手動 / RTC バッテリー追加）が必須。

---

## モード 1: 24/7 常時稼働 + 健康監視（推奨デフォルト）

### 利点
- スマホからいつでも最新オッズ・直前情報にアクセス可能
- 設定変更なし、複雑性ゼロ
- レース時間外の DB 構築・潮汐取得もそのまま動く

### コスト
- RPi5 アイドル消費 ~3W × 24h × 30 日 = 約 2.2 kWh/月
- 27 円/kWh で **約 60 円/月**

### 健康監視の有効化
```bash
# crontab に health_check.sh を追加（15 分間隔）
( crontab -l ; echo '*/15 * * * * /home/pi/boatrace-ai/scripts/health_check.sh >> /home/pi/boatrace-ai/logs/health.log 2>&1' ) | crontab -
```

これで以下が自動チェック・自己回復される:
- cron デーモンが死んでいたら restart
- ディスク使用率 85% で警告、95% で重大警告
- logs/ サイズ膨張警告
- 営業時間内に git push が 30 分止まったら警告
- heartbeat ファイル整合性

---

## モード 2: 22:30 シャットダウン + スマートプラグ（省エネ推奨）

### 必要なもの
- スマートプラグ（TP-Link Kasa HS105 / SwitchBot プラグミニ 等、~2000 円）
- スマホアプリで「8:30 ON」「23:00 OFF（保険）」のスケジュール設定

### セットアップ
```bash
# 22:30 自動シャットダウンを cron に追加
bash /home/pi/boatrace-ai/scripts/setup_power_schedule.sh install

# 確認
bash /home/pi/boatrace-ai/scripts/setup_power_schedule.sh status

# 解除
bash /home/pi/boatrace-ai/scripts/setup_power_schedule.sh remove
```

### 動作
1. JST 22:30 に shutdown -h +1（1 分後に halt）→ EEPROM POWER_OFF_ON_HALT=1 で完全電源切
2. スマートプラグが 8:30 に通電 → RPi 自動起動
3. cron @reboot は使っていないが、systemd で cron デーモンが起動 → 9:00 から scraper 開始

### 電気代節約
- ~3W × 11h × 30 日 = ~1.0 kWh/月 = **約 27 円/月**（年間 ~400 円節約）

---

## モード 3: RTC バッテリー + rtcwake（上級者向け）

### 必要なもの
- RPi5 公式 RTC バッテリー（J5 ヘッダに装着、Raspberry Pi 公式アクセサリ）

### 設定例
```bash
# config.txt に追加（充電有効化）
echo "dtparam=rtc_bbat_vchg=3000000" | sudo tee -a /boot/firmware/config.txt
sudo reboot

# 充電確認（再起動後、battery_voltage が 1.6-3.0V を示すはず）
cat /sys/class/rtc/rtc0/battery_voltage

# シャットダウン + 翌 8:30 に自動起動 (テスト)
WAKE_AT=$(date -d 'tomorrow 08:30' +%s)
sudo rtcwake -m off -t $WAKE_AT
```

### cron エントリ例
```cron
30 22 * * * WAKE=$(date -d 'tomorrow 08:30' +\%s); sudo /usr/sbin/rtcwake -m off -t $WAKE
```

> **注意**: RTC バッテリー未充電や設定ミスで起動しないリスクあり。実機で 1 週間検証してから本運用へ。

---

## モード 4: 手動朝起動（非推奨）

毎朝 RPi の物理電源ボタンを押す必要があり、データの鮮度が遅れがち。
旅行・出張時にデータが古くなる。

---

## トラブルシューティング

### Q. シャットダウン直前に予想がしたくなった
A. SSH でログインして `sudo shutdown -c` でキャンセル可能。

### Q. cron が時々 push に失敗する
A. `health_check.sh` で 30 分連続失敗を検知してアラート。手動 `cd ~/boatrace-ai && git pull --rebase && git push` で復旧。

### Q. スマートプラグが朝通電したのに RPi が起動しない
A. EEPROM `BOOT_ORDER` の確認: `sudo rpi-eeprom-config | grep BOOT_ORDER`。
   `0xf461` なら SD → USB → NETWORK → RESTART で OK（現状の設定）。
