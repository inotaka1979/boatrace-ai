#!/usr/bin/env bash
# =============================================================================
# cron_monitor.sh — スクレイパー監視スクリプト (P1: stat フェイル/24h ガード修正版)
#
# 修正内容（P1）:
#   M-02 stat 失敗時の age=0 化を排除（明示的にエラーアラート）
#   M-06 営業時間外でも 24h 無更新は alert
#   M-07 Linux 互換に統一（stat -c%s）
# =============================================================================

set -euo pipefail

export TZ="Asia/Tokyo"
LOG_DIR="${LOG_DIR:-/home/pi/boatrace-ai/logs}"   # テスト時に env で上書き可能
ALERT_FILE="${LOG_DIR}/alerts.log"
STALE_SECONDS="${STALE_SECONDS:-900}"     # 15 分（odds 実行が長いケースに対応）
HARD_STALE_SECONDS="${HARD_STALE_SECONDS:-86400}" # M-06: 24h 閾値（時間外でも警告）

mkdir -p "$LOG_DIR"

now=$(date +%s)
hour=$(date +%H)

alert() {
    # 後方互換のため alert() は維持。新規呼出は alert_critical/alert_warn を推奨。
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $*" >> "$ALERT_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $*" >&2
}
# P1-Q10: alert level 分化 — Slack 通知は CRITICAL のみ ping、WARN は朝レビューに回す運用
alert_critical() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] CRITICAL: $*" >> "$ALERT_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] CRITICAL: $*" >&2
}
alert_warn() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: $*" >> "$ALERT_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN: $*" >&2
}

check_mode() {
    local mode="$1"
    local hb_file="${LOG_DIR}/heartbeat_${mode}.txt"

    if [ ! -f "$hb_file" ]; then
        # ファイル不在は重大度高
        alert "${mode} heartbeat missing — scraper has never written or was deleted"
        return
    fi

    # M-02: stat 失敗を握り潰さない
    local hb_time
    if ! hb_time=$(stat -c%Y "$hb_file" 2>/dev/null); then
        alert "${mode} heartbeat unreadable (stat failed) — fs error?"
        return
    fi
    if ! [[ "$hb_time" =~ ^[0-9]+$ ]]; then
        alert "${mode} heartbeat mtime invalid: '${hb_time}'"
        return
    fi

    local age=$((now - hb_time))
    local last
    last=$(cat "$hb_file" 2>/dev/null || echo "unreadable")

    # M-06: 24h ハード閾値は時間外でも常時評価
    if [ "$age" -gt "$HARD_STALE_SECONDS" ]; then
        # P1-Q10: 24h停止は本物の障害 → CRITICAL で Slack ping 対象
        alert_critical "${mode} no heartbeat for ${age}s (>24h, last=${last})"
        return
    fi

    # 営業時間内のみ通常 stale チェック
    if [ "$hour" -ge 9 ] && [ "$hour" -lt 21 ]; then
        if [ "$age" -gt "$STALE_SECONDS" ]; then
            alert "${mode} stale: ${age}s ago (last=${last})"
        fi
    fi
}

for mode in odds previews; do
    check_mode "$mode"
done

# ログローテーション (Linux 互換: stat -c%s)
find "$LOG_DIR" -name "alerts.log.*" -mtime +30 -delete 2>/dev/null || true

if [ -f "$ALERT_FILE" ]; then
    size=$(stat -c%s "$ALERT_FILE" 2>/dev/null || echo 0)
    if [ "$size" -gt 1048576 ]; then
        mv "$ALERT_FILE" "${ALERT_FILE}.$(date +%Y%m%d%H%M%S)"
    fi
fi
