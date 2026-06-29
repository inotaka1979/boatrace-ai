#!/usr/bin/env python3
"""住之江(12) は SP が ajax_yosou ベンダー(津と同型)。正しい req を特定するプローブ。

スクショで 住之江 SP に オリジナル展示(枠/展示/一周/まわり足/直線)を確認。津と同じ
タブ構成。/sp/index.php?page=yosou-yosou の data-req を採取し、ajax_yosou.php を
各 req(cyokuzen/sttenji)で叩いてオリジナル展示を返すものを特定する。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-suminoe.jp"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    h_pg = {"Referer": BASE + "/sp/"}
    h_ajax = {"Referer": BASE + "/sp/index.php?page=yosou-yosou",
              "X-Requested-With": "XMLHttpRequest"}

    # 1) レース詳細ページの data-req を採取(津と同じ手口)
    print("== suminoe yosou-yosou tabs ==")
    for pg in (f"{BASE}/sp/index.php?page=yosou-yosou&race=5",
               f"{BASE}/sp/index.php?page=yosou&race=5",
               f"{BASE}/sp/race/?race=5"):
        try:
            raw = fetch_bytes(pg, timeout=12, retries=1, headers=h_pg)
            txt = raw.decode("utf-8", errors="replace")
            dreq = sorted(set(re.findall(r'data-req=[\"\']([^\"\']+)[\"\']', txt)))
            ajx = sorted(set(re.findall(r'/ajax/([a-z_]+\.php)', txt)))
            print(f"[{pg[len(BASE):]}] ({len(raw)}B) data-req={dreq} ajax={ajx}")
            if dreq or ajx:
                with open(os.path.join(OUTDIR, "suminoe_yosou_tabs.html"),
                          "wb") as f:
                    f.write(raw)
                break
        except Exception as e:
            print(f"[{pg[len(BASE):]}] FAIL: {str(e)[:50]}")

    # 2) ajax_yosou.php を req 別に叩く(5R, 展示窓内)
    print("== ajax_yosou req scan (race=5) ==")
    from bs4 import BeautifulSoup
    for req in ("sttenji", "cyokuzen", "syussou"):
        url = (f"{BASE}/sp/ajax/ajax_yosou.php"
               f"?targetday={hd}&race=5&req={req}&run=0")
        try:
            raw = fetch_bytes(url, timeout=10, retries=0, headers=h_ajax)
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[req={req}] -- {str(e)[:45]}")
            continue
        hit = ("一周" in txt) and ("まわり" in txt)
        marks = " ".join(f"{m}={txt.count(m)}" for m in
                         ("一周", "まわり足", "直線", "展示", "waku"))
        print(f"[req={req}] ({len(raw)}B) {marks}{' <<< ORIG!' if hit else ''}")
        if hit:
            soup = BeautifulSoup(txt, "html.parser")
            for tbl in soup.find_all("table"):
                if "まわり" in tbl.get_text() and "一周" in tbl.get_text():
                    for ri, row in enumerate(tbl.find_all("tr")[:8]):
                        cells = [("/".join(td.get("class") or [])) + ":" +
                                 td.get_text(strip=True)
                                 for td in row.find_all(["td", "th"])]
                        if cells:
                            print(f"    row{ri}: {cells[:11]}")
                    break
            with open(os.path.join(OUTDIR, f"suminoe_ajax_{req}_R05.html"),
                      "wb") as f:
                f.write(raw)
            print(f"    saved suminoe_ajax_{req}_R05.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
