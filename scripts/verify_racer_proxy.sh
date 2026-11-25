#!/usr/bin/env bash
# Worker の /racer-proxy（選手の今後の出場予定・過去 3 節）がデプロイされ、動いているかを確かめる（2026-11-25）。
#
#   使い方: verify_racer_proxy.sh <Worker の URL> [<確認に使う登録番号>]
#   呼ぶ側: .github/workflows/deploy-worker.yml（デプロイ直後）。手元からも実行できる。
#
# 1) 必須（失敗したら exit 1）: 不正な登録番号に 400 を返すこと。
#      この経路が無い版の Worker は既定の応答（200）を返すので、デプロイされたかどうかを区別できる。
#      登録番号の検証で止まるので、公式サイトには取りに行かない。
# 2) 参考（失敗させない）: 実在の 1 選手を 2 回呼び、次を記録する。
#      - 公式サイトから取れているか（200 + found）。502 / 503 は公式側の都合なので、デプロイの失敗にはしない。
#      - 2 回目が x-cache: HIT か。Cloudflare の Cache API が *.workers.dev で効くかどうかが分かる
#        （効かなくても、ブラウザ側の保存・アプリ内の 30 分・1 分 30 人の上限で取得は抑えられる）。
#      公式サイトへの取得は、この確認 1 回につき最大 2 選手ページ × 2 回。
set -uo pipefail

BASE="${1:-}"
TOBAN="${2:-4320}"
if [ -z "$BASE" ]; then
  echo "usage: verify_racer_proxy.sh <worker url> [toban]" >&2
  exit 2
fi
BASE="${BASE%/}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- 1) 経路がデプロイされていること（最大 3 回。デプロイ直後は古い版が数秒残ることがある）
code=000
for attempt in 1 2 3; do
  code=$(curl -sS -m 15 -o /dev/null -w "%{http_code}" "$BASE/racer-proxy?toban=abc" 2>/dev/null || echo 000)
  [ "$code" = "400" ] && break
  [ "$attempt" -lt 3 ] && sleep 5
done
if [ "$code" != "400" ]; then
  echo "❌ /racer-proxy がデプロイされていない、または応答しない (不正な登録番号に対して HTTP $code、期待は 400)"
  exit 1
fi
echo "✅ /racer-proxy はデプロイ済み (不正な登録番号 → 400)"

# ---- 2) 実在の 1 選手で 2 回（参考）
header() { # ファイル 名前 → 値（名前の大文字小文字は区別しない、CR 除去。無ければ空）
  [ -f "$1" ] || return 0
  tr -d '\r' < "$1" | awk -v k="$2" 'tolower($0) ~ "^" tolower(k) ":" { sub(/^[^:]*:[ \t]*/, ""); print; exit }'
}
call() { # n → "status|x-cache|cache-control"
  local n="$1" st
  st=$(curl -sS -m 30 -D "$TMP/h$n" -o "$TMP/b$n" -w "%{http_code}" "$BASE/racer-proxy?toban=$TOBAN" 2>/dev/null || echo 000)
  echo "$st|$(header "$TMP/h$n" x-cache)|$(header "$TMP/h$n" cache-control)"
}
r1=$(call 1)
s1="${r1%%|*}"
echo "1 回目: HTTP $s1 / x-cache: $(echo "$r1" | cut -d'|' -f2) / cache-control: $(echo "$r1" | cut -d'|' -f3)"
if [ "$s1" != "200" ]; then
  echo "::warning::/racer-proxy は動いているが、公式サイトから取得できなかった (HTTP $s1: $(head -c 200 "$TMP/b1" 2>/dev/null))。公式側の都合のことがある（RUNBOOK §11.1）。デプロイは成功として扱う。"
  exit 0
fi
python3 - "$TMP/b1" <<'PY' || true
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    print(f"  found={d.get('found')} 出場予定 {len(d.get('schedule') or [])} 件 / 過去 3 節 {len(d.get('back3') or [])} 件 / "
          f"優勝 {len(d.get('wins') or [])} 件 / back3_ok={d.get('back3_ok')}")
    if d.get("found") and not (d.get("schedule") or d.get("back3")):
        print("::warning::選手ページは取れたが、出場予定も過去 3 節も 0 件。公式ページの形が変わった可能性（test_racer_proxy_parse.js のフィクスチャを取り直して確認）。")
except Exception as e:  # noqa: BLE001
    print(f"::warning::/racer-proxy の応答を JSON として読めない: {e}")
PY
sleep 3
r2=$(call 2)
x2="$(echo "$r2" | cut -d'|' -f2)"
echo "2 回目: HTTP ${r2%%|*} / x-cache: $x2 / cache-control: $(echo "$r2" | cut -d'|' -f3)"
if [ "$x2" = "HIT" ]; then
  echo "✅ edge の保存が効いている (2 回目は公式サイトに取りに行っていない)"
else
  echo "::notice::2 回目も x-cache: ${x2:-なし}。edge の保存 (Cache API) はこの配置では効いていない可能性。ブラウザ側の保存・アプリ内の 30 分・1 分 30 人の上限で取得は抑えられる。"
fi
exit 0
