#!/usr/bin/env python3
"""児島(16) round3: モバイル UA でオリジナル展示ページの実 URL を特定する。

ユーザーのスマホでは kojimaboat.jp に 直前情報(オリジナル展示: 一周/まわり足/直線,
桐生/唐津と同一ベンダー表) が表示されるが、desktop UA の probe では
/sp/ajax/ajax_cyokuzen.php も /sp/index.php?page=yosou-cyokuzen も失敗(0件)。
UA 判定リダイレクト or 別パスの可能性が高い。iPhone UA でリダイレクトを追跡し、
最終 URL・マーカー・直前系リンクを出す。確認後撤去。
"""
import os
import re
import sys
import urllib.request

OUTDIR = "data/_debug"
BASE = "https://www.kojimaboat.jp"

IPHONE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 "
             "Mobile/15E148 Safari/604.1")

CANDIDATES = [
    ("top_mobile", f"{BASE}/"),
    ("sp_root", f"{BASE}/sp/"),
    ("sp_page_cyokuzen", f"{BASE}/sp/index.php?page=yosou-cyokuzen&race=1"),
    ("sp_ajax_cyokuzen", f"{BASE}/sp/ajax/ajax_cyokuzen.php?race=1"),
    ("smart_root", f"{BASE}/smartphone/"),
    ("m_root", f"{BASE}/m/"),
]

MARK = ["オリジナル展示", "直前情報", "直前", "展示タイム", "一周", "まわり足",
        "直線", "半周", "cyokuzen", "ajax_cyokuzen", "yosou", "col5-1"]


def fetch(url):
    """iPhone UA で GET。(status, final_url, body_text) を返す。"""
    req = urllib.request.Request(url, headers={
        "User-Agent": IPHONE_UA,
        "Referer": BASE + "/",
        "Accept": "text/html,application/xhtml+xml",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.geturl(), r.read().decode("utf-8", errors="replace")


def probe(name, url, save=False):
    print(f"\n===== {name}: {url} =====")
    try:
        status, final, html = fetch(url)
    except Exception as e:
        print(f"  FETCH FAIL: {str(e)[:120]}")
        return None
    print(f"  status={status} final={final[:110]}")
    print(f"  len={len(html)}")
    print(f"  markers: {[m for m in MARK if m in html]}")
    # 直前/展示/cyokuzen 系リンクと race タブ構造
    for pat, label in [
        (r'<a[^>]+href=["\']([^"\']*(?:cyokuzen|choku|tenji|yosou)[^"\']*)["\']', "link"),
        (r'<iframe[^>]+src=["\']([^"\']+)["\']', "iframe"),
        (r'(?:href|src|action)=["\']([^"\']*index\.php\?page=[^"\']+)["\']', "page"),
    ]:
        for v in list(dict.fromkeys(re.findall(pat, html, re.I)))[:12]:
            print(f"  {label}: {v[:120]}")
    for key in ("オリジナル展示", "直前情報", "まわり足"):
        i = html.find(key)
        if i >= 0:
            print(f"  [{key}] ..." + re.sub(r"\s+", " ", html[max(0, i-150):i+350])[:420] + "...")
            break
    if save:
        with open(os.path.join(OUTDIR, f"kojima3_{name}.html"), "w",
                  encoding="utf-8", errors="replace") as f:
            f.write(html)
    return html


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    top = probe("top_mobile", CANDIDATES[0][1], save=True)
    # トップから直前/cyokuzen リンクを 2 件まで追跡
    n = 0
    if top:
        for u in dict.fromkeys(re.findall(
                r'href=["\']([^"\']*(?:cyokuzen|直前)[^"\']*)["\']', top)):
            if n >= 2:
                break
            full = u if u.startswith("http") else BASE + (u if u.startswith("/") else "/" + u)
            probe(f"follow{n}", full, save=True)
            n += 1
    for name, url in CANDIDATES[1:]:
        probe(name, url, save=(name == "sp_page_cyokuzen"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
