#!/usr/bin/env python3
"""児島(16) round4: kyogi/sp レースウィジェット内の直前情報ファイル名規則を特定。

round3 でモバイルトップに iframe /asp/kyogi/16/sp/syusso0801.htm を発見。
ユーザーのスクショ(出走表/予想/直前情報/オッズ/結果 タブ)はこの iframe の中身。
本体を採取してタブのリンク/JS から 直前情報(オリジナル展示)ページの
ファイル名規則(cyokuzenXXRR.htm 等)を特定する。確認後撤去。
"""
import os
import re
import sys
import urllib.request

OUTDIR = "data/_debug"
BASE = "https://www.kojimaboat.jp"
KYOGI = f"{BASE}/asp/kyogi/16/sp"

IPHONE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 "
             "Mobile/15E148 Safari/604.1")

CANDIDATES = [
    ("syusso0801", f"{KYOGI}/syusso0801.htm"),
    ("cyokuzen0801", f"{KYOGI}/cyokuzen0801.htm"),
    ("cyokuzen01", f"{KYOGI}/cyokuzen01.htm"),
    ("tyokuzen0801", f"{KYOGI}/tyokuzen0801.htm"),
    ("chokuzen0801", f"{KYOGI}/chokuzen0801.htm"),
    ("yosou0801", f"{KYOGI}/yosou0801.htm"),
]

MARK = ["オリジナル展示", "直前情報", "直前", "展示タイム", "展示", "一周",
        "まわり足", "直線", "半周", "col5-1", "col4", "cyokuzen", "syusso"]


def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": IPHONE_UA, "Referer": BASE + "/",
        "Accept": "text/html,application/xhtml+xml"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.geturl(), r.read().decode("utf-8", errors="replace")


def probe(name, url, save=False):
    print(f"\n===== {name}: {url} =====")
    try:
        status, final, html = fetch(url)
    except Exception as e:
        print(f"  FETCH FAIL: {str(e)[:100]}")
        return None
    print(f"  status={status} len={len(html)}")
    print(f"  markers: {[m for m in MARK if m in html]}")
    # .htm へのリンク / JS 内のファイル名参照(タブ切替の規則を掴む)
    for v in list(dict.fromkeys(re.findall(r'["\'(/]([A-Za-z_]+\d*\.htm[l]?)', html)))[:20]:
        print(f"  file: {v}")
    for v in list(dict.fromkeys(re.findall(r'<a[^>]+href=["\']([^"\']+)["\']', html)))[:15]:
        print(f"  link: {v[:110]}")
    for key in ("オリジナル展示", "直前情報", "まわり足"):
        i = html.find(key)
        if i >= 0:
            print(f"  [{key}] ..." + re.sub(r"\s+", " ", html[max(0, i-150):i+400])[:450] + "...")
            break
    if save:
        with open(os.path.join(OUTDIR, f"kojima4_{name}.html"), "w",
                  encoding="utf-8", errors="replace") as f:
            f.write(html)
    return html


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    body = probe("syusso0801", CANDIDATES[0][1], save=True)
    # syusso 内から cyokuzen/直前 らしきファイル参照を追跡(2件まで)
    n = 0
    if body:
        cands = dict.fromkeys(
            re.findall(r'["\'(/]([A-Za-z_]*(?:cyokuzen|choku|tyoku)[A-Za-z_]*\d*\.htm[l]?)', body, re.I))
        for f in cands:
            if n >= 2:
                break
            probe(f"follow_{f}", f"{KYOGI}/{f}", save=True)
            n += 1
    for name, url in CANDIDATES[1:]:
        probe(name, url, save=("cyokuzen" in name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
