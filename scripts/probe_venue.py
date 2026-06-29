#!/usr/bin/env python3
"""住之江(12) の SP iframe /asp/kyogi/12/sp/syusso{NNNN}.htm を採取するプローブ。

/sp/ の iframe src が /asp/kyogi/12/sp/syusso1005.htm(=5R)。PC index は
syusso1003/1005/1010/1012(=R3/5/10/12)→ 規則は syusso{1000+RR} と推定。
R1..R6 を取得して規則検証＋オリジナル展示(枠/展示/一周/まわり足/直線)の表構造を採取。
確認後撤去。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.boatrace-suminoe.jp"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    from bs4 import BeautifulSoup
    saved = False
    for rno in range(1, 7):
        num = 1000 + rno
        url = f"{BASE}/asp/kyogi/12/sp/syusso{num}.htm"
        try:
            raw = fetch_bytes(url, timeout=10, retries=0,
                              headers={"Referer": BASE + "/sp/"})
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[syusso{num} R{rno}] -- {str(e)[:45]}")
            continue
        marks = " ".join(f"{m}={txt.count(m)}" for m in
                         ("オリジナル展示", "一周", "まわり", "直線", "展示",
                          "R", "レース"))
        # ページが示すレース番号(タイトル等)を確認
        soup = BeautifulSoup(txt, "html.parser")
        print(f"[syusso{num} R{rno}] ({len(raw)}B) {marks}")
        for tbl in soup.find_all("table"):
            t = tbl.get_text()
            if ("一周" in t) and ("まわり" in t):
                for ri, row in enumerate(tbl.find_all("tr")[:8]):
                    cells = [("/".join(td.get("class") or [])) + ":" +
                             td.get_text(strip=True)
                             for td in row.find_all(["td", "th"])]
                    if cells:
                        print(f"    row{ri}: {cells[:12]}")
                break
        if not saved and ("一周" in txt) and ("まわり" in txt):
            with open(os.path.join(OUTDIR, f"suminoe_syusso{num}.htm"),
                      "wb") as f:
                f.write(raw)
            print(f"    saved suminoe_syusso{num}.htm")
            saved = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
