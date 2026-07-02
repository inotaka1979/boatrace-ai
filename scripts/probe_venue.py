#!/usr/bin/env python3
"""唐津(23): オリジナル展示(一周/まわり足/直線)のデータ源を探すプローブ。

SP サイト(index.php?page= 型 CMS)のメニューには直前情報/オリジナル展示ページが
無く、ajax_cyokuzen.php 推定も 0 件だった。PC サイトと候補エンドポイントを走査し、
展示系マーカーを含むページを特定する。サンプルは data/_debug に保存。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.boatrace-karatsu.jp"

# 候補 URL: PC トップ / SP index page 型 / 他場で実績ある path パターン
CANDIDATES = [
    ("pc_top", f"{BASE}/"),
    ("sp_ajax_cyokuzen_r1", f"{BASE}/sp/ajax/ajax_cyokuzen.php?race=1"),
    ("sp_page_cyokuzen", f"{BASE}/sp/index.php?page=yosou-cyokuzen&race=1"),
    ("sp_page_raceinfo_series", f"{BASE}/sp/index.php?page=raceinfo-series"),
    ("modules_yosou", f"{BASE}/modules/yosou/index.php?race=1"),
    ("cgi_cyokuzen", f"{BASE}/cgi-bin/cyokuzen.cgi?race=1"),
    ("infoworld_ai", "http://www.infoworld.co.jp/karatsu/ai_yosou/"),
]

MARK = ["オリジナル展示", "直前情報", "直前", "展示タイム", "一周", "まわり足",
        "回り足", "直線", "半周", "cyokuzen", "ajax_cyokuzen", "ajax_yosou",
        "getYosou", "iframe", "tenji", "st_tenji"]


def probe(name, url):
    print(f"\n===== {name}: {url} =====")
    try:
        raw = fetch_bytes(url, timeout=20, retries=1,
                          headers={"Referer": BASE + "/"})
    except Exception as e:
        print(f"  FETCH FAIL: {str(e)[:120]}")
        return None
    html = raw.decode("utf-8", errors="replace")
    print(f"  len={len(html)}")
    hits = [m for m in MARK if m in html]
    print(f"  markers: {hits}")
    # 展示系リンク/iframe/script を列挙(PC トップから直前ページを辿るため)
    for pat, label in [
        (r'<a[^>]+href=["\']([^"\']*(?:choku|cyoku|tenji|yosou|live|zen)[^"\']*)["\']', "link"),
        (r'<iframe[^>]+src=["\']([^"\']+)["\']', "iframe"),
        (r'<script[^>]+src=["\']([^"\']+)["\']', "script"),
    ]:
        vals = list(dict.fromkeys(re.findall(pat, html, re.I)))[:10]
        for v in vals:
            print(f"  {label}: {v[:130]}")
    # マーカー周辺を少し表示
    for key in ("オリジナル展示", "直前", "展示タイム"):
        i = html.find(key)
        if i >= 0:
            print(f"  [{key}] ..." + re.sub(r"\s+", " ", html[max(0, i-100):i+260]) + "...")
            break
    return raw


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    for name, url in CANDIDATES:
        raw = probe(name, url)
        if raw and name in ("pc_top", "sp_page_raceinfo_series"):
            with open(os.path.join(OUTDIR, f"karatsu_{name}.html"), "wb") as f:
                f.write(raw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
