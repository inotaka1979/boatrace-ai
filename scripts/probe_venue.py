#!/usr/bin/env python3
"""津(9) の req=sttenji(展示情報=スタート展示/オリジナル展示)を採取するプローブ。

yosou-yosou ページのタブ data-req は syussou/cyokuzen/sttenji/waku10/.../result。
「展示情報」= req=sttenji と判明。この応答に オリジナル展示(一周/まわり足/直線)が
含まれるか、含む場合の表構造(thead/td クラス)を採取する。さらにサブタブの
data-req があれば拾う。確認後撤去。
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


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    h_ajax = {"Referer": BASE + "/sp/index.php?page=yosou-yosou",
              "X-Requested-With": "XMLHttpRequest"}
    from bs4 import BeautifulSoup
    for req in ("sttenji", "cyokuzen"):
        for race in (1, 2):
            url = (f"{BASE}/sp/ajax/ajax_yosou.php"
                   f"?targetday={hd}&race={race}&req={req}&run=0")
            try:
                raw = fetch_bytes(url, timeout=12, retries=1, headers=h_ajax)
                txt = raw.decode("utf-8", errors="replace")
            except Exception as e:
                print(f"[{req} R{race}] FAIL: {str(e)[:60]}")
                continue
            kw = {k: txt.count(k) for k in
                  ("オリジナル展示", "一周", "まわり足", "直線", "展示タイム",
                   "スタート展示")}
            subreq = sorted(set(re.findall(r'data-(?:req|tab|kind)=[\"\']'
                                           r'([^\"\']+)[\"\']', txt)))
            print(f"[{req} R{race}] ({len(raw)}B) {kw} sub={subreq}")
            soup = BeautifulSoup(txt, "html.parser")
            for tbl in soup.find_all("table"):
                t = tbl.get_text()
                if ("一周" in t) and ("まわり足" in t):
                    ths = [th.get_text(strip=True) for th in tbl.find_all("th")]
                    print(f"    THEAD: {ths}")
                    for ri, row in enumerate(tbl.find_all("tr")[:5]):
                        cells = [("/".join(td.get("class") or [])) + ":" +
                                 td.get_text(strip=True)
                                 for td in row.find_all(["td", "th"])]
                        if cells:
                            print(f"    row{ri}: {cells[:10]}")
            if req == "sttenji" and race == 1 and len(raw) > 300:
                with open(os.path.join(OUTDIR, "tsu_sttenji_R01.html"),
                          "wb") as f:
                    f.write(raw)
                print("    saved tsu_sttenji_R01.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
