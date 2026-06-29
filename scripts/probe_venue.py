#!/usr/bin/env python3
"""宮島(17) は住之江と同じ boatcast/ASP ベンダー。yoso05{RR}.htm を確認するプローブ。

スクショで宮島 SP のタブ(出走表/選手コメント前日予想/スタート展示周回タイム/枠番別/
得点率/結果, サブタブ=オリジナル展示タイム, 列=枠/体重/チルト/展示/一周/まわり足/直線)が
住之江と同型と判明。住之江は /asp/kyogi/12/sp/yoso05{RR}.htm だった。宮島(17)も
/asp/kyogi/17/sp/yoso05{RR}.htm か確認し、表構造を採取。違えば /sp/ iframe を辿る。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.boatrace-miyajima.com"


def dump(txt):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(txt, "html.parser")
    for tbl in soup.find_all("table"):
        t = tbl.get_text()
        if ("一周" in t) and ("まわり" in t):
            print("    *** ORIG TABLE ***")
            for ri, row in enumerate(tbl.find_all("tr")[:8]):
                cells = [("/".join(c.get("class") or [])) + ":" +
                         c.get_text(strip=True)
                         for c in row.find_all(["td", "th"])]
                if cells:
                    print(f"    row{ri}: {cells[:13]}")
            return True
    return False


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    saved = False
    # 1) 住之江同型 yoso05{RR}.htm を試す(スクショ=12R)
    print("== miyajima /asp/kyogi/17/sp/yoso05RR ==")
    for rno in (12, 1, 2):
        url = f"{BASE}/asp/kyogi/17/sp/yoso05{rno:02d}.htm"
        try:
            raw = fetch_bytes(url, timeout=10, retries=0,
                              headers={"Referer": BASE + "/sp/"})
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[yoso05{rno:02d}] -- {str(e)[:45]}")
            continue
        marks = " ".join(f"{m}={txt.count(m)}" for m in
                         ("オリジナル展示", "一周", "まわり", "直線", "展示"))
        print(f"[yoso05{rno:02d} R{rno}] ({len(raw)}B) {marks}")
        if dump(txt) and not saved:
            with open(os.path.join(OUTDIR, f"miyajima_yoso05{rno:02d}.htm"),
                      "wb") as f:
                f.write(raw)
            print(f"    saved miyajima_yoso05{rno:02d}.htm")
            saved = True

    # 2) ダメなら /sp/ の iframe src と内部タブバーを辿る
    if not saved:
        print("== miyajima /sp/ iframe discovery ==")
        try:
            raw = fetch_bytes(BASE + "/sp/", timeout=12, retries=1,
                              headers={"Referer": BASE + "/"})
            txt = raw.decode("utf-8", errors="replace")
            for m in re.finditer(r'<iframe[^>]+src=[\"\']([^\"\']+)[\"\']', txt):
                print("   iframe:", m.group(1))
            for u in sorted(set(re.findall(
                    r'/asp/kyogi/\d+/sp/[a-z0-9_]+\.htm', txt)))[:15]:
                print("   asp:", u)
            with open(os.path.join(OUTDIR, "miyajima_sp.html"), "wb") as f:
                f.write(raw)
        except Exception as e:
            print(f"[/sp/] FAIL: {str(e)[:55]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
