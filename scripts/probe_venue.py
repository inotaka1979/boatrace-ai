#!/usr/bin/env python3
"""津(9) の「オリジナル展示」サブタブの AJAX 経路を発見するプローブ。

津は実際にはオリジナル展示(枠/展示/一周/まわり足/直線)を公開している(SP の
展示情報→オリジナル展示タブ)。req=cyokuzen は別タブ(直前情報=展示評価)だった。
SP ページの JS から オリジナル展示 を読む正しい req/URL を突き止める。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-tsu.com"
KW = ("オリジナル展示", "一周", "まわり足", "直線", "展示タイム", "スタート展示", "waku")


def _marks(txt):
    return " ".join(f"{m}={txt.count(m)}" for m in KW)


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    h_pg = {"Referer": BASE + "/"}
    h_ajax = {"Referer": BASE + "/sp/", "X-Requested-With": "XMLHttpRequest"}

    # 1) SP のタブを持つページを取得し、ajax_yosou の req 一覧と オリジナル展示 周辺を吸い出す
    print("== 津 SP pages ==")
    for name, url in [
        ("sp", f"{BASE}/sp/"),
        ("sp_index_race1", f"{BASE}/sp/index.php?race=1"),
    ]:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=h_pg)
            txt = raw.decode("utf-8", errors="replace")
            print(f"[{name}] ({len(raw)}B) {_marks(txt)}")
            # ajax_yosou.php を呼ぶ JS の req 値を全部拾う
            reqs = sorted(set(re.findall(r'req=([A-Za-z0-9_]+)', txt)))
            print(f"    req values seen: {reqs}")
            # 「オリジナル展示」近傍(タブ定義の data-* / onclick)
            for m in re.finditer("オリジナル展示", txt):
                seg = re.sub(r'\s+', ' ', txt[m.start()-220:m.start()+40])
                print(f"    near: ...{seg}")
            with open(os.path.join(OUTDIR, f"tsu_{name}.html"), "wb") as f:
                f.write(raw)
        except Exception as e:
            print(f"[{name}] FAIL: {str(e)[:70]}")

    # 2) 拾った req を全部 ajax_yosou.php で叩いて オリジナル展示(一周&まわり足)を探す
    print("== try ajax_yosou.php with discovered/likely reqs ==")
    cand = ["cyokuzen", "cyokuzendetail", "cyokuzen_detail", "original",
            "cyokuzen_original", "tenjidetail", "tenji_detail", "shusso",
            "cyokuzen2", "syussou", "cyokuzeninfo"]
    for req in cand:
        url = (f"{BASE}/sp/ajax/ajax_yosou.php"
               f"?targetday={hd}&race=1&req={req}&run=0")
        try:
            raw = fetch_bytes(url, timeout=10, retries=0, headers=h_ajax)
            txt = raw.decode("utf-8", errors="replace")
            hit = ("一周" in txt) and ("まわり足" in txt)
            print(f"[req={req}] ({len(raw)}B) {_marks(txt)} {'<<< ORIG!' if hit else ''}")
            if hit:
                with open(os.path.join(OUTDIR, f"tsu_orig_{req}.html"), "wb") as f:
                    f.write(raw)
        except Exception as e:
            print(f"[req={req}] -- {str(e)[:40]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
