#!/usr/bin/env python3
"""大村(24, omurakyotei.jp) の直前展示データ経路を発見するプローブ。

大村は独自ドメイン omurakyotei.jp。/yosou/sp/syussou/#cyokuzen に
枠/ST/展示タイム/一周/まわり足/直線/チルト を1表で掲載(JS駆動 getdata2.js)。
ページとJSから データ取得先(json/php/ajax)とパラメータを突き止める。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://omurakyotei.jp"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    h = {"Referer": BASE + "/"}
    pages = [
        ("syussou", f"{BASE}/yosou/sp/syussou/"),
        ("cyokuzen", f"{BASE}/yosou/sp/cyokuzen/"),
    ]
    js_urls = set()
    for name, url in pages:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=h)
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[{name}] FAIL: {str(e)[:55]}")
            continue
        kw = {k: txt.count(k) for k in
              ("一周", "まわり", "直線", "展示タイム", "ST", "getdata", "ajax")}
        print(f"[{name}] ({len(raw)}B) {kw}")
        for s in sorted(set(re.findall(r'<script[^>]+src=[\"\']([^\"\']+)[\"\']',
                                       txt))):
            if re.search(r'getdata|cyokuzen|syussou|yosou|race|data', s, re.I):
                print("   js:", s)
                full = s if s.startswith("http") else (
                    BASE + s if s.startswith("/") else BASE + "/yosou/sp/" + s)
                js_urls.add(full)
        for u in sorted(set(re.findall(
                r'[\"\']([^\"\']*(?:\.php|\.json|getdata|ajax|/api/)[^\"\']*)'
                r'[\"\']', txt)))[:15]:
            print("   ref:", u[:90])
        with open(os.path.join(OUTDIR, f"omura_{name}.html"), "wb") as f:
            f.write(raw)

    # JS を取得し、データ取得 URL(ajax url / fetch / json) を抽出
    for ju in list(js_urls)[:5]:
        try:
            raw = fetch_bytes(ju, timeout=12, retries=1, headers=h)
            js = raw.decode("utf-8", errors="replace")
            print(f"== JS {ju[len(BASE):]} ({len(raw)}B) ==")
            for m in re.finditer(r'(url:\s*["\'][^"\']+["\']|'
                                 r'(?:get|post|fetch|load)\s*\(\s*["\'][^"\']+'
                                 r'["\']|[\"\'][^\"\']*\.(?:php|json)[^\"\']*'
                                 r'[\"\'])', js):
                print("   ", re.sub(r'\s+', ' ', m.group(0))[:110])
            fn = re.sub(r"[^a-z0-9]+", "_", ju[len(BASE):])
            with open(os.path.join(OUTDIR, f"omura_js_{fn}.txt"), "w",
                      encoding="utf-8") as f:
                f.write(js)
        except Exception as e:
            print(f"[JS {ju}] FAIL: {str(e)[:50]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
