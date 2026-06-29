#!/usr/bin/env python3
"""びわこ(11) のオリジナル展示(kind=2)の表構造を採取するプローブ。

びわこの直前ページはタブ式で、オリジナル展示は
  /modules/yosou/cyokuzen.php?day=YYYYMMDD&race=N&if=0&kind=2
にある(kind=0直前情報/1スタート展示/2オリジナル展示)。この kind=2 の
thead と各行(td クラス:値)を採取してパーサ実装に使う。確認後撤去。
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-biwako.jp"
KW = ("オリジナル展示", "一周", "半周", "まわり足", "直線", "周回", "展示タイム",
      "展示", "<table", "<th")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    from bs4 import BeautifulSoup
    saved = False
    for race in (1, 2, 3, 4):
        url = (f"{BASE}/modules/yosou/cyokuzen.php"
               f"?day={hd}&race={race}&if=0&kind=2")
        try:
            raw = fetch_bytes(url, timeout=12, retries=1,
                              headers={"Referer": BASE + "/"})
            txt = raw.decode("utf-8", errors="replace")
            marks = " ".join(f"{m}={txt.count(m)}" for m in KW)
            print(f"[R{race} kind=2] ({len(raw)}B) {marks}")
            soup = BeautifulSoup(txt, "html.parser")
            for ti, tbl in enumerate(soup.find_all("table")):
                t = tbl.get_text()
                if ("まわり足" in t) or ("一周" in t) or ("直線" in t):
                    ths = [th.get_text(strip=True) for th in tbl.find_all("th")]
                    print(f"    table{ti} THEAD: {ths}")
                    for ri, row in enumerate(tbl.find_all("tr")[:9]):
                        cells = []
                        for td in row.find_all(["td", "th"]):
                            cls = "/".join(td.get("class") or [])
                            cells.append(f"{cls}:{td.get_text(strip=True)}")
                        if cells:
                            print(f"    row{ri}: {cells[:12]}")
            if not saved and len(raw) > 500:
                p = os.path.join(OUTDIR, f"biwako_cyokuzen_kind2_R{race:02d}.html")
                with open(p, "wb") as f:
                    f.write(raw)
                print(f"    saved {p}")
                saved = True
        except Exception as e:
            print(f"[R{race} kind=2] FAIL: {str(e)[:70]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
