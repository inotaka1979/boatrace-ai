#!/usr/bin/env python3
"""
BoatRace Oracle - 展示情報リアルタイム取得スクリプト
GitHub Actionsから5分間隔で実行される

公式サイト(boatrace.jp)の直前情報ページから展示タイム・ST・チルト・進入コースを取得し、
data/previews/today.json に保存する。

Open APIは約30分遅延があるため、公式サイトから直接取得することで
レース開始前に展示データを反映させる。
"""

import json, os, time, datetime, sys
from urllib.request import urlopen, Request
from bs4 import BeautifulSoup

PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
BEFOREINFO_URL = "https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno={rno}&jcd={jcd:02d}&hd={date}"
RESULTS_URL = "https://www.boatrace.jp/owpc/pc/race/raceresult?rno={rno}&jcd={jcd:02d}&hd={date}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
INTERVAL = 1  # リクエスト間隔（秒）
OUTPUT = "data/previews/today.json"


def fetch_json(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def fetch_html(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=15) as r:
        return r.read().decode()


def scrape_beforeinfo(jcd, rno, date_str):
    """公式サイトの直前情報ページから展示データを取得"""
    url = BEFOREINFO_URL.format(rno=rno, jcd=jcd, date=date_str)
    try:
        html = fetch_html(url)
        soup = BeautifulSoup(html, "html.parser")
        boats = {}

        tables = soup.select("table")
        if len(tables) < 2:
            return None

        # テーブル[1]: 出走表+展示タイム
        t = tables[1]
        for row in t.select("tr"):
            tds = row.select("td")
            if not tds:
                continue
            texts = [td.get_text(strip=True) for td in tds]
            if not texts or texts[0] not in ["1", "2", "3", "4", "5", "6"]:
                continue
            bn = int(texts[0])
            # texts: [枠番, (写真), 選手名, 体重, 展示タイム, チルト, ...]
            et = 0
            tilt = 0
            try:
                et = float(texts[4]) if len(texts) > 4 and texts[4] else 0
            except (ValueError, IndexError):
                pass
            try:
                tilt = float(texts[5]) if len(texts) > 5 and texts[5] else 0
            except (ValueError, IndexError):
                pass

            boats[bn] = {"exhibition_time": et, "tilt": tilt, "start_timing": None, "course": None}

        # テーブル[2]: スタート展示
        if len(tables) >= 3:
            t2 = tables[2]
            rows = t2.select("tr")
            course_num = 0
            for row in rows:
                tds = row.select("td")
                if not tds:
                    continue
                text = tds[0].get_text(strip=True)
                # ST値: "1.09" = コース1のST 0.09 / "6F.04" = コース6のFスタート
                if text and ("." in text):
                    course_num += 1
                    # パース: "3.01" → コース3, ST=0.01
                    is_f = "F" in text
                    clean = text.replace("F", "")
                    parts = clean.split(".")
                    if len(parts) == 2:
                        try:
                            course = int(parts[0])
                            st_val = float("0." + parts[1])
                            if is_f:
                                st_val = -st_val
                            # コース番号から元の艇番を特定（ボートの並び順=コース）
                            # course_numがコース番号に対応
                            for bn, data in boats.items():
                                if data.get("course") is None:
                                    pass
                            # コースは上から1コース,2コース...の順
                            boats_by_course = {}
                            for bn, data in boats.items():
                                data["start_timing"] = None  # まだ設定しない
                            # コースの並び: テーブルの行順がコース1,2,3...
                            # 但し、どの艇がどのコースに入ったかの情報が必要
                            # texts[最後]が進入コース番号の可能性がある
                        except (ValueError, IndexError):
                            pass

            # STを再取得（シンプルに行順=コース番号として処理）
            st_by_course = {}
            course_idx = 0
            for row in rows:
                tds = row.select("td")
                if not tds:
                    continue
                text = tds[0].get_text(strip=True)
                if text and "." in text and any(c.isdigit() for c in text):
                    course_idx += 1
                    is_f = "F" in text
                    clean = text.replace("F", "")
                    parts = clean.split(".")
                    if len(parts) == 2:
                        try:
                            st_val = float("0." + parts[1])
                            if is_f:
                                st_val = -st_val
                            st_by_course[course_idx] = st_val
                        except ValueError:
                            pass

        # 出走表テーブルの最後の列から進入コースを取得
        for row in t.select("tr"):
            tds = row.select("td")
            if not tds:
                continue
            texts = [td.get_text(strip=True) for td in tds]
            if texts and texts[0] in ["1", "2", "3", "4", "5", "6"]:
                bn = int(texts[0])
                # 最後の数字がコース番号
                last_val = texts[-1] if texts[-1] else None
                try:
                    course = int(last_val) if last_val else bn
                except ValueError:
                    course = bn
                if bn in boats:
                    boats[bn]["course"] = course
                    # コースに対応するSTを設定
                    if course in st_by_course:
                        boats[bn]["start_timing"] = st_by_course[course]

        # データが有効か確認（少なくとも1艇に展示タイムがある）
        has_data = any(b["exhibition_time"] > 0 for b in boats.values())
        if not has_data:
            return None

        return boats

    except Exception as e:
        print(f"  Error scraping beforeinfo {jcd}-{rno}: {e}", file=sys.stderr)
        return None


def scrape_result(jcd, rno, date_str):
    """公式サイトのレース結果ページから着順・払戻を取得"""
    url = RESULTS_URL.format(rno=rno, jcd=jcd, date=date_str)
    try:
        html = fetch_html(url)
        soup = BeautifulSoup(html, "html.parser")

        # 結果テーブルを探す
        result = {"places": [], "technique": None, "payouts": {}}

        # 着順テーブル
        result_table = soup.select_one(".is-w495")
        if result_table:
            for row in result_table.select("tbody tr"):
                tds = row.select("td")
                if len(tds) >= 4:
                    texts = [td.get_text(strip=True) for td in tds]
                    try:
                        place = int(texts[0])
                        boat = int(texts[1])
                        result["places"].append({"place": place, "boat": boat})
                    except (ValueError, IndexError):
                        pass

        # 払戻金テーブル
        payout_tables = soup.select(".is-payout")
        for pt in payout_tables:
            rows = pt.select("tr")
            for row in rows:
                tds = row.select("td,th")
                texts = [td.get_text(strip=True) for td in tds]
                if len(texts) >= 3:
                    bet_type = texts[0]
                    combo = texts[1]
                    try:
                        payout = int(texts[2].replace(",", "").replace("円", "").replace("¥", ""))
                    except ValueError:
                        continue

                    type_key = None
                    if "3連単" in bet_type:
                        type_key = "trifecta"
                    elif "3連複" in bet_type:
                        type_key = "trio"
                    elif "2連単" in bet_type:
                        type_key = "exacta"
                    elif "2連複" in bet_type:
                        type_key = "quinella"
                    elif "単勝" in bet_type:
                        type_key = "win"
                    elif "複勝" in bet_type:
                        type_key = "place"

                    if type_key:
                        if type_key not in result["payouts"]:
                            result["payouts"][type_key] = []
                        result["payouts"][type_key].append({"combination": combo, "payout": payout})

        if not result["places"]:
            return None
        return result

    except Exception as e:
        print(f"  Error scraping result {jcd}-{rno}: {e}", file=sys.stderr)
        return None


def main():
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

    # 本日の開催情報を取得
    print("Fetching today's programs...")
    try:
        prog = fetch_json(PROGRAMS_URL)
    except Exception as e:
        print(f"Failed: {e}")
        return

    programs = prog.get("programs", [])
    if not programs:
        print("No programs today")
        with open(OUTPUT, "w") as f:
            json.dump({"updated_at": datetime.datetime.utcnow().isoformat() + "Z", "races": []}, f)
        return

    date_str = programs[0].get("race_date", "").replace("-", "")
    if not date_str:
        date_str = datetime.datetime.now().strftime("%Y%m%d")

    # 既存データを読み込み（差分更新のため）
    # 日付が変わっていたら既存データを破棄（前日のfinishedが残る問題を防止）
    existing = {}
    if os.path.exists(OUTPUT):
        try:
            with open(OUTPUT, "r") as f:
                old = json.load(f)
                old_race_date = old.get("race_date", old.get("updated_at", "")[:10].replace("-", ""))
                if old_race_date == date_str:
                    for r in old.get("races", []):
                        existing[(r["stadium"], r["race"])] = r
                else:
                    print(f"Date changed ({old_race_date} -> {date_str}), discarding old data")
        except Exception:
            pass

    # 場+レース一覧
    stadiums = {}
    for p in programs:
        sid = p["race_stadium_number"]
        rn = p["race_number"]
        if sid not in stadiums:
            stadiums[sid] = []
        stadiums[sid].append(rn)

    print(f"Date: {date_str}, {len(stadiums)} stadiums")

    all_races = []
    for sid, race_nums in sorted(stadiums.items()):
        for rn in sorted(race_nums):
            key = (sid, rn)

            # 既に結果確定済みのレースはスキップ
            if key in existing and existing[key].get("finished"):
                all_races.append(existing[key])
                continue

            # 展示情報を取得
            print(f"  {sid}-{rn}R...", end="", flush=True)
            boats = scrape_beforeinfo(sid, rn, date_str)
            time.sleep(INTERVAL)

            race_data = {
                "stadium": sid,
                "race": rn,
                "boats": {},
                "finished": False,
                "result": None,
            }

            if boats:
                for bn, data in boats.items():
                    race_data["boats"][str(bn)] = {
                        "racer_exhibition_time": data["exhibition_time"],
                        "racer_start_timing": data["start_timing"],
                        "racer_tilt_adjustment": data["tilt"],
                        "racer_course_number": data["course"],
                    }

            # 結果を取得（展示データの有無に関わらず）
            result = scrape_result(sid, rn, date_str)
            if result and result["places"]:
                race_data["finished"] = True
                race_data["result"] = result
                print(f" 確定({result['places'][0]['boat']}号艇1着)")
            elif boats:
                print(f" 展示OK")
            else:
                print(f" 展示なし")
            time.sleep(INTERVAL)

            all_races.append(race_data)

    # 出力
    output = {
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "race_date": date_str,
        "races": all_races,
    }
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    finished_count = sum(1 for r in all_races if r.get("finished"))
    preview_count = sum(1 for r in all_races if r.get("boats"))
    print(f"\nDone! {preview_count} previews, {finished_count} results → {OUTPUT}")


if __name__ == "__main__":
    main()
