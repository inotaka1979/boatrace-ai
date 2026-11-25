#!/usr/bin/env bash
# 意図して見た目を変えた VRT スナップショットの申告を読む（2026-11-25）。
#
# 背景:
#   VRT は「commit 済みの PNG」と現在の描画を比べるだけなので、意図した UI 変更でも赤くなる。
#   baseline は CI 上でしか撮り直せない（フォントが手元と違う。docs/RUNBOOK.md §10）ため、
#   これまでは「マージ後に Actions の画面から E2E を手動実行する」運用で、忘れると main の VRT が
#   赤いまま放置された（2026-05〜08 に 3 か月。CLAUDE.md FA-9）。
#
# しくみ:
#   見た目を変える PR は tests/e2e/vrt-baseline-request に、変わるのが正しいテストのタイトル
#   （Playwright の --grep に渡す正規表現）を 1 行に 1 つ書く。このスクリプトは、今回のイベント
#   （PR / main への push）でそのファイルが変更されていたときだけ、行を "|" でつないで出力する。
#   .github/workflows/e2e.yml が受け取り、
#     - vrt ジョブ: 申告されたテストは比較せず撮り直し、それ以外は通常どおり比較する
#     - update-snapshots ジョブ: main への push なら baseline を撮り直して commit する
#   ファイルが変更されていなければ何も出力しない（= 従来どおり全テストを比較）。
#
# 使い方: vrt_request.sh <event_name> [<push の before SHA>]
#   pull_request … checkout は base と PR head の merge commit。第 1 親 (= base) との差分を見る
#                  （actions/checkout に fetch-depth: 2 が必要）
#   push         … before..HEAD の差分を見る（before が手元に無ければ取りに行く）
#   判定できないときは何も出力しない（厳しい側 = 全テスト比較に倒す）。
set -uo pipefail

FILE="tests/e2e/vrt-baseline-request"
event="${1:-}"
before="${2:-}"

changed_files() {
  case "$event" in
    pull_request)
      git diff --name-only HEAD^1 HEAD 2>/dev/null || true
      ;;
    push)
      # 新規ブランチの push は before が 0000…（比べる相手が無い）
      if [ -z "$before" ] || [[ "$before" =~ ^0+$ ]]; then return 0; fi
      if ! git cat-file -e "${before}^{commit}" 2>/dev/null; then
        git fetch --no-tags --depth=1 origin "$before" >/dev/null 2>&1 || return 0
      fi
      git diff --name-only "$before" HEAD 2>/dev/null || true
      ;;
  esac
}

if [ -f "$FILE" ] && changed_files | grep -qxF "$FILE"; then
  # コメント行と空行を除き、行末の空白を落として "|" でつなぐ
  grep -v '^[[:space:]]*#' "$FILE" | sed 's/[[:space:]]*$//' | grep -v '^$' | paste -sd'|' - || true
fi
