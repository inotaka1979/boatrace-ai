#!/usr/bin/env python3
"""
BoatRace Oracle - 月間開催日程取得スクリプト
月1回（月初）に実行される

処理フロー:
1. 当月と翌月のスケジュールページを取得
2. 各場の開催日程・グレード・レース名を抽出
3. data/schedule/current.json に出力
"""

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta

import requests
from bs4 import BeautifulSoup

JST = timezone(timedelta(hours=9))
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BoatRaceOracle/1.0)"}
SCHEDULE_URL = "https://www.boatrace.jp/owpc/pc/race/monthlyschedule?ym={ym}"
OUTPUT_FILE = "data/schedule/current.json"

STADIUMS = {
    1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川",
    6: "浜名湖", 7: "蒲郡", 8: "常滑", 9: "津", 10: "三国",
    11: "びわこ", 12: "住之江", 13: "尼崎", 14: "鳴門", 15: "丸亀",
    16: "児島", 17: "宮島", 18: "徳山", 19: "下関", 20: "若松",
    21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村",
}

GRADE_MAP = {
    "is-gradeColorSG": "SG",
    "is-gradeColorG1": "G1",
    "is-gradeColorG2": "G2",
    "is-gradeColorG3": "G3",
}


def scrape_month(year_month):
    """月間スケジュールを取得"""
    url = SCHEDULE_URL.format(ym=year_month)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            print(f"  スケジュール取得失敗: {resp.status_code}", file=sys.stderr)
            return []

        soup = BeautifulSoup(resp.text, "lxml")
        events = []

        # スケジュールテーブルの各セルを解析
        rows = soup.select("table.is-calendar tr")
        for row in rows:
            cells = row.select("td")
            for cell in cells:
                # グレード判定
                grade = "一般"
                for cls_name, g in GRADE_MAP.items():
                    if cls_name in (cell.get("class") or []):
                        grade = g
                        break

                # イベント名とリンクの取得
                links = cell.select("a")
                for link in links:
                    title = link.get_text(strip=True)
                    href = link.get("href", "")
                    if not title or not href:
                        continue

                    # 場番号の推定（URLのjcdパラメータから）
                    stadium = 0
                    if "jcd=" in href:
                        try:
                            jcd_str = href.split("jcd=")[1].split("&")[0]
                            stadium = int(jcd_str)
                        except (ValueError, IndexError):
                            pass

                    if stadium > 0 and title:
                        events.append({
                            "stadium": stadium,
                            "stadium_name": STADIUMS.get(stadium, f"場{stadium}"),
                            "grade": grade,
                            "title": title,
                        })

        return events
    except Exception as e:
        print(f"  スケジュール解析失敗: {e}", file=sys.stderr)
        return []


def main():
    now = datetime.now(JST)
    months_data = []

    # 当月
    ym1 = now.strftime("%Y%m")
    print(f"当月取得: {ym1}")
    events1 = scrape_month(ym1)
    months_data.append({
        "year_month": now.strftime("%Y-%m"),
        "events": events1,
    })
    time.sleep(3)

    # 翌月
    next_month = now.replace(day=1) + timedelta(days=32)
    ym2 = next_month.strftime("%Y%m")
    print(f"翌月取得: {ym2}")
    events2 = scrape_month(ym2)
    months_data.append({
        "year_month": next_month.strftime("%Y-%m"),
        "events": events2,
    })

    output = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "months": months_data,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total_events = sum(len(m["events"]) for m in months_data)
    print(f"完了: {total_events}イベントを保存")


if __name__ == "__main__":
    main()
