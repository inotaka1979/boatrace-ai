#!/usr/bin/env bash
# Worker の Web Push（お気に入り選手の締切前通知）がデプロイされ、動いているかを確かめる（2026-11-27）。
#
#   使い方: verify_push.sh <Worker の URL>            … 登録口と暗号の確認（数秒）
#           verify_push.sh <Worker の URL> --cron [秒] … 毎分の cron が動いている記録を待つ（既定 180 秒）
#   呼ぶ側: .github/workflows/deploy-worker.yml（デプロイ直後）。手元からも実行できる。
#
# 開発環境からは workers.dev にも実機にも届かないので、デプロイのたびにここで確かめる。
# 実際の端末への配達（Apple / Google の push service 経由）は、ここでは確かめられない。
#   それはアプリの設定「閉じている間も通知」→「テスト通知」で確かめる。
#
# 登録口と暗号（1 つでも違えば exit 1）:
#   1) GET  /push/selftest  → 200 {"ok":true}
#        Worker の実行環境の暗号が、標準仕様 (RFC 8291) の例と同じ本文を作ること。
#        この経路が無い版の Worker は別の応答を返すので、デプロイされたかどうかも分かる。
#   2) GET  /push/key を 2 回 → 同じ鍵（87 文字）。最初の呼出で鍵が作られ、KV に置かれる。
#   3) POST /push/subscribe に、決まった push service 以外の宛先 → 400 bad_endpoint（何も保存しない）
#   4) POST /push/test に、登録の無い宛先 → 404 not_registered（何も送らない）
# 毎分の cron（--cron。失敗させず warning にする）:
#   GET /push/status の tick_at が入るまで待つ。記録は 6 時間に 1 回なので、6 時間 + 5 分以内なら動いている。
set -uo pipefail

BASE="${1:-}"
MODE="${2:-}"
if [ -z "$BASE" ]; then
  echo "usage: verify_push.sh <worker url> [--cron [max wait sec]]" >&2
  exit 2
fi
BASE="${BASE%/}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

first_line() { local v="${1%%$'\n'*}"; echo "${v:-$2}"; }
# 応答の JSON から 1 項目を取り出す（無ければ空。真偽値は true / false、null は空）
field() { # ファイル キー
  python3 - "$1" "$2" <<'PY' 2>/dev/null || true
import json, sys
try:
    v = json.load(open(sys.argv[1], encoding="utf-8")).get(sys.argv[2])
except Exception:
    v = None
print("" if v is None else ("true" if v is True else "false" if v is False else v))
PY
}
get() { # path 出力ファイル → HTTP ステータス
  first_line "$(curl -sS -m 20 -o "$2" -w "%{http_code}" "$BASE$1" 2>/dev/null || true)" 000
}
post() { # path 本文 出力ファイル → HTTP ステータス
  first_line "$(curl -sS -m 20 -o "$3" -w "%{http_code}" -X POST -H "content-type: text/plain;charset=UTF-8" --data "$2" "$BASE$1" 2>/dev/null || true)" 000
}

if [ "$MODE" = "--cron" ]; then
  MAX_WAIT="${3:-180}"
  ALIVE_SEC=$((6 * 3600 + 300))
  waited=0
  while :; do
    code=$(get /push/status "$TMP/st")
    tick="$(field "$TMP/st" tick_at)"
    age="$(field "$TMP/st" tick_age_sec)"
    echo "[${waited}s] HTTP $code tick_at=${tick:-なし} tick_age_sec=${age:-なし} subs=$(field "$TMP/st" subs) index_races=$(field "$TMP/st" index_races) sent_today=$(field "$TMP/st" sent_today)"
    if [ "$code" = "200" ] && [ -n "$tick" ] && [ -n "$age" ] && [ "$age" -ge 0 ] 2>/dev/null && [ "$age" -le "$ALIVE_SEC" ] 2>/dev/null; then
      echo "✅ 毎分の cron が動いている（最後の記録 $tick、記録は 6 時間に 1 回）"
      if [ "$(field "$TMP/st" index_races)" = "0" ]; then
        echo "::notice::締切の索引 (push:index) がまだありません。データ更新の cron が番組表を書くと作られます（日中 5 分毎・夜間 30 分毎）。"
      fi
      exit 0
    fi
    if [ "$waited" -ge "$MAX_WAIT" ]; then
      echo "::warning::毎分の cron（締切前通知の確認）の記録を ${MAX_WAIT} 秒以内に確認できませんでした (HTTP $code tick_at=${tick:-なし})。Cloudflare 側の反映が遅れている可能性があります。続く場合は Cloudflare dashboard → boatrace-scrape-trigger → Settings → Triggers に「* * * * *」があるかを確認してください。"
      exit 0
    fi
    sleep 15
    waited=$((waited + 15))
  done
