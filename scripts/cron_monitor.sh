#!/usr/bin/env bash
# =============================================================================
# cron_monitor.sh — スクレイパー監視スクリプト
#
# 10分以上ハートビートが更新されていなければ警告ログを出力
# =============================================================================

set -euo pipefail

export TZ="Asia/Tokyo"
LOG_DIR="/home/pi/boatrace-ai/logs"
ALERT_FILE="${LOG_DIR}/alerts.log"
STALE_SECONDS=600  # 10分

mkdir -p "$LOG_DIR"

now=$(date +%s)
hour=$(date +%H)

# レース時間外 (21:00-09:00) はチェックしない
if [ "$hour" -lt 9 ] || [ "$hour" -ge 21 ]; then
    exit 0
fi

alert() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $*" >> "$ALERT_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $*" >&2
}

for mode in odds previews; do
    hb_file="${LOG_DIR}/heartbeat_${mode}.txt"

    if [ ! -f "$hb_file" ]; then
        alert "${mode} heartbeat file not found — scraper may not have run today"
        continue
    fi

    hb_time=$(date -r "$hb_file" +%s 2>/dev/null || echo 0)
    age=$((now - hb_time))

    if [ "$age" -gt "$STALE_SECONDS" ]; then
        last=$(cat "$hb_file" 2>/dev/null || echo "unknown")
        alert "${mode} scraper stale: last heartbeat ${age}s ago (${last})"
    fi
done

# ログファイルローテーション: 30日以上前のアラートログ削除
find "$LOG_DIR" -name "alerts.log.*" -mtime +30 -delete 2>/dev/null || true

# 今日のアラートログが大きくなりすぎたらローテーション
if [ -f "$ALERT_FILE" ]; then
    size=$(stat -f%z "$ALERT_FILE" 2>/dev/null || stat -c%s "$ALERT_FILE" 2>/dev/null || echo 0)
    if [ "$size" -gt 1048576 ]; then  # 1MB超
        mv "$ALERT_FILE" "${ALERT_FILE}.$(date +%Y%m%d%H%M%S)"
    fi
fi
