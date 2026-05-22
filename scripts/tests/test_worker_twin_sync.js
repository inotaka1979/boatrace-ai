/**
 * Phase 2 完遂 (Clearwing patterns): Worker twin sync lint test
 *
 *   node scripts/tests/test_worker_twin_sync.js
 *
 * 目的:
 *   assets/worker_predictor.js は src/analysis/* / src/utils/* の関数を「ロジック
 *   等価」で重複定義している (Worker は別 thread / 別スコープのため共有不可)。
 *   片方を編集して他方を忘れる "twin maintenance" バグを CI で検出する。
 *
 * 仕組み:
 *   各 TWIN ペア (src 側 / worker 側) について:
 *     1. 関数本体を brace 深度ベースで抽出
 *     2. コメント除去 + 全空白を 1 スペースに正規化
 *     3. 等価比較
 *     4. 差があれば「最初の差分位置 + 文脈」を表示
 *
 * 抜本対策 (将来):
 *   build/build.mjs の worker bundle 化 (src/analysis/* を esbuild で
 *   worker_predictor.js として再生成) — docs/architecture.md § 9 参照
 *
 * 失敗時の対処:
 *   差分の意図が main 側にあるなら worker 側を更新、または逆。
 *   両者を編集してロジックを一致させてから commit。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * @typedef {Object} TwinPair
 * @property {string} name       関数名
 * @property {string} src        src 側ファイル (ROOT 相対)
 * @property {string} worker     worker 側ファイル (ROOT 相対)
 * @property {string} [note]     差分が許容される場合の説明
 * @property {boolean} [warnOnly] 差分を warn 扱いとする (error にしない)
 */

/** @type {TwinPair[]} */
const TWINS = [
  // utils/math.js
  { name: 'softmax',                src: 'src/utils/math.js',          worker: 'assets/worker_predictor.js' },
  { name: 'safeDiv',                src: 'src/utils/math.js',          worker: 'assets/worker_predictor.js' },
  { name: '_plackettLuceTrifectaProb', src: 'src/utils/math.js',       worker: 'assets/worker_predictor.js' },
  { name: '_plackettLuceExactaProb',   src: 'src/utils/math.js',       worker: 'assets/worker_predictor.js' },

  // analysis/calibration.js
  { name: '_applyPlattCalibration',  src: 'src/analysis/calibration.js', worker: 'assets/worker_predictor.js' },
  { name: '_normalizeFeatures',      src: 'src/analysis/calibration.js', worker: 'assets/worker_predictor.js' },
  { name: '_updateFeatureStats',     src: 'src/analysis/calibration.js', worker: 'assets/worker_predictor.js' },

  // analysis/l2_features.js
  { name: '_computeClassAttenuation', src: 'src/analysis/l2_features.js', worker: 'assets/worker_predictor.js' },
  { name: '_resolveCourse',           src: 'src/analysis/l2_features.js', worker: 'assets/worker_predictor.js' },
  { name: 'getL2Features',            src: 'src/analysis/l2_features.js', worker: 'assets/worker_predictor.js' },
  { name: 'l2Predict',                src: 'src/analysis/l2_features.js', worker: 'assets/worker_predictor.js' },
  { name: 'l2Update',                 src: 'src/analysis/l2_features.js', worker: 'assets/worker_predictor.js' },

  // analysis/score_boat.js
  { name: 'scoreBoatV2',              src: 'src/analysis/score_boat.js',  worker: 'assets/worker_predictor.js' },

  // analysis/predict_scenarios.js
  { name: 'predictScenarios',         src: 'src/analysis/predict_scenarios.js', worker: 'assets/worker_predictor.js' },
  { name: 'predictWithScenarios',     src: 'src/analysis/predict_scenarios.js', worker: 'assets/worker_predictor.js' },
  { name: 'predictEntryCourses',      src: 'src/analysis/predict_scenarios.js', worker: 'assets/worker_predictor.js' },

  // analysis/predict_race.js
  { name: 'predictRace',              src: 'src/analysis/predict_race.js', worker: 'assets/worker_predictor.js' },
];

/**
 * brace 深度ベースで関数本体 (function NAME(...) { ... }) を抽出。
 * 文字列リテラル / コメント内の `{` `}` は除外する。
 * @param {string} text
 * @param {string} fnName
 * @returns {string | null}
 */
