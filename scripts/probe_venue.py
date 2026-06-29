#!/usr/bin/env python3
"""江戸川(3) の実サイト構造と「オリジナル展示」の有無/データ経路を発見するプローブ。

前回 probe で /sp/index.php?page=yosou-cyokuzen が 404 と判明(桐生/福岡型ではない)。
江戸川 top と候補ページを取得し、オリジナル展示(一周/まわり足/直線)への参照
(URL/JS/ajax/xml)を抽出して、現行の正しいデータ経路を突き止める。確認後撤去。
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


def _refs(txt):
    pats = re.findall(
        r'''(?:src|href|url|data-[\w-]+|action)\s*[=:]\s*["']?([^"'<> )]+)''',
        txt)
    hits = [u for u in pats
            if re.search(r'xml|original|ajax|\.php|kaisai|cyokuzen|yosou|'
                         r'recomend|tenji|shukai|周回', u, re.I)]
    return sorted(set(hits))[:50]


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    headers = {"Referer": BASE + "/"}

    pages = [
        ("top", f"{BASE}/"),
        ("sp_top", f"{BASE}/sp/"),
        ("modal_r1", f"{BASE}/modate/race?rno=1&hd={hd}"),
        ("yosou", f"{BASE}/yosou/"),
        ("sp_yosou", f"{BASE}/sp/index.php?page=yosou"),
        ("sp_cyokuzen", f"{BASE}/sp/index.php?page=cyokuzen&race=1"),
        ("sp_index", f"{BASE}/sp/index.php"),
    ]
    for name, url in pages:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=headers)
            txt = raw.decode("utf-8", errors="replace")
            has = " ".join(f"{m}={txt.count(m)}" for m in
                           ("オリジナル展示", "一周", "半周", "まわり足", "直線",
                            "周回", "展示"))
            print(f"[{name}] {url[len(BASE):] or '/'} ({len(raw)}B) {has}")
            for r in _refs(txt):
                print(f"    ref: {r}")
            if name in ("top", "sp_top"):
                p = os.path.join(OUTDIR, f"edogawa_{name}.html")
                with open(p, "wb") as f:
                    f.write(raw)
        except Exception as e:
            print(f"[{name}] {url[len(BASE):] or '/'} FAIL: {str(e)[:70]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
