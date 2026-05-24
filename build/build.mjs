#!/usr/bin/env node
// =============================================================================
// build.mjs — BoatRace Oracle ビルドスクリプト (PC-7b → PE-4 Step 2)
//
// 段階導入計画 (build/README.md §段階導入):
//   Step 1: 構文検証のみ（実装済）
//   Step 2: src/utils/safe_storage.js を IIFE bundle → marker 領域に注入  ← 現状ここ
//   Step 3: src/predictor/* も同様に
//   Step 4: src/ui/* も同様に
//   Step 5: CSP nonce 自動付与 + 'unsafe-inline' 撤去
//
// 動作:
//   - src/utils/safe_storage.js を esbuild で IIFE bundle
//   - index.html の <!-- BUILD:SAFE_STORAGE:START/END --> 間に注入
//   - その後、構文検証 + ハッシュ表示
//   - --check モード: 注入後の差分が無いことを確認（CI で再現性ガード）
//
// 使い方:
//   cd build && npm install && npm run build           # 実ビルド
//   cd build && npm run build -- --check               # CI 再現性チェック
// =============================================================================

import { readFile, writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { build as esbuild } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');
const CHECK_MODE = process.argv.includes('--check');

async function sha256(path) {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function bundleModule(entry) {
  const result = await esbuild({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    legalComments: 'none',
    minify: false,
    minifyWhitespace: false,
    minifyIdentifiers: false,
    minifySyntax: false,
    write: false,
  });
  if (result.outputFiles.length !== 1) {
    throw new Error('esbuild produced ' + result.outputFiles.length + ' outputs');
  }
  return result.outputFiles[0].text;
}

function injectBundle(html, marker, bundle) {
  const startTag = '/* BUILD:' + marker + ':START */';
  const endTag = '/* BUILD:' + marker + ':END */';
  const start = html.indexOf(startTag);
  const end = html.indexOf(endTag);
  if (start < 0 || end < 0) {
    throw new Error('marker not found: ' + marker);
  }
  // START マーカー直後の改行から END マーカーまでを bundle に置換
  const startLineEnd = html.indexOf('\n', start + startTag.length);
  if (startLineEnd < 0) throw new Error('no newline after START marker: ' + marker);
  const before = html.slice(0, startLineEnd + 1);
  const after = html.slice(end);
  // 注意: bundle の "use strict" は IIFE 外なのでそのまま挿入してよい
  return before + bundle + '\n' + after;
}

async function checkJsSyntax(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).join('\n;\n');
  const tmp = await mkdtemp(join(tmpdir(), 'br-build-'));
  const path = join(tmp, 'inline.js');
  await writeFile(path, scripts);
  return new Promise((res) => {
    const proc = spawn('node', ['--check', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => err += d);
    proc.on('exit', async (code) => {
      try { await unlink(path); } catch (_) {}
      res({ ok: code === 0, err });
    });
  });
}

async function checkOther(path) {
  return new Promise((res) => {
    const proc = spawn('node', ['--check', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => err += d);
    proc.on('exit', code => res({ ok: code === 0, err }));
  });
}

async function main() {
  console.log('=== BoatRace Oracle Build (PE-5: assets/app.js target) ===\n');

  const indexPath = resolve(ROOT, 'index.html');
  const appJsPath = resolve(ROOT, 'assets/app.js');
  const swPath = resolve(ROOT, 'sw.js');
  const manifestPath = resolve(ROOT, 'manifest.json');

  // 1) PE-4 + PE-10: 全モジュールを IIFE bundle してマーカー領域に注入
  // main thread bundle 群 (assets/app.js に注入)
  const modules = [
    { marker: 'SAFE_STORAGE', src: 'utils/safe_storage.js' },
    { marker: 'MATH',         src: 'utils/math.js' },
    { marker: 'FEATURES',     src: 'utils/features.js' },   // Epic 12
    { marker: 'IDB',          src: 'utils/idb_store.js' },  // Epic 13
    { marker: 'BANDIT',       src: 'utils/bandit.js' },     // Epic 15
    { marker: 'I18N',         src: 'utils/i18n.js' },       // Epic 16
    { marker: 'DP_GRADIENT',  src: 'utils/dp_gradient.js' },// Epic 21
    { marker: 'CAPABILITIES', src: 'capabilities.js' },     // Clearwing Phase 1
    { marker: 'DISCOVERY_OPENAPI', src: 'discovery/openapi_client.js' }, // Clearwing Phase 2b
    { marker: 'ANALYSIS_BACKTEST', src: 'analysis/backtest.js' },        // Clearwing Phase 2c
    { marker: 'REPORTING_STATUS_BANNER', src: 'reporting/status_banner.js' }, // Clearwing Phase 2d
    { marker: 'CONTEXT_DOMAIN', src: 'context/domain_constants.js' },         // Clearwing Phase 2e
    { marker: 'ANALYSIS_SCORE_BOAT', src: 'analysis/score_boat.js' },         // Phase 2 完遂 (scoreBoatV2)
    { marker: 'ANALYSIS_CALIBRATION', src: 'analysis/calibration.js' },       // Phase 2 完遂続き (Platt + featureStats)
    { marker: 'ANALYSIS_GBDT_RUNTIME', src: 'analysis/gbdt_runtime.js' },     // Tier 3 (2026-05-24) GBDT 評価ランタイム
    { marker: 'REPORTING_STATS_PAGE', src: 'reporting/stats_page.js' },       // Phase 2 完遂続き (renderStats + renderStatsChart)
    { marker: 'ANALYSIS_PREDICT_SCENARIOS', src: 'analysis/predict_scenarios.js' }, // Phase 2 完遂続き (シナリオ + 進入予想)
    { marker: 'ANALYSIS_PREDICT_RACE', src: 'analysis/predict_race.js' },     // Phase 2 完遂続き (predictRace 本体)
    { marker: 'ANALYSIS_PREDICT_PROGRAM', src: 'analysis/predict_program.js' }, // Phase 2 完遂続き (番組予想)
    { marker: 'ANALYSIS_L2_FEATURES', src: 'analysis/l2_features.js' },       // Phase 2 完遂続き (scoreBoatV2 helpers + L2)
    { marker: 'ANALYSIS_LEARNING', src: 'analysis/learning.js' },             // Phase 2 完遂続編 (learnFromResults)
    { marker: 'REPORTING_PAGE_ROUTER', src: 'reporting/page_router.js' },     // Phase 2 完遂続編 (showPage)
    { marker: 'REPORTING_STADIUM_PAGES', src: 'reporting/stadium_pages.js' }, // Phase 2 完遂続編 (renderStadiums + openStadium)
    { marker: 'REPORTING_RACE_DETAIL', src: 'reporting/race_detail.js' },     // Phase 2 完遂続編 (openRace orchestrator)
    { marker: 'REPORTING_RACE_DETAIL_BOATS', src: 'reporting/race_detail_boats.js' },           // Phase 2 完遂続編 (boats card)
    { marker: 'REPORTING_RACE_DETAIL_PREDICTION', src: 'reporting/race_detail_prediction.js' }, // Phase 2 完遂続編 (番組 + 直前予想)
    { marker: 'REPORTING_RACE_DETAIL_BETS', src: 'reporting/race_detail_bets.js' },             // Phase 2 完遂続編 (買い目 + 穴予想)
  ];
  // Worker bundle 群 (assets/worker_predictor.js に注入)
  const workerModules = [
    { marker: 'CAPABILITIES_WORKER', src: 'capabilities-worker.js' }, // Clearwing Phase 2
  ];

  // Phase 2 完遂続編 (Clearwing): Worker twin sync auto-generation。
  //   src/utils/math.js + src/analysis/* を concat + esbuild bundle して worker_predictor.js の
  //   BUILD:WORKER_TWIN_SYNCED マーカー領域に注入する。
  //   従来は手動コピー → twin sync test で divergence 検出だったが、
  //   本機構で物理的に divergence が起きない (auto-gen)。
  //
  //   excludeFunctions: worker context で不要な main thread 専用関数を bundle 後に strip
  //     (predictRaceAsync は _getAppWorker を呼ぶため worker では動かない)
  async function generateWorkerTwinSynced() {
    // 結合順: math (依存なし) → calibration (math 参照) → l2_features (calibration 参照)
    //         → score_boat (l2_features 参照) → predict_scenarios → predict_race
    // 2026-05-24 v2: utils/features.js を末尾に追加。
    //   l2_features.js の inline getL2Features は dead code (本流は
    //   features.js の FEATURE_PIPELINE)。worker context でも同じく
    //   features.js が globalThis.getL2Features を上書きすることで、
    //   12→24 dim 拡張時に worker 側を二重メンテせず済む。
    const sources = [
      'utils/math.js',
      'analysis/calibration.js',
      'analysis/gbdt_runtime.js', // Tier 3 (2026-05-24): GBDT runtime
      'analysis/l2_features.js',
      'analysis/score_boat.js',
      'analysis/predict_scenarios.js',
      'analysis/predict_race.js',
      'utils/features.js', // ← v2: pipeline override (must be last)
    ];
    let concatenated = '';
    for (const rel of sources) {
      const txt = await readFile(resolve(SRC, rel), 'utf8');
      concatenated += '\n// ===== ' + rel + ' =====\n' + txt + '\n';
    }
    // esbuild で bundle (concat 済なので bundle:false でも OK だが、minify を後段で実施)
    const result = await esbuild({
      stdin: { contents: concatenated, sourcefile: 'twin_synced.js', loader: 'js' },
      bundle: false,
      format: 'iife',
      target: 'es2020',
      legalComments: 'none',
      minify: false,
      write: false,
    });
    let bundled = result.outputFiles[0].text;
    // predictRaceAsync は worker 不要 → 関数定義と globalThis export を strip
    bundled = stripFunction(bundled, 'predictRaceAsync');
    bundled = bundled.replace(/^.*globalThis\.predictRaceAsync\s*=\s*predictRaceAsync;.*$/m, '');
    return bundled;
  }

  // 文字列内の `function NAME(...) { ... }` (brace 深度ベース) を 1 個削除
  function stripFunction(src, fnName) {
    const re = new RegExp('^(?:async\\s+)?function\\s+' + fnName + '\\s*\\(', 'm');
    const m = re.exec(src);
    if (!m) return src;
    let i = src.indexOf('{', m.index + m[0].length);
    if (i < 0) return src;
    let depth = 0, inStr = null, inLineC = false, inBlockC = false, inTpl = false;
    let j = i;
    while (j < src.length) {
      const ch = src[j], nxt = j + 1 < src.length ? src[j + 1] : '';
      if (inLineC) { if (ch === '\n') inLineC = false; }
      else if (inBlockC) { if (ch === '*' && nxt === '/') { inBlockC = false; j++; } }
      else if (inStr) { if (ch === '\\') j++; else if (ch === inStr) inStr = null; }
      else if (inTpl) { if (ch === '\\') j++; else if (ch === '`') inTpl = false; }
      else {
        if (ch === '/' && nxt === '/') { inLineC = true; j++; }
        else if (ch === '/' && nxt === '*') { inBlockC = true; j++; }
        else if (ch === "'" || ch === '"') inStr = ch;
        else if (ch === '`') inTpl = true;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { return src.slice(0, m.index) + src.slice(j + 1); } }
      }
      j++;
    }
    return src;
  }

  async function applyInjections(targetPath, mods, label){
    const before = await readFile(targetPath, 'utf8');
    let current = before;
    for (const m of mods) {
      console.log('[bundle] src/' + m.src + ' ...');
      const code = await bundleModule(resolve(SRC, m.src));
      console.log('  -> ' + code.length + ' chars (marker: ' + m.marker + ')');
      current = injectBundle(current, m.marker, code);
    }
    // Phase 2 完遂続編: worker_predictor.js のみ WORKER_TWIN_SYNCED auto-gen を注入
    if (targetPath.endsWith('worker_predictor.js') && current.indexOf('/* BUILD:WORKER_TWIN_SYNCED:START */') >= 0) {
      console.log('[bundle] WORKER_TWIN_SYNCED (auto-gen from src/utils + src/analysis)');
      const twinBundle = await generateWorkerTwinSynced();
      console.log('  -> ' + twinBundle.length + ' chars (marker: WORKER_TWIN_SYNCED)');
      current = injectBundle(current, 'WORKER_TWIN_SYNCED', twinBundle);
    }
    if (CHECK_MODE) {
      if (before !== current) {
        console.error('[check] ' + label + ' differs from build output. Run "npm run build" and commit.');
        process.exit(1);
      }
      console.log('[check] ' + label + ' matches build output ✓');
    } else if (before !== current) {
      await writeFile(targetPath, current);
      console.log('[write] ' + label + ' updated');
    } else {
      console.log('[no-op] ' + label + ' already up-to-date');
    }
  }

  await applyInjections(appJsPath, modules, 'assets/app.js');
  const workerPredPath = resolve(ROOT, 'assets/worker_predictor.js');
  await applyInjections(workerPredPath, workerModules, 'assets/worker_predictor.js');

  // 2b) PE-6 + PI-3: minify を 3 ファイル (app + critical + rest) で実行
  //         配信物のみ最小化、tests / debug は ソース版を参照
  async function minifyFile(srcPath, outPath, label){
    const r = await esbuild({
      entryPoints: [srcPath],
      bundle: false,
      minify: true,
      target: 'es2020',
      legalComments: 'none',
      sourcemap: false,
      write: false,
    });
    const before = await readFile(outPath, 'utf8').catch(() => '');
    const after = r.outputFiles[0].text;
    const srcSize = (await readFile(srcPath, 'utf8')).length;
    const ratio = ((1 - after.length / srcSize) * 100).toFixed(1);
    if (CHECK_MODE) {
      if (before !== after) {
        console.error('[check] ' + label + ' differs from build output');
        process.exit(1);
      }
      console.log('[check] ' + label + ' matches build output ✓');
    } else if (before !== after) {
      await writeFile(outPath, after);
      console.log('[write] ' + label + ' updated (' + srcSize + ' → ' +
                  after.length + ' chars, -' + ratio + '%)');
    } else {
      console.log('[no-op] ' + label + ' already up-to-date');
    }
  }

  await minifyFile(appJsPath, resolve(ROOT, 'assets/app.min.js'), 'assets/app.min.js');
  // PI-3: split bundle (auto-generated by scripts/split_app.py)
  // Phase 2 完遂続編: app-rest-stats.js + app-rest-detail.js (lazy sub-chunks)
  const criticalSrc = resolve(ROOT, 'assets/app-critical.js');
  const restSrc = resolve(ROOT, 'assets/app-rest.js');
  const restStatsSrc = resolve(ROOT, 'assets/app-rest-stats.js');
  const restDetailSrc = resolve(ROOT, 'assets/app-rest-detail.js');
  if (await readFile(criticalSrc, 'utf8').then(()=>true).catch(()=>false)){
    await minifyFile(criticalSrc, resolve(ROOT, 'assets/app-critical.min.js'), 'assets/app-critical.min.js');
  }
  if (await readFile(restSrc, 'utf8').then(()=>true).catch(()=>false)){
    await minifyFile(restSrc, resolve(ROOT, 'assets/app-rest.min.js'), 'assets/app-rest.min.js');
  }
  if (await readFile(restStatsSrc, 'utf8').then(()=>true).catch(()=>false)){
    await minifyFile(restStatsSrc, resolve(ROOT, 'assets/app-rest-stats.min.js'), 'assets/app-rest-stats.min.js');
  }
  if (await readFile(restDetailSrc, 'utf8').then(()=>true).catch(()=>false)){
    await minifyFile(restDetailSrc, resolve(ROOT, 'assets/app-rest-detail.min.js'), 'assets/app-rest-detail.min.js');
  }

  // P1-Q3: Bundle size budget — 配信物が予算を超えたら fail / warn
  //   critical は LCP に直結するため hard fail、それ以外は warn 留め。
  //   超過時は CI が PR を block して退行を防ぐ。
  //
  // Epic 1-28g 完了時点 (critical=75.4KB / rest=116KB / worker=59KB)
  //   Epic 28x で診断ロジック / IDB migration polling / TOP10 等の保険コード追加で +1KB
  //
  // Clearwing Phase 完了時点で rest = 134.2KB。旧 125KB warn は時代遅れ
  // (Phase 2 で discovery / analysis / reporting / context / scoreBoatV2 を
  //  REST_ONLY bundle として注入したため rest の絶対サイズが微増)。
  // 新 140000 warn は「現状 + 5KB 余裕」で設定し、本格的な圧縮は次フェーズで:
  //   - app-rest を core / stats / settings の 3 chunk に分割 (lazy load)
  //   - i18n table を別 chunk
  //   - worker_predictor を必要時のみ register (現状は startup 直後 register)
  //  詳細は docs/architecture.md § 5 ビルドパイプライン参照。
  const BUDGETS = [
    { path: 'assets/app-critical.min.js', max: 96000,  level: 'fail' },   // v2 (24 dim) features 含む
    { path: 'assets/app-rest.min.js',     max: 100000, level: 'warn' },   // detail chunk 分離後 (~95KB)
    { path: 'assets/app-rest-stats.min.js',  max: 20000, level: 'warn' },  // 成績 + バックテスト sub-chunk
    { path: 'assets/app-rest-detail.min.js', max: 30000, level: 'warn' },  // レース詳細 sub-chunk
    { path: 'assets/worker_predictor.js', max: 90000,  level: 'warn' },   // v2 24-dim + features.js bundle 後 (~85KB)
  ];
  let budgetFail = false;
  for (const b of BUDGETS) {
    const buf = await readFile(resolve(ROOT, b.path)).catch(()=>null);
    if (!buf){ console.warn('[budget] missing ' + b.path); continue; }
    const size = buf.length;
    const pct = ((size / b.max) * 100).toFixed(1);
    if (size > b.max){
      const tag = b.level === 'fail' ? '[budget FAIL]' : '[budget WARN]';
      console.error(tag + ' ' + b.path + ' = ' + size + 'B > ' + b.max + 'B (' + pct + '%)');
      if (b.level === 'fail') budgetFail = true;
    } else {
      console.log('[budget OK] ' + b.path + ' = ' + size + 'B / ' + b.max + 'B (' + pct + '%)');
    }
  }
  if (budgetFail && CHECK_MODE){
    console.error('[budget] critical bundle exceeded budget — failing CI');
    process.exit(1);
  }

  // Epic 10: inline onclick 計測（Phase 2 移行までに削減すべき箇所を可視化）
  //   docs/CSP_MIGRATION_ROADMAP.md 参照
  try {
    const htmlForCsp = await readFile(indexPath, 'utf8');
    const onclickCount = (htmlForCsp.match(/\sonclick=/g) || []).length;
    // baseline = 静的 ~17 + prerender 開催場 24 = ~41 (Epic 10 計測時点)
    // Epic 19 で 0 達成。退行検知のため baseline は 50 のまま据え置き。
    const ONCLICK_BASELINE = 50;
    // Epic 23: inline style="" 計測（CSP Phase 4 削減進捗の監視）
    //   baseline = Epic 23 完了時点 (index.html 18 + app.js 103 = 121)
    //   Phase 4 後段で更に削減し、最終的に 0 + style-src 'unsafe-inline' 撤去を目指す。
    try {
      const appJsForCsp = await readFile(appJsPath, 'utf8');
      const styleCount = (htmlForCsp.match(/\sstyle="/g) || []).length
                       + (appJsForCsp.match(/\sstyle="/g) || []).length;
      const STYLE_BASELINE = 130;
      const styleTag = styleCount <= STYLE_BASELINE ? '[csp OK]' : '[csp WARN]';
      console.log(styleTag + ' inline style="" = ' + styleCount + ' (baseline ' + STYLE_BASELINE + ')');
    } catch(_){}
    const tag = onclickCount <= ONCLICK_BASELINE ? '[csp OK]' : '[csp WARN]';
    console.log(tag + ' index.html inline onclick = ' + onclickCount + ' (baseline ' + ONCLICK_BASELINE + ')');
    if (onclickCount > ONCLICK_BASELINE){
      console.warn('  → onclick が増えています。delegation 化を検討してください。');
    }
  } catch(_){}

  // Epic 10: nonce 生成 scaffold (Phase 3 で activate)
  //   今は使われない。CSP unsafe-inline 撤去時に index.html の <!-- CSP-NONCE-PLACEHOLDER -->
  //   と <script> タグへ注入する想定。
  //   const { randomBytes } = await import('node:crypto');
  //   const nonce = randomBytes(16).toString('base64');

  // Epic 27: critical bundle が rest 関数を typeof guard なしで呼んでいないかを lint
  //   PJ Phase / Epic 26 後の致命バグ (commit 05f4a2c) と同種の事故を build 時に防ぐ。
  //   検出条件:
  //     1) /* MOVED: function xxx */ で rest へ移譲された関数 xxx を取得
  //     2) critical の top-level (= 行頭が空白で始まらない) で `xxx(...)` を直接呼出
  //     3) ただし以下は OK:
  //        - 同行に typeof xxx (guard あり)
  //        - 同行に setTimeout / setInterval (deferred 実行)
  //        - 関数定義行 (function ...) や var/let/const 宣言行
  //        - コメント行
  try {
    const criticalSrcLint = await readFile(criticalSrc, 'utf8').catch(()=>null);
    if (criticalSrcLint){
      // MOVED コメントで rest 移譲されたものを取得
      const moved = new Set();
      for (const m of criticalSrcLint.matchAll(/\/\* MOVED: function (\w+) \*\//g)) moved.add(m[1]);
      // ただし critical 内に function 定義もある場合 (重複定義) は除外
      //   split_app.py が anchor 判定で両方に出力するケースがある (例: _runIdleTask)
      const definedInCritical = new Set();
      for (const m of criticalSrcLint.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)) {
        definedInCritical.add(m[1]);
      }
      const trulyMoved = new Set([...moved].filter(fn => !definedInCritical.has(fn)));

      const violations = [];
      const linesL = criticalSrcLint.split('\n');
      for (let i = 0; i < linesL.length; i++){
        const line = linesL[i];
        // top-level statement のみ (行頭非空白)
        if (line.length === 0 || /^\s/.test(line)) continue;
        // 関数定義 / 変数宣言 / コメントは除外（async function も含む）
        if (/^(async\s+)?function\s|^var\s|^let\s|^const\s|^class\s/.test(line)) continue;
        if (/^\/\/|^\/\*|^\*/.test(line)) continue;
        for (const fn of trulyMoved){
          const re = new RegExp(`\\b${fn}\\s*\\(`);
          if (!re.test(line)) continue;
          if (line.includes(`typeof ${fn}`)) continue;        // guard あり OK
          if (/\bsetTimeout\b|\bsetInterval\b/.test(line)) continue; // deferred OK
          if (/\bif\s*\(\s*typeof\b/.test(line)) continue;     // typeof if guard 同様
          violations.push({ line: i + 1, fn, src: line.trim().slice(0, 140) });
        }
      }
      const lintTag = violations.length === 0 ? '[lint OK]' : '[lint FAIL]';
      console.log(lintTag + ' critical→rest 直接呼出 = ' + violations.length + ' (Epic 27 / PJ Phase 致命バグ防止)');
      if (violations.length > 0){
        console.error('  以下の箇所で rest 関数を typeof guard なしに呼んでいます:');
        for (const v of violations){
          console.error('    L' + v.line + ' [' + v.fn + ']: ' + v.src);
        }
        console.error('  対処: typeof xxx === "function" の guard、または setTimeout / polling でラップしてください。');
        if (CHECK_MODE){
          console.error('[lint] critical→rest violation found — failing CI');
          process.exit(1);
        }
      }
    }
  } catch(_){}

  // Path B (2026-05-16): SW VERSION と index.html の `?v=` を **自動同期**。
  //   旧運用: 手動で sw.js + index.html 4 箇所を bump → 漏れると stale 化
  //   新運用: ビルド成果物 (app-critical.min.js + app-rest.min.js) の sha256 短縮を
  //          VERSION 兼 `?v=` に注入。コンテンツが変われば VERSION も必ず変わる。
  try {
    const criticalBuf = await readFile(resolve(ROOT, 'assets/app-critical.min.js'));
    const restBuf = await readFile(resolve(ROOT, 'assets/app-rest.min.js'));
    // Phase 2 完遂続編: lazy sub-chunks も hash 計算に含めて更新検知
    const restStatsBuf = await readFile(resolve(ROOT, 'assets/app-rest-stats.min.js')).catch(() => Buffer.alloc(0));
    const restDetailBuf = await readFile(resolve(ROOT, 'assets/app-rest-detail.min.js')).catch(() => Buffer.alloc(0));
    const combined = Buffer.concat([criticalBuf, restBuf, restStatsBuf, restDetailBuf]);
    const newVer = createHash('sha256').update(combined).digest('hex').slice(0, 8);

    // sw.js の VERSION を上書き
    const swSrc = await readFile(swPath, 'utf8');
    const swNew = swSrc.replace(
      /(const VERSION\s*=\s*['"])br-oracle-[\w]+(['"])/,
      `$1br-oracle-${newVer}$2`
    );
    if (swNew !== swSrc) {
      if (CHECK_MODE) {
        console.error('[version FAIL] sw.js VERSION 自動同期が必要 — ローカルで cd build && node build.mjs を実行してから commit してください');
        process.exit(1);
      }
      await writeFile(swPath, swNew, 'utf8');
      console.log(`[write] sw.js VERSION → br-oracle-${newVer}`);
    } else {
      console.log(`[version OK] sw.js VERSION = br-oracle-${newVer}`);
    }

    // index.html の ?v=... (preload + script src 計 4 箇所) を上書き
    const htmlSrc = await readFile(indexPath, 'utf8');
    const htmlNew = htmlSrc.replace(
      /(assets\/app[\w-]*\.min\.js\?v=)[\w]+/g,
      `$1${newVer}`
    );
    if (htmlNew !== htmlSrc) {
      if (CHECK_MODE) {
        console.error('[version FAIL] index.html ?v= 自動同期が必要 — ローカルで cd build && node build.mjs を実行してから commit してください');
        process.exit(1);
      }
      await writeFile(indexPath, htmlNew, 'utf8');
      console.log(`[write] index.html ?v=${newVer}`);
    } else {
      console.log(`[version OK] index.html ?v=${newVer}`);
    }
  } catch (e) {
    console.warn('[version] auto-sync skipped:', e.message);
  }

  // 3) Hash report
  console.log('');
  console.log('[hash] index.html    SHA-256:', (await sha256(indexPath)).slice(0, 16) + '...');
  console.log('[hash] assets/app.js SHA-256:', (await sha256(appJsPath)).slice(0, 16) + '...');
  console.log('[hash] sw.js         SHA-256:', (await sha256(swPath)).slice(0, 16) + '...');
  console.log('[hash] manifest.json SHA-256:', (await sha256(manifestPath)).slice(0, 16) + '...');

  // 4) Syntax 検証 - assets/app.js (外部) と index.html の inline 両方
  console.log('');
  const appSyntax = await checkOther(appJsPath);
  if (appSyntax.ok) console.log('[syntax] assets/app.js OK');
  else { console.error('[syntax] assets/app.js FAILED:\n', appSyntax.err); process.exit(1); }
  const html = await readFile(indexPath, 'utf8');
  const syntax = await checkJsSyntax(html);
  if (syntax.ok) console.log('[syntax] inline <script> OK (none expected)');
  else { console.error('[syntax] inline FAILED:\n', syntax.err); process.exit(1); }

  try {
    JSON.parse(await readFile(manifestPath, 'utf8'));
    console.log('[syntax] manifest.json OK');
  } catch (e) {
    console.error('[syntax] manifest.json FAILED:', e.message);
    process.exit(1);
  }

  const swSyntax = await checkOther(swPath);
  if (swSyntax.ok) console.log('[syntax] sw.js OK');
  else { console.error('[syntax] sw.js FAILED:\n', swSyntax.err); process.exit(1); }

  console.log('');
  console.log('Build complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
