#!/usr/bin/env python3
"""
boatrace.jp公式サイトからレース結果（着順・払戻金）を取得し、
Open API互換のJSON形式で出力する。
"""

import json, os, re, time, datetime
from urllib.request import urlopen, Request

BASE_URL = "https://www.boatrace.jp/owpc/pc/race/raceresult"
PROG_API = "https://boatraceopenapi.github.io/programs/v2/today.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
INTERVAL = 3
OUTPUT = "data/results/today.json"


def fetch(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", errors="replace")


def fetch_json(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def parse_raceresult(html, stadium, race_num):
    """raceresultページから結果を抽出"""
    result = {
        "race_stadium_number": stadium,
        "race_number": race_num,
        "race_date": datetime.datetime.now().strftime("%Y-%m-%d"),
        "race_technique_number": None,
        "boats": [],
        "payouts": {
            "trifecta": [],
            "trio": [],
            "exacta": [],
            "quinella": [],
            "quinella_place": [],
            "win": [],
            "place": [],
        },
    }

    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")

        # 着順テーブル
        result_table = soup.select_one(".table1")
        if result_table:
            rows = result_table.select("tbody tr")
            for row in rows:
                tds = row.select("td")
                if len(tds) < 3:
                    continue

                place_text = tds[0].get_text(strip=True)
                boat_text = tds[1].get_text(strip=True)

                try:
                    place = int(place_text)
                    boat_num = int(boat_text)
                except ValueError:
                    continue

                name = tds[2].get_text(strip=True) if len(tds) > 2 else ""

                boat_data = {
                    "racer_boat_number": boat_num,
                    "racer_place_number": place,
                    "racer_course_number": boat_num,
                    "racer_name": name,
                    "racer_start_timing": None,
                    "racer_number": None,
                }
                result["boats"].append(boat_data)

            if result["boats"]:
                result["race_technique_number"] = 1

        # 払戻金テーブル
        payout_tables = soup.select(".table1")
        for table in payout_tables:
            text = table.get_text()
            if "払戻" not in text and "配当" not in text:
                continue

            rows = table.select("tr")
            for row in rows:
                tds = row.select("td")
                if len(tds) < 2:
                    continue

                label = row.select_one("th")
                if not label:
                    continue
                label_text = label.get_text(strip=True)

                combo_text = tds[0].get_text(strip=True)
                amount_text = (
                    tds[1]
                    .get_text(strip=True)
                    .replace(",", "")
                    .replace("円", "")
                    .replace("¥", "")
                )

                try:
                    amount = int(re.search(r"\d+", amount_text).group())
                except (ValueError, AttributeError):
                    continue

                payout_entry = {"combination": combo_text, "amount": amount}

                if "3連単" in label_text:
                    result["payouts"]["trifecta"].append(payout_entry)
                elif "3連複" in label_text:
                    result["payouts"]["trio"].append(payout_entry)
                elif "2連単" in label_text:
                    result["payouts"]["exacta"].append(payout_entry)
                elif "2連複" in label_text:
                    result["payouts"]["quinella"].append(payout_entry)
                elif "単勝" in label_text:
                    result["payouts"]["win"].append(payout_entry)
                elif "複勝" in label_text:
                    result["payouts"]["place"].append(payout_entry)

    except ImportError:
        # BeautifulSoupなしのフォールバック
        places = re.findall(r"<td[^>]*>(\d)</td>", html)
        if len(places) >= 6:
            for i in range(6):
                result["boats"].append(
                    {
                        "racer_boat_number": int(places[i]),
                        "racer_place_number": i + 1,
                        "racer_course_number": int(places[i]),
                        "racer_name": None,
                        "racer_start_timing": None,
                        "racer_number": None,
                    }
                )
            result["race_technique_number"] = 1

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
                    "results": [],
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

    all_results = []
    for sid, rn in sorted(races):
        jcd = f"{sid:02d}"
        url = f"{BASE_URL}?rno={rn}&jcd={jcd}&hd={date_str}"
        try:
            html = fetch(url)
            race_result = parse_raceresult(html, sid, rn)
            all_results.append(race_result)
            status = "finished" if race_result["race_technique_number"] else "not yet"
            print(f"  Stadium {sid} Race {rn}: {status}")
        except Exception as e:
            print(f"  Stadium {sid} Race {rn}: {e}")
        time.sleep(INTERVAL)

    output = {
        "results": all_results,
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    print(
        f"Done! {len([r for r in all_results if r['race_technique_number']])} finished races"
    )


if __name__ == "__main__":
    main()
