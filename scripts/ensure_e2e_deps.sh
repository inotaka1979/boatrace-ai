#!/usr/bin/env bash
# FA-8 (2026-08-11): tests/e2e から `@playwright/test` を解決できる状態を保証する。
#
# 背景:
#   Playwright の spec は repo root の tests/e2e/ にあるが、依存は build/node_modules
#   にしか入っていない。Node の ESM 解決は spec ファイルの位置から上方向に
#   node_modules を辿るため、build/ を cwd にして起動しても build/node_modules は
#   探索されず、root に何らかの解決経路が要る。
#
#   CI (.github/workflows/e2e.yml) は root node_modules ごと build/node_modules への
#   symlink にしていたが、ローカルでは `make install` の `npm ci`（root の eslint /
#   prettier / typescript を入れる）が root node_modules を実ディレクトリで作るため、
#   symlink が消えて `make test-e2e` が Cannot find module で落ちていた
#   （= install した直後に e2e が壊れる）。
#
# 対処:
#   root node_modules ごとではなく `node_modules/@playwright` スコープだけを
#   build/node_modules へ向ける。root が実ディレクトリでも共存できる。
#   Node は symlink を realpath へ解決するため、@playwright/test 自身の依存
#   (playwright / playwright-core) は build/node_modules 側から正しく解決される。
#
#   冪等。build 側が未インストールなら何もせず正常終了する。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/build/node_modules/@playwright"
DST="$ROOT/node_modules/@playwright"

if [ ! -d "$SRC" ]; then
  echo "[e2e-deps] build/node_modules/@playwright が無いためスキップ (先に 'cd build && npm ci')"
  exit 0
fi

# root 側に実体（root package.json が直接 @playwright/test を持つ場合）があるなら尊重する
if [ -e "$DST" ] && [ ! -L "$DST" ]; then
  echo "[e2e-deps] root に実体の @playwright があるため何もしません"
  exit 0
fi

mkdir -p "$ROOT/node_modules"
ln -sfn "../build/node_modules/@playwright" "$DST"
echo "[e2e-deps] node_modules/@playwright -> build/node_modules/@playwright ✓"
