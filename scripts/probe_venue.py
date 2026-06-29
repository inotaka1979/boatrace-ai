#!/usr/bin/env python3
"""宮島(17) の race ラッパー/iframe/asp パスを発見するプローブ。

宮島 SP の UI は住之江と同型(boatcast)だが /sp/ も /asp/kyogi/17/sp/yoso05 も 404。
boatrace-miyajima.com 直下に同UIがある。top と候補ページから iframe src と
/asp/kyogi/17/... の htm パス・タブ構造を採取し、オリジナル展示の URL を突き止める。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.boatrace-miyajima.com"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    h = {"Referer": BASE + "/"}
    pages = [
        ("top", f"{BASE}/"),
        ("race", f"{BASE}/race/"),
        ("yosou", f"{BASE}/race/index.php?page=yosou-yosou&race=1"),
        ("kyogi_index", f"{BASE}/asp/kyogi/17/sp/index.htm"),
        ("kyogi_pc_index", f"{BASE}/asp/kyogi/17/pc/index.htm"),
    ]
    for name, url in pages:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=h)
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[{name}] {url[len(BASE):]} FAIL: {str(e)[:55]}")
            continue
        kw = {k: txt.count(k) for k in
              ("オリジナル展示", "一周", "まわり", "直線", "iframe", "kaisai_reload")}
        print(f"[{name}] {url[len(BASE):] or '/'} ({len(raw)}B) {kw}")
        for m in re.finditer(r'<iframe[^>]+(?:src|id)=[\"\']([^\"\']+)[\"\']', txt):
            print("   iframe:", m.group(1)[:90])
        for u in sorted(set(re.findall(
                r'/asp/[a-z0-9/_]+\.htm', txt)))[:15]:
            print("   asp:", u)
        for u in sorted(set(re.findall(
                r'(?:href|src)=[\"\']([^\"\']*(?:yoso|syusso|cyokuzen|tenji|'
                r'kaisai|周回)[^\"\']*)[\"\']', txt)))[:12]:
            print("   ref:", u[:90])
        if name in ("top", "race", "yosou") and len(raw) > 500:
            with open(os.path.join(OUTDIR, f"miyajima_{name}.html"), "wb") as f:
                f.write(raw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
