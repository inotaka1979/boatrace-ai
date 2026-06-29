#!/usr/bin/env python3
"""住之江(12): 直前情報予想 yoso05{RR}.htm の オリジナル展示テーブルを採取(最終)。

タブバー解析で 直前情報予想 = /asp/kyogi/12/sp/yoso05{RR:02d}.htm と判明
(出走表=syusso10RR, 前日=syusso01RR, 得点率=hayami01RR, オッズ=kekka01RR)。
yoso0505(R5)/yoso0501(R1) を取得し、オリジナル展示(枠/展示/一周/まわり足/直線)の
表構造とサブタブ(スタート展示/オリジナル展示)を確認する。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.boatrace-suminoe.jp"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    from bs4 import BeautifulSoup
    saved = False
    for rno in (5, 1, 2):
        url = f"{BASE}/asp/kyogi/12/sp/yoso05{rno:02d}.htm"
        try:
            raw = fetch_bytes(url, timeout=10, retries=1,
                              headers={"Referer": BASE + "/sp/"})
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[yoso05{rno:02d}] -- {str(e)[:45]}")
            continue
        marks = " ".join(f"{m}={txt.count(m)}" for m in
                         ("オリジナル展示", "スタート展示", "一周", "まわり",
                          "直線", "展示"))
        print(f"[yoso05{rno:02d} R{rno}] ({len(raw)}B) {marks}")
        # サブタブ(スタート展示/オリジナル展示)のリンク
        for a in re.findall(r'<a[^>]+href=[\"\']([^\"\']+)[\"\'][^>]*>([^<]*'
                            r'(?:スタート|オリジナル|展示)[^<]*)</a>', txt):
            print(f"    subtab: {a[1].strip()} -> {a[0]}")
        soup = BeautifulSoup(txt, "html.parser")
        for tbl in soup.find_all("table"):
            t = tbl.get_text()
            if ("一周" in t) and ("まわり" in t):
                print("    *** ORIGINAL EXHIBITION TABLE ***")
                for ri, row in enumerate(tbl.find_all("tr")[:8]):
                    cells = [("/".join(c.get("class") or [])) + ":" +
                             c.get_text(strip=True)
                             for c in row.find_all(["td", "th"])]
                    if cells:
                        print(f"    row{ri}: {cells[:12]}")
                break
        if not saved and len(raw) > 500:
            with open(os.path.join(OUTDIR, f"suminoe_yoso05{rno:02d}.htm"),
                      "wb") as f:
                f.write(raw)
            print(f"    saved suminoe_yoso05{rno:02d}.htm")
            saved = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
