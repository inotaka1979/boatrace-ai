#!/usr/bin/env python3
"""徳山(18) の ajax_yosou 応答を診断するプローブ(三国は表示OK、徳山のみ不可)。

徳山は ajax_yosou 登録済みだが today.json に一度も出ていない。開催中の今、
{base}/sp/ajax/ajax_yosou.php?targetday=&race=&req=cyokuzen&run=0 の実応答を採取し、
404/空/別ラベル/別エンドポイントのどれかを切り分ける。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-tokuyama.jp"


def _counts(h):
    return " ".join(f"{m}={h.count(m)}" for m in
                    ("一周", "まわり足", "直線", "周回", "展示", "table"))


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    headers = {"Referer": BASE + "/sp/", "X-Requested-With": "XMLHttpRequest"}
    saved = False
    for rno in (1, 2, 3, 4, 5, 6, 7, 8):
        url = (f"{BASE}/sp/ajax/ajax_yosou.php"
               f"?targetday={hd}&race={rno}&req=cyokuzen&run=0")
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=headers)
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"R{rno} FAIL: {str(e)[:70]}")
            continue
        # th ラベルを表示
        ths = [re.sub(r"<[^>]+>", "", t).strip()
               for t in re.findall(r"<th[^>]*>.*?</th>", txt, re.S)]
        ths = [t for t in ths if t][:14]
        print(f"R{rno} ({len(raw)}B) {_counts(txt)} ths={ths}")
        if not saved and len(raw) > 200:
            p = os.path.join(OUTDIR, f"tokuyama_ajax_R{rno:02d}.html")
            with open(p, "wb") as f:
                f.write(raw)
            print(f"      saved {p}")
            saved = True
    # 別エンドポイント候補(徳山が ajax_cyokuzen 系の可能性)も確認
    for alt in ("/sp/ajax/ajax_cyokuzen.php", "/sp/index.php?page=yosou-cyokuzen"):
        try:
            raw = fetch_bytes(BASE + alt, timeout=10, retries=1, headers=headers)
            txt = raw.decode("utf-8", errors="replace")
            print(f"ALT {alt} ({len(raw)}B) {_counts(txt)}")
        except Exception as e:
            print(f"ALT {alt} FAIL: {str(e)[:50]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
