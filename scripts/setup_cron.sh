#!/usr/bin/env bash
# =============================================================================
# setup_cron.sh — cron設定の自動インストール
#
# 実行: bash scripts/setup_cron.sh
# 確認: crontab -l
# 削除: crontab -r
# =============================================================================

set -euo pipefail

REPO_DIR="/home/pi/boatrace-ai"
SCRIPT="${REPO_DIR}/scripts/cron_scrape.sh"
MONITOR="${REPO_DIR}/scripts/cron_monitor.sh"

# 実行権限付与
chmod +x "$SCRIPT" "$MONITOR"

# crontab内容を生成
CRON_CONTENT=$(cat <<'CRONTAB'
# =============================================================================
# BoatRace Oracle - ローカルスクレイピング cron設定
# レース開催時間: JST 9:00-21:00
# =============================================================================

# 環境変数
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
HOME=/home/pi

# --- オッズ: 3分間隔 (JST 10:00-21:00) ---
# ※オッズは開催中に頻繁に変動するため高頻度
*/3 10-20 * * * /home/pi/boatrace-ai/scripts/cron_scrape.sh odds >> /dev/null 2>&1

# --- 展示情報+結果: 3分間隔 (JST 9:00-21:00) ---
# ※展示データは各レース30分前に公開、結果はレース終了後
*/3 9-20 * * * /home/pi/boatrace-ai/scripts/cron_scrape.sh previews >> /dev/null 2>&1

# --- 監視: 5分間隔 (JST 9:00-21:00) ---
*/5 9-20 * * * /home/pi/boatrace-ai/scripts/cron_monitor.sh >> /dev/null 2>&1

# --- 日次: レースデータ+スケジュール (JST 8:30, 12:00) ---
# ※racedata はGitHub Actionsのままでも可（頻度が低いため）
# 30 8 * * * /home/pi/boatrace-ai/scripts/cron_scrape_racedata.sh >> /dev/null 2>&1
# 0 12 * * * /home/pi/boatrace-ai/scripts/cron_scrape_racedata.sh >> /dev/null 2>&1

CRONTAB
)

echo "=== 設定する crontab 内容 ==="
echo "$CRON_CONTENT"
echo ""
echo "=== 現在の crontab ==="
crontab -l 2>/dev/null || echo "(空)"
echo ""

read -p "crontab を上書きインストールしますか? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "$CRON_CONTENT" | crontab -
    echo "crontab インストール完了!"
    echo ""
    crontab -l
else
    echo "キャンセルしました"
    echo ""
    echo "手動でインストールする場合:"
    echo "  echo '\$CRON_CONTENT' | crontab -"
    echo "  または: crontab -e で貼り付け"
fi
