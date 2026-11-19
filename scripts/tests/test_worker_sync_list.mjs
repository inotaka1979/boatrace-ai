/**
 * main → worker の state 同期リストの網羅性（2026-11-20）
 *
 * _syncWorkerState (app.js) が送る項目と _syncState (worker.js) が受ける項目は手書きの列挙で、
 * main に新しい state を足して worker への同期を忘れると、エラーは出ずに worker の予想だけが main と
 * ずれる（11/19 の「30/30 レース不一致」と同じ形）。worker の予測ロジック (WORKER_TWIN_SYNCED 領域) が
 * 読む「app.js のトップレベル var（= 実行時に変わる state）」を AST で集め、それぞれが
 *   (a) main が送り、worker が受けている、または
 *   (b) 下の WORKER_LOCAL に理由付きで載っている（worker 内で完結 / 予測に影響しない）
 * ことを要求する。定数（WORKER_SHARED_CONSTANTS で転記）と関数は対象外。
 *
 *   node scripts/tests/test_worker_sync_list.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const app = read('assets/app.js');
const wp = read('assets/worker_predictor.js');
const wjs = read('assets/worker.js');
const build = read('build/build.mjs');

// worker の中で完結する / 予測結果に影響しない state（理由を必ず書く）
const WORKER_LOCAL = {
  _appWorkerReqId: 'predictRaceAsync（main 専用経路）',
  _appWorkerCallbacks: 'predictRaceAsync（main 専用経路）',
  _gbdtModel: 'GBDT は placeholder（n_train < 5000 で blend しない）。worker は常に未ロード = main と同じ no-op',
};

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

function region(src, marker) {
  const s = src.indexOf('/* BUILD:' + marker + ':START */');
  const e = src.indexOf('/* BUILD:' + marker + ':END */');
  if (s < 0 || e < 0) throw new Error('marker not found: ' + marker);
  return src.slice(s, e);
}
function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k in node) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn));
    else if (v && typeof v.type === 'string' && k !== 'loc') walk(v, fn);
  }
}
function identifiers(src) {
  const out = new Set();
  walk(acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' }), (n) => { if (n.type === 'Identifier') out.add(n.name); });
  return out;
}
function topVars(src) {
  const out = new Set();
  for (const st of acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' }).body) {
    if (st.type === 'VariableDeclaration') st.declarations.forEach((d) => d.id.type === 'Identifier' && out.add(d.id.name));
  }
  return out;
}

const shared = new Set((build.match(/const WORKER_SHARED_CONSTANTS = \[([\s\S]*?)\];/)[1].match(/'([A-Z0-9_a-z]+)'/g) || []).map((s) => s.slice(1, -1)));
const appVars = topVars(app);
const used = identifiers(region(wp, 'WORKER_TWIN_SYNCED'));
// worker の予測ロジックが読む、app.js の可変 state
const needed = [...used].filter((n) => appVars.has(n) && !shared.has(n) && !/^[A-Z][A-Z0-9_]+$/.test(n));

// main が送る値（_syncWorkerState の state オブジェクトの値に出る識別子）
const syncFn = app.slice(app.indexOf('function _syncWorkerState'), app.indexOf('function _syncWorkerState') + 3000);
const sentObj = syncFn.slice(syncFn.indexOf('state: {'), syncFn.indexOf('\n    }\n'));
const sent = new Set([...sentObj.matchAll(/:\s*([A-Za-z_$][\w$]*)\s*,?/g)].map((m) => m[1]));
// worker が受ける変数（_syncState 内で `X = state.` の X）
const recvFn = wjs.slice(wjs.indexOf('function _syncState'), wjs.indexOf('\n}\n', wjs.indexOf('function _syncState')));
const received = new Set([...recvFn.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*state\./g)].map((m) => m[1]));

t('worker の予測ロジックが読む state を集められている（空でない）', () => {
  if (needed.length < 5) throw new Error('needed=' + needed.join(','));
});
t('読む state はすべて main が送り worker が受ける、または WORKER_LOCAL に理由付き', () => {
  const missing = needed.filter((n) => !WORKER_LOCAL[n] && !(sent.has(n) && received.has(n)));
  if (missing.length) {
    throw new Error('未同期: ' + missing.map((n) => n + (sent.has(n) ? '' : '[main が送っていない]') + (received.has(n) ? '' : '[worker が受けていない]')).join(', '));
  }
});
t('WORKER_LOCAL に、もう読まれていない / 同期済みの名前が残っていない', () => {
  const stale = Object.keys(WORKER_LOCAL).filter((n) => !needed.includes(n) || (sent.has(n) && received.has(n)));
  if (stale.length) throw new Error('不要になった WORKER_LOCAL: ' + stale.join(', '));
});

console.log('needed:', needed.sort().join(', '));
console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);
