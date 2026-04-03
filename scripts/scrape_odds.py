#!/usr/bin/env python3
"""
BoatRace Oracle - オッズ自動取得スクリプト
GitHub Actionsから15分間隔で実行される

処理:
1. Boatrace Open API programs/today.json → 本日の開催場+レース一覧を取得
2. 各レースのオッズページ(boatrace.jp)をBeautifulSoupでスクレイピング
3. data/odds/today.json にJSON出力
"""

import json, os, time, datetime
from urllib.request import urlopen, Request
from bs4 import BeautifulSoup

PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
ODDS_BASE = "https://www.boatrace.jp/owpc/pc/race"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
INTERVAL = 3  # リクエスト間隔（秒）
OUTPUT = "data/odds/today.json"

def fetch_json(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

def fetch_html(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=15) as r:
        return r.read().decode()

def scrape_odds_page(url, bet_type):
    """オッズページからオッズを取得"""
    try:
        html = fetch_html(url)
        soup = BeautifulSoup(html, "html.parser")
        odds = {}

        if bet_type == "win":
            # 単勝: oddstf ページの最初のis-w495テーブル
            # 各行: td[0]=艇番, td[1]=選手名, td[2]=オッズ
            win_tables = soup.select("table.is-w495")
            if win_tables:
                for row in win_tables[0].select("tbody tr"):
                    tds = row.select("td")
                    if len(tds) >= 3:
                        boat = tds[0].get_text(strip=True)
                        val = tds[2].get_text(strip=True)
                        # 範囲表示(1.0-1.1)の場合は先頭の値を使用
                        if "-" in val and "." in val:
                            val = val.split("-")[0]
                        try:
                            odds[boat] = float(val)
                        except ValueError:
                            pass

        elif bet_type == "exacta":
            # 2連単: odds2tf ページ
            points = soup.select("td.oddsPoint")
            combos = []
            for i in range(1, 7):
                for j in range(1, 7):
                    if i != j:
                        combos.append(f"{i}-{j}")
            for k, el in enumerate(points):
                if k < len(combos):
                    try:
                        odds[combos[k]] = float(el.get_text(strip=True))
                    except ValueError:
                        pass

        elif bet_type == "trifecta":
            # 3連単: odds3t ページ
            points = soup.select("td.oddsPoint")
            combos = []
            for i in range(1, 7):
                for j in range(1, 7):
                    if j == i: continue
                    for k2 in range(1, 7):
                        if k2 == i or k2 == j: continue
                        combos.append(f"{i}-{j}-{k2}")
            for k, el in enumerate(points):
                if k < len(combos):
                    try:
                        odds[combos[k]] = float(el.get_text(strip=True))
                    except ValueError:
                        pass

        return odds
    except Exception as e:
        print(f"  Error scraping {url}: {e}")
        return {}

def main():
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

    # 1. 本日の開催情報を取得
    print("Fetching today's programs...")
    try:
        prog = fetch_json(PROGRAMS_URL)
    except Exception as e:
        print(f"Failed to fetch programs: {e}")
        return

    programs = prog.get("programs", [])
    if not programs:
        print("No programs today")
        with open(OUTPUT, "w") as f:
            json.dump({"updated_at": datetime.datetime.utcnow().isoformat() + "Z", "odds": []}, f)
        return

    # 場+レース番号の一覧
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

    print(f"Date: {date_str}, {len(races)} races found")

    # 2. 各レースのオッズを取得
    all_odds = []
    for sid, rn in sorted(races):
        jcd = f"{sid:02d}"
        print(f"  Scraping stadium={sid} race={rn}...")

        race_odds = {"stadium": sid, "race": rn}

        # 単勝
        url_win = f"{ODDS_BASE}/oddstf?rno={rn}&jcd={jcd}&hd={date_str}"
        race_odds["win"] = scrape_odds_page(url_win, "win")
        time.sleep(INTERVAL)

        # 2連単
        url_exacta = f"{ODDS_BASE}/odds2tf?rno={rn}&jcd={jcd}&hd={date_str}"
        race_odds["exacta"] = scrape_odds_page(url_exacta, "exacta")
        time.sleep(INTERVAL)

        # 3連単
        url_tri = f"{ODDS_BASE}/odds3t?rno={rn}&jcd={jcd}&hd={date_str}"
        race_odds["trifecta"] = scrape_odds_page(url_tri, "trifecta")
        time.sleep(INTERVAL)

        all_odds.append(race_odds)

    # 3. JSON出力
    result = {
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "odds": all_odds
    }
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"Done! {len(all_odds)} races written to {OUTPUT}")

if __name__ == "__main__":
    main()
