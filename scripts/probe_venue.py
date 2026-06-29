#!/usr/bin/env python3
"""大村(omurakyotei.jp) の直前展示テーブルの実URLと構造を採取するプローブ。

getdata2.js: GetLiveContents(dspkbn,day,race) → /include2/iframe_live.php
  ?dspkbn=&liveday=&liverace=。footer に /yosou/chokuzen.php(直前情報)も。
chokuzen.php と iframe_live.php(dspkbn 数種)を叩き、ST/展示/一周/まわり足/直線 の
表を持つ URL と列構造を採取する。確認後撤去。
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://omurakyotei.jp"


def dump(tag, txt):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(txt, "html.parser")
    for tbl in soup.find_all("table"):
        t = tbl.get_text()
        if ("一周" in t) and ("まわり" in t):
            print(f"    *** [{tag}] ORIG TABLE ***")
            for ri, row in enumerate(tbl.find_all("tr")[:8]):
                cells = [("/".join(c.get("class") or [])) + ":" +
                         c.get_text(strip=True)
                         for c in row.find_all(["td", "th"])]
                if cells:
                    print(f"    row{ri}: {cells[:14]}")
            return True
    return False


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    h = {"Referer": BASE + "/yosou/sp/syussou/"}
    saved = False
    cands = [
        f"/yosou/chokuzen.php?day={hd}&race=1",
        f"/yosou/chokuzen.php?race=1",
        "/yosou/chokuzen.php",
        f"/include2/iframe_live.php?dspkbn=2&liveday={hd}&liverace=1",
        f"/include2/iframe_live.php?dspkbn=3&liveday={hd}&liverace=1",
        f"/include2/iframe_live.php?dspkbn=cyokuzen&liveday={hd}&liverace=1",
        f"/include2/iframe_live.php?dspkbn=chokuzen&liveday={hd}&liverace=1",
        f"/include2/iframe_live.php?dspkbn=1&liveday={hd}&liverace=1",
    ]
    for path in cands:
        try:
            raw = fetch_bytes(BASE + path, timeout=10, retries=0, headers=h)
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[{path[:55]}] -- {str(e)[:40]}")
            continue
        marks = " ".join(f"{m}={txt.count(m)}" for m in
                         ("ST", "展示タイム", "一周", "まわり", "直線"))
        print(f"[{path[:55]}] ({len(raw)}B) {marks}")
        got = dump(path, txt)
        if got and not saved:
            import re
            fn = re.sub(r"[^a-z0-9]+", "_", path.split("?")[0].strip("/"))
            with open(os.path.join(OUTDIR, f"omura_{fn}.html"), "wb") as f:
                f.write(raw)
            print(f"    saved omura_{fn}.html")
            saved = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