function extractFunctionBody(text, fnName) {
  const re = new RegExp('^(?:async\\s+)?function\\s+' + fnName.replace(/\$/g, '\\$') + '\\s*\\(', 'm');
  const m = re.exec(text);
  if (!m) return null;
  // find first '{'
  let i = text.indexOf('{', m.index + m[0].length);
  if (i < 0) return null;
  let depth = 0;
  /** @type {string | null} */
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  let inTemplate = false;
  let j = i;
  while (j < text.length) {
    const ch = text[j];
    const nxt = j + 1 < text.length ? text[j + 1] : '';
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
    } else if (inBlockComment) {
      if (ch === '*' && nxt === '/') {
        inBlockComment = false;
        j++;
      }
    } else if (inStr) {
      if (ch === '\\') j++;
      else if (ch === inStr) inStr = null;
    } else if (inTemplate) {
      if (ch === '\\') j++;
      else if (ch === '`') inTemplate = false;
    } else {
      if (ch === '/' && nxt === '/') {
        inLineComment = true;
        j++;
      } else if (ch === '/' && nxt === '*') {
        inBlockComment = true;
        j++;
      } else if (ch === "'" || ch === '"') {
        inStr = ch;
      } else if (ch === '`') {
        inTemplate = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(i, j + 1);
        }
      }
    }
    j++;
  }
  return null;
}

/**
 * 比較用に正規化: コメント除去 + 全空白 → 1 スペース。
 * @param {string} body
 * @returns {string}
 */
function normalize(body) {
  // 行コメント / ブロックコメント除去 (文字列リテラル内は無視するため簡易処理)
  let out = '';
  let i = 0;
  /** @type {string | null} */
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  let inTemplate = false;
  while (i < body.length) {
    const ch = body[i];
    const nxt = i + 1 < body.length ? body[i + 1] : '';
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ' ';
      }
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && nxt === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      out += ch;
      if (ch === '\\' && i + 1 < body.length) {
        out += body[i + 1];
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (inTemplate) {
      out += ch;
      if (ch === '\\' && i + 1 < body.length) {
        out += body[i + 1];
        i += 2;
        continue;
      }
      if (ch === '`') inTemplate = false;
      i++;
      continue;
    }
    if (ch === '/' && nxt === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && nxt === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  // 全空白を 1 スペースに、前後 trim
  out = out.replace(/\s+/g, ' ').trim();
  // 句読点周辺の余分な空白を除去 (token 等価のため: `if(x)` と `if (x)` を同一視)
  // 文字列リテラル内の空白はこの時点で content の一部、out には ' ' が含まれない
  // (上の文字列スキャンで保持済) のでこの置換は安全
  out = out.replace(/\s*([(){}\[\],;:=!+\-*/<>&|?.])\s*/g, '$1');
  return out;
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

console.log('[Phase 2 完遂: Worker twin sync lint]');
console.log('  対象: src/analysis/* / src/utils/* と assets/worker_predictor.js の関数等価性');
console.log('');

let pass = 0;
let fail = 0;
let warn = 0;

for (const t of TWINS) {
  const srcPath = path.join(ROOT, t.src);
  const workerPath = path.join(ROOT, t.worker);
  if (!fs.existsSync(srcPath)) {
    console.log('  SKIP: ' + t.name + ' — src file not found: ' + t.src);
    continue;
  }
  if (!fs.existsSync(workerPath)) {
    console.log('  SKIP: ' + t.name + ' — worker file not found: ' + t.worker);
    continue;
  }
  const srcText = fs.readFileSync(srcPath, 'utf8');
  const workerText = fs.readFileSync(workerPath, 'utf8');
  const srcBody = extractFunctionBody(srcText, t.name);
  const workerBody = extractFunctionBody(workerText, t.name);
  if (!srcBody) {
    console.log('  FAIL: ' + t.name + ' — not found in ' + t.src);
    fail++;
    continue;
  }
  if (!workerBody) {
    console.log('  FAIL: ' + t.name + ' — not found in ' + t.worker);
    fail++;
    continue;
  }
  const normSrc = normalize(srcBody);
  const normWorker = normalize(workerBody);
  if (normSrc === normWorker) {
    console.log('  PASS: ' + t.name);
    pass++;
  } else {
    const tag = t.warnOnly ? 'WARN' : 'FAIL';
    console.log('  ' + tag + ': ' + t.name + ' — diverged between src and worker');
    const idx = firstDiff(normSrc, normWorker);
    const winA = normSrc.slice(Math.max(0, idx - 40), Math.min(normSrc.length, idx + 60));
    const winB = normWorker.slice(Math.max(0, idx - 40), Math.min(normWorker.length, idx + 60));
    console.log('    first diff at char ' + idx);
    console.log('    src   : ' + winA);
    console.log('    worker: ' + winB);
    if (t.warnOnly) warn++;
    else fail++;
  }
}

console.log('');
console.log('=== Worker twin sync result ===');
console.log('pass: ' + pass + '  fail: ' + fail + '  warn: ' + warn);

if (fail > 0) {
  console.log('');
  console.log('編集時の対処:');
  console.log('  1. main / worker どちらかの実装を意図的に変えたなら、もう片方も同じロジックに更新');
  console.log('  2. 抜本対策は build パイプラインで worker_predictor.js を src/ から自動生成すること');
  console.log('     (docs/architecture.md § 9 参照)');
  process.exit(1);
}
process.exit(0);
