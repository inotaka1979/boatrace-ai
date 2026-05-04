#!/usr/bin/env bash
# =============================================================================
# cron_scrape.sh — RPi5ローカルスクレイピング + git push (P1: heartbeat / flock / exit-code 修正版)
#
# 用途: cron から 2-3 分間隔で呼び出し、odds/previews をスクレイプして
#       変更があれば git push → GitHub Pages 自動デプロイ
#
# 使い方:
#   ./scripts/cron_scrape.sh odds       # オッズのみ
#   ./scripts/cron_scrape.sh previews   # 直前情報のみ
#   ./scripts/cron_scrape.sh all        # 両方（順次実行）
#
# 修正内容（P1）:
#   M-01 heartbeat を atomic + error-logged に
#   M-03 flock に timeout 300s（長時間ジョブによる cron 重複起動を防止）
#   M-04 $? が log 経由で 0 化していた件を local exit_code= で保存
#   M-05 git rebase 失敗時に reset --hard を撤去（abort して次サイクルでリトライ）
#   M-09 失敗を上位（cron）まで非ゼロ終了で伝播
#   D-07 git add のパスを data/{odds,previews,racedata,schedule} に絞り込み
#   D-13 global lock を導入し odds と previews の git 操作を直列化
# =============================================================================

set -euo pipefail

# --- 設定 ---
REPO_DIR="/home/pi/boatrace-ai"
LOCK_DIR="/tmp/boatrace-scrape-locks"
LOG_DIR="/home/pi/boatrace-ai/logs"
PYTHON="/usr/bin/python3"
MAX_LOG_DAYS=7
PUSH_RETRY=3
LOCK_WAIT_SEC="${LOCK_WAIT_SEC:-300}"   # M-03: 既定 5 分
GLOBAL_LOCK_WAIT_SEC="${GLOBAL_LOCK_WAIT_SEC:-60}"

export TZ="Asia/Tokyo"

# --- 引数チェック ---
MODE="${1:-all}"
if [[ "$MODE" != "odds" && "$MODE" != "previews" && "$MODE" != "all" && "$MODE" != "tide" && "$MODE" != "racedata" ]]; then
    echo "Usage: $0 {odds|previews|all|tide|racedata}" >&2
    exit 1
fi

# --- ディレクトリ準備 ---
mkdir -p "$LOCK_DIR" "$LOG_DIR"

LOG_FILE="${LOG_DIR}/scrape_$(date +%Y%m%d).log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

find "$LOG_DIR" -name "scrape_*.log" -mtime +"$MAX_LOG_DAYS" -delete 2>/dev/null || true

# --- M-03: モード別 flock with timeout ---
LOCK_FILE="${LOCK_DIR}/cron_scrape_${MODE}.lock"
exec 200>"$LOCK_FILE"
if ! flock -w "$LOCK_WAIT_SEC" -n 200; then
    log "SKIP: ${MODE} lock busy >${LOCK_WAIT_SEC}s"
    exit 0
fi

log "=== START ${MODE} ==="

cd "$REPO_DIR"

# --- M-01 (P1): heartbeat を atomic + error logged に ---
update_heartbeat() {
    local mode="$1"
    local hb="${LOG_DIR}/heartbeat_${mode}.txt"
    local tmp
    if ! tmp=$(mktemp "${hb}.XXXXXX" 2>>"$LOG_FILE"); then
        log "ERROR: heartbeat mktemp failed for ${mode}"
        return 1
    fi
    if ! date '+%Y-%m-%d %H:%M:%S' >"$tmp" 2>>"$LOG_FILE"; then
        log "ERROR: heartbeat write failed for ${mode}"
        rm -f "$tmp"
        return 1
    fi
    if ! mv -f "$tmp" "$hb" 2>>"$LOG_FILE"; then
        log "ERROR: heartbeat rename failed for ${mode}"
        rm -f "$tmp"
        return 1
    fi
    log "heartbeat updated: ${mode}"
    return 0
}

