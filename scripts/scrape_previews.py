#!/usr/bin/env python3
"""
boatrace.jp公式サイトから直前情報（展示タイム・ST・チルト・天候）を取得し、
Open API互換のJSON形式で出力する。

GitHub Actionsからレース時間帯に10分間隔で実行。
"""

import json, os, re, time, datetime
from urllib.request import urlopen, Request

BASE_URL = "https://www.boatrace.jp/owpc/pc/race/beforeinfo"
PROG_API = "https://boatraceopenapi.github.io/programs/v2/today.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
INTERVAL = 3
OUTPUT = "data/previews/today.json"


def fetch(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", errors="replace")


def fetch_json(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def parse_beforeinfo(html, stadium, race_num):
    """beforeinfoページのHTMLから展示情報を抽出する。"""
    result = {
        "race_stadium_number": stadium,
        "race_number": race_num,
        "race_date": datetime.datetime.now().strftime("%Y-%m-%d"),
        "boats": {},
        "race_wind": None,
        "race_wind_direction_number": None,
        "race_wave": None,
        "race_weather_number": None,
        "race_temperature": None,
        "race_water_temperature": None,
    }

    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")

        # 天候情報
        weather_div = soup.select_one(".weather1_body")
        if weather_div:
            wind_el = weather_div.select_one(
                ".weather1_bodyUnit.is-wind .weather1_bodyUnitLabelData"
            )
            if wind_el:
                m = re.search(r"(\d+)", wind_el.get_text())
                if m:
                    result["race_wind"] = int(m.group(1))
            wave_el = weather_div.select_one(
                ".weather1_bodyUnit.is-wave .weather1_bodyUnitLabelData"
            )
            if wave_el:
                m = re.search(r"(\d+)", wave_el.get_text())
                if m:
                    result["race_wave"] = int(m.group(1))
            temp_el = weather_div.select_one(
                ".weather1_bodyUnit.is-temp .weather1_bodyUnitLabelData"
            )
            if temp_el:
                m = re.search(r"([\d.]+)", temp_el.get_text())
                if m:
                    result["race_temperature"] = float(m.group(1))
            wtemp_el = weather_div.select_one(
                ".weather1_bodyUnit.is-waterTemp .weather1_bodyUnitLabelData"
            )
            if wtemp_el:
                m = re.search(r"([\d.]+)", wtemp_el.get_text())
                if m:
                    result["race_water_temperature"] = float(m.group(1))

        # 各艇の展示情報
        table = soup.select_one("table.is-w748")
        if not table:
            tables = soup.select("table")
            for t in tables:
                if "展示" in t.get_text() or len(t.select("tbody tr")) >= 6:
                    table = t
                    break

        if table:
            rows = table.select("tbody tr")
            for i, row in enumerate(rows):
                if i >= 6:
                    break
                boat_num = i + 1
                tds = row.select("td")

                boat_data = {
                    "racer_boat_number": boat_num,
                    "racer_course_number": boat_num,
                    "racer_start_timing": None,
                    "racer_exhibition_time": None,
                    "racer_tilt_adjustment": None,
                }

                values = []
                for td in tds:
                    text = td.get_text(strip=True)
                    m = re.search(r"[-]?[\d]+\.[\d]+|[-]?[\d]+", text)
                    if m:
                        try:
                            values.append(float(m.group()))
                        except ValueError:
                            pass

                for v in values:
                    if 6.0 <= v <= 8.0 and boat_data["racer_exhibition_time"] is None:
                        boat_data["racer_exhibition_time"] = v
                    elif (
                        -0.5 <= v <= 0.5
                        and abs(v) < 1
                        and boat_data["racer_start_timing"] is None
                    ):
                        boat_data["racer_start_timing"] = v
                    elif (
                        -1.0 <= v <= 3.5
                        and boat_data["racer_tilt_adjustment"] is None
                    ):
                        boat_data["racer_tilt_adjustment"] = v

                course_el = row.select_one("td:first-child")
                if course_el:
                    m = re.search(r"(\d)", course_el.get_text())
                    if m:
                        boat_data["racer_course_number"] = int(m.group(1))

                result["boats"][str(boat_num)] = boat_data

    except ImportError:
        # BeautifulSoupなしのフォールバック
        times = re.findall(r"[67]\.\d{2}", html)
        sts = re.findall(r"[0F]\.\d{2}", html)
        for i in range(min(6, len(times))):
            boat_num = i + 1
            result["boats"][str(boat_num)] = {
                "racer_boat_number": boat_num,
                "racer_course_number": boat_num,
                "racer_start_timing": float(sts[i]) if i < len(sts) else None,
                "racer_exhibition_time": float(times[i]) if i < len(times) else None,
                "racer_tilt_adjustment": None,
            }

    return result


def main():
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

    print("Fetching today's programs...")
    try:
        prog = fetch_json(PROG_API)
    except Exception as e:
        print(f"Programs fetch failed: {e}")
        return

    programs = prog.get("programs", [])
    if not programs:
        print("No programs today")
        with open(OUTPUT, "w") as f:
            json.dump(
                {
                    "previews": [],
                    "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
                },
                f,
            )
        return

    races = set()
    date_str = ""
    for p in programs:
        sid = p.get("race_stadium_number")
        rn = p.get("race_number")
        if sid and rn:
            races.add((sid, rn))
        if not date_str:
            date_str = p.get("race_date", "").replace("-", "")

    if not date_str:
        date_str = datetime.datetime.now().strftime("%Y%m%d")

    print(f"Date: {date_str}, {len(races)} races")

    all_previews = []
    for sid, rn in sorted(races):
        jcd = f"{sid:02d}"
        url = f"{BASE_URL}?rno={rn}&jcd={jcd}&hd={date_str}"
        try:
            html = fetch(url)
            preview = parse_beforeinfo(html, sid, rn)
            has_data = any(
                preview["boats"].get(str(b), {}).get("racer_exhibition_time")
                is not None
                for b in range(1, 7)
            )
            if has_data:
                all_previews.append(preview)
                print(f"  Stadium {sid} Race {rn}: OK")
            else:
                print(f"  Stadium {sid} Race {rn}: no exhibition data yet")
        except Exception as e:
            print(f"  Stadium {sid} Race {rn}: {e}")
        time.sleep(INTERVAL)

    output = {
        "previews": all_previews,
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    print(f"Done! {len(all_previews)} previews written")


if __name__ == "__main__":
    main()
