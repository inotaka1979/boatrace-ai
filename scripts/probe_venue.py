#!/usr/bin/env python3
"""住之江(12) のオリジナル展示のデータ経路と表構造を発見するプローブ。

住之江は未登録。これまでの各パターン(ajax_yosou の cyokuzen/sttenji、
modules/yosou の kind=2、戸田XML 等)を一通り当たり、オリジナル展示
(一周/まわり足/直線)を返すエンドポイントと表構造を採取する。確認後撤去。
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
KW = ("オリジナル展示", "一周", "半周", "まわり足", "直線", "周回", "展示タイム",
      "展示評価", "スタート展示", "waku")


def _marks(t):
    return " ".join(f"{m}={t.count(m)}" for m in KW)


def _dump(txt):
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return
    soup = BeautifulSoup(txt, "html.parser")
    for tbl in soup.find_all("table"):
        t = tbl.get_text()
        if ("まわり足" in t) and (("一周" in t) or ("半周" in t)):
            for ri, row in enumerate(tbl.find_all("tr")[:9]):
                cells = [("/".join(td.get("class") or [])) + ":" +
                         td.get_text(strip=True)
                         for td in row.find_all(["td", "th"])]
                if cells:
                    print(f"      row{ri}: {cells[:11]}")
            return True
    return False


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    h_pg = {"Referer": BASE + "/"}
    h_ajax = {"Referer": BASE + "/sp/", "X-Requested-With": "XMLHttpRequest"}

    # 1) 構造発見: top/sp で vendor を判定
    print("== suminoe discovery ==")
    for name, url in [("top", f"{BASE}/"), ("sp", f"{BASE}/sp/"),
                      ("yosou", f"{BASE}/sp/index.php?page=yosou-yosou&race=1")]:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=h_pg)
            txt = raw.decode("utf-8", errors="replace")
            print(f"[{name}] ({len(raw)}B) {_marks(txt)}")
            print("   data-req:", sorted(set(re.findall(
                r'data-req=[\"\']([^\"\']+)[\"\']', txt))))
            print("   ajax php:", sorted(set(re.findall(
                r'/(?:sp/)?ajax/([a-z_]+\.php)', txt))))
            print("   modules:", sorted(set(re.findall(
                r'(/modules/yosou/[a-z_]+\.php)', txt))))
            with open(os.path.join(OUTDIR, f"suminoe_{name}.html"), "wb") as f:
                f.write(raw)
        except Exception as e:
            print(f"[{name}] FAIL: {str(e)[:60]}")

    # 2) 候補エンドポイントを総当たり
    print("== endpoint candidates ==")
    cands = [
        f"/sp/ajax/ajax_yosou.php?targetday={hd}&race=1&req=cyokuzen&run=0",
        f"/sp/ajax/ajax_yosou.php?targetday={hd}&race=1&req=sttenji&run=0",
        f"/modules/yosou/cyokuzen.php?day={hd}&race=1&if=0&kind=2",
        f"/sp/ajax/ajax_cyokuzen.php?targetday={hd}&race=1",
    ]
    for path in cands:
        try:
            raw = fetch_bytes(BASE + path, timeout=10, retries=0, headers=h_ajax)
            txt = raw.decode("utf-8", errors="replace")
            hit = ("一周" in txt or "半周" in txt) and ("まわり足" in txt)
            tag = " <<< ORIG!" if hit else ""
            print(f"[{path[:55]}] ({len(raw)}B) {_marks(txt)}{tag}")
            if hit:
                _dump(txt)
                fn = re.sub(r"[^a-z0-9]+", "_", path.split("?")[0].strip("/"))
                with open(os.path.join(OUTDIR, f"suminoe_{fn}.html"), "wb") as f:
                    f.write(raw)
                print(f"      saved suminoe_{fn}.html")
        except Exception as e:
            print(f"[{path[:55]}] -- {str(e)[:40]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
