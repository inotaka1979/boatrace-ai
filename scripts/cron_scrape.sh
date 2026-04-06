#!/usr/bin/env bash
# =============================================================================
# cron_scrape.sh — RPi5ローカルスクレイピング + git push
#
# 用途: cronから2-3分間隔で呼び出し、odds/previews をスクレイプして
#       変更があればgit push → GitHub Pages自動デプロイ
#
# 使い方:
#   # odds スクレイプ
#   ./scripts/cron_scrape.sh odds
#
#   # previews スクレイプ
#   ./scripts/cron_scrape.sh previews
#
#   # 両方
#   ./scripts/cron_scrape.sh all
# =============================================================================

set -euo pipefail

# --- 設定 ---
REPO_DIR="/home/pi/boatrace-ai"
LOCK_DIR="/tmp/boatrace-scrape-locks"
LOG_DIR="/home/pi/boatrace-ai/logs"
PYTHON="/usr/bin/python3"
MAX_LOG_DAYS=7
PUSH_RETRY=3

# タイムスタンプ用 (JST)
export TZ="Asia/Tokyo"

# --- 引数チェック ---
MODE="${1:-all}"
if [[ "$MODE" != "odds" && "$MODE" != "previews" && "$MODE" != "all" ]]; then
    echo "Usage: $0 {odds|previews|all}" >&2
    exit 1
fi

# --- ディレクトリ準備 ---
mkdir -p "$LOCK_DIR" "$LOG_DIR"

# --- ログファイル (日付ローテーション) ---
LOG_FILE="${LOG_DIR}/scrape_$(date +%Y%m%d).log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# --- 古いログ削除 ---
find "$LOG_DIR" -name "scrape_*.log" -mtime +"$MAX_LOG_DAYS" -delete 2>/dev/null || true

# --- flock: モード別排他制御 ---
LOCK_FILE="${LOCK_DIR}/cron_scrape_${MODE}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    log "SKIP: 前回の ${MODE} がまだ実行中"
    exit 0
fi

log "=== START ${MODE} ==="

cd "$REPO_DIR"

# --- git pull (競合防止) ---
git_pull() {
    log "git pull --rebase..."
    if ! git pull --rebase origin main >> "$LOG_FILE" 2>&1; then
        log "WARN: git pull failed, attempting reset"
        git rebase --abort 2>/dev/null || true
        git reset --hard origin/main >> "$LOG_FILE" 2>&1
    fi
}

# --- スクレイプ実行 ---
run_scrape() {
    local script="$1"
    local label="$2"

    log "Running ${label}..."
    if $PYTHON "scripts/${script}" >> "$LOG_FILE" 2>&1; then
        log "${label} completed"
        return 0
    else
        log "ERROR: ${label} failed (exit code: $?)"
        return 1
    fi
}

# --- 変更検出 + commit + push ---
git_push_if_changed() {
    local label="$1"

    # data/ 以下の変更のみ対象
    git add data/

    if git diff --staged --quiet; then
        log "No changes in data/ — skip push"
        return 0
    fi

    local msg="${label}: $(date '+%Y-%m-%dT%H:%M:%S%z') [rpi]"
    git commit -m "$msg" >> "$LOG_FILE" 2>&1
    log "Committed: $msg"

    # push (リトライ付き)
    local attempt=0
    while [ $attempt -lt $PUSH_RETRY ]; do
        attempt=$((attempt + 1))
        if git push origin main >> "$LOG_FILE" 2>&1; then
            log "Push successful (attempt ${attempt})"
            return 0
        fi

        log "WARN: push failed (attempt ${attempt}/${PUSH_RETRY})"

        # pull --rebase してリトライ
        if ! git pull --rebase origin main >> "$LOG_FILE" 2>&1; then
            git rebase --abort 2>/dev/null || true
            # conflict解決: dataディレクトリはローカル優先
            git checkout --theirs data/ 2>/dev/null || true
            git add data/
            git rebase --continue 2>/dev/null || true
        fi

        sleep 2
    done

    log "ERROR: push failed after ${PUSH_RETRY} attempts"
    return 1
}

# --- ハートビート (監視用) ---
update_heartbeat() {
    echo "$(date '+%Y-%m-%d %H:%M:%S')" > "${LOG_DIR}/heartbeat_${MODE}.txt"
}

# --- メイン処理 ---
git_pull

case "$MODE" in
    odds)
        run_scrape "scrape_odds_fast.py" "odds"
        git_push_if_changed "odds"
        ;;
    previews)
        run_scrape "scrape_previews.py" "previews"
        git_push_if_changed "previews"
        ;;
    all)
        run_scrape "scrape_previews.py" "previews"
        run_scrape "scrape_odds_fast.py" "odds"
        git_push_if_changed "odds+previews"
        ;;
esac

update_heartbeat

log "=== END ${MODE} ($(date '+%H:%M:%S')) ==="
