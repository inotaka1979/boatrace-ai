/**
 * 未定義参照の静的検査（2026-11-20）
 *
 * eslint.config.mjs は assets/app.js と worker 2 本を丸ごと ignore していた。過去の重大障害
 * （PJ Phase の _initFeatureStats、11/14・11/19 の worker 未定義参照 22 種、helper の範囲削除）は
 * どれも未定義参照で、この検査で機械的に検出できる。初回実行で、90 秒 poll が typeof guard 付きで
 * 呼ぶ _prefetchLiveOddsForUpcoming が export されておらず、閲覧中の live オッズ継続取得が
 * 一度も動いていなかったことが見つかった。
 *
 *   - assets/app.js        : ブラウザ環境 + app.js 自身のグローバル（build/app_globals.mjs）
 *   - assets/worker*.js    : Worker 環境 + worker 2 本のグローバル
 *   - src/**               : ブラウザ環境 + app.js のグローバル（bundle 先と同じ空間）
 * 許可リストは「意図的に外部・未到達」のものだけ（理由付き）。新しい未定義参照が出たら失敗する。
 *
 *   node scripts/tests/test_no_undef.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import globals from 'globals';
import { appGlobals, workerGlobals } from '../../build/app_globals.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 意図的に未定義のまま参照しているもの（理由を必ず書く）
const ALLOW = {
  app: {
    Chart: 'Chart.js を成績タブ表示時に CDN から動的に読む (PD-13b)。参照は読込後のみ',
  },
  worker: {
    // WORKER_TWIN_SYNCED / 手書きコピーに含まれる main 専用の経路（worker では呼ばれない）
    localStorage: 'calibration の自動選択・API キャッシュ（main 専用経路のコピー）',
    window: 'キャッシュ削除（main 専用経路のコピー）',
    event: 'キャッシュ削除ボタン（main 専用経路のコピー）',
    _appWorkerCallbacks: 'predictRaceAsync（main が worker を呼ぶ経路のコピー）',
    _appWorkerReqId: 'predictRaceAsync（同上）',
    _getAppWorker: 'predictRaceAsync（同上）',
    _getPlattWorker: '_refitPlattCoeffs（main が worker を呼ぶ経路のコピー、typeof guard 付き）',
  },
  src: {
    Chart: 'Chart.js（上記）',
  },
};

let pass = 0, fail = 0;
async function check(label, files, env, extraGlobals, allow) {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.js'],
      languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...env, ...extraGlobals } },
      rules: { 'no-undef': 'error' },
    }],
  });
  const res = await eslint.lintFiles(files);
  const bad = [];
  for (const r of res) {
    for (const m of r.messages) {
      if (m.fatal) { bad.push(path.relative(ROOT, r.filePath) + ': ' + m.message); continue; }
      if (m.ruleId !== 'no-undef') continue;
      const name = (m.message.match(/'([^']+)'/) || [])[1];
      if (allow[name]) continue;
      bad.push(path.relative(ROOT, r.filePath) + ':' + m.line + ' ' + m.message);
    }
  }
  if (bad.length) {
    console.log('  FAIL:', label);
    bad.slice(0, 40).forEach((b) => console.log('     ', b));
    fail++;
  } else {
    console.log('  PASS:', label, '(' + files.length + ' files)');
    pass++;
  }
}

const srcFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') && !/capabilities-worker\.js$/.test(p)) srcFiles.push(path.relative(ROOT, p));
  }
})(path.join(ROOT, 'src'));

const app = appGlobals();
await check('assets/app.js', ['assets/app.js'], globals.browser, app, ALLOW.app);
await check('assets/worker.js + worker_predictor.js', ['assets/worker.js', 'assets/worker_predictor.js'], globals.worker, workerGlobals(), ALLOW.worker);
await check('src/**（app.js のグローバルで）', srcFiles, { ...globals.browser, ...globals.node }, app, ALLOW.src);

// 検査自体が効いていることの確認: 未定義の名前を含むソースは失敗する
{
  const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: true, overrideConfig: [{ files: ['**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser, ...app } }, rules: { 'no-undef': 'error' } }] });
  const [r] = await eslint.lintText('function f(){ return _definitelyNotDefinedAnywhere(); }', { filePath: path.join(ROOT, 'x.js') });
  if (r.messages.some((m) => m.ruleId === 'no-undef')) { console.log('  PASS: 未定義参照を検出できる'); pass++; }
  else { console.log('  FAIL: 未定義参照を検出できない'); fail++; }
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);
