// 2026-11-20: app.js / worker の「グローバルに見える名前」を AST から集める。
//
// 背景: eslint.config.mjs は assets/app.js・worker 2 本を丸ごと ignore し、src/ の予測・描画の中核 15 ファイルは
//   no-undef を off にしていた。過去の重大障害（PJ Phase の _initFeatureStats、11/14・11/19 の worker 未定義参照
//   22 種、helper の範囲削除）はどれも未定義参照で、no-undef で機械的に検出できる種類だった。
//   src は app.js に bundle されて 1 つのスクリプト空間で動くので、app.js の
//     - プログラム直下の var / let / const / function / class 宣言
//     - globalThis / _g / window / self への代入で export された名前
//   を既知のグローバルとして渡せば、どこにも定義されていない名前だけが検出される。
//
// 使用: eslint.config.mjs（src/ の no-undef）と scripts/tests/test_no_undef.mjs（app.js / worker / src）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT_OBJECTS = new Set(['globalThis', '_g', 'window', 'self']);

function addPattern(id, out) {
  if (!id) return;
  if (id.type === 'Identifier') out.add(id.name);
  else if (id.type === 'ObjectPattern') id.properties.forEach((p) => addPattern(p.value || p.argument, out));
  else if (id.type === 'ArrayPattern') id.elements.forEach((e) => addPattern(e, out));
  else if (id.type === 'AssignmentPattern') addPattern(id.left, out);
  else if (id.type === 'RestElement') addPattern(id.argument, out);
}

// 全ノードを辿る（acorn-walk を使わない最小実装）
function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k in node) {
    if (k === 'loc' || k === 'range') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn));
    else if (v && typeof v.type === 'string') walk(v, fn);
  }
}

/** ソース 1 本からグローバルに見える名前を集める */
export function collectGlobals(src) {
  const out = new Set();
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  for (const st of ast.body) {
    if (st.type === 'VariableDeclaration') st.declarations.forEach((d) => addPattern(d.id, out));
    else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) out.add(st.id.name);
  }
  walk(ast, (n) => {
    if (n.type !== 'AssignmentExpression') return;
    const l = n.left;
    if (l.type === 'MemberExpression' && !l.computed && l.object.type === 'Identifier' && EXPORT_OBJECTS.has(l.object.name)) {
      out.add(l.property.name);
    }
  });
  return out;
}

function toEslintGlobals(names) {
  const g = {};
  for (const n of names) g[n] = 'writable';
  return g;
}

/** assets/app.js から集めたグローバル（ESLint の languageOptions.globals 形式） */
export function appGlobals() {
  return toEslintGlobals(collectGlobals(fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8')));
}

/** worker.js + worker_predictor.js から集めたグローバル */
export function workerGlobals() {
  const names = new Set();
  for (const f of ['worker.js', 'worker_predictor.js']) {
    for (const n of collectGlobals(fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8'))) names.add(n);
  }
  return toEslintGlobals(names);
}
