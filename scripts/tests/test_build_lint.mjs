/**
 * critical→rest 到達性 lint の回帰テスト（FA-6 / 2026-08-11）
 *
 * 「PJ Phase の致命バグそのもの」を lint が検出できることを固定する。
 * 旧ヒューリスティック実装は、まさにこの形だけを見逃していた:
 *
 *   var _featureStats = (function(){        ← `^var` 除外にヒットしてスキップ
 *     return _initFeatureStats();           ← `^\s` 除外にヒットしてスキップ
 *   })();
 *
 *   node scripts/tests/test_build_lint.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { lintEagerRestCalls, collectMovedFns } = await import(
  pathToFileURL(path.join(ROOT, 'build', 'lint_critical.mjs')).href
);

let acorn = null;
try {
  acorn = await import(pathToFileURL(path.join(ROOT, 'build', 'node_modules', 'acorn', 'dist', 'acorn.mjs')).href);
} catch (_) {
  try { acorn = await import('acorn'); } catch (_2) { acorn = null; }
}
if (!acorn) {
  console.error('SKIP: acorn を解決できません (cd build && npm ci)');
  process.exit(0);
}

const MOVED = new Set(['_initFeatureStats', 'renderStats', 'restOnly']);

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}
const lint = (src) => lintEagerRestCalls(src, MOVED, acorn);

console.log('=== critical→rest 到達性 lint (FA-6) ===');

t('PJ Phase の実バグ形 (var X = IIFE 内で rest 呼出) を検出する', () => {
  const { violations } = lint(
    'var _featureStats = (function(){\n' +
    '  var raw = _bootParseLS("k", null);\n' +
    '  if (raw) return raw;\n' +
    '  return _initFeatureStats();\n' +
    '})();\n'
  );
  assert.strictEqual(violations.length, 1, '旧 lint と同じく見逃している');
  assert.strictEqual(violations[0].fn, '_initFeatureStats');
  assert.strictEqual(violations[0].line, 4);
});

t('top-level のむき出し呼出を検出する', () => {
  assert.strictEqual(lint('renderStats();\n').violations.length, 1);
});

t('IIFE を .call() で起動する形も検出する', () => {
  assert.strictEqual(lint('(function(){ restOnly(); }).call(this);\n').violations.length, 1);
});

t('アロー IIFE も検出する', () => {
  assert.strictEqual(lint('const x = (() => restOnly())();\n').violations.length, 1);
});

t('関数宣言の中の呼出は検出しない（後から呼ばれる）', () => {
  assert.strictEqual(lint('function later(){ renderStats(); }\n').violations.length, 0);
});

t('setTimeout コールバック内は検出しない', () => {
  assert.strictEqual(lint('setTimeout(function(){ renderStats(); }, 0);\n').violations.length, 0);
});

t('addEventListener コールバック内は検出しない', () => {
  assert.strictEqual(
    lint('window.addEventListener("load", function(){ renderStats(); });\n').violations.length, 0);
});

t('typeof guard 付き if は検出しない', () => {
  assert.strictEqual(
    lint('if (typeof renderStats === "function") { renderStats(); }\n').violations.length, 0);
});

t('typeof guard 付き && 短絡は検出しない', () => {
  assert.strictEqual(
    lint('typeof renderStats === "function" && renderStats();\n').violations.length, 0);
});

t('typeof guard 付き三項は検出しない', () => {
  assert.strictEqual(
    lint('var a = typeof renderStats === "function" ? renderStats() : null;\n').violations.length, 0);
});

t('別名の typeof guard は guard として認めない', () => {
  assert.strictEqual(
    lint('if (typeof somethingElse === "function") { renderStats(); }\n').violations.length, 1,
    '無関係な typeof を guard と誤認している');
});

t('try/catch 内は halt しないので violations ではなく tryGuarded に分類する', () => {
  const r = lint('try { renderStats(); } catch(e) {}\n');
  assert.strictEqual(r.violations.length, 0);
  assert.strictEqual(r.tryGuarded.length, 1);
});

t('非 eager IIFE（関数宣言の中の IIFE）は検出しない', () => {
  assert.strictEqual(
    lint('function later(){ (function(){ restOnly(); })(); }\n').violations.length, 0);
});

t('collectMovedFns: critical にも定義がある関数は moved から除外する', () => {
  const src = '/* MOVED: function foo */\n/* MOVED: function bar */\nfunction bar(){}\n';
  const s = collectMovedFns(src);
  assert.ok(s.has('foo'));
  assert.ok(!s.has('bar'), 'critical に定義がある bar を moved 扱いしている');
});

t('実際の app-critical.js に違反が無い', () => {
  const p = path.join(ROOT, 'assets', 'app-critical.js');
  if (!fs.existsSync(p)) { console.log('    (app-critical.js 未生成のためスキップ)'); return; }
  const src = fs.readFileSync(p, 'utf8');
  const { violations } = lintEagerRestCalls(src, collectMovedFns(src), acorn);
  assert.strictEqual(violations.length, 0,
    '違反: ' + violations.map((v) => 'L' + v.line + ' ' + v.fn).join(', '));
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
