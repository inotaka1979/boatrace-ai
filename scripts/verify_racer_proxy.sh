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
#      - 保存した結果から返るか（x-cache: HIT）。HIT が出るまで最大 3 回呼び、応答した Cloudflare の拠点（cf-ray）も残す。
#        Cache API の保存は拠点ごとなので、「同じ拠点で 3 回とも MISS」（効いていない）と「拠点が違った」（判定できない）を
#        区別する。2026-11-25 は 1 回のデプロイで HIT、次のデプロイで MISS → MISS となり、拠点が分からず判別できなかった。
#      - Worker が測った公式サイトの応答時間と、公式サイト自身の計測（Server-Timing の edge / origin）。
#      公式サイトへの取得は、この確認 1 回につき最大 2 選手ページ × 3 回。
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

# ---- 2) 実在の 1 選手で最大 3 回（参考）
header() { # ファイル 名前 → 値（名前の大文字小文字は区別しない、CR 除去。無ければ空）
  [ -f "$1" ] || return 0
  tr -d '\r' < "$1" | awk -v k="$2" 'tolower($0) ~ "^" tolower(k) ":" { sub(/^[^:]*:[ \t]*/, ""); print; exit }'
}
SLOW_SEC=15
call() { # n → "status|x-cache|cache-control|秒|拠点"
  local n="$1" out st sec ray colo
  out=$(first_line "$(curl -sS -m 40 -D "$TMP/h$n" -o "$TMP/b$n" -w "%{http_code} %{time_total}" "$BASE/racer-proxy?toban=$TOBAN" 2>/dev/null || true)" "000 0")
  st="${out%% *}"
  sec=$(LC_ALL=C awk -v s="${out#* }" 'BEGIN { printf "%.1f", s + 0 }')
  # cf-ray: <id>-<拠点 (IATA)>。Cache API の保存は拠点ごとなので、どの拠点が応答したかを残す
  ray="$(header "$TMP/h$n" cf-ray)"
  colo=""
  case "$ray" in *-*) colo="${ray##*-}" ;; esac
  echo "$st|$(header "$TMP/h$n" x-cache)|$(header "$TMP/h$n" cache-control)|$sec|$colo"
}
field() { echo "$1" | cut -d'|' -f"$2"; }
show() { # n 結果
  local c; c="$(field "$2" 5)"
  echo "$1 回目: HTTP $(field "$2" 1) ($(field "$2" 4) 秒) / x-cache: $(field "$2" 2) / 拠点: ${c:-不明} / cache-control: $(field "$2" 3)"
}
r1=$(call 1)
s1="$(field "$r1" 1)"
t1="$(field "$r1" 4)"
show 1 "$r1"
if [ "$s1" != "200" ]; then
  echo "::warning::/racer-proxy は動いているが、公式サイトから取得できなかった (HTTP $s1: $(head -c 200 "$TMP/b1" 2>/dev/null))。公式側の都合のことがある（RUNBOOK §11.1）。デプロイは成功として扱う。"
  exit 0
fi
python3 - "$TMP/b1" "$(field "$r1" 2)" <<'PY' || true
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    print(f"  found={d.get('found')} 出場予定 {len(d.get('schedule') or [])} 件 / 過去 3 節 {len(d.get('back3') or [])} 件 / "
          f"優勝 {len(d.get('wins') or [])} 件 / back3_ok={d.get('back3_ok')}")
    if d.get("found") and not (d.get("schedule") or d.get("back3")):
        print("::warning::選手ページは取れたが、出場予定も過去 3 節も 0 件。公式ページの形が変わった可能性（test_racer_proxy_parse.js のフィクスチャを取り直して確認）。")
    t = d.get("timing")
    if isinstance(t, dict):
        sec = lambda v: "不明" if not isinstance(v, (int, float)) else f"{v / 1000:.1f} 秒"
        # 保存した結果 (HIT) に入っているのは、保存した時点（最大 3 時間前）に測った値
        when = "保存した時点に Worker が測った値" if sys.argv[2:3] == ["HIT"] else "Worker が測った値"
        line = f"  公式サイトの応答（{when}）: profile {sec(t.get('profile_ms'))} / back3 {sec(t.get('back3_ms'))}"
        if isinstance(t.get("edge_ms"), (int, float)) or isinstance(t.get("origin_ms"), (int, float)):
            line += f"（公式サイト自身の計測: 配信側 {sec(t.get('edge_ms'))} / サーバ本体 {sec(t.get('origin_ms'))}）"
        print(line)
except Exception as e:  # noqa: BLE001
    print(f"::warning::/racer-proxy の応答を JSON として読めない: {e}")
PY
if LC_ALL=C awk -v s="$t1" -v lim="$SLOW_SEC" 'BEGIN { exit !(s + 0 > lim) }'; then
  echo "::warning::初回の取得に ${t1} 秒かかった（公式サイトの応答待ち）。アプリが待つのは 25 秒、Worker が公式を待つのは 20 秒まで。続くようなら RUNBOOK §11.1。"
fi
# 保存した結果から返るか。HIT が出るまで 2 回（計 3 回）まで試す
x1="$(field "$r1" 2)"
colos="$(field "$r1" 5)"
all_known=1
[ -n "$(field "$r1" 5)" ] || all_known=0
hit_at=0
[ "$x1" = "HIT" ] && hit_at=1
n=1
while [ "$hit_at" -eq 0 ] && [ "$n" -lt 3 ]; do
  n=$((n + 1))
  sleep 3
  r=$(call "$n")
  show "$n" "$r"
  c="$(field "$r" 5)"
  [ -n "$c" ] || all_known=0
  colos="$colos $c"
  [ "$(field "$r" 2)" = "HIT" ] && hit_at="$n"
done
if [ "$hit_at" -eq 1 ]; then
  echo "✅ edge の保存が効いている (1 回目から保存した結果が返った。3 時間以内に同じ拠点で取得済み)"
elif [ "$hit_at" -gt 1 ]; then
  echo "✅ edge の保存が効いている ($hit_at 回目は公式サイトに取りに行っていない)"
else
  uniq_colos="$(echo $colos | tr ' ' '\n' | sort -u | grep -c . || true)"
  route="$(echo $colos | sed 's/ / → /g')"
  if [ "$all_known" -eq 1 ] && [ "$uniq_colos" -eq 1 ]; then
    echo "::warning::同じ拠点 ($route) で 3 回とも保存した結果が返らなかった。edge の保存 (Cache API) が効いていない可能性が高い。ブラウザ側の保存・アプリ内の 30 分・1 分 30 人の上限で取得は抑えられる（RUNBOOK §11.1）。"
  elif [ "$all_known" -eq 1 ]; then
    echo "::notice::呼び出しごとに Cloudflare の拠点が違った ($route)。保存は拠点ごとなので、この確認では edge の保存を判定できない。"
  else
    echo "::notice::3 回とも保存した結果が返らなかった（応答した拠点は不明）。edge の保存 (Cache API) が効いていない可能性。ブラウザ側の保存・アプリ内の 30 分・1 分 30 人の上限で取得は抑えられる。"
  fi
fi
exit 0
