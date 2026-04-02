#!/usr/bin/env python3
"""
BoatRace Oracle - 今節成績・部品交換・選手写真取得スクリプト
GitHub Actionsから1日2回実行される

処理フロー:
1. Open API programs/today.json から本日の開催場・レース一覧を取得
2. 各場の1Rの出走表ページから今節成績を取得
3. 各場の直前情報ページから部品交換情報を取得
4. 本日出走する選手の写真をダウンロード（未取得分のみ）
5. data/racedata/today.json に出力
"""

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta

import requests
from bs4 import BeautifulSoup

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

JST = timezone(timedelta(hours=9))
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BoatRaceOracle/1.0)"}
PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
RACELIST_URL = "https://www.boatrace.jp/owpc/pc/race/racelist?rno={rno}&jcd={jcd:02d}&hd={date}"
BEFOREINFO_URL = "https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno={rno}&jcd={jcd:02d}&hd={date}"
PHOTO_URL = "https://www.boatrace.jp/racerphoto/{}.jpg"
OUTPUT_FILE = "data/racedata/today.json"
PHOTO_DIR = "data/photos"


def get_today_programs():
    """Open APIから本日の開催場・レース一覧を取得"""
    try:
        resp = requests.get(PROGRAMS_URL, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"ERROR: プログラム取得失敗: {e}", file=sys.stderr)
        return {}


def scrape_current_series(jcd, date_str, boats_info):
    """出走表ページから今節成績を取得"""
    url = RACELIST_URL.format(rno=1, jcd=jcd, date=date_str)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            return {}

        results = {}

        if HAS_PANDAS:
            # pandasでテーブル解析
            try:
                tables = pd.read_html(resp.text)
                # 出走表テーブルを探す
                for tbl in tables:
                    cols = list(tbl.columns)
                    # 今節成績列を含むテーブルを特定
                    for col in cols:
                        if "節" in str(col) or "成績" in str(col):
                            break
            except Exception:
                pass

        # BeautifulSoupでもパース（フォールバック）
        soup = BeautifulSoup(resp.text, "lxml")

        # 選手ごとの今節成績を抽出
        rows = soup.select("tbody.is-fs12")
        for idx, row in enumerate(rows):
            if idx >= 6:
                break
            boat_num = idx + 1
            # 今節成績セルを探す
            tds = row.select("td")
            series_results = []
            for td in tds:
                text = td.get_text(strip=True)
                # 着順は1-6の数字
                if text.isdigit() and 1 <= int(text) <= 6:
                    series_results.append(int(text))
                elif text in ["妨", "失", "転", "落", "沈", "不", "欠", "エ", "返"]:
                    series_results.append(6)  # 事故等は6着扱い

            if series_results:
                avg = sum(series_results) / len(series_results) if series_results else 0
                win = sum(1 for r in series_results if r == 1)
                top2 = sum(1 for r in series_results if r <= 2)
                top3 = sum(1 for r in series_results if r <= 3)
                results[boat_num] = {
                    "results": series_results,
                    "summary": {
                        "races": len(series_results),
                        "avg_place": round(avg, 2),
                        "win": win,
                        "top2": top2,
                        "top3": top3,
                    }
                }

        return results
    except Exception as e:
        print(f"  今節成績取得失敗 {jcd}: {e}", file=sys.stderr)
        return {}


def scrape_parts(jcd, rno, date_str):
    """直前情報ページから部品交換情報を取得"""
    url = BEFOREINFO_URL.format(rno=rno, jcd=jcd, date=date_str)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            return {}

        soup = BeautifulSoup(resp.text, "lxml")
        parts = {}

        # 部品交換テーブルを探す
        note_bodies = soup.select(".table1_noteBody")
        for note in note_bodies:
            text = note.get_text(strip=True)
            if not text:
                continue
            # 部品名を含むセルを探す
            part_keywords = [
                "ピストン", "リング", "シリンダー", "クランク",
                "キャリア", "ギヤ", "電気", "キャブ",
            ]
            found_parts = [kw for kw in part_keywords if kw in text]
            if found_parts:
                # 対応する艇番を特定（親要素から推定）
                parent_row = note.find_parent("tr")
                if parent_row:
                    first_td = parent_row.find("td")
                    if first_td:
                        td_text = first_td.get_text(strip=True)
                        if td_text.isdigit():
                            parts[int(td_text)] = found_parts

        return parts
    except Exception as e:
        print(f"  部品交換取得失敗 {jcd}-{rno}: {e}", file=sys.stderr)
        return {}


