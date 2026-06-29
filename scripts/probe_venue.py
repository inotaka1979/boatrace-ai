#!/usr/bin/env python3
"""津(9) のオリジナル展示(ajax_yosou)が表示されない原因を切り分けるプローブ。

津は platform A(ajax_yosou)・_OE_VENUES 登録済みで本来 on-demand で動くはず。
実応答を採取し、404/空(展示前)/別ラベル/別エンドポイント/列構成差 のどれかを
切り分ける。Worker 経由(クライアント実経路)も確認。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-tsu.com"
WORKER = "https://boatrace-scrape-trigger.inotaka1979.workers.dev"


def _counts(h):
    return " ".join(f"{m}={h.count(m)}" for m in
                    ("一周", "まわり足", "直線", "周回", "展示", "展示タイム",
                     "table", "waku"))


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    headers = {"Referer": BASE + "/sp/", "X-Requested-With": "XMLHttpRequest"}
    saved = False
    print(f"== 津 ajax_yosou direct (hd={hd}) ==")
    for rno in range(1, 13):
        url = (f"{BASE}/sp/ajax/ajax_yosou.php"
               f"?targetday={hd}&race={rno}&req=cyokuzen&run=0")
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=headers)
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"R{rno} FAIL: {str(e)[:70]}")
            continue
        ths = [re.sub(r"<[^>]+>", "", t).strip()
               for t in re.findall(r"<th[^>]*>.*?</th>", txt, re.S)]
        ths = [t for t in ths if t][:14]
        print(f"R{rno} ({len(raw)}B) {_counts(txt)} ths={ths}")
        if not saved and len(raw) > 200:
            with open(os.path.join(OUTDIR, f"tsu_ajax_R{rno:02d}.html"),
                      "wb") as f:
                f.write(raw)
            print(f"      saved tsu_ajax_R{rno:02d}.html")
            saved = True

    print("== via Worker /orig-exhibition-proxy jcd=9 ==")
    for rno in (1, 2, 3, 6):
        u = f"{WORKER}/orig-exhibition-proxy?jcd=9&race={rno}&hd={hd}"
        try:
            raw = fetch_bytes(u, timeout=15, retries=1)
            txt = raw.decode("utf-8", errors="replace")
            print(f"R{rno} ({len(raw)}B) {_counts(txt)}")
        except Exception as e:
            print(f"R{rno} FAIL: {str(e)[:80]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