fi

fail=0
# ---- 1) 経路がデプロイされ、暗号が仕様の例と一致すること（デプロイ直後は古い版が数秒残ることがある）
code=000
ok=""
for attempt in 1 2 3; do
  code=$(get /push/selftest "$TMP/self")
  ok="$(field "$TMP/self" ok)"
  [ "$code" = "200" ] && [ "$ok" = "true" ] && break
  [ "$attempt" -lt 3 ] && sleep 5
done
if [ "$code" = "200" ] && [ "$ok" = "true" ]; then
  echo "✅ /push/selftest: 実行環境の暗号が RFC 8291 の例と一致"
else
  echo "❌ /push/selftest が通らない (HTTP $code ok=${ok:-なし} error=$(field "$TMP/self" error))。Web Push がデプロイされていないか、実行環境の暗号が仕様と違う"
  fail=1
fi

# ---- 2) 送信元の鍵
c1=$(get /push/key "$TMP/k1")
k1="$(field "$TMP/k1" key)"
c2=$(get /push/key "$TMP/k2")
k2="$(field "$TMP/k2" key)"
if [ "$c1" = "200" ] && [ "$c2" = "200" ] && [ "${#k1}" = "87" ] && [ "$k1" = "$k2" ]; then
  echo "✅ /push/key: 鍵がある（2 回とも同じ鍵）"
else
  echo "❌ /push/key が期待と違う (1 回目 HTTP $c1 長さ ${#k1} / 2 回目 HTTP $c2 長さ ${#k2} / 同じ鍵か: $([ -n "$k1" ] && [ "$k1" = "$k2" ] && echo はい || echo いいえ))"
  fail=1
fi

# ---- 3) 決まった push service 以外の宛先は受け付けない（何も保存しない）
BAD_SUB='{"sub":{"endpoint":"https://push-check.invalid/not-a-push-service/0000","keys":{"p256dh":"x","auth":"x"}},"favs":[],"lead":5}'
c=$(post /push/subscribe "$BAD_SUB" "$TMP/sub")
e="$(field "$TMP/sub" error)"
if [ "$c" = "400" ] && [ "$e" = "bad_endpoint" ]; then
  echo "✅ /push/subscribe: 決まった push service 以外の宛先は断る (400 bad_endpoint)"
else
  echo "❌ /push/subscribe が期待と違う (HTTP $c error=${e:-なし}、期待は 400 bad_endpoint)"
  fail=1
fi

# ---- 4) 登録の無い宛先にはテスト通知を送らない
c=$(post /push/test '{"endpoint":"https://fcm.googleapis.com/fcm/send/deploy-check-not-registered"}' "$TMP/test")
e="$(field "$TMP/test" error)"
if [ "$c" = "404" ] && [ "$e" = "not_registered" ]; then
  echo "✅ /push/test: 登録の無い宛先には送らない (404 not_registered)"
else
  echo "❌ /push/test が期待と違う (HTTP $c error=${e:-なし}、期待は 404 not_registered)"
  fail=1
fi

# ---- 参考: いまの状態
c=$(get /push/status "$TMP/st")
echo "状態: HTTP $c 宛先 $(field "$TMP/st" subs) 件 / 索引 $(field "$TMP/st" index_races) レース / 今日送った数 $(field "$TMP/st" sent_today) / 毎分の cron の記録 $(field "$TMP/st" tick_at)"
# KV の書込（本体のデータ更新と共用の 1 日 1,000 回）を通知が使い切らないための上限。届いていたら知らせる（失敗にはしない）
sw="$(field "$TMP/st" subs_writes_today)"
swmax="$(field "$TMP/st" max_subs_writes)"
rw="$(field "$TMP/st" sent_writes_today)"
rwmax="$(field "$TMP/st" max_sent_writes)"
echo "今日の KV 書込: 宛先の文書 ${sw:-?}/${swmax:-?} 回・送った記録 ${rw:-?}/${rwmax:-?} 回"
if [ -n "$sw" ] && [ -n "$swmax" ] && [ "$sw" -ge "$swmax" ] 2>/dev/null; then
  echo "::warning::通知の宛先の書込が今日の上限 (${swmax} 回) に達しています。登録・変更は日本時間の 9 時まで受け付けません。心当たりが無ければ docs/RUNBOOK.md §12.4（預かっている宛先を消す）。"
fi
if [ -n "$rw" ] && [ -n "$rwmax" ] && [ "$rw" -ge "$rwmax" ] 2>/dev/null; then
  echo "::warning::通知の「送った記録」の書込が今日の上限 (${rwmax} 回) に達しています。今日は締切前ちょうどの回の通知だけを送ります（拾い直しなし）。"
fi
exit "$fail"