def download_photos(racer_numbers):
    """選手写真をダウンロード（未取得分のみ）"""
    os.makedirs(PHOTO_DIR, exist_ok=True)
    downloaded = 0
    skipped = 0

    for rn in racer_numbers:
        path = os.path.join(PHOTO_DIR, f"{rn}.jpg")
        if os.path.exists(path):
            skipped += 1
            continue
        try:
            resp = requests.get(
                PHOTO_URL.format(rn),
                headers=HEADERS,
                timeout=10
            )
            if resp.status_code == 200 and len(resp.content) > 100:
                with open(path, "wb") as f:
                    f.write(resp.content)
                downloaded += 1
            time.sleep(1)
        except Exception:
            pass

    print(f"  写真: {downloaded}枚ダウンロード, {skipped}枚キャッシュ済み")


def cleanup_old_photos(active_racers, max_age_days=60):
    """古い写真を削除"""
    if not os.path.exists(PHOTO_DIR):
        return
    now = time.time()
    removed = 0
    for fname in os.listdir(PHOTO_DIR):
        fpath = os.path.join(PHOTO_DIR, fname)
        # アクティブな選手の写真は残す
        rn = fname.replace(".jpg", "")
        if rn in active_racers:
            continue
        # 古いファイルを削除
        if now - os.path.getmtime(fpath) > max_age_days * 86400:
            os.remove(fpath)
            removed += 1
    if removed > 0:
        print(f"  古い写真 {removed}枚を削除")


def main():
    date_str = datetime.now(JST).strftime("%Y%m%d")
    programs = get_today_programs()
    if not programs:
        print("本日のレースがありません")
        return

    all_racedata = []
    all_racers = set()

    for sid, stadium_races in programs.items():
        jcd = int(sid)
        race_nums = sorted(stadium_races.keys(), key=int)
        print(f"場{jcd}: {len(race_nums)}R")

        # 全選手の登録番号を収集
        for rn, race in stadium_races.items():
            if race.get("boats") and isinstance(race["boats"], list):
                for boat in race["boats"]:
                    rid = boat.get("racer_registration_number")
                    if rid:
                        all_racers.add(str(rid))

        # 今節成績（1Rの出走表から取得）
        series = scrape_current_series(jcd, date_str, stadium_races.get("1", {}).get("boats", []))
        time.sleep(3)

        # 部品交換（1Rの直前情報から）
        parts = scrape_parts(jcd, 1, date_str)
        time.sleep(3)

        # レースデータ構築
        for rn in race_nums:
            race = stadium_races[rn]
            boats_data = []
            if race.get("boats") and isinstance(race["boats"], list):
                for boat in race["boats"]:
                    bn = boat.get("racer_boat_number", 0)
                    rid = boat.get("racer_registration_number", 0)
                    boat_entry = {
                        "boat_number": bn,
                        "racer_number": rid,
                        "racer_name": boat.get("racer_name", ""),
                    }
                    # 今節成績
                    if bn in series:
                        boat_entry["current_series"] = series[bn]["results"]
                        boat_entry["current_series_summary"] = series[bn]["summary"]
                    # 部品交換
                    if bn in parts:
                        boat_entry["parts_replaced"] = parts[bn]

                    boats_data.append(boat_entry)

            all_racedata.append({
                "stadium": jcd,
                "race": int(rn),
                "boats": boats_data,
            })

    # 選手写真ダウンロード
    print(f"選手写真チェック: {len(all_racers)}人")
    download_photos(all_racers)
    cleanup_old_photos(all_racers)

    # 出力
    output = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "racedata": all_racedata,
    }
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, ensure_ascii=False)

    print(f"完了: {len(all_racedata)}レースのデータを保存")


if __name__ == "__main__":
    main()
