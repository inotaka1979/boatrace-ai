#!/usr/bin/env python3
"""住之江(12) の 直前情報/オリジナル展示 htm のファイル名を sma_assist + 候補で特定。

syusso{1000+RR}=出走表 と判明(オリジナル展示でない)。タブ切替で読む直前情報の
htm 名を、sma_assist.htm(SMART ASSIST: タブ定義) と候補ファイル直叩きで突き止める。
確認後撤去。
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
    h = {"Referer": BASE + "/sp/"}

    # 1) sma_assist(タブ定義)を SP/PC で取得し .htm 参照規則を抽出
    for d in ("sp", "pc"):
        url = f"{BASE}/asp/kyogi/12/{d}/sma_assist.htm"
        try:
            raw = fetch_bytes(url, timeout=10, retries=0, headers=h)
            txt = raw.decode("utf-8", errors="replace")
            htms = sorted(set(re.findall(r'([a-zA-Z_]+\d*\.htm)', txt)))
            print(f"[sma_assist/{d}] ({len(raw)}B) htm={htms}")
            # タブ名 + 直前/展示/オリジナル 周辺
            for m in re.finditer(r'(直前|展示|オリジナル|一周|まわり)', txt):
                print("   near:", re.sub(r'\s+', ' ',
                      txt[m.start()-60:m.start()+60]))
            with open(os.path.join(OUTDIR, f"suminoe_sma_assist_{d}.htm"),
                      "wb") as f:
                f.write(raw)
        except Exception as e:
            print(f"[sma_assist/{d}] -- {str(e)[:45]}")

    # 2) 直前情報/オリジナル展示 候補ファイル名(race5=1005)を直叩き
    print("== 直前候補 (race5=1005) ==")
    saved = False
    for stem in ("cyokuzen", "tyokuzen", "chokuzen", "tenji", "tenbo",
                 "syuukai", "syukai", "mawari", "original", "syusso_cyokuzen",
                 "cyokuzen_detail", "tenbo_detail"):
        url = f"{BASE}/asp/kyogi/12/sp/{stem}1005.htm"
        try:
            raw = fetch_bytes(url, timeout=8, retries=0, headers=h)
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[{stem}1005] -- {str(e)[:35]}")
            continue
        hit = ("一周" in txt) and ("まわり" in txt)
        marks = " ".join(f"{m}={txt.count(m)}" for m in
                         ("一周", "まわり", "直線", "展示"))
        print(f"[{stem}1005] ({len(raw)}B) {marks}{' <<< ORIG!' if hit else ''}")
        if hit and not saved:
            soup = BeautifulSoup(txt, "html.parser")
            for tbl in soup.find_all("table"):
                if "一周" in tbl.get_text() and "まわり" in tbl.get_text():
                    for ri, row in enumerate(tbl.find_all("tr")[:8]):
                        cells = [("/".join(c.get("class") or [])) + ":" +
                                 c.get_text(strip=True)
                                 for c in row.find_all(["td", "th"])]
                        if cells:
                            print(f"    row{ri}: {cells[:12]}")
                    break
            with open(os.path.join(OUTDIR, f"suminoe_{stem}1005.htm"),
                      "wb") as f:
                f.write(raw)
            print(f"    saved suminoe_{stem}1005.htm")
            saved = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
