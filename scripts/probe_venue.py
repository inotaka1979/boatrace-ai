#!/usr/bin/env python3
"""桐生(1): scrape_ajax_cyokuzen が 0 件になる原因を診断するプローブ。

逐次化後も data に桐生/福岡が 0。実 scrape_ajax_cyokuzen を走らせて
(a) 各レースの取得可否・roster・時刻有無、(b) roster 重複抑止が出るか、
(c) 直接 ?race= パラメータ(cookie 無し)が race 別データを返すか を調べる。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_orig_exhibition as S  # noqa: E402
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.kiryu-kyotei.com"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)

    # 1) 各レースを個別取得して roster/時刻を確認(R1..R6)
    print("== per-race _fetch_one_cyokuzen ==")
    rosters = []
    for rno in range(1, 7):
        race = S._fetch_one_cyokuzen(BASE, 1, rno)
        if not race:
            print(f"R{rno}: None (取得失敗/時刻なし)")
            continue
        ros = race.get("_roster")
        rosters.append(ros)
        laps = [b["lap_time"] for b in race["boats"]]
        print(f"R{rno}: has_times={S._has_times(race)} roster={ros} laps={laps}")
    print(f"  distinct rosters: {len(set(rosters))}/{len(rosters)}")

    # 2) 本番 scrape_ajax_cyokuzen の戻り
    print("== scrape_ajax_cyokuzen() ==")
    races = S.scrape_ajax_cyokuzen(BASE, 1, "")
    print(f"  -> {len(races)} races: {[r['race_number'] for r in races]}")

    # 3) 直接 ?race= (cookie 無し) が race 別か
    print("== direct ?race= (no cookie) ==")
    for rno in (1, 5):
        url = f"{BASE}/sp/ajax/ajax_cyokuzen.php?race={rno}"
        try:
            raw = fetch_bytes(url, timeout=10, retries=0,
                              headers={"Referer": BASE + "/sp/",
                                       "X-Requested-With": "XMLHttpRequest"})
            txt = raw.decode("utf-8", errors="replace")
            r = S.parse_kiryu_cyokuzen(txt, 1, rno)
            ros = S._roster(txt)
            print(f"  ?race={rno}: roster={ros} "
                  f"laps={None if not r else [b['lap_time'] for b in r['boats']]}")
        except Exception as e:
            print(f"  ?race={rno} FAIL: {str(e)[:50]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
