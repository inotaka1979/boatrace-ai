#!/usr/bin/env bash
# =============================================================================
# setup_power_schedule.sh — RPi5 電源スケジュール導入支援 (PE-1)
#
# 用途: JST 22:30 自動シャットダウンを cron に追加
#
# 注意:
#   * RPi5 は suspend (S3) を非サポートのため、shutdown (S5) のみ対応
#   * RTC バッテリー未搭載 (battery_voltage=0) の場合、自動 wake は不可
#   * 自動再起動には外部機構が必要 (smart plug / RTC battery + rtcwake / 手動)
#
# 使い方:
#   bash scripts/setup_power_schedule.sh install   # cron に追加
#   bash scripts/setup_power_schedule.sh remove    # cron から削除
#   bash scripts/setup_power_schedule.sh status    # 現状確認
#
# 既定値:
#   SHUTDOWN_HOUR=22  SHUTDOWN_MIN=30   (JST、最終レース ~21:00 + 1.5h バッファ)
# =============================================================================

set -euo pipefail
export TZ="Asia/Tokyo"

ACTION="${1:-status}"
SHUTDOWN_HOUR="${SHUTDOWN_HOUR:-22}"
SHUTDOWN_MIN="${SHUTDOWN_MIN:-30}"
TAG="# PE-1 BOATRACE_AUTO_SHUTDOWN"
CRON_LINE="${SHUTDOWN_MIN} ${SHUTDOWN_HOUR} * * * /usr/sbin/shutdown -h +1 'BoatRace AI: scheduled nightly shutdown' ${TAG}"

case "$ACTION" in
  install)
    if crontab -l 2>/dev/null | grep -qF "$TAG"; then
      echo "Already installed:"
      crontab -l | grep -F "$TAG"
      exit 0
    fi
    ( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab -
    echo "Installed: shutdown at JST ${SHUTDOWN_HOUR}:${SHUTDOWN_MIN} (with 1 min broadcast warning)"
    echo ""
    echo "WAKE-UP には別途以下のいずれかが必要:"
    echo "  A. スマートプラグ (TP-Link Kasa, SwitchBot 等) で 8:30 通電"
    echo "  B. RTC バッテリーを RPi5 J5 ヘッダに装着 + rtcwake -m off -t TIME"
    echo "     (現状 battery_voltage=0 で未搭載)"
    echo "  C. 物理電源ボタンを朝に手動押下"
    echo ""
    echo "解除: bash scripts/setup_power_schedule.sh remove"
    ;;
  remove)
    crontab -l 2>/dev/null | grep -vF "$TAG" | crontab -
    echo "Removed scheduled shutdown."
    ;;
  status)
    if crontab -l 2>/dev/null | grep -qF "$TAG"; then
      echo "STATUS: ENABLED"
      crontab -l | grep -F "$TAG"
    else
      echo "STATUS: DISABLED (24/7 mode)"
    fi
    echo ""
    echo "RTC battery_voltage: $(cat /sys/class/rtc/rtc0/battery_voltage 2>/dev/null || echo '?')"
    echo "RTC charging_voltage: $(cat /sys/class/rtc/rtc0/charging_voltage 2>/dev/null || echo '?')"
    echo "Suspend support: $(cat /sys/power/state 2>/dev/null || echo 'NONE')"
    ;;
  *)
    echo "Usage: $0 {install|remove|status}"
    exit 1
    ;;
esac
