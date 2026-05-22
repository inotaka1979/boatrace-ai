#!/usr/bin/env python3
"""PI-2: assets/app.js を critical / rest に分割

戦略:
  - 起動 ~ top page render に必要な関数 (24 個) を critical に
  - 残り 102 関数 + 関連 state を rest に
  - critical は即時 <script defer>、rest は window.load 後 lazy 化

出力:
  assets/app-critical.js (~50KB before minify)
  assets/app-rest.js     (~150KB before minify)
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_JS = ROOT / "assets" / "app.js"
OUT_CRITICAL = ROOT / "assets" / "app-critical.js"
OUT_REST = ROOT / "assets" / "app-rest.js"

src = APP_JS.read_text()

# 関数定義 (col 0) を brace 深度ベースで抽出（regex は 1 行関数を誤認するため）
def parse_top_level_functions(text: str) -> dict[str, tuple[int, int]]:
    """Return {name: (start_offset, end_offset)} for top-level function declarations."""
    out: dict[str, tuple[int, int]] = {}
    func_re = re.compile(r'^(?:async\s+)?function\s+(\w+)\s*\(', re.MULTILINE)
    for m in func_re.finditer(text):
        name = m.group(1)
        # find body: scan from m.end() — find first `{`, then match braces
        i = text.find('{', m.end())
        if i < 0:
            continue
        depth = 0
        in_str: str | None = None      # current string delimiter
        in_line_comment = False
        in_block_comment = False
        in_template = False
        prev = ''
        end = -1
        j = i
        while j < len(text):
            ch = text[j]
            nxt = text[j + 1] if j + 1 < len(text) else ''
            if in_line_comment:
                if ch == '\n':
                    in_line_comment = False
            elif in_block_comment:
                if ch == '*' and nxt == '/':
                    in_block_comment = False
                    j += 1
            elif in_str:
                if ch == '\\':
                    j += 1   # skip escape
                elif ch == in_str:
                    in_str = None
            elif in_template:
                if ch == '\\':
                    j += 1
                elif ch == '`':
                    in_template = False
            else:
                if ch == '/' and nxt == '/':
                    in_line_comment = True
                    j += 1
                elif ch == '/' and nxt == '*':
                    in_block_comment = True
                    j += 1
                elif ch == "'" or ch == '"':
                    in_str = ch
                elif ch == '`':
                    in_template = True
                elif ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        end = j + 1
                        break
            j += 1
        if end > 0:
            out[name] = (m.start(), end)
    return out


func_ranges = parse_top_level_functions(src)
funcs: dict[str, str] = {name: src[s:e] for name, (s, e) in func_ranges.items()}


def get_calls(body: str) -> set[str]:
    return set(re.findall(r'(\w+)\s*\(', body)) & set(funcs.keys())


# 「rest 領域」のアンカー: ここに到達したら critical の DFS を止める
REST_ANCHORS = {
    'loadDeferredData', 'learnFromResults', 'learnFromResultsViaWorker',
    '_backfillTodayPredictions', 'savePrediction', 'updateHistoryWithResults',
    'predictRace', 'predictWithScenarios', 'predictScenarios',
    'predictEntryCourses', 'scoreBoatV2', 'l2Predict', 'l2Update',
    '_normalizeFeatures', '_updateFeatureStats', '_applyPlattCalibration',
    '_refitPlattCoeffs', '_extractPlattPairs', 'predictRaceAsync',
    '_syncWorkerState', '_computeClassAttenuation', '_resolveCourse',
    'getL2Features', 'getRacerCourseStyle', 'getRacerCourseWinRate',
    'getRacerForm', 'getStadiumCourseWinRate', 'pairwiseScore',
    'selfStyleScore', 'seriesAdjustmentScore', 'stDivergenceScore',
    'stormBonus', 'tideScore', 'classifyTidePhase', 'exhibitionZScore',
    'isHeadWind', 'isTailWind', 'linearSlope', 'motorScoreNormalized',
    'motorTrendWarning', 'getEntryDist', 'buildTrifectaProbDist',
    'buildExactaProbDist', '_plackettLuceTrifectaProb',
    '_plackettLuceExactaProb', 'generateBetsV2', 'selectBetsByEV',
    'calcOddsDivergence', 'comparePredictions', 'predictWithProgramsOnly',
    'learnMotorStatsFromPrograms', 'learnExhibitionStatsFromPreviews',
    'learnRacerStFromPreviews', 'learnEntryPatternFromResults',
    'learnSeriesAndPairwiseFromResults', 'updateDBFromResults',
    'getRacerSeriesAdjustment', 'buildInitialDB',
    'openRace', 'refreshThisRace', 'startOddsAutoRefresh',
    'stopOddsAutoRefresh', 'partsHtml', 'familyName', 'motorEvalGrade',
    'starsHtml', 'renderStats', 'renderStatsChart', 'calcTodayStats',
    'runBacktest', 'runBacktestEngine', 'runForwardChainBacktest',
    '_computeCalibrationMetrics', 'runForwardChainNow', '_btParseDate',
    '_rateColor', 'loadSettings', 'saveSetting', 'clearCache',
    'clearHistory', 'rebuildDB', 'resetWeights', 'showErrorLog',
    'copyErrorLog', 'clearErrorLog', '_loadErrorLog',
    'exportHistoryCSV', 'refitPlattCoefficients', '_loadChartLib',
    'checkHit', '_stackedPredict', 'calcEV', '_runLazyBackfillOnce',
    '_scheduleLazyBackfill', 'getOddsForRace', 'calcPopularity',
    'boatBadge', 'predictRaceProgram',
}


def deps_of(start: str, visited: set[str] | None = None, depth: int = 30) -> set[str]:
    if visited is None:
        visited = set()
    if start in visited or depth <= 0:
        return visited
    if start in REST_ANCHORS:
        return visited
    if start not in funcs:
        return visited
    visited.add(start)
    for c in get_calls(funcs[start]):
        if c not in visited and c not in REST_ANCHORS:
            deps_of(c, visited, depth - 1)
    return visited


CRITICAL_SEEDS = [
    'loadAllData', 'renderStadiums', 'getAccuracy',
    'showPage', 'openStadium', 'forceRefresh', 'hardReload',
    '_runIdleTask', '_yieldToMain', '_setupServiceWorker',
    '_setupStadiumDelegation',
    '_renderFreshness', '_noteUpdatedAt', 'setManagedInterval',
    'showUpdateToast',
    'jstYmd', 'getJSTDate', 'todayStr', 'formatDate',
    'escText', 'sleep', 'cacheKey', 'pf',
    'fetchWithFallback',
    'indexByStadiumRace', 'indexPreviews', 'indexResults',
    '_applyLiveDataMerge',
    'validateApiPayload',   # PA-7: API スキーマ検証
    'cleanOldData', 'saveDB',  # critical setup 直呼び (PI-fix)
    '_filterStalePreviews',  # loadAllData で呼ぶ critical helper
    '_migrateDropStaleTodayHistory', '_cleanStaleHistoryToday',
    'getAccuracy',  # renderStadiums で必須 (critical)
]

critical_funcs: set[str] = set()
for s in CRITICAL_SEEDS:
    if s in funcs:
        deps_of(s, critical_funcs)

rest_funcs = set(funcs.keys()) - critical_funcs

print(f'critical: {len(critical_funcs)} funcs')
print(f'rest:     {len(rest_funcs)} funcs')

# critical body の合計サイズ
crit_body = sum(len(funcs[f]) for f in critical_funcs)
rest_body = sum(len(funcs[f]) for f in rest_funcs)
print(f'critical body: {crit_body:,} chars')
print(f'rest body:     {rest_body:,} chars')

# ----------------------------------------------------------------
# 抽出
# ----------------------------------------------------------------
# 関数を全て探してセットへ振り分けて元ソースから消す
critical_parts: list[str] = []
rest_parts: list[str] = []

# 各関数を順に削除しつつ、所属に応じて critical/rest へ
src_remaining = src
for name, body in funcs.items():
    # 元 src からこの関数本体を削除
    if name in critical_funcs:
        critical_parts.append(body)
    else:
        rest_parts.append(body)
    # body は exact match なので 1 回だけ replace
    src_remaining = src_remaining.replace(body, f'/* MOVED: function {name} */', 1)

# src_remaining = 関数を抜いた残骸 (constants / state / boot inline / bundle markers)
# これは critical に含める（state と constants と boot は critical に必要）
# rest 専用 state があれば後で分離だが、ひとまず全 state を critical に置く

# Clearwing Phase 2c: 一部の BUILD: bundle は rest 専用に振り分け。
#   理由: 例えば backtest 関数群は backtest ページを開いたときにしか呼ばれない。
#         critical に入れると LCP/TBT に悪影響 (~3-4KB の解析時間)。
#   仕組み: src_remaining から該当 BUILD bundle (START〜END) を抜き取り rest_out に prepend。
#         build.mjs が injectBundle するのは canonical app.js への 1 度きりなので、
#         split 後のファイル間で重複しないよう片方からのみ削除する。
REST_ONLY_BUILD_MARKERS = {
    'ANALYSIS_BACKTEST',
    # scoreBoatV2 はレース詳細ページ open 時にしか呼ばれない。critical 入りを避けて
    # LCP/TBT を守る (~12KB minified)。app-rest 側に置く。
    'ANALYSIS_SCORE_BOAT',
    # Platt scaling / featureStats は学習 (results 受信時) と設定画面のみで呼ばれる。
    'ANALYSIS_CALIBRATION',
    # 成績タブ render (renderStats + renderStatsChart) は成績タブ open 時のみ。
    'REPORTING_STATS_PAGE',
    # predict 系はレース詳細を開いた時のみ。critical 起動には不要。
    'ANALYSIS_PREDICT_SCENARIOS',
    'ANALYSIS_PREDICT_RACE',
    'ANALYSIS_PREDICT_PROGRAM',
    # L2 / scoring helpers — レース詳細 / 学習 / 設定でしか呼ばれない
    'ANALYSIS_L2_FEATURES',
    # 学習バッチ (results 受信時のみ) — critical 起動には不要
    'ANALYSIS_LEARNING',
    # レース詳細 (openRace 712 行) — 詳細を開いた時のみ
    'REPORTING_RACE_DETAIL',
}

rest_bundle_extracted: list[str] = []
for marker in REST_ONLY_BUILD_MARKERS:
    start_tag = f'/* BUILD:{marker}:START */'
    end_tag = f'/* BUILD:{marker}:END */'
    s = src_remaining.find(start_tag)
    e = src_remaining.find(end_tag)
    if s < 0 or e < 0:
        continue
    # 終端タグの行末まで含めて削除
    e_end = src_remaining.find('\n', e + len(end_tag))
    if e_end < 0:
        e_end = e + len(end_tag)
    block = src_remaining[s : e_end + 1]
    rest_bundle_extracted.append(block)
    src_remaining = src_remaining[:s] + src_remaining[e_end + 1 :]

# ----------------------------------------------------------------
# 出力
# ----------------------------------------------------------------
critical_out = (
    "// PI-2: app-critical.js (auto-generated by scripts/split_app.py)\n"
    "// 編集禁止 — assets/app.js を編集して `python3 scripts/split_app.py` を実行\n"
    "// 起動 + top page render に必要な関数群\n"
    "// rest bundle は別 <script defer> で並列 load される (index.html 参照)\n"
    "\n"
    + src_remaining
    + "\n\n// === Critical functions ===\n"
    + "\n\n".join(critical_parts)
    + "\n"
)

# rest ソース: 関数本体 + rest 専用 BUILD bundle
rest_out = (
    "// PI-2: app-rest.js (auto-generated by scripts/split_app.py)\n"
    "// 編集禁止 — assets/app.js を編集して `python3 scripts/split_app.py` を実行\n"
    "// 詳細・stats・backtest・predictor・learning などの非クリティカル関数群\n"
    "// window.load 後に lazy load される\n"
    "'use strict';\n"
    "\n"
    + ("\n\n".join(rest_bundle_extracted) + "\n\n" if rest_bundle_extracted else "")
    + "\n\n".join(rest_parts)
    + "\n"
)

OUT_CRITICAL.write_text(critical_out)
OUT_REST.write_text(rest_out)

print()
print(f'wrote {OUT_CRITICAL} ({len(critical_out):,} chars)')
print(f'wrote {OUT_REST}     ({len(rest_out):,} chars)')
