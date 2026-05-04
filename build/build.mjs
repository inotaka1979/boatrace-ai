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
  const modules = [
    { marker: 'SAFE_STORAGE', src: 'utils/safe_storage.js' },
    { marker: 'MATH',         src: 'utils/math.js' },
  ];
  let beforeApp = await readFile(appJsPath, 'utf8');
  let currentApp = beforeApp;
  for (const m of modules) {
    console.log('[bundle] src/' + m.src + ' ...');
    const code = await bundleModule(resolve(SRC, m.src));
    console.log('  -> ' + code.length + ' chars (marker: ' + m.marker + ')');
    currentApp = injectBundle(currentApp, m.marker, code);
  }
  const afterApp = currentApp;

  if (CHECK_MODE) {
    if (beforeApp !== afterApp) {
      console.error('[check] assets/app.js differs from build output. Run "npm run build" and commit.');
      process.exit(1);
    }
    console.log('[check] assets/app.js matches build output ✓');
  } else if (beforeApp !== afterApp) {
    await writeFile(appJsPath, afterApp);
    console.log('[write] assets/app.js updated');
  } else {
    console.log('[no-op] assets/app.js already up-to-date');
  }

  // 2b) PE-6: assets/app.js を minify → assets/app.min.js (本番配信用)
  //         配信物のみ最小化、tests / debug は assets/app.js (可読版) を参照
  const appMinPath = resolve(ROOT, 'assets/app.min.js');
  const minifyResult = await esbuild({
    entryPoints: [appJsPath],
    bundle: false,        // 既に統合済 (1 ファイル)
    minify: true,
    target: 'es2020',
    legalComments: 'none',
    sourcemap: false,
    write: false,
  });
  const minBefore = await readFile(appMinPath, 'utf8').catch(() => '');
  const minAfter = minifyResult.outputFiles[0].text;
  const minRatio = ((1 - minAfter.length / afterApp.length) * 100).toFixed(1);

  if (CHECK_MODE) {
    if (minBefore !== minAfter) {
      console.error('[check] assets/app.min.js differs from build output');
      process.exit(1);
    }
    console.log('[check] assets/app.min.js matches build output ✓');
  } else if (minBefore !== minAfter) {
    await writeFile(appMinPath, minAfter);
    console.log('[write] assets/app.min.js updated (' + afterApp.length + ' → ' +
                minAfter.length + ' chars, -' + minRatio + '%)');
  } else {
    console.log('[no-op] assets/app.min.js already up-to-date');
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
