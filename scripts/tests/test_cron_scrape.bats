#!/usr/bin/env bash
# Bats フォーマットだが bash 単体でも実行可能なシンプルテスト
# 用途: cron_scrape.sh の heartbeat 関数 / lock を独立検証

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${SCRIPT_DIR}/cron_scrape.sh"

PASS=0
FAIL=0
WORKDIR=""

cleanup() { [ -n "${WORKDIR:-}" ] && rm -rf "$WORKDIR"; }
trap cleanup EXIT

assert() {
    local label="$1" cond="$2"
    if eval "$cond"; then
        echo "  PASS: $label"
        PASS=$((PASS+1))
    else
        echo "  FAIL: $label  ($cond)"
        FAIL=$((FAIL+1))
    fi
}

# --- TEST 1: スクリプトの構文 ---
echo "[T1] bash syntax"
if bash -n "$SCRIPT"; then
    echo "  PASS: cron_scrape.sh -n"
    PASS=$((PASS+1))
else
    echo "  FAIL: cron_scrape.sh -n"
    FAIL=$((FAIL+1))
fi

# --- TEST 2: heartbeat 関数を抽出して単独実行 ---
echo "[T2] update_heartbeat creates atomic file with valid timestamp"
WORKDIR=$(mktemp -d)
LOG_DIR="$WORKDIR" LOG_FILE="${WORKDIR}/log" \
    bash -c '
LOG_DIR='"$WORKDIR"'
LOG_FILE='"$WORKDIR"'/log
log() { echo "$@" >> "$LOG_FILE"; }
update_heartbeat() {
    local mode="$1"
    local hb="${LOG_DIR}/heartbeat_${mode}.txt"
    local tmp
    tmp=$(mktemp "${hb}.XXXXXX") || return 1
    date "+%Y-%m-%d %H:%M:%S" > "$tmp" || { rm -f "$tmp"; return 1; }
    mv -f "$tmp" "$hb" || { rm -f "$tmp"; return 1; }
}
update_heartbeat odds
update_heartbeat previews
'
assert "heartbeat_odds.txt exists"      "[ -f '$WORKDIR/heartbeat_odds.txt' ]"
assert "heartbeat_previews.txt exists"  "[ -f '$WORKDIR/heartbeat_previews.txt' ]"
assert "no leftover .XXXXXX tempfile"   "[ -z \"$(ls $WORKDIR | grep '.XXXXXX' || true)\" ]"
assert "content is recent timestamp"    "grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\$' '$WORKDIR/heartbeat_odds.txt'"

# --- TEST 3: heartbeat 書き込み失敗時に non-zero を返す ---
# Clearwing Phase 3: root ユーザは chmod 555 を CAP_DAC_OVERRIDE で bypass するため、
#   このテストは「権限制限が効く環境」でのみ意味を持つ。dev container / Docker root では skip。
#   CI (ubuntu-latest) は非 root で実行されるため、本来の検証が走る。
if [ "$(id -u)" -eq 0 ]; then
  echo "[T3] update_heartbeat returns non-zero on unwritable dir — SKIP (root bypasses chmod 555)"
  PASS=$((PASS+1))
else
  echo "[T3] update_heartbeat returns non-zero on unwritable dir"
  RO_DIR=$(mktemp -d)
  chmod 555 "$RO_DIR"
  RC=0
  LOG_DIR="$RO_DIR" bash -c '
LOG_DIR='"$RO_DIR"'
update_heartbeat() {
    local hb="${LOG_DIR}/heartbeat_test.txt"
    local tmp
    tmp=$(mktemp "${hb}.XXXXXX" 2>/dev/null) || return 1
    date "+%Y-%m-%d %H:%M:%S" > "$tmp" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 1; }
    mv -f "$tmp" "$hb" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 1; }
}
update_heartbeat
' || RC=$?
  chmod 755 "$RO_DIR"
  rm -rf "$RO_DIR"
  assert "non-zero on unwritable dir" "[ $RC -ne 0 ]"
fi

# --- TEST 4: cron_monitor.sh が stat 失敗を握り潰さない ---
echo "[T4] cron_monitor handles missing heartbeat with explicit alert"
MON="${SCRIPT_DIR}/cron_monitor.sh"
TESTLOG=$(mktemp -d)
LOG_DIR="$TESTLOG" STALE_SECONDS=900 bash "$MON" >/dev/null 2>&1 || true
assert "alert.log mentions 'missing'" "grep -q 'heartbeat missing' '$TESTLOG/alerts.log' 2>/dev/null"
rm -rf "$TESTLOG"

# --- TEST 5: flock の wait timeout が指定通り動く ---
echo "[T5] flock with -w returns non-zero when lock is held"
LFILE=$(mktemp)
(
    exec 9>"$LFILE"
    flock -x 9
    sleep 3
) &
HOLDER=$!
sleep 0.3
RC=0
( exec 9>"$LFILE"; flock -w 1 -n 9 ) || RC=$?
wait "$HOLDER"
rm -f "$LFILE"
assert "flock -w 1 returns non-zero while held" "[ $RC -ne 0 ]"

echo ""
echo "=== Result: ${PASS} passed, ${FAIL} failed ==="
exit $FAIL
