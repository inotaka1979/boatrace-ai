#!/usr/bin/env python3
"""住之江(12) の per-race ページ(syusso/tenbo)に オリジナル展示があるか精査。

kyogi_index から /asp/kyogi/12/pc/syusso{NNNN}.htm(出走表 per-race) を発見。
これらのテーブルを全ダンプし、周回展示(一周/まわり足/直線)の有無と構造を確認する。
無ければ tenbo 系 per-race も当たる。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.boatrace-suminoe.jp"


def dump_tables(tag, txt):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(txt, "html.parser")
    tbls = soup.find_all("table")
    print(f"  [{tag}] tables={len(tbls)}")
    for ti, tbl in enumerate(tbls):
        t = tbl.get_text(" ", strip=True)
        if any(k in t for k in ("展示", "一周", "まわり", "ﾏﾜﾘ", "直線",
                                "ﾁﾙﾄ", "ST", "周回", "ﾀｲﾑ", "タイム")):
            print(f"    table{ti}:")
            for row in tbl.find_all("tr")[:9]:
                cells = [c.get_text(strip=True)
                         for c in row.find_all(["td", "th"])]
                cells = [c for c in cells if c]
                if cells:
                    print(f"      {cells[:14]}")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    # kyogi_index から実在が確認された syusso 番号 + 周辺
    files = ["syusso1003", "syusso1005", "syusso1010", "syusso1012",
             "tenbo1003", "tenbo1005", "syuukai1003", "syukai1003",
             "today_syusso_detail"]
    saved = False
    for name in files:
        url = f"{BASE}/asp/kyogi/12/pc/{name}.htm"
        try:
            raw = fetch_bytes(url, timeout=10, retries=0,
                              headers={"Referer": BASE + "/"})
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[{name}] -- {str(e)[:45]}")
            continue
        marks = " ".join(f"{m}={txt.count(m)}" for m in
                         ("一周", "まわり", "ﾏﾜﾘ", "直線", "周回", "展示", "ﾀｲﾑ"))
        print(f"[{name}] ({len(raw)}B) {marks}")
        dump_tables(name, txt)
        if not saved and len(raw) > 500:
            with open(os.path.join(OUTDIR, f"suminoe_{name}.html"), "wb") as f:
                f.write(raw)
            print(f"    saved suminoe_{name}.html")
            saved = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