# --- git pull (P1 M-05: reset --hard を撤去) ---
git_pull() {
    log "git fetch + rebase..."
    if ! git fetch origin main >> "$LOG_FILE" 2>&1; then
        log "WARN: git fetch failed; will retry next cycle"
        return 1
    fi
    if ! git rebase origin/main >> "$LOG_FILE" 2>&1; then
        log "WARN: rebase conflict — aborting, retry next cycle"
        git rebase --abort 2>/dev/null || true
        return 1
    fi
    return 0
}

# --- スクレイプ実行 (P1 M-04: exit code を確実に保持) ---
run_scrape() {
    local script="$1"
    local label="$2"

    log "Running ${label}..."
    local code=0
    "$PYTHON" "scripts/${script}" >> "$LOG_FILE" 2>&1 || code=$?
    if [ "$code" -ne 0 ]; then
        log "ERROR: ${label} failed (exit=${code})"
        return "$code"
    fi
    log "${label} completed"
    update_heartbeat "$label" || true   # heartbeat 失敗は警告のみ、本処理は成功扱い
    return 0
}

# --- 変更検出 + commit + push ---
git_push_if_changed() {
    local label="$1"

    # D-07: pathspec を data の対象サブディレクトリに限定
    git add data/odds/ data/previews/ data/racedata/ data/schedule/ 2>>"$LOG_FILE" || true

    if git diff --staged --quiet; then
        log "No changes — skip push"
        return 0
    fi

    local msg="${label}: $(date '+%Y-%m-%dT%H:%M:%S%z') [rpi]"
    if ! git commit -m "$msg" >> "$LOG_FILE" 2>&1; then
        log "ERROR: git commit failed"
        return 1
    fi
    log "Committed: $msg"

    local attempt=0
    while [ "$attempt" -lt "$PUSH_RETRY" ]; do
        attempt=$((attempt + 1))
        if git push origin main >> "$LOG_FILE" 2>&1; then
            log "Push successful (attempt ${attempt})"
            return 0
        fi
        log "WARN: push failed (attempt ${attempt}/${PUSH_RETRY})"

        # M-05: rebase 失敗時は abort のみ。reset --hard / checkout --theirs は撤去
        if ! git pull --rebase origin main >> "$LOG_FILE" 2>&1; then
            log "WARN: pull --rebase failed during retry; aborting"
            git rebase --abort 2>/dev/null || true
            return 1
        fi
        sleep 2
    done

    log "ERROR: push failed after ${PUSH_RETRY} attempts"
    return 1
}

# --- D-13: グローバル git lock 取得（odds と previews が並行 git する事を防止） ---
acquire_global_git_lock() {
    GLOBAL_LOCK_FILE="${LOCK_DIR}/cron_scrape_global.lock"
    exec 201>"$GLOBAL_LOCK_FILE"
    if ! flock -w "$GLOBAL_LOCK_WAIT_SEC" 201; then
        log "SKIP: global git lock busy >${GLOBAL_LOCK_WAIT_SEC}s"
        return 1
    fi
    return 0
}

# --- メイン処理 ---
overall=0

if ! acquire_global_git_lock; then
    exit 0
fi

if ! git_pull; then
    overall=1
fi

case "$MODE" in
    odds)
        run_scrape "scrape_odds_fast.py" "odds" || overall=$?
        git_push_if_changed "odds" || overall=$?
        ;;
    previews)
        run_scrape "scrape_previews.py" "previews" || overall=$?
        git_push_if_changed "previews" || overall=$?
        ;;
    all)
        run_scrape "scrape_previews.py" "previews" || overall=$?
        run_scrape "scrape_odds_fast.py" "odds" || overall=$?
        git_push_if_changed "odds+previews" || overall=$?
        ;;
    tide)
        run_scrape "scrape_tide.py" "tide" || overall=$?
        git_push_if_changed "tide" || overall=$?
        ;;
    racedata)
        run_scrape "scrape_racedata.py" "racedata" || overall=$?
        git_push_if_changed "racedata" || overall=$?
        ;;
esac

log "=== END ${MODE} ($(date '+%H:%M:%S'), exit=${overall}) ==="
exit "$overall"
