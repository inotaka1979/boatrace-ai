#!/usr/bin/env node
// =============================================================================
// build.mjs — BoatRace Oracle ビルドスクリプト雛形 (PC-7b)
//
// 段階導入計画 (build/README.md §段階導入):
//   Step 1: 雛形のみ（このスクリプトは現行 index.html の SHA-256 と SRI を表示するだけ）
//   Step 2: src/utils/* を esbuild で IIFE bundle → index.html の <script> 部分のみ置換
//   Step 3: src/predictor/* も同様に
//   Step 4: src/ui/* も同様に
//   Step 5: CSP nonce 自動付与 + 'unsafe-inline' 撤去
//
// 現状（Step 1）の動作:
//   - index.html の検証 (SHA-256 と inline JS 構文チェック)
//   - manifest.json / sw.js の構文検証
//   - 配布物の整合性レポート
//
// 使い方:
//   cd build && npm install && npm run build
// =============================================================================

import { readFile, writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function sha256(path) {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function sriHash(path) {
  const buf = await readFile(path);
  return 'sha384-' + createHash('sha384').update(buf).digest('base64');
}

async function checkJsSyntax(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).join('\n;\n');
  const tmp = await mkdtemp(join(tmpdir(), 'br-build-'));
  const path = join(tmp, 'inline.js');
  await writeFile(path, "'use strict';" + scripts);
  return new Promise((res) => {
    const proc = spawn('node', ['--check', path], { stdio: ['ignore','pipe','pipe'] });
    let err = '';
    proc.stderr.on('data', d => err += d);
    proc.on('exit', async (code) => {
      try { await unlink(path); } catch (_) {}
      res({ ok: code === 0, err });
    });
  });
}

async function main() {
  console.log('=== BoatRace Oracle Build Scaffold (PC-7b Step 1) ===\n');

  const indexPath = resolve(ROOT, 'index.html');
  const swPath = resolve(ROOT, 'sw.js');
  const manifestPath = resolve(ROOT, 'manifest.json');

  // 1) Hash report
  console.log('[hash] index.html  SHA-256:', (await sha256(indexPath)).slice(0,16) + '...');
  console.log('[hash] sw.js       SHA-256:', (await sha256(swPath)).slice(0,16) + '...');
  console.log('[hash] manifest.json SHA-256:', (await sha256(manifestPath)).slice(0,16) + '...');
  console.log('');

  // 2) JS 構文チェック (inline script)
  const html = await readFile(indexPath, 'utf8');
  const syntax = await checkJsSyntax(html);
  if (syntax.ok) {
    console.log('[syntax] inline <script> OK');
  } else {
    console.error('[syntax] FAILED:\n', syntax.err);
    process.exit(1);
  }

  // 3) manifest.json 構文
  try {
    JSON.parse(await readFile(manifestPath, 'utf8'));
    console.log('[syntax] manifest.json OK');
  } catch (e) {
    console.error('[syntax] manifest.json FAILED:', e.message);
    process.exit(1);
  }

  // 4) sw.js syntax
  const swSyntax = await new Promise((res) => {
    const proc = spawn('node', ['--check', swPath], { stdio: ['ignore','pipe','pipe'] });
    let err = '';
    proc.stderr.on('data', d => err += d);
    proc.on('exit', code => res({ ok: code === 0, err }));
  });
  if (swSyntax.ok) {
    console.log('[syntax] sw.js OK');
  } else {
    console.error('[syntax] sw.js FAILED:\n', swSyntax.err);
    process.exit(1);
  }

  console.log('');
  console.log('Build scaffold complete (no transform applied at Step 1).');
  console.log('Next: install esbuild and migrate src/utils/* (build/README.md §Step 2).');
}

main().catch((e) => { console.error(e); process.exit(1); });
