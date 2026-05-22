# Phase 3 (Clearwing patterns): ローカル CI ゲート
#
# 目的: push 前に Raspberry Pi 上で品質を担保する `make gate` を提供。
#
# ターゲット:
#   make install   - npm ci (ローカル開発用、初回 / package.json 変更時)
#   make lint      - ESLint + Prettier check (src/ 限定)
#   make format    - Prettier 自動整形
#   make type      - 型チェック (Phase 4 で本格化、現状は stub)
#   make test      - scripts/tests/run_all.sh (Python + Node + bash)
#   make build     - assets/app.js bundle 注入 + minify + split 反映
#   make gate      - lint + type + test + build:check (= push 前必須)
#   make clean     - node_modules / dist / .cache 削除
#
# 設計:
#   全 npm script を経由 (package.json と二重メンテしない)
#   gate は exit code 非ゼロで即停止し、PR を block する想定

SHELL := /bin/bash

.PHONY: help install lint format type test test-e2e snapshots-update build build-check split gate clean

help:
	@echo "Clearwing local CI gate (BoatRace Oracle)"
	@echo ""
	@echo "  make install           - npm ci (root + build/)"
	@echo "  make lint              - eslint + prettier --check (src/, scripts/tests/)"
	@echo "  make format            - prettier --write (src/)"
	@echo "  make type              - tsc --noEmit -p jsconfig.json (JSDoc strict / Phase 4)"
	@echo "  make test              - bash scripts/tests/run_all.sh"
	@echo "  make test-e2e          - Playwright suite (heavy)"
	@echo "  make snapshots-update  - 期待が変わったら UPDATE_SNAPSHOTS=1 で再生成"
	@echo "  make split             - python3 scripts/split_app.py (critical/rest 再生成)"
	@echo "  make build             - esbuild IIFE inject + minify (canonical app.js)"
	@echo "  make build-check       - --check モードで再現性ガード"
	@echo "  make gate              - lint + type + test + build-check (push 前)"
	@echo "  make clean             - node_modules / dist / .cache を削除"

install:
	npm ci
	cd build && npm ci

lint:
	npm run lint
	npm run format:check

format:
	npm run format

type:
	npm run type

test:
	npm test

test-e2e:
	npm run test:e2e

# Clearwing Phase 5: snapshot 再生成。
#   通常開発で expectation が変わったら本ターゲットで更新 → git diff で内容を確認してから commit。
snapshots-update:
	UPDATE_SNAPSHOTS=1 node scripts/tests/test_snapshots.js

split:
	npm run split

build:
	npm run build

build-check:
	npm run build:check

# Phase 3 のフラッグシップ: ローカルで全件チェック。
# 失敗時の exit code は最初の不通過 step の値。
gate: lint type test build-check
	@echo ""
	@echo "✅ gate passed — safe to push"

clean:
	rm -rf node_modules build/node_modules dist .cache build/playwright-report build/test-results
