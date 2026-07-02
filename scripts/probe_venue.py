#!/usr/bin/env python3
"""児島(16) 最終確認: kyogi ライブ系サブシステムに展示データが無いか走査。

サイト全メニュー解析で直前情報/オリジナル展示ページは見当たらず(展望/出走予定/
PDF/リプレイ/結果/気象LIVE のみ)、レース中データは公式 boatrace.jp へ委譲。
唯一のライブ系 /asp/kyogi/16/weather/ の隣接に展示系が無いか最終確認する。
無ければ児島は江戸川と同じ「オリジナル展示 非公開」と結論する。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.kojimaboat.jp"

CANDIDATES = [
    ("kyogi_weather", f"{BASE}/asp/kyogi/16/weather/index.html"),
    ("kyogi_root", f"{BASE}/asp/kyogi/16/"),
    ("kyogi_tenji", f"{BASE}/asp/kyogi/16/tenji/index.html"),
    ("kyogi_cyokuzen", f"{BASE}/asp/kyogi/16/cyokuzen/index.html"),
    ("kyogi_live", f"{BASE}/asp/kyogi/16/live/index.html"),
    ("kyogi_race", f"{BASE}/asp/kyogi/16/race/index.html"),
]

MARK = ["オリジナル展示", "直前情報", "直前", "展示タイム", "展示", "一周",
        "まわり足", "回り足", "直線", "半周", "tenji", "cyokuzen", "ST"]


def probe(name, url, save=False):
    print(f"\n===== {name}: {url} =====")
    try:
        raw = fetch_bytes(url, timeout=20, retries=1,
                          headers={"Referer": BASE + "/"})
    except Exception as e:
        print(f"  FETCH FAIL: {str(e)[:120]}")
        return None
    html = raw.decode("utf-8", errors="replace")
    print(f"  len={len(html)}")
    print(f"  markers: {[m for m in MARK if m in html]}")
    # ページ内の全リンク/iframe/script(タブや隣接ライブページを発見するため)
    for pat, label in [
        (r'<a[^>]+href=["\']([^"\']+)["\']', "link"),
        (r'<iframe[^>]+src=["\']([^"\']+)["\']', "iframe"),
        (r'<script[^>]+src=["\']([^"\']+)["\']', "script"),
    ]:
        for v in list(dict.fromkeys(re.findall(pat, html)))[:12]:
            print(f"  {label}: {v[:120]}")
    if save:
        with open(os.path.join(OUTDIR, f"kojima_{name}.html"), "wb") as f:
            f.write(raw)
    return html


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    for i, (name, url) in enumerate(CANDIDATES):
        probe(name, url, save=(i == 0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
