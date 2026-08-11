/**
 * critical bundle → rest bundle の「起動時到達性」lint（FA-6 / 2026-08-11）
 *
 * 背景:
 *   PJ Phase の致命バグ (CLAUDE.md 参照) は
 *     var _featureStats = (function(){ ... return _initFeatureStats(); })();
 *   という critical 側の即時実行 IIFE が、rest bundle にしか無い関数を呼び、
 *   window.onerror を bind する前に ReferenceError で script 全体を halt させたもの。
 *   iOS standalone PWA では DevTools が使えず、特定に 6 時間 / 24 commit を要した。
 *
 *   Epic 27 でこれを防ぐ lint が入ったが、判定が「行頭が非空白の行」ベースの
 *   ヒューリスティックだったため、まさに原因となった形（`var X = (function(){...})()`）を
 *   構造的に検出できなかった:
 *     - `var _featureStats = ...` は `^var` 除外にヒットしてスキップ
 *     - IIFE 本体の行は先頭が空白なので `^\s` 除外にヒットしてスキップ
 *   つまり「再発防止 lint が、防ぐべき当の再発パターンだけを見逃す」状態だった。
 *
 * 本モジュールは acorn の AST で「起動時に必ず実行される (eager) 領域」を正確に
 * 求め、その中の rest 関数呼出だけを違反として報告する。
 *
 *   eager = Program 直下の文
 *         + 即時実行される関数式 (IIFE / .call() / .apply()) の本体
 *   非 eager = 関数宣言・関数式の本体（後から呼ばれる）
 *              setTimeout / addEventListener / then 等に渡したコールバック
 *
 *   guard あり (= 違反としない):
 *     if (typeof fn === 'function') fn();
 *     typeof fn === 'function' && fn();
 *     typeof fn === 'function' ? fn() : ...
 *     try { fn(); } catch(e) {}     ← halt しないので致命ではない（別枠で報告）
 */

/** @param {object} node */
function memberName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.property && node.property.type === 'Identifier') {
    return node.property.name;
  }
  return '';
}

const FN_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression']);
const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'parent']);

/**
 * critical ソース中で「起動時に評価される」rest 関数呼出を列挙する。
 *
 * @param {string} src critical bundle のソース
 * @param {Set<string>|string[]} movedFns rest へ移譲された関数名
 * @param {object} acorn acorn モジュール（呼出側で import して渡す）
 * @returns {{violations: Array<{line:number, fn:string, src:string}>,
 *            tryGuarded: Array<{line:number, fn:string, src:string}>}}
 */
export function lintEagerRestCalls(src, movedFns, acorn) {
  const moved = movedFns instanceof Set ? movedFns : new Set(movedFns);
  const ast = acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
    allowReturnOutsideFunction: true,
  });

  const violations = [];
  const tryGuarded = [];
  const lines = src.split('\n');

  function isGuarded(fn, ancestors) {
    const re = new RegExp('typeof\\s*\\(?\\s*' + fn + '\\b');
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const a = ancestors[i];
      if (a.type === 'IfStatement' || a.type === 'ConditionalExpression') {
        if (re.test(src.slice(a.test.start, a.test.end))) return 'typeof';
      } else if (a.type === 'LogicalExpression') {
        if (re.test(src.slice(a.left.start, a.left.end))) return 'typeof';
      } else if (a.type === 'TryStatement') {
        return 'try';
      }
    }
    return null;
  }

  function record(node, fn, ancestors) {
    const guard = isGuarded(fn, ancestors);
    if (guard === 'typeof') return;
    const line = node.loc.start.line;
    const entry = { line, fn, src: (lines[line - 1] || '').trim().slice(0, 140) };
    if (guard === 'try') tryGuarded.push(entry);
    else violations.push(entry);
  }

  const iife = new WeakSet();

  function walk(node, eager, ancestors) {
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const c = node.callee;
      if (c && FN_TYPES.has(c.type)) {
        iife.add(c);
      } else if (
        c &&
        c.type === 'MemberExpression' &&
        c.object &&
        FN_TYPES.has(c.object.type) &&
        (memberName(c) === 'call' || memberName(c) === 'apply')
      ) {
        iife.add(c.object);
      }
      if (eager && c && c.type === 'Identifier' && moved.has(c.name)) {
        record(node, c.name, ancestors);
      }
    }

    let childEager = eager;
    if (node.type === 'FunctionDeclaration') childEager = false;
    else if (FN_TYPES.has(node.type)) childEager = iife.has(node) ? eager : false;

    ancestors.push(node);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (const x of v) if (x && typeof x.type === 'string') walk(x, childEager, ancestors);
      } else if (v && typeof v.type === 'string') {
        walk(v, childEager, ancestors);
      }
    }
    ancestors.pop();
  }

  walk(ast, true, []);
  return { violations, tryGuarded };
}

/**
 * MOVED コメントから「critical に定義が無く rest にしか無い関数」を抽出する。
 * @param {string} src critical bundle のソース
 * @returns {Set<string>}
 */
export function collectMovedFns(src) {
  const moved = new Set();
  for (const m of src.matchAll(/\/\* MOVED: function (\w+) \*\//g)) moved.add(m[1]);
  const definedInCritical = new Set();
  for (const m of src.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)) {
    definedInCritical.add(m[1]);
  }
  // split_app.py が anchor 判定で両方に出力するケース (例: _runIdleTask) は除外
  return new Set([...moved].filter((fn) => !definedInCritical.has(fn)));
}
