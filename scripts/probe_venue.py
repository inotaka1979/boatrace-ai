#!/usr/bin/env python3
"""宮島(17): race20231019.js と kaisai_reload.php 実応答を採取するプローブ。

宮島は JS 駆動。race_common/js/race20231019.js が kaisai_reload.php に POST して
タブHTMLを得る。実応答の構造(#### split 等)とオリジナル展示の所在を確認し、
合成 fixture でしか検証していない既存パーサとの差を埋める。確認後撤去。
"""
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-miyajima.com"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")

    # 1) full race js
    try:
        raw = fetch_bytes(f"{BASE}/race_common/js/race20231019.js?1234",
                          timeout=12, retries=1, headers={"Referer": BASE + "/"})
        js = raw.decode("utf-8", errors="replace")
        print(f"[race.js] ({len(raw)}B)")
        # ajax 呼び出し(url + data)を抽出
        for m in re.finditer(r'url:\s*["\']([^"\']+)["\'][^}]{0,120}', js):
            print("   ajax:", re.sub(r'\s+', ' ', m.group(0))[:140])
        # オリジナル/周回/sttenji/cyokuzen を含む行
        for m in re.finditer(r'(オリジナル|周回|sttenji|cyokuzen|original|'
                             r'split|####|dt\[)', js):
            print("   js:", re.sub(r'\s+', ' ', js[m.start()-40:m.start()+60]))
        with open(os.path.join(OUTDIR, "miyajima_race_js.txt"), "w",
                  encoding="utf-8") as f:
            f.write(js)
    except Exception as e:
        print(f"[race.js] FAIL: {str(e)[:55]}")

    # 2) kaisai_reload.php 実 POST(現行 _miyajima_post と同じ)
    print("== POST kaisai_reload.php ==")
    for race in (1, 12):
        data = urllib.parse.urlencode({"race": race, "date": hd}).encode()
        req = urllib.request.Request(
            BASE + "/race_common/require/kaisai_reload.php", data=data,
            headers={"User-Agent": _UA, "Referer": BASE + "/",
                     "X-Requested-With": "XMLHttpRequest",
                     "Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=12) as r:
                body = r.read().decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[POST race={race}] FAIL: {str(e)[:60]}")
            continue
        parts = body.split("####")
        print(f"[POST race={race}] {len(body)}B parts={len(parts)}")
        for i, p in enumerate(parts):
            marks = [m for m in ("一周", "半周", "まわり", "直線", "周回",
                                 "オリジナル", "展示") if m in p]
            if marks:
                print(f"   part[{i}] ({len(p)}B) {marks} table={p.count('<table')}")
        if race == 1:
            with open(os.path.join(OUTDIR, "miyajima_reload_R01.txt"), "w",
                      encoding="utf-8") as f:
                f.write(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
