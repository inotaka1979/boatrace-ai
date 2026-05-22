/**
 * Phase 6 (Clearwing patterns): 退行禁止パターン検出テスト
 *
 *   node scripts/tests/test_deprecated_patterns.js
 *
 * 目的:
 *   ESLint で検出する no-restricted-syntax は src/ のみ対象。
 *   本テストは src/ + assets/app.js (canonical) + worker_predictor.js を含めて
 *   「過去に致命バグの原因となったコードパターン」が再混入していないかを検証する。
 *
 * 検出対象:
 *   1) AbortSignal.timeout( の直接呼出 (iOS Safari < 16 互換性破壊)
 *      → capabilities.makeTimeoutSignal(ms) を使うべき
 *   2) src/discovery/* で document. / window. に直接アクセス (層責務違反)
 *      → reporting 層に委譲すべき
 *   3) src/reporting/* で fetch( の直接呼出 (層責務違反)
 *      → discovery 層 (fetchWithFallback / _fetchOne) 経由
 *   4) src/analysis/* で fetch( の直接呼出 (層責務違反)
 *      → analysis は計算ロジックのみ、外部 IO は呼ばない
 *   5) src/ 全般で `// @ts-ignore` / `// @ts-nocheck` (Phase 4 strict をすり抜ける)
 *
 * 例外:
 *   - capabilities*.js 自身は 1) を直接扱ってよい (公式の polyfill 提供窓口)
 *   - assets/app.js は legacy のため警告のみ (PR 評価は人間)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * パターン定義
 * @typedef {Object} Pattern
 * @property {string}  name      規則名
 * @property {RegExp}  re        検出正規表現
 * @property {string[]} files    対象ファイル (glob 風: 完全 path を絶対 path で渡す前提)
 * @property {string[]} [allowFiles]  検出を許可するファイル (例外窓口)
 * @property {'error'|'warn'} severity
 * @property {string} message
 */

const SRC_DIR = path.join(ROOT, 'src');
const APP_JS = path.join(ROOT, 'assets/app.js');
const WORKER_PRED = path.join(ROOT, 'assets/worker_predictor.js');

