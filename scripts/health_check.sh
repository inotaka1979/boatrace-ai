#!/usr/bin/env bash
# =============================================================================
# health_check.sh — 24/7 運用の自己回復ヘルスチェック (PE-1)
#
# 目的:
#   - cron デーモンが生きているか確認、死んでいたら restart
#   - ディスク残量チェック (data/ ディレクトリ満杯防止)
#   - 直近の git push 状況 (cron_scrape の最終 push が古すぎないか)
#   - logs/ サイズが膨張していないか
#
# 推奨配置: crontab で 15 分間隔
#   */15 * * * * /home/pi/boatrace-ai/scripts/health_check.sh >> /home/pi/boatrace-ai/logs/health.log 2>&1
#
# 自動修復は最小限。深刻な異常は ALERT_FILE に記録するのみで、
# 再起動・破壊操作は行わない（fail-loud 原則）。
# =============================================================================

set -uo pipefail
export TZ="Asia/Tokyo"

LOG_DIR="/home/pi/boatrace-ai/logs"
ALERT_FILE="${LOG_DIR}/alerts.log"
DATA_DIR="/home/pi/boatrace-ai/data"
DISK_WARN_PCT=85    # ディスク使用率 % で警告
DISK_CRIT_PCT=95    # ディスク使用率 % で重大警告

mkdir -p "$LOG_DIR"

now=$(date '+%Y-%m-%d %H:%M:%S')
hour=$(date '+%H')
log() { echo "[$now] HEALTH $*"; }
alert() {
  log "ALERT: $*"
  echo "[$now] ALERT: $*" >> "$ALERT_FILE"
}

issues=0

# 1) cron デーモン
if ! systemctl is-active --quiet cron 2>/dev/null; then
  alert "cron service inactive — attempting restart"
  if sudo -n systemctl restart cron 2>/dev/null; then
    log "cron restarted successfully"
  else
    alert "cron restart FAILED (need manual intervention)"
  fi
  issues=$((issues+1))
fi

# 2) ディスク残量
disk_usage=$(df -P "$DATA_DIR" | awk 'NR==2 {gsub("%",""); print $5}')
if [ -n "$disk_usage" ] && [ "$disk_usage" -ge "$DISK_CRIT_PCT" ]; then
  alert "disk usage CRITICAL: ${disk_usage}% on data partition"
  issues=$((issues+1))
elif [ -n "$disk_usage" ] && [ "$disk_usage" -ge "$DISK_WARN_PCT" ]; then
  alert "disk usage warning: ${disk_usage}%"
fi

# 3) logs/ サイズ膨張チェック (合計 500MB 超で警告)
if [ -d "$LOG_DIR" ]; then
  log_size_mb=$(du -sm "$LOG_DIR" 2>/dev/null | awk '{print $1}')
  if [ -n "$log_size_mb" ] && [ "$log_size_mb" -gt 500 ]; then
    alert "logs/ size exceeds 500MB: ${log_size_mb}MB — consider rotation/cleanup"
  fi
fi

# 4) 営業時間内 (JST 9-21) は最終 git push が 30 分以内であるか確認
if [ "$hour" -ge 9 ] && [ "$hour" -lt 21 ]; then
  last_commit_epoch=$(cd /home/pi/boatrace-ai && git log -1 --format=%ct HEAD 2>/dev/null || echo 0)
  now_epoch=$(date +%s)
  age=$((now_epoch - last_commit_epoch))
  if [ "$age" -gt 1800 ]; then   # 30 分
    alert "no git commit for ${age}s (>30 min) during business hours — scraper or push may be broken"
    issues=$((issues+1))
  fi
fi

# 5) heartbeat ファイル整合性 (cron_monitor.sh と二重チェック)
for mode in odds previews; do
  hb="${LOG_DIR}/heartbeat_${mode}.txt"
  if [ -f "$hb" ]; then
    age=$(($(date +%s) - $(stat -c%Y "$hb" 2>/dev/null || echo 0)))
    if [ "$hour" -ge 9 ] && [ "$hour" -lt 21 ] && [ "$age" -gt 1800 ]; then
      alert "${mode} heartbeat stale: ${age}s during business hours"
      issues=$((issues+1))
    fi
  fi
done

# サマリ
if [ "$issues" -eq 0 ]; then
  log "OK (disk=${disk_usage:-?}%, logs=${log_size_mb:-?}MB)"
else
  log "FINISHED with ${issues} issue(s)"
fi

exit 0
