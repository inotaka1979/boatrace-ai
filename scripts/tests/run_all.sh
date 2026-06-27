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

# 1b) PC-1 / PC-8: http_utils ユニットテスト
step "Python unit tests (http_utils)" \
     "python3 -m unittest scripts.tests.test_http_utils -v"

# 1c) REDESIGN Phase 0a: check_freshness ユニットテスト
step "Python unit tests (check_freshness)" \
     "python3 -m unittest scripts.tests.test_check_freshness -v"

# 1d) 2026-05-17: scrape_all._decide_tasks / _is_fresh_today ユニットテスト
step "Python unit tests (scrape_all decide / freshness gate)" \
     "python3 -m unittest scripts.tests.test_scrape_all_decide -v"

# 1e) 2026-05-17 B14: 穴予想 (ana_bets) 履歴追跡 smoke test
step "JS tests (ana_bets / checkHit / ana_hit)" \
     "node scripts/tests/test_ana_tracking.js"

# 2) Python シンタックスチェック（main は実行しない）
step "Python parse check" \
     "for f in scripts/scrape_odds_fast.py scripts/scrape_previews.py scripts/scrape_racedata.py scripts/scrape_schedule.py scripts/scrape_tide.py scripts/io_utils.py scripts/time_utils.py scripts/http_utils.py scripts/check_freshness.py; do python3 -c 'import ast; ast.parse(open(\"'\"\$f\"'\").read())' || exit 1; done"

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

# 8b) PA-5 / PC-8: localStorage スキーマバリデータテスト
step "Storage validator tests (_validateLS)" \
     "node scripts/tests/test_storage_validator.js"

# 8c) PB-4 / PC-8: Plackett–Luce 3連単/2連単確率モデルテスト
step "Plackett-Luce probability tests" \
     "node scripts/tests/test_plackett_luce.js"

# 8d) PC-2b / PC-8: 抽出済 純粋ヘルパテスト
step "Pure helper tests (_computeClassAttenuation / _resolveCourse)" \
     "node scripts/tests/test_pure_helpers.js"

# P1-Q11: 極端入力下での softmax / sigmoid / safeDiv 安定性
step "Numerical stability tests (P1-Q11)" \
     "node scripts/tests/test_numerical_stability.js"

# P2-8: ファン手帳パーサ（固定長 Shift-JIS）テスト
step "Fan handbook parser tests (P2-8)" \
     "python3 scripts/tests/test_fan_handbook_parse.py"

# 公式番組表パーサ（boatrace.jp racelist → openapi 互換 programs）回帰テスト
step "Official programs parser tests" \
     "python3 -m unittest scripts.tests.test_programs_parse -v"

# Epic 12 (P1-B1): 特徴量パイプラインの新旧同一性
step "Features pipeline regression tests (P1-B1)" \
     "node scripts/tests/test_features_pipeline.js"

# Epic 13 (P1-B2): IndexedDB store API
step "IndexedDB store tests (P1-B2)" \
     "node scripts/tests/test_idb_store.js"

# Epic 15 (P2-4): mini-bandit Thompson sampling
step "Bandit (Thompson sampling) tests (P2-4)" \
     "node scripts/tests/test_bandit.js"

# Epic 16 (P2-5): i18n scaffold
step "i18n scaffold tests (P2-5)" \
     "node scripts/tests/test_i18n.js"

# Epic 17 (P2-6): community weights 計算
step "Community weights tests (P2-6)" \
     "python3 scripts/tests/test_community_weights.py"

# Epic 21 (P2-6 拡張): DP gradient ヘルパ
step "DP gradient tests (P2-6 ext / Epic 21)" \
     "node scripts/tests/test_dp_gradient.js"

# 8e) PC-7b / PE-4: build パイプライン (Step 2 = src/utils/safe_storage を bundle 注入)
#     --check モードで「再ビルドしても index.html が変わらない」ことを検証 (CI 再現性ガード)
#     CI 環境では node_modules が無いため、初回のみ npm ci を実施
step "Build pipeline + reproducibility check" \
     "(cd build && [ -d node_modules ] || npm ci --silent --no-audit --no-fund > /dev/null 2>&1; node build.mjs --check > /dev/null)"

# 9) X1 EV/Kelly/乖離テスト
step "X1 EV/Kelly/divergence tests" \
     "node scripts/tests/test_ev_kelly.js"

# 10) X2 正規化テスト
step "X2 normalization tests" \
     "node scripts/tests/test_normalization.js"

# 11) X3 進入予想テスト
step "X3 entry prediction tests" \
     "node scripts/tests/test_entry_predict.js"

# 12) X4 環境データテスト
step "X4 environment (tide / wind / storm) tests" \
     "node scripts/tests/test_environment.js"

# 13) X5 シナリオ展開テスト
step "X5 scenario / grade tests" \
     "node scripts/tests/test_scenarios.js"

# 14) X6 節間 / 対戦相性テスト
step "X6 series / pairwise tests" \
     "node scripts/tests/test_series_pairwise.js"

# 15) X7 バックテストテスト
step "X7 backtest engine tests" \
     "node scripts/tests/test_backtest.js"

# 16) F13 自己決まり手スコアテスト
step "F13 self-style score tests" \
     "node scripts/tests/test_self_style.js"

# 17) Clearwing Phase 5: snapshot tests
#     discovery / analysis / context / capabilities / math の出力固定
#     更新したいときは UPDATE_SNAPSHOTS=1 node scripts/tests/test_snapshots.js
step "Clearwing snapshot tests" \
     "node scripts/tests/test_snapshots.js"

# 18) Clearwing Phase 6: 退行禁止パターン検出 (deprecated patterns regression guard)
#     AbortSignal.timeout 直接呼出 / 層責務違反 / @ts-ignore 等を検出
step "Clearwing deprecated pattern detector" \
     "node scripts/tests/test_deprecated_patterns.js"

# 19) rt-fix3 (2026-06-27): 鮮度バッジがデータ世代基準で stale を隠さないこと
step "Status banner freshness semantics (rt-fix3)" \
     "node scripts/tests/test_status_banner_freshness.js"

# 20) rt-fix3 (2026-06-27): 出走表タブからの「◯日目」抽出
step "Day label extraction (rt-fix3)" \
     "python3 -m unittest scripts.tests.test_day_label -v"

echo "============================================================"
echo "Result: ${PASS} passed, ${FAIL} failed"
echo "============================================================"
exit $FAIL
