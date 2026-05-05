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

import json, os, sys, time, datetime, re
from urllib.request import urlopen, Request
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # P2 D-01
from time_utils import utc_iso_seconds  # P2 D-02
from http_utils import fetch_text, fetch_json, DEFAULT_HEADERS  # PC-1

PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
BASE_URL = "https://www.boatrace.jp/owpc/pc/race"
PHOTO_URL = "https://www.boatrace.jp/racerphoto/{}.jpg"
HEADERS = DEFAULT_HEADERS  # PC-1: 共通 UA を再エクスポート（写真 DL の urlopen 用）
INTERVAL = 3
OUTPUT_RACEDATA = "data/racedata/today.json"
PHOTO_DIR = "data/photos"


def fetch_html(url: str) -> str:
    """URL から HTML を取得（http_utils.fetch_text の alias）。"""
    return fetch_text(url)

def scrape_racelist(jcd: str, rno: int, date_str: str) -> list[dict]:
    """出走表ページから今節成績（直近 6 艇分）を取得する。

    boatrace.jp の HTML 構造（2026 時点）:
      - tbody.is-fs12 = 1 名分の 4 行 group
      - tr[0]: 枠/写真/名前/F.L/勝率等 + レースNo (今節各日)
      - tr[1]: 進入コース (今節各日)
      - tr[2]: スタートタイミング (今節各日)
      - tr[3]: 着順 (全角数字、今節各日)  ← これを取りたい

    着順が全角数字 (２, ５ 等) で入っているので半角に変換。
    特殊コード (転覆/失格 等) は記号文字なので位置 0 にマップ（無効扱い）。

    Args:
        jcd: 場番号 2 桁文字列 (例 "01")
        rno: レース番号 (1..12)
        date_str: 日付 YYYYMMDD 文字列

    Returns:
        艇番順の dict 配列。各 dict は current_series_results / summary を含む。
        失敗時は空リスト。
    """
    url = f"{BASE_URL}/racelist?rno={rno}&jcd={jcd}&hd={date_str}"
    try:
        html = fetch_html(url)
        soup = BeautifulSoup(html, "html.parser")
        boats = []

        # 全角→半角 変換テーブル
        zen2han = str.maketrans("０１２３４５６７８９", "0123456789")

        for i, tbody in enumerate(soup.select("tbody.is-fs12"), 1):
            if i > 6: break
            trs = tbody.find_all("tr", recursive=False)
            # tr[1] = 進入コース、tr[2] = ST、tr[3] = 着順（同じ td index で対応）
            tr1 = trs[1].find_all("td", recursive=False) if len(trs) >= 2 else []
            tr2 = trs[2].find_all("td", recursive=False) if len(trs) >= 3 else []
            tr3 = trs[3].find_all("td", recursive=False) if len(trs) >= 4 else []
            # Macool 風: 14 cells (= 7 days × 2 slots) を全て保持、空セルは null。
            # 当面 14 cells を保持し、フロントが日割りグルーピングを担当。
            n = max(len(tr1), len(tr2), len(tr3))
            results: list = []
            for j in range(n):
                ct = tr1[j].get_text(strip=True).translate(zen2han) if j < len(tr1) else ""
                st = tr2[j].get_text(strip=True) if j < len(tr2) else ""
                pt = tr3[j].get_text(strip=True).translate(zen2han) if j < len(tr3) else ""
                if (not ct or ct == "\xa0") and (not st or st == "\xa0") and (not pt or pt == "\xa0"):
                    results.append(None)
                    continue
                place = None
                try:
                    pv = int(pt)
                    if 1 <= pv <= 6: place = pv
                except ValueError:
                    pass
                course = None
                try:
                    cv = int(ct)
                    if 1 <= cv <= 6: course = cv
                except ValueError:
                    pass
                # ST は ".26" 等。先頭ピリオド付の文字列として保持
                results.append({"course": course, "place": place, "st": st or None})

            # サマリ計算は place のみ集計
            places = [r["place"] for r in results if r and r.get("place")]
            avg = sum(places) / len(places) if places else 0
            wins = places.count(1)
            top2 = sum(1 for p in places if p <= 2)
            top3 = sum(1 for p in places if p <= 3)

            boats.append({
                "boat_number": i,
                "current_series_results": results,   # [{course,place,st} | null, ...] (14 entries 想定)
                "current_series_summary": {
                    "races": len(places),
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

def scrape_beforeinfo(jcd: str, rno: int, date_str: str) -> dict[int, list[str]]:
    """直前情報ページから艇番→部品交換タグ配列のマップを取得する。"""
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

def download_photo(racer_number: int | str, attempts: int = 2) -> bool:
    """選手写真を data/photos/{番号}.jpg にダウンロード。

    既存ファイルが >500B あればスキップ（プレースホルダ画像対策で size 検証）。
    timeout 20s × attempts 回までリトライ。成功 True / 失敗 False。
    """
    path = f"{PHOTO_DIR}/{racer_number}.jpg"
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return True
    url = PHOTO_URL.format(racer_number)
    last_err = None
    for i in range(attempts):
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=20) as r:
                if r.status == 200:
                    data = r.read()
                    if len(data) > 500:
                        os.makedirs(PHOTO_DIR, exist_ok=True)
                        with open(path, "wb") as f:
                            f.write(data)
                        time.sleep(0.3)
                        return True
                    last_err = f"too small ({len(data)}b)"
                else:
                    last_err = f"status {r.status}"
        except Exception as e:
            last_err = str(e)[:60]
        time.sleep(0.5)
    print(f"[photo] download fail ({url}): {last_err}")
    return False

def main() -> None:
    """エントリーポイント: 本日の出走表 / 直前情報 / 写真を取得し OUTPUT_RACEDATA に出力。"""
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
        atomic_write_json(OUTPUT_RACEDATA, {"updated_at": utc_iso_seconds(), "racedata": []})  # D-01 / D-02
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

    # D-08: 写真削除に try/except、削除失敗は warn にとどめて続行
    if os.path.exists(PHOTO_DIR):
        now = time.time()
        for fname in os.listdir(PHOTO_DIR):
            fpath = os.path.join(PHOTO_DIR, fname)
            if fname == ".gitkeep":
                continue
            try:
                if now - os.path.getmtime(fpath) > 60 * 86400:
                    os.remove(fpath)
                    print(f"  Removed old photo: {fname}")
            except OSError as e:
                print(f"  WARN: photo cleanup failed {fname}: {e}")

    result = {
        "updated_at": utc_iso_seconds(),  # D-02
        "racedata": all_data,
    }
    atomic_write_json(OUTPUT_RACEDATA, result)  # D-01

    print(f"Done! {len(all_data)} races written")

if __name__ == "__main__":
    main()
