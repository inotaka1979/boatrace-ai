#!/usr/bin/env python3
"""桐生(1, kiryu-kyotei.com) のオリジナル展示+ST の実構造を採取するプローブ。

ユーザ提供URL: /sp/?page=yosou-cyokuzen&race=N&run=0 (直前情報=半周/まわり足/直線)。
スタート展示タブに ST。これらが当該URLにインラインか、ajax_cyokuzen.php 経由かを確認し、
表構造(thead/td クラス、半周表記)と ST の所在を採取する。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.kiryu-kyotei.com"


def dump(txt, need):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(txt, "html.parser")
    found = False
    for tbl in soup.find_all("table"):
        t = tbl.get_text()
        if all(k in t for k in need):
            print("    *** TABLE ***")
            for ri, row in enumerate(tbl.find_all("tr")[:9]):
                cells = [("/".join(c.get("class") or [])) + ":" +
                         c.get_text(" ", strip=True)
                         for c in row.find_all(["td", "th"])]
                if cells:
                    print(f"    row{ri}: {cells[:13]}")
            found = True
            break
    return found


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    h = {"Referer": BASE + "/sp/", "X-Requested-With": "XMLHttpRequest"}
    cands = [
        ("cyokuzen_page", f"{BASE}/sp/?page=yosou-cyokuzen&race=8&run=0"),
        ("start_page", f"{BASE}/sp/?page=yosou-start&race=8&run=0"),
        ("sttenji_page", f"{BASE}/sp/?page=yosou-sttenji&race=8&run=0"),
        ("ajax_cyokuzen", f"{BASE}/sp/ajax/ajax_cyokuzen.php"),
    ]
    saved = False
    for name, url in cands:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=h)
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[{name}] FAIL: {str(e)[:55]}")
            continue
        segs = txt.split("<!--sep-->")
        marks = " ".join(f"{m}={txt.count(m)}" for m in
                         ("半周", "一周", "まわり", "直線", "展示タイム", "ST",
                          "スタート展示", "<table"))
        print(f"[{name}] ({len(raw)}B) segs={len(segs)} {marks}")
        if ("半周" in txt) or ("まわり" in txt):
            dump(txt, ["まわり"])
        # ST テーブル(スタート展示)
        if "ST" in txt and ("スタート" in txt):
            dump(txt, ["ST"])
        if not saved and len(raw) > 500:
            with open(os.path.join(OUTDIR, f"kiryu_{name}.html"), "wb") as f:
                f.write(raw)
            print(f"    saved kiryu_{name}.html")
            saved = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
