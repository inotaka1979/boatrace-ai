#!/usr/bin/env python3
"""児島(16) round5(最終): yoso05RR.htm を採取し実パーサで解析検証。

round4 で直前情報 = /asp/kyogi/16/sp/yoso05{RR}.htm と判明(タブリンクから)。
住之江と同じ yoso05RR 命名だが、表レイアウトが 住之江型(位置ベース) か
桐生型(col クラス) か未確定のため、両パーサを実走して判定する。
これが通れば実装 PR は「検証済み」で出せる。確認後撤去。
"""
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_orig_exhibition as S  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.kojimaboat.jp"
KYOGI = f"{BASE}/asp/kyogi/16/sp"

IPHONE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 "
             "Mobile/15E148 Safari/604.1")


def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": IPHONE_UA, "Referer": BASE + "/"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", errors="replace")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    for rno in (1, 2, 3, 5):
        url = f"{KYOGI}/yoso05{rno:02d}.htm"
        print(f"\n===== yoso05{rno:02d}: {url} =====")
        try:
            html = fetch(url)
        except Exception as e:
            print(f"  FETCH FAIL: {str(e)[:100]}")
            continue
        print(f"  len={len(html)}")
        hits = [m for m in ("オリジナル展示", "一周", "まわり足", "直線",
                            "展示タイム", "col5-1", "col5_1", "col4", "waku")
                if m in html]
        print(f"  markers: {hits}")
        # thead 断片(レイアウト判定用)
        tm = re.search(r'<thead[^>]*>([\s\S]{0,700})', html)
        if tm:
            print("  thead: " + re.sub(r"\s+", " ", tm.group(1))[:420])
        # 実パーサ検証
        k = S.parse_kiryu_cyokuzen(html, 16, rno)
        print(f"  parse_kiryu: " +
              (f"{len(k['boats'])} boats, has_times={S._has_times(k)}, "
               f"boat1={k['boats'][0]}" if k else "None"))
        try:
            sm = S.parse_suminoe_yoso(html, 16, rno)
            print(f"  parse_suminoe: " +
                  (f"{len(sm['boats'])} boats, has_times={S._has_times(sm)}"
                   if sm else "None"))
        except Exception as e:
            print(f"  parse_suminoe: ERROR {str(e)[:60]}")
        if rno == 1:
            with open(os.path.join(OUTDIR, "kojima5_yoso0501.html"), "w",
                      encoding="utf-8", errors="replace") as f:
                f.write(html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
