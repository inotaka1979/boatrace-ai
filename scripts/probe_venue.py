#!/usr/bin/env python3
"""江戸川(3) のオリジナル展示(ajax_cyokuzen)が表示されない原因を切り分けるプローブ。

江戸川は data/orig_exhibition/today.json に1レースも出ていない。cookie session で
レースを選び ajax_cyokuzen.php を取得する方式のため、(a)展示前 (b)race-selection 不能で
全抑止 (c)パース不一致 のどれかを切り分ける。scraper の本体関数をそのまま使って
roster の差異・時刻の有無を確認する。確認後撤去。
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_orig_exhibition as S  # noqa: E402
from scrape_orig_exhibition import _fetch_one_cyokuzen, _cookie_get  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-edogawa.com"
JCD = 3


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    date_str = datetime.now(JST).strftime("%Y%m%d")
    print(f"== 江戸川 ajax_cyokuzen (date={date_str}) ==")

    # 生 HTML を1レース保存(構造確認用)
    import http.cookiejar
    import urllib.request
    for rno in (1, 2, 3):
        page = BASE + f"/sp/index.php?page=yosou-cyokuzen&race={rno}"
        ajax = BASE + "/sp/ajax/ajax_cyokuzen.php"
        try:
            cj = http.cookiejar.CookieJar()
            op = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(cj))
            _cookie_get(op, page, BASE + "/sp/")
            html = _cookie_get(op, ajax, page)
            segs = html.split("<!--sep-->")
            marks = " ".join(f"{m}={html.count(m)}" for m in
                             ("半周", "一周", "まわり足", "直線", "展示",
                              "表示するデータがありません", "<table"))
            print(f"R{rno}: ajax {len(html)}B segs={len(segs)} {marks}")
            if rno == 1:
                p = os.path.join(OUTDIR, "edogawa_cyokuzen_R01.html")
                with open(p, "w", encoding="utf-8") as f:
                    f.write(html)
                print(f"      saved {p}")
            race = S.parse_kiryu_cyokuzen(html, JCD, rno)
            if race:
                roster = S._roster(html)
                times = [(b["racer_boat_number"], b["ex_time"], b["lap_time"],
                          b["turn_time"], b["straight_time"])
                         for b in race["boats"]]
                print(f"      parsed boats={len(race['boats'])} "
                      f"has_times={S._has_times(race)} roster={roster}")
                print(f"      times={times}")
            else:
                print("      parse → None (テーブル構造不一致 or 展示前)")
        except Exception as e:
            print(f"R{rno} FAIL: {str(e)[:90]}")

    # scraper 本体経由(roster 重複抑止が効くか)
    print("== scrape_ajax_cyokuzen() 経由(本番ロジック) ==")
    try:
        races = S.scrape_ajax_cyokuzen(BASE, JCD, date_str)
        print(f"  returned {len(races)} races: "
              f"{[r['race_number'] for r in races]}")
    except Exception as e:
        print(f"  FAIL: {str(e)[:90]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
