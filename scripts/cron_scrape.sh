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
if [[ "$MODE" != "odds" && "$MODE" != "previews" && "$MODE" != "all" && "$MODE" != "tide" && "$MODE" != "racedata" && "$MODE" != "photos" ]]; then
    echo "Usage: $0 {odds|previews|all|tide|racedata|photos}" >&2
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
    git add data/odds/ data/previews/ data/racedata/ data/schedule/ data/photos/ 2>>"$LOG_FILE" || true

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

# --- D-13 修正版: 短時間ロック → git 操作の前後でだけ取得して即解放 ---
# 旧実装は scrape 本体実行中も lock を握っていたため、racedata (14分超) が
# odds/previews を完全ブロック。これが「更新が遅くなった」真因。
GLOBAL_LOCK_FILE="${LOCK_DIR}/cron_scrape_global.lock"

# git_pull を short lock 内（数秒）で実行
git_pull_locked() {
    (
        flock -w "$GLOBAL_LOCK_WAIT_SEC" 201 || { log "SKIP: git pull lock busy >${GLOBAL_LOCK_WAIT_SEC}s"; exit 1; }
        log "git fetch + rebase..."
        git fetch origin main >> "$LOG_FILE" 2>&1 || { log "WARN: git fetch failed"; exit 1; }
        if ! git rebase origin/main >> "$LOG_FILE" 2>&1; then
            log "WARN: rebase conflict — aborting"
            git rebase --abort 2>/dev/null
            exit 1
        fi
    ) 201>"$GLOBAL_LOCK_FILE"
}

# git_push_if_changed を short lock 内で実行
git_push_locked() {
    local label="$1"
    (
        flock -w "$GLOBAL_LOCK_WAIT_SEC" 201 || { log "SKIP: git push lock busy >${GLOBAL_LOCK_WAIT_SEC}s"; exit 1; }
        git_push_if_changed "$label"
    ) 201>"$GLOBAL_LOCK_FILE"
}

# --- メイン処理 ---
overall=0

if ! git_pull_locked; then
    overall=1
fi

case "$MODE" in
    odds)
        run_scrape "scrape_odds_fast.py" "odds" || overall=$?
        git_push_locked "odds" || overall=$?
        ;;
    previews)
        run_scrape "scrape_previews.py" "previews" || overall=$?
        git_push_locked "previews" || overall=$?
        ;;
    all)
        run_scrape "scrape_previews.py" "previews" || overall=$?
        run_scrape "scrape_odds_fast.py" "odds" || overall=$?
        git_push_locked "odds+previews" || overall=$?
        ;;
    tide)
        run_scrape "scrape_tide.py" "tide" || overall=$?
        git_push_locked "tide" || overall=$?
        ;;
    racedata)
        run_scrape "scrape_racedata.py" "racedata" || overall=$?
        # PE-11: racedata 取得後に top page を pre-render（LCP 即時化）
        if cd "$REPO_DIR" && python3 scripts/prerender_top.py >> "$LOG_FILE" 2>&1; then
            log "prerender_top: ok"
        else
            log "WARN: prerender_top failed"
        fi
        git_push_locked "racedata+prerender" || overall=$?
        ;;
    photos)
        # 全選手の写真リフレッシュ（月初想定、~10-15 分）。
        # download_photo の attempts=2 + timeout 20s に依存し、欠損のみ拾う。
        run_scrape "refresh_all_photos.py" "photos" || overall=$?
        git_push_locked "photos" || overall=$?
        ;;
esac

log "=== END ${MODE} ($(date '+%H:%M:%S'), exit=${overall}) ==="
exit "$overall"
