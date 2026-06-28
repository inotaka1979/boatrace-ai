#!/usr/bin/env python3
"""各場「オリジナル展示」(一周/まわり足/直線/展示タイム)を取得する。

boatrace.jp(全国版)には無い、各場が独自に実測・公開する周回展示データを予想に取り込む。
場ごとにサイト構造が異なるため、場別パーサを持つ。現状は鳴門(jcd=14)に対応。

鳴門(n14.jp)の直前情報は AJAX:
  GET /sp/ajax/ajax_yosou.php?targetday=YYYYMMDD&race=N&req=cyokuzen&run=0
  (Referer / X-Requested-With ヘッダ必須。無いと空応答)
返る HTML の「各タイム」表: col4=展示, col5=一周, col6=まわり足, col7=直線、
各艇 2 行(メイン + 調整重量行)。rank_1/rank_2 クラスが各列の最速/2番手を示す。

出力 data/orig_exhibition/today.json(openapi 互換の補助データ):
  {"updated_at","race_date","exhibition":[
     {"race_stadium_number","race_number","boats":[
        {"racer_boat_number","ex_time","lap_time","turn_time","straight_time","adjust_weight"}]}]}
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402
from http_utils import fetch_text  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTPUT = "data/orig_exhibition/today.json"

NARUTO_AJAX = (
    "https://www.n14.jp/sp/ajax/ajax_yosou.php"
    "?targetday={d}&race={rno}&req=cyokuzen&run=0"
)
NARUTO_HEADERS = {
    "Referer": "https://www.n14.jp/sp/",
    "X-Requested-With": "XMLHttpRequest",
}


def _f(s):
    try:
        v = float(str(s).strip())
        return v if v > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


def parse_naruto_cyokuzen(html, sid, rno):
    """鳴門 cyokuzen HTML → {race_stadium_number,race_number,boats:[...]} | None。

    「各タイム」表(ヘッダに 一周/まわり足/直線)を探し、col4-7 を抽出する。
    展示前で値が出ていない場合は boats=[] か None。
    """
    soup = BeautifulSoup(html, "html.parser")
    # 一周/まわり足/直線 を含むテーブルを特定
    target = None
    for tbl in soup.find_all("table"):
        txt = tbl.get_text()
        if ("一周" in txt) and ("まわり足" in txt) and ("直線" in txt):
            target = tbl
            break
    if target is None:
        return None

    boats = []
    rows = target.find_all("tr")
    for i, row in enumerate(rows):
        waku_td = row.find("td", class_="waku")
        if not waku_td:
            continue
        try:
            waku = int(waku_td.get_text(strip=True))
        except (TypeError, ValueError):
            continue
        if not (1 <= waku <= 6):
            continue

        def col(c):
            td = row.find("td", class_=c)
            return _f(td.get_text(strip=True)) if td else 0.0

        # 調整重量は次行 col2
        adj = 0.0
        if i + 1 < len(rows):
            sub = rows[i + 1].find("td", class_="col2")
            if sub:
                adj = _f(sub.get_text(strip=True))

        boats.append({
            "racer_boat_number": waku,
            "ex_time": col("col4"),       # 展示(直線150m)タイム
            "lap_time": col("col5"),      # 一周タイム
            "turn_time": col("col6"),     # まわり足
            "straight_time": col("col7"),  # 直線
            "adjust_weight": adj,
        })

    if not boats:
        return None
    return {
        "race_stadium_number": int(sid),
        "race_number": int(rno),
        "boats": boats,
    }


def _has_times(race):
    """1 艇でも一周/まわり足/直線が入っていれば True(展示後)。"""
    return any(
        (b["lap_time"] or b["turn_time"] or b["straight_time"]) > 0
        for b in race.get("boats", [])
    )


def scrape_naruto(date_str):
    """鳴門 全 12R の cyokuzen を取得し、値が入ったレースのみ返す。"""
    out = []
    for rno in range(1, 13):
        url = NARUTO_AJAX.format(d=date_str, rno=rno)
        try:
            html = fetch_text(url, timeout=15, retries=1, headers=NARUTO_HEADERS)
            race = parse_naruto_cyokuzen(html, 14, rno)
        except Exception as e:
            print(f"  naruto {rno}R fail: {e}")
            race = None
        if race and _has_times(race):
            out.append(race)
    return out


def main() -> int:
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    date_str = datetime.now(JST).strftime("%Y%m%d")
    exhibition = []
    exhibition.extend(scrape_naruto(date_str))
    atomic_write_json(OUTPUT, {
        "updated_at": utc_iso_seconds(),
        "race_date": f"{date_str[0:4]}-{date_str[4:6]}-{date_str[6:8]}",
        "exhibition": exhibition,
    })
    print(f"wrote {OUTPUT}: {len(exhibition)} races with original exhibition times")
    return 0


if __name__ == "__main__":
    sys.exit(main())
