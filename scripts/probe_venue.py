#!/usr/bin/env python3
"""住之江(12): iframe 内 syusso1005.htm のタブバーから 直前情報/オリジナル展示 の htm を特定。

/sp/ は iframe ラッパーで、タブバー(出走表/前日予想/直前情報予想/得点率/オッズ)と
データは iframe 内 htm にある。syusso{1000+RR}=出走表タブ。その htm 内のタブバー
リンクに 直前情報予想(=オリジナル展示) の htm 名があるはず。それを抽出する。確認後撤去。
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
    url = f"{BASE}/asp/kyogi/12/sp/syusso1005.htm"
    try:
        raw = fetch_bytes(url, timeout=12, retries=1,
                          headers={"Referer": BASE + "/sp/"})
    except Exception as e:
        print(f"FAIL: {e}")
        return 0
    txt = raw.decode("utf-8", errors="replace")
    print(f"syusso1005.htm ({len(raw)}B)")
    # タブラベルとリンク
    for lbl in ("直前", "オリジナル", "展示", "前日", "出走", "得点", "オッズ"):
        for m in re.finditer(lbl, txt):
            seg = re.sub(r'\s+', ' ', txt[m.start()-140:m.start()+20])
            print(f"  [{lbl}] ...{seg}")
            break
    print("=== all .htm hrefs ===")
    for u in sorted(set(re.findall(
            r'(?:href|src|onclick|location\.href\s*=\s*)[=\s]?[\"\']'
            r'([^\"\']*\.htm[^\"\']*)[\"\']', txt))):
        print("  ", u)
    print("=== JS htm concatenation / location ===")
    for m in re.finditer(r'location\.href[^;]{0,80}|\.htm[\"\']', txt):
        print("  ", re.sub(r'\s+', ' ', m.group(0))[:100])
    # data-* on tab elements
    print("data-*:", sorted(set(re.findall(r'data-([a-z]+)=', txt)))[:20])
    with open(os.path.join(OUTDIR, "suminoe_syusso1005_full.htm"), "wb") as f:
        f.write(raw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
