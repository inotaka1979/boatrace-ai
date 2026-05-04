#!/usr/bin/env bash
# 全テスト実行スクリプト
# 用途: ローカルおよび CI で利用
#
#   bash scripts/tests/run_all.sh

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

step() {
  local label="$1" cmd="$2"
  echo "============================================================"
  echo "▶ $label"
  echo "------------------------------------------------------------"
  if eval "$cmd"; then
    echo "✅ $label PASS"
    PASS=$((PASS+1))
  else
    echo "❌ $label FAIL"
    FAIL=$((FAIL+1))
  fi
  echo ""
}

# 1) Python ユニットテスト
step "Python unit tests (io_utils / time_utils)" \
     "python3 -m unittest scripts.tests.test_io_time -v"

# 2) Python シンタックスチェック（main は実行しない）
step "Python parse check" \
     "for f in scripts/scrape_odds_fast.py scripts/scrape_previews.py scripts/scrape_racedata.py scripts/scrape_schedule.py scripts/serve_data.py scripts/io_utils.py scripts/time_utils.py; do python3 -c 'import ast; ast.parse(open(\"'\"\$f\"'\").read())' || exit 1; done"

# 3) Bash テスト
step "Shell tests (cron_scrape / cron_monitor)" \
     "bash scripts/tests/test_cron_scrape.bats"

# 4) Bash 構文チェック
step "Shell parse check" \
     "bash -n scripts/cron_scrape.sh && bash -n scripts/cron_monitor.sh && bash -n scripts/setup_cron.sh"

# 5) JS シンタックス
step "index.html JS syntax" \
     "node scripts/tests/_check_html_js.js"

# 6) sw.js 構文
step "sw.js syntax" \
     "node -e 'new Function(require(\"fs\").readFileSync(\"sw.js\",\"utf8\"))'"

# 7) manifest.json 構文
step "manifest.json validity" \
     "python3 -c 'import json; json.load(open(\"manifest.json\"))'"

# 8) JS ヘルパテスト
step "JS helper tests (softmax / safeDiv / safeParse / safeSet / jstYmd)" \
     "node scripts/tests/test_predictor_helpers.js"

# 9) X1 EV/Kelly/乖離テスト
step "X1 EV/Kelly/divergence tests" \
     "node scripts/tests/test_ev_kelly.js"

# 10) X2 正規化テスト
step "X2 normalization tests" \
     "node scripts/tests/test_normalization.js"

echo "============================================================"
echo "Result: ${PASS} passed, ${FAIL} failed"
echo "============================================================"
exit $FAIL
