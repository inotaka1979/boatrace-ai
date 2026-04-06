#!/usr/bin/env python3
"""
scrape_odds_fast.py — RPi5ローカル用 高速オッズ取得

最適化:
- リクエスト間隔 1秒 (サーバー負荷を考慮しつつ高速化)
- 確定済レースはスキップ (previews/today.json から判定)
- 単勝のみ取得 (2連単/3連単は省略 → アプリ側で不要なら)
- 既存データとマージ (差分更新)

144レース全件: 約22分 → 単勝のみ未確定: 約2-5分
"""

import json, os, time, datetime, sys
from urllib.request import urlopen, Request
from bs4 import BeautifulSoup

PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
ODDS_BASE = "https://www.boatrace.jp/owpc/pc/race"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
INTERVAL = 1.0  # リクエスト間隔（秒）
OUTPUT = "data/odds/today.json"
PREVIEWS = "data/previews/today.json"

# 取得対象 (True=取得, False=スキップ)
FETCH_WIN = True
FETCH_EXACTA = True
FETCH_TRIFECTA = False  # 3連単は巨大+時間かかるので省略


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
            win_tables = soup.select("table.is-w495")
            if win_tables:
                for row in win_tables[0].select("tbody tr"):
                    tds = row.select("td")
                    if len(tds) >= 3:
                        boat = tds[0].get_text(strip=True)
                        val = tds[2].get_text(strip=True)
                        if "-" in val and "." in val:
                            val = val.split("-")[0]
                        try:
                            v = float(val)
                            if v > 0:
                                odds[boat] = v
                        except ValueError:
                            pass

        elif bet_type == "exacta":
            points = soup.select("td.oddsPoint")
            combos = []
            for i in range(1, 7):
                for j in range(1, 7):
                    if i != j:
                        combos.append(f"{i}-{j}")
            for k, el in enumerate(points):
                if k < len(combos):
                    try:
                        v = float(el.get_text(strip=True))
                        if v > 0:
                            odds[combos[k]] = v
                    except ValueError:
                        pass

        elif bet_type == "trifecta":
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
                        v = float(el.get_text(strip=True))
                        if v > 0:
                            odds[combos[k]] = v
                    except ValueError:
                        pass

        return odds
    except Exception as e:
        print(f"  Error scraping {url}: {e}", file=sys.stderr)
        return {}


def get_finished_races():
    """previews/today.json から確定済レースのセットを返す"""
    finished = set()
    if os.path.exists(PREVIEWS):
        try:
            with open(PREVIEWS) as f:
                data = json.load(f)
            for r in data.get("races", []):
                if r.get("finished"):
                    finished.add((r["stadium"], r["race"]))
        except Exception:
            pass
    return finished


def main():
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    start_time = time.time()

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

    # 確定済レースを特定
    finished = get_finished_races()

    # 既存データを読み込み（マージ用）
    existing = {}
    if os.path.exists(OUTPUT):
        try:
            with open(OUTPUT) as f:
                old = json.load(f)
            for r in old.get("odds", []):
                existing[(r["stadium"], r["race"])] = r
        except Exception:
            pass

    # レースをフィルタ
    active_races = sorted(races - finished)
    skipped = len(races) - len(active_races)
    print(f"Date: {date_str}, {len(races)} total, {skipped} finished (skip), {len(active_races)} to scrape")

    pages_per_race = sum([FETCH_WIN, FETCH_EXACTA, FETCH_TRIFECTA])
    est_time = len(active_races) * pages_per_race * (INTERVAL + 0.5)
    print(f"Estimated time: {est_time:.0f}s ({est_time/60:.1f}min)")

    # 2. アクティブなレースのオッズを取得
    scraped = 0
    for sid, rn in active_races:
        jcd = f"{sid:02d}"
        race_odds = {"stadium": sid, "race": rn}

        # 既存データがあればベースにする
        if (sid, rn) in existing:
            race_odds = existing[(sid, rn)].copy()

        if FETCH_WIN:
            url_win = f"{ODDS_BASE}/oddstf?rno={rn}&jcd={jcd}&hd={date_str}"
            win = scrape_odds_page(url_win, "win")
            if win:
                race_odds["win"] = win
            time.sleep(INTERVAL)

        if FETCH_EXACTA:
            url_exacta = f"{ODDS_BASE}/odds2tf?rno={rn}&jcd={jcd}&hd={date_str}"
            exacta = scrape_odds_page(url_exacta, "exacta")
            if exacta:
                race_odds["exacta"] = exacta
            time.sleep(INTERVAL)

        if FETCH_TRIFECTA:
            url_tri = f"{ODDS_BASE}/odds3t?rno={rn}&jcd={jcd}&hd={date_str}"
            tri = scrape_odds_page(url_tri, "trifecta")
            if tri:
                race_odds["trifecta"] = tri
            time.sleep(INTERVAL)

        existing[(sid, rn)] = race_odds
        scraped += 1

        if scraped % 20 == 0:
            print(f"  Progress: {scraped}/{len(active_races)}")

    # 確定済レースの既存データも保持
    for sid, rn in sorted(finished):
        if (sid, rn) not in existing:
            existing[(sid, rn)] = {"stadium": sid, "race": rn}

    # 3. JSON出力
    all_odds = [existing[k] for k in sorted(existing.keys())]
    result = {
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "odds": all_odds
    }
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    elapsed = time.time() - start_time
    print(f"Done! {scraped} scraped, {len(all_odds)} total → {OUTPUT} ({elapsed:.0f}s)")


if __name__ == "__main__":
    main()
