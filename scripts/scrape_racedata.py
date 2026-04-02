#!/usr/bin/env python3
"""
BoatRace Oracle - 今節成績・部品交換・選手写真 取得スクリプト
GitHub Actionsから1日2回実行される

処理:
1. Open API programs/today.json → 本日の開催場を特定
2. 各場の出走表ページ(racelist) → 今節成績を取得
3. 各場の直前情報ページ(beforeinfo) → 部品交換情報を取得
4. 出走選手の写真をダウンロード（未取得分のみ）
"""

import json, os, time, datetime, re
from urllib.request import urlopen, Request
from bs4 import BeautifulSoup

PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
BASE_URL = "https://www.boatrace.jp/owpc/pc/race"
PHOTO_URL = "https://www.boatrace.jp/racerphoto/{}.jpg"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
INTERVAL = 3
OUTPUT_RACEDATA = "data/racedata/today.json"
PHOTO_DIR = "data/photos"

def fetch_json(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

def fetch_html(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=15) as r:
        return r.read().decode()

def scrape_racelist(jcd, rno, date_str):
    """出走表ページから今節成績を取得"""
    url = f"{BASE_URL}/racelist?rno={rno}&jcd={jcd}&hd={date_str}"
    try:
        html = fetch_html(url)
        soup = BeautifulSoup(html, "html.parser")
        boats = []

        for i, row in enumerate(soup.select("tbody.is-fs12"), 1):
            if i > 6: break
            tds = row.select("td")
            series_text = ""
            for td in tds:
                text = td.get_text(strip=True)
                if re.match(r'^[\d\s]+$', text) and len(text) > 2:
                    series_text = text
                    break

            results = []
            if series_text:
                for ch in series_text.split():
                    try:
                        results.append(int(ch))
                    except ValueError:
                        pass

            avg = sum(results) / len(results) if results else 0
            wins = results.count(1)
            top2 = sum(1 for r in results if r <= 2)
            top3 = sum(1 for r in results if r <= 3)

            boats.append({
                "boat_number": i,
                "current_series_results": results,
                "current_series_summary": {
                    "races": len(results),
                    "avg_place": round(avg, 2),
                    "win": wins,
                    "top2": top2,
                    "top3": top3
                }
            })

        return boats
    except Exception as e:
        print(f"  Error scraping racelist: {e}")
        return []

def scrape_beforeinfo(jcd, rno, date_str):
    """直前情報ページから部品交換情報を取得"""
    url = f"{BASE_URL}/beforeinfo?rno={rno}&jcd={jcd}&hd={date_str}"
    try:
        html = fetch_html(url)
        soup = BeautifulSoup(html, "html.parser")
        parts = {}

        for note in soup.select(".table1_noteBody"):
            text = note.get_text(strip=True)
            if text and text != "\xa0":
                parent_row = note.find_parent("tr")
                if parent_row:
                    boat_td = parent_row.select_one(".table1_boatImage1Number")
                    if boat_td:
                        bn = boat_td.get_text(strip=True)
                        try:
                            parts[int(bn)] = text.split()
                        except ValueError:
                            pass

        return parts
    except Exception as e:
        print(f"  Error scraping beforeinfo: {e}")
        return {}

def download_photo(racer_number):
    """選手写真をダウンロード（未取得分のみ）"""
    path = f"{PHOTO_DIR}/{racer_number}.jpg"
    if os.path.exists(path):
        return
    try:
        url = PHOTO_URL.format(racer_number)
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=10) as r:
            if r.status == 200:
                os.makedirs(PHOTO_DIR, exist_ok=True)
                with open(path, "wb") as f:
                    f.write(r.read())
        time.sleep(1)
    except Exception:
        pass

def main():
    os.makedirs(os.path.dirname(OUTPUT_RACEDATA), exist_ok=True)

    print("Fetching today's programs...")
    try:
        prog = fetch_json(PROGRAMS_URL)
    except Exception as e:
        print(f"Failed: {e}")
        return

    programs = prog.get("programs", [])
    if not programs:
        print("No programs today")
        with open(OUTPUT_RACEDATA, "w") as f:
            json.dump({"updated_at": datetime.datetime.utcnow().isoformat() + "Z", "racedata": []}, f)
        return

    stadiums = {}
    date_str = ""
    racer_numbers = set()
    for p in programs:
        sid = p["race_stadium_number"]
        rn = p["race_number"]
        if not date_str:
            date_str = p.get("race_date", "").replace("-", "")
        if sid not in stadiums:
            stadiums[sid] = []
        stadiums[sid].append(rn)
        for b in p.get("boats", []):
            if b.get("racer_number"):
                racer_numbers.add(b["racer_number"])

    print(f"Date: {date_str}, {len(stadiums)} stadiums, {len(racer_numbers)} racers")

    all_data = []
    for sid, race_nums in sorted(stadiums.items()):
        jcd = f"{sid:02d}"
        print(f"  Stadium {sid}...")

        for rn in sorted(race_nums):
            boats = scrape_racelist(jcd, rn, date_str)
            time.sleep(INTERVAL)

            parts = scrape_beforeinfo(jcd, rn, date_str)
            time.sleep(INTERVAL)

            for b in boats:
                b["parts_replaced"] = parts.get(b["boat_number"], [])

            all_data.append({
                "stadium": sid,
                "race": rn,
                "boats": boats
            })

    print(f"Downloading photos for {len(racer_numbers)} racers...")
    for rn in sorted(racer_numbers):
        download_photo(rn)

    if os.path.exists(PHOTO_DIR):
        now = time.time()
        for fname in os.listdir(PHOTO_DIR):
            fpath = os.path.join(PHOTO_DIR, fname)
            if fname == ".gitkeep":
                continue
            if now - os.path.getmtime(fpath) > 60 * 86400:
                os.remove(fpath)
                print(f"  Removed old photo: {fname}")

    result = {
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "racedata": all_data
    }
    with open(OUTPUT_RACEDATA, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"Done! {len(all_data)} races written")

if __name__ == "__main__":
    main()
