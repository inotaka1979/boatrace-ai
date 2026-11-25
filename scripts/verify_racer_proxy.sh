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
#      - 取得にかかった秒数。edge に無い選手の初回取得は公式サイトの応答待ちで長くなる（本番で 10.9 秒を実測）。
#        アプリが待つのは 25 秒、Worker が公式を待つのは 20 秒まで。15 秒を超えたら warning。
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
# curl は失敗しても -w の内容（http_code は 000）を出力する。念のため 1 行目だけ使い、空なら 000 にする
first_line() { local v="${1%%$'\n'*}"; echo "${v:-$2}"; }
code=000
for attempt in 1 2 3; do
  code=$(first_line "$(curl -sS -m 15 -o /dev/null -w "%{http_code}" "$BASE/racer-proxy?toban=abc" 2>/dev/null || true)" 000)
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
SLOW_SEC=15
call() { # n → "status|x-cache|cache-control|秒"
  local n="$1" out st sec
  out=$(first_line "$(curl -sS -m 40 -D "$TMP/h$n" -o "$TMP/b$n" -w "%{http_code} %{time_total}" "$BASE/racer-proxy?toban=$TOBAN" 2>/dev/null || true)" "000 0")
  st="${out%% *}"
  sec=$(LC_ALL=C awk -v s="${out#* }" 'BEGIN { printf "%.1f", s + 0 }')
  echo "$st|$(header "$TMP/h$n" x-cache)|$(header "$TMP/h$n" cache-control)|$sec"
}
field() { echo "$1" | cut -d'|' -f"$2"; }
r1=$(call 1)
s1="$(field "$r1" 1)"
t1="$(field "$r1" 4)"
echo "1 回目: HTTP $s1 (${t1} 秒) / x-cache: $(field "$r1" 2) / cache-control: $(field "$r1" 3)"
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
if LC_ALL=C awk -v s="$t1" -v lim="$SLOW_SEC" 'BEGIN { exit !(s + 0 > lim) }'; then
  echo "::warning::初回の取得に ${t1} 秒かかった（公式サイトの応答待ち）。アプリが待つのは 25 秒、Worker が公式を待つのは 20 秒まで。続くようなら RUNBOOK §11.1。"
fi
sleep 3
r2=$(call 2)
x2="$(field "$r2" 2)"
echo "2 回目: HTTP $(field "$r2" 1) ($(field "$r2" 4) 秒) / x-cache: $x2 / cache-control: $(field "$r2" 3)"
if [ "$x2" = "HIT" ]; then
  echo "✅ edge の保存が効いている (2 回目は公式サイトに取りに行っていない)"
else
  echo "::notice::2 回目も x-cache: ${x2:-なし}。edge の保存 (Cache API) はこの配置では効いていない可能性。ブラウザ側の保存・アプリ内の 30 分・1 分 30 人の上限で取得は抑えられる。"
fi
exit 0