/** @type {Pattern[]} */
const PATTERNS = [
  {
    name: 'no-direct-abort-signal-timeout',
    re: /\bAbortSignal\s*\.\s*timeout\s*\(/g,
    files: [APP_JS, WORKER_PRED, SRC_DIR],
    allowFiles: [
      path.join(SRC_DIR, 'capabilities.js'),
      path.join(SRC_DIR, 'capabilities-worker.js'),
    ],
    severity: 'error',
    message:
      'Direct AbortSignal.timeout() — use capabilities.makeTimeoutSignal(ms) ' +
      'to preserve iOS Safari < 16 compatibility.',
  },
  {
    name: 'no-fetch-in-analysis',
    re: /\bfetch\s*\(/g,
    files: [path.join(SRC_DIR, 'analysis')],
    severity: 'error',
    message:
      'Analysis layer must not perform network IO. Use discovery layer ' +
      '(fetchWithFallback / _fetchOne) instead.',
  },
  {
    name: 'no-fetch-in-reporting',
    re: /\bfetch\s*\(/g,
    files: [path.join(SRC_DIR, 'reporting')],
    severity: 'error',
    message:
      'Reporting layer must not perform network IO. Inject data via globalThis state ' +
      'or call discovery functions.',
  },
  {
    name: 'no-dom-in-discovery',
    re: /\b(document|window)\s*\.\s*/g,
    files: [path.join(SRC_DIR, 'discovery')],
    severity: 'error',
    message:
      'Discovery layer must not touch DOM. Delegate to reporting layer via ' +
      'globalThis._renderXxx().',
  },
  {
    name: 'no-ts-ignore',
    re: /@ts-ignore|@ts-nocheck/g,
    files: [SRC_DIR],
    severity: 'error',
    message:
      'Phase 4 strict typing must not be bypassed. Fix the type error or add an ' +
      'explicit JSDoc annotation.',
  },
];

/**
 * ディレクトリを再帰スキャンして .js ファイル一覧を返す。
 * @param {string} target
 * @returns {string[]}
 */
function walkJs(target) {
  if (!fs.existsSync(target)) return [];
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  if (!st.isDirectory()) return [];
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(target)) {
    const full = path.join(target, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      // node_modules / generated 等を除外
      if (/node_modules|\.min\.js$/.test(entry)) continue;
      out.push(...walkJs(full));
    } else if (full.endsWith('.js') && !full.endsWith('.min.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * BUILD: マーカー領域 (build.mjs が src/* から auto-generate) は authored ではない
 * ため除外する。auto-generated 部分の検出は src/* 側で別途行われる。
 * @param {string} src
 * @param {number} idx
 * @returns {boolean}
 */
function _isInsideBuildRegion(src, idx) {
  const startRe = /\/\* BUILD:[A-Z_]+:START \*\//g;
  const endRe = /\/\* BUILD:[A-Z_]+:END \*\//g;
  /** @type {Array<{start:number, end:number}>} */
  const regions = [];
  let s;
  while ((s = startRe.exec(src)) !== null) {
    endRe.lastIndex = s.index;
    const e = endRe.exec(src);
    if (!e) break;
    regions.push({ start: s.index, end: e.index + e[0].length });
  }
  return regions.some((r) => idx >= r.start && idx < r.end);
}

/**
 * パターンを 1 個チェック。
 * @param {Pattern} p
 * @returns {Array<{ file: string; line: number; col: number; sample: string }>}
 */
function runPattern(p) {
  /** @type {string[]} */
  const targets = [];
  for (const t of p.files) targets.push(...walkJs(t));
  /** @type {Array<{ file: string; line: number; col: number; sample: string }>} */
  const violations = [];
  for (const file of targets) {
    if (p.allowFiles && p.allowFiles.indexOf(file) >= 0) continue;
    const src = fs.readFileSync(file, 'utf8');
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(src)) !== null) {
      // BUILD: マーカー領域内なら skip (auto-generated コードは src/ 側で検出済)
      if (_isInsideBuildRegion(src, m.index)) continue;
      const upto = src.slice(0, m.index);
      const line = upto.split('\n').length;
      const col = m.index - upto.lastIndexOf('\n');
      const lineStart = upto.lastIndexOf('\n') + 1;
      const lineEnd = src.indexOf('\n', m.index);
      const sample = src.slice(lineStart, lineEnd >= 0 ? lineEnd : src.length).trim();
      // ESLint disable コメント付きは除外 (rationale 付きの例外を許容)
      if (/eslint-disable.*no-restricted-syntax/.test(sample)) continue;
      // コメント行 / コメント内の言及は除外
      if (sample.startsWith('//') || sample.startsWith('*') || sample.startsWith('/*')) continue;
      violations.push({ file, line, col, sample });
    }
  }
  return violations;
}

console.log('[Phase 6: deprecated pattern detector]');

let totalError = 0;
let totalWarn = 0;
const results = [];
for (const p of PATTERNS) {
  const v = runPattern(p);
  results.push({ pattern: p, violations: v });
  if (v.length === 0) {
    console.log(`  PASS: ${p.name} (0 violations)`);
  } else {
    const label = p.severity === 'error' ? 'FAIL' : 'WARN';
    console.log(`  ${label}: ${p.name} (${v.length} violations)`);
    console.log(`    → ${p.message}`);
    for (const x of v.slice(0, 5)) {
      const rel = path.relative(ROOT, x.file);
      console.log(`    ${rel}:${x.line}:${x.col}  ${x.sample.slice(0, 100)}`);
    }
    if (v.length > 5) console.log(`    ... +${v.length - 5} more`);
    if (p.severity === 'error') totalError += v.length;
    else totalWarn += v.length;
  }
}

console.log('');
console.log(`=== Deprecated pattern result ===`);
console.log(`errors: ${totalError}  warnings: ${totalWarn}`);

if (totalError > 0) {
  console.log('');
  console.log('Errors are PR-blocking. Either fix the violation or add a justified');
  console.log('// eslint-disable-next-line no-restricted-syntax comment.');
  process.exit(1);
}
process.exit(0);
