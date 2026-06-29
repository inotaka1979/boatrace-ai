#!/usr/bin/env python3
"""津(9) がオリジナル展示(一周/まわり足/直線)を公開しているか発見するプローブ。

津の ajax_yosou req=cyokuzen は直前情報(展示評価)のみで一周/まわり足/直線が無いと判明。
鳴門(n14)は req=cyokuzen に在るので津は別実装。津のページ/別 req を当たって、
オリジナル展示タブ/エンドポイントの有無を確定する。確認後撤去。
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
KW = ("オリジナル展示", "一周", "半周", "まわり足", "直線", "周回", "展示タイム",
      "展示評価", "スタート展示", "展示")


def _marks(txt):
    return " ".join(f"{m}={txt.count(m)}" for m in KW)


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    h_ajax = {"Referer": BASE + "/sp/", "X-Requested-With": "XMLHttpRequest"}
    h_pg = {"Referer": BASE + "/"}

    # 1) ホスト側ページ(タブのリンク/JSを見る)
    print("== 津 pages ==")
    for name, url in [
        ("sp", f"{BASE}/sp/"),
        ("sp_yosou_cyokuzen", f"{BASE}/sp/index.php?page=yosou-cyokuzen&race=1"),
        ("top", f"{BASE}/"),
    ]:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=h_pg)
            txt = raw.decode("utf-8", errors="replace")
            print(f"[{name}] ({len(raw)}B) {_marks(txt)}")
            refs = re.findall(
                r'''(?:href|src|data-[\w-]+|onclick)=["']?'''
                r'''([^"'<> )]*(?:cyokuzen|original|tenji|req=|kind=|周回)'''
                r'''[^"'<> )]*)''', txt)
            for r in sorted(set(refs))[:25]:
                print(f"    ref: {r}")
            # 「オリジナル展示」近傍を表示
            i = txt.find("オリジナル展示")
            if i >= 0:
                print(f"    near: {re.sub(chr(9),'',txt[i-150:i+120])}")
            if name == "sp_yosou_cyokuzen":
                with open(os.path.join(OUTDIR, "tsu_yosou_cyokuzen.html"),
                          "wb") as f:
                    f.write(raw)
        except Exception as e:
            print(f"[{name}] FAIL: {str(e)[:70]}")

    # 2) 別 req 候補を直叩き
    print("== 津 ajax req candidates ==")
    for req in ("cyokuzen2", "original", "cyokuzen_o", "shukai", "syuukai",
                "tenji", "cyokuzen&kind=2"):
        url = (f"{BASE}/sp/ajax/ajax_yosou.php"
               f"?targetday={hd}&race=1&req={req}&run=0")
        try:
            raw = fetch_bytes(url, timeout=10, retries=0, headers=h_ajax)
            txt = raw.decode("utf-8", errors="replace")
            print(f"[req={req}] ({len(raw)}B) {_marks(txt)}")
        except Exception as e:
            print(f"[req={req}] -- {str(e)[:45]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
