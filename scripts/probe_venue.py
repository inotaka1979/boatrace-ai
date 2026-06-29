#!/usr/bin/env python3
"""戸田(2) のオリジナル展示 XML の正しい現行パスを発見するプローブ。

前回 probe で本日(6/29=マクール杯初日)の race_table_original_{RR}.xml が全 404 と判明。
6/28(前イベント)では同パスで取得できていた。原因確定のため、戸田の実 HTML ページ内の
データ参照(xml/original/ajax/php)を抽出し、現行の正しいデータURLを突き止める。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-toda.jp"


def _refs(txt):
    """xml/original/ajax/php/kaisai を含む src/href/url 文字列を抽出。"""
    pats = re.findall(
        r'''(?:src|href|url|data-[\w-]+)\s*[=:]\s*["']?([^"'<> )]+)''', txt)
    hits = [u for u in pats
            if re.search(r'xml|original|ajax|\.php|kaisai|cyokuzen|recomend',
                         u, re.I)]
    return sorted(set(hits))[:40]


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    headers = {"Referer": BASE + "/"}

    pages = [
        ("top", f"{BASE}/"),
        ("race_r1", f"{BASE}/race/race?rno=1&jcd=02&hd={hd}"),
        ("before_r1", f"{BASE}/race/beforeinfo?rno=1&jcd=02&hd={hd}"),
        ("raceindex", f"{BASE}/race/raceindex?jcd=02&hd={hd}"),
        ("syussou_r1", f"{BASE}/race/syussou?rno=1&jcd=02&hd={hd}"),
    ]
    for name, url in pages:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=headers)
            txt = raw.decode("utf-8", errors="replace")
            has = " ".join(f"{m}={txt.count(m)}" for m in
                           ("一周", "まわり足", "直線", "周回", "展示", "original", "xml"))
            print(f"[{name}] {url[len(BASE):]} ({len(raw)}B) {has}")
            for r in _refs(txt):
                print(f"    ref: {r}")
            p = os.path.join(OUTDIR, f"toda_{name}.html")
            with open(p, "wb") as f:
                f.write(raw)
        except Exception as e:
            print(f"[{name}] {url[len(BASE):]} FAIL: {str(e)[:80]}")

    # 直 XML パス候補(年月日違い/別dir)を網羅的に
    print("== xml path candidates ==")
    cands = [
        f"/race/xml/kaisai/{hd}/race_table_original_01.xml",
        f"/race/xml/{hd}/race_table_original_01.xml",
        f"/race/xml/kaisai/{hd}/race_table_original_1.xml",
        f"/race/xml/kaisai/{hd}/original_01.xml",
        f"/race/xml/kaisai/{hd}/race_table_01.xml",
        f"/xml/kaisai/{hd}/race_table_original_01.xml",
        f"/race/xml/kaisai/{hd[:6]}/race_table_original_01.xml",
    ]
    for c in cands:
        try:
            raw = fetch_bytes(BASE + c, timeout=8, retries=0, headers=headers)
            print(f"  OK {c} ({len(raw)}B) rec={raw.decode('utf-8','replace').count('<record>')}")
        except Exception as e:
            print(f"  -- {c} {str(e)[:40]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
