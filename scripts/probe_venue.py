#!/usr/bin/env python3
"""宮島(17) kaisai_reload.php の周回タイム(dt[8])を過去日付込みで採取。

本日 宮島 非開催で dt[8] が空。kaisai_reload.php は date 引数を取るため、
過去日付(直近10日)を POST し、開催日の populated dt[8](周回タイム)構造を採取する。
確認後撤去。
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
    today = datetime.now(JST)
    saved = False
    for back in range(0, 11):
        d = (today - timedelta(days=back)).strftime("%Y%m%d")
        # 各日 数レースだけ試す(開催日判定 + 展示後レース)
        hit = False
        for rno in (10, 11, 12, 7, 5):
            try:
                resp = _post(rno, d)
            except Exception as e:
                print(f"{d} R{rno} FAIL: {str(e)[:50]}")
                continue
            parts = resp.split("####")
            dt8 = parts[8] if len(parts) > 8 else ""
            has = any(m in dt8 for m in ORIG)
            if len(dt8) > 30 or has:
                cnt = " ".join(f"{m}={dt8.count(m)}" for m in ORIG)
                print(f"{d} R{rno} parts={len(parts)} dt8({len(dt8)}B) {cnt} has={has}")
                hit = True
                if has and not saved:
                    p = os.path.join(OUTDIR, f"miyajima_shukai_{d}_R{rno:02d}.html")
                    with open(p, "w", encoding="utf-8") as f:
                        f.write(dt8)
                    print(f"      saved {p}")
                    saved = True
                    return 0  # 1件取れれば十分
        if not hit:
            print(f"{d}: no dt8 data (非開催?)")
    if not saved:
        print("no populated dt8 found in last 11 days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
