#!/usr/bin/env python3
"""児島(16): オリジナル展示(直前情報)のデータ源を探すプローブ。

kojimaboat.jp は /asp/htmlmade/Race/<Cat>/16/*.htm 型の静的 ASP 配信。
採取済みトップは非開催日のもので本日レースメニューが無かった。開催日の
トップから直前系リンクを抽出し、候補パス(Cyokuzen 等の jumper.htm)も走査する。
サンプルは data/_debug に保存。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.kojimaboat.jp"

# Race カテゴリ jumper.htm パターン + 既知の today ページ
CANDIDATES = [
    ("top_live", f"{BASE}/"),
    ("today_touban", f"{BASE}/asp/htmlmade/kojima/today_syussou/touban.htm"),
    ("race_cyokuzen_jumper", f"{BASE}/asp/htmlmade/Race/Cyokuzen/16/jumper.htm"),
    ("race_chokuzen_jumper", f"{BASE}/asp/htmlmade/Race/Chokuzen/16/jumper.htm"),
    ("race_tyokuzen_jumper", f"{BASE}/asp/htmlmade/Race/Tyokuzen/16/jumper.htm"),
    ("race_yosou_jumper", f"{BASE}/asp/htmlmade/Race/Yosou/16/jumper.htm"),
    ("race_tenji_jumper", f"{BASE}/asp/htmlmade/Race/Tenji/16/jumper.htm"),
]

MARK = ["オリジナル展示", "直前情報", "直前", "展示タイム", "一周", "まわり足",
        "回り足", "直線", "半周", "cyokuzen", "chokuzen", "tenji", "Tenji"]


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
    hits = [m for m in MARK if m in html]
    print(f"  markers: {hits}")
    # /asp/ 配下の Race/直前/展示系リンクを列挙
    links = dict.fromkeys(re.findall(
        r'["\'(]([^"\'()]*(?:Race|cyokuzen|chokuzen|tenji|yosou|choku)[^"\'()]*?\.(?:htm|html|php)[^"\'()]*)["\')]',
        html, re.I))
    for a in list(links)[:25]:
        print(f"  link: {a[:130]}")
    for key in ("オリジナル展示", "直前情報", "まわり足", "展示タイム"):
        i = html.find(key)
        if i >= 0:
            print(f"  [{key}] ..." + re.sub(r"\s+", " ", html[max(0, i-150):i+350]) + "...")
            break
    if save:
        with open(os.path.join(OUTDIR, f"kojima_{name}.html"), "wb") as f:
            f.write(raw)
    return html


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    top = probe("top_live", CANDIDATES[0][1], save=True)
    # トップから直前/展示らしきリンクを見つけたら追撃で 2 件まで採取
    followed = 0
    if top:
        cands = dict.fromkeys(re.findall(
            r'href=["\']([^"\']+)["\'][^>]*>[^<]{0,20}(?:直前|展示)', top))
        cands2 = dict.fromkeys(re.findall(
            r'["\'(]([^"\'()]*(?:yokuzen|cyokuzen|chokuzen|tenji)[^"\'()]*)["\')]', top, re.I))
        for u in list(cands) + list(cands2):
            if followed >= 2:
                break
            full = u if u.startswith("http") else BASE + (u if u.startswith("/") else "/" + u)
            h = probe(f"follow{followed}", full, save=True)
            if h:
                followed += 1
    for name, url in CANDIDATES[1:]:
        probe(name, url, save=(name == "today_touban"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
