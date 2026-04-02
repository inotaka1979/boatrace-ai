#!/usr/bin/env python3
"""
BoatRace Oracle - オッズ自動取得スクリプト
GitHub Actionsから15分間隔で実行される

処理フロー:
1. Open API programs/today.json から本日の開催場・レース一覧を取得
2. 各レースのオッズページ(boatrace.jp)をスクレイピング
3. data/odds/today.json に出力
4. オッズ推移を data/odds/history.json に蓄積
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
PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
ODDS_BASE = "https://www.boatrace.jp/owpc/pc/race"
OUTPUT_FILE = "data/odds/today.json"
HISTORY_FILE = "data/odds/history.json"


def get_today_races():
    """Open APIから本日の開催場・レース一覧を取得"""
    try:
        resp = requests.get(PROGRAMS_URL, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        races = []
        for sid, stadium_races in data.items():
            for rno in stadium_races.keys():
                races.append({"stadium": int(sid), "race": int(rno)})
        return races
    except Exception as e:
        print(f"ERROR: プログラム取得失敗: {e}", file=sys.stderr)
        return []


def scrape_trifecta(jcd, rno, date_str):
    """3連単オッズを取得"""
    url = f"{ODDS_BASE}/odds3t?rno={rno}&jcd={jcd:02d}&hd={date_str}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            return {}
        soup = BeautifulSoup(resp.text, "lxml")
        odds = {}
        cells = soup.select("td.oddsPoint")
        # 3連単は120通り (6*5*4)
        combos = []
        for i in range(1, 7):
            for j in range(1, 7):
                if j == i:
                    continue
                for k in range(1, 7):
                    if k == i or k == j:
                        continue
                    combos.append(f"{i}-{j}-{k}")
        for idx, cell in enumerate(cells):
            if idx < len(combos):
                text = cell.get_text(strip=True).replace(",", "")
                try:
                    odds[combos[idx]] = float(text)
                except ValueError:
                    odds[combos[idx]] = 999.9
        return odds
    except Exception as e:
        print(f"  3連単取得失敗 {jcd}-{rno}: {e}", file=sys.stderr)
        return {}


def scrape_exacta(jcd, rno, date_str):
    """2連単オッズを取得"""
    url = f"{ODDS_BASE}/odds2tf?rno={rno}&jcd={jcd:02d}&hd={date_str}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            return {}
        soup = BeautifulSoup(resp.text, "lxml")
        odds = {}
        cells = soup.select("td.oddsPoint")
        combos = []
        for i in range(1, 7):
            for j in range(1, 7):
                if j == i:
                    continue
                combos.append(f"{i}-{j}")
        for idx, cell in enumerate(cells):
            if idx < len(combos):
                text = cell.get_text(strip=True).replace(",", "")
                try:
                    odds[combos[idx]] = float(text)
                except ValueError:
                    odds[combos[idx]] = 999.9
        return odds
    except Exception as e:
        print(f"  2連単取得失敗 {jcd}-{rno}: {e}", file=sys.stderr)
        return {}


def scrape_win(jcd, rno, date_str):
    """単勝オッズを取得"""
    url = f"{ODDS_BASE}/oddstf?rno={rno}&jcd={jcd:02d}&hd={date_str}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            return {}
        soup = BeautifulSoup(resp.text, "lxml")
        odds = {}
        cells = soup.select("td.oddsPoint")
        for idx, cell in enumerate(cells[:6]):
            text = cell.get_text(strip=True).replace(",", "")
            try:
                odds[str(idx + 1)] = float(text)
            except ValueError:
                odds[str(idx + 1)] = 999.9
        return odds
    except Exception as e:
        print(f"  単勝取得失敗 {jcd}-{rno}: {e}", file=sys.stderr)
        return {}


def update_history(today_data):
    """オッズ推移を蓄積"""
    history = {"snapshots": []}
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                history = json.load(f)
        except (json.JSONDecodeError, KeyError):
            history = {"snapshots": []}

    # 本日分のみ保持
    today_str = datetime.now(JST).strftime("%Y-%m-%d")
    history["snapshots"] = [
        s for s in history.get("snapshots", [])
        if s.get("time", "").startswith(today_str)
    ]

    # 変動があったデータのみ記録
    snapshot = {
        "time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "odds": {}
    }
    for race_odds in today_data.get("odds", []):
        key = f"{race_odds['stadium']}-{race_odds['race']}"
        if race_odds.get("win"):
            snapshot["odds"][key] = {"win": race_odds["win"]}

    if snapshot["odds"]:
        history["snapshots"].append(snapshot)
        # 最大48スナップショット(12時間×15分間隔)
        if len(history["snapshots"]) > 48:
            history["snapshots"] = history["snapshots"][-48:]

    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, ensure_ascii=False)


def main():
    date_str = datetime.now(JST).strftime("%Y%m%d")
    races = get_today_races()
    if not races:
        print("本日のレースがありません")
        return

    print(f"本日のレース数: {len(races)}")

    all_odds = []
    for race in races:
        jcd = race["stadium"]
        rno = race["race"]
        print(f"  取得中: {jcd}場 {rno}R...")

        win = scrape_win(jcd, rno, date_str)
        time.sleep(3)

        exacta = scrape_exacta(jcd, rno, date_str)
        time.sleep(3)

        trifecta = scrape_trifecta(jcd, rno, date_str)
        time.sleep(3)

        if win or exacta or trifecta:
            all_odds.append({
                "stadium": jcd,
                "race": rno,
                "win": win,
                "exacta": exacta,
                "trifecta": trifecta,
            })

    output = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "odds": all_odds,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, ensure_ascii=False)

    update_history(output)
    print(f"完了: {len(all_odds)}レースのオッズを保存")


if __name__ == "__main__":
    main()
