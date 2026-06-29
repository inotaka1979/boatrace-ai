#!/usr/bin/env python3
"""江戸川(3) の直前モジュールにオリジナル展示(一周/まわり足/直線)があるか確認するプローブ。

江戸川は独自CMS。top の JS から、直前データは iframe で
  /modules/yosou/cyokuzen.php?day=YYYYMMDD&race=N
  /modules/yosou/cyokuzen_info.php?day=YYYYMMDD&race=N
として読まれると判明。これらを取得し、オリジナル展示の有無と表構造を確認する。
無ければ「江戸川は非公開」と結論。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-edogawa.com"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    headers = {"Referer": BASE + "/"}
    mods = ["cyokuzen", "cyokuzen_info"]
    saved = set()
    for mod in mods:
        for race in (1, 2, 3):
            url = f"{BASE}/modules/yosou/{mod}.php?day={hd}&race={race}"
            try:
                raw = fetch_bytes(url, timeout=12, retries=1, headers=headers)
                txt = raw.decode("utf-8", errors="replace")
                marks = " ".join(f"{m}={txt.count(m)}" for m in
                                 ("オリジナル展示", "一周", "半周", "まわり足",
                                  "直線", "周回", "展示タイム", "展示", "<table",
                                  "<th"))
                # th ラベル一覧(列構成把握)
                ths = [re.sub(r"<[^>]+>", "", t).strip()
                       for t in re.findall(r"<th[^>]*>.*?</th>", txt, re.S)]
                ths = [t for t in ths if t][:16]
                print(f"[{mod} R{race}] ({len(raw)}B) {marks}")
                print(f"    th={ths}")
                if mod not in saved and len(raw) > 300:
                    p = os.path.join(OUTDIR, f"edogawa_{mod}_R{race:02d}.html")
                    with open(p, "wb") as f:
                        f.write(raw)
                    print(f"    saved {p}")
                    saved.add(mod)
            except Exception as e:
                print(f"[{mod} R{race}] FAIL: {str(e)[:70]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
