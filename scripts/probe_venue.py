#!/usr/bin/env python3
"""宮島(17) kaisai_reload.php の周回タイム(dt[8])を採取するプローブ。

宮島は POST race_common/require/kaisai_reload.php {race,date} のレスポンスを
'####' で split、dt[8]=周回タイム(オリジナル展示)。全12レースで POST し、
dt[8] に 一周/まわり足/直線 が入るか確認、構造を採取する。確認後撤去。
"""
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-miyajima.com"
URL = BASE + "/race_common/require/kaisai_reload.php"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 BoatRaceOracle/1.0")
ORIG = ("一周", "まわり足", "直線", "周回", "ターン")


def _post(race, date):
    data = urllib.parse.urlencode({"race": race, "date": date}).encode()
    req = urllib.request.Request(URL, data=data, headers={
        "User-Agent": UA, "Referer": BASE + "/",
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8", errors="replace")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    saved = False
    for rno in range(1, 13):
        try:
            resp = _post(rno, hd)
        except Exception as e:
            print(f"R{rno:2d} POST FAIL: {str(e)[:60]}")
            continue
        parts = resp.split("####")
        dt8 = parts[8] if len(parts) > 8 else ""
        cnt = " ".join(f"{m}={dt8.count(m)}" for m in ORIG)
        print(f"R{rno:2d} parts={len(parts)} dt8({len(dt8)}B) {cnt}")
        if not saved and len(dt8) > 50:
            p = os.path.join(OUTDIR, f"miyajima_shukai_R{rno:02d}.html")
            with open(p, "w", encoding="utf-8") as f:
                f.write(dt8)
            print(f"      saved {p}")
            if any(m in dt8 for m in ORIG):
                saved = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
