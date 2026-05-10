#!/usr/bin/env python3
"""
boatrace.jp公式サイトからレース結果（着順・払戻金）を取得し、
Open API互換のJSON形式で出力する。
"""

import json, os, re, sys, time, datetime, logging

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from time_utils import utc_iso_seconds, jst_now  # PC-10 / D-02 / FIX: JST aware
from http_utils import fetch_text, fetch_json  # PC-1: HTTP 共通化
from io_utils import atomic_write_json, quality_header  # P0-8 / P1-B4

# P1-C2: print → logging 統一（cron log の level 制御を可能にする）
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("results")

BASE_URL = "https://www.boatrace.jp/owpc/pc/race/raceresult"
PROG_API = "https://boatraceopenapi.github.io/programs/v2/today.json"
INTERVAL = 3
OUTPUT = "data/results/today.json"


def fetch(url: str) -> str:
    """URL から HTML を取得（http_utils.fetch_text の thin wrapper）。"""
    return fetch_text(url, timeout=20)


def parse_raceresult(html: str, stadium: int, race_num: int) -> dict:
    """raceresult ページの HTML から 1 レース分の結果を抽出する。

    Args:
        html: raceresult ページの生 HTML
        stadium: 場番号 (1..24)
        race_num: レース番号 (1..12)

    Returns:
        Open API 互換の dict。決勝に至っていなければ
        race_technique_number=None / boats=[] が返る。
    """
    result = {
        "race_stadium_number": stadium,
        "race_number": race_num,
        "race_date": jst_now().strftime("%Y-%m-%d"),  # FIX: GHA UTC 起動時に前日になるバグ回避
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


def main() -> None:
    """エントリーポイント: 本日の全レース結果を取得し OUTPUT に書き出す。"""
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    _t_start = time.monotonic()  # P1-B4: 品質ヘッダ用

    log.info("Fetching today's programs...")
    try:
        prog = fetch_json(PROG_API)
    except Exception as e:
        log.error("Programs fetch failed: %s", e)
        return

    programs = prog.get("programs", [])
    if not programs:
        log.info("No programs today")
        atomic_write_json(
            OUTPUT,
            {"results": [], "updated_at": utc_iso_seconds()},
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
        date_str = jst_now().strftime("%Y%m%d")  # FIX: GHA UTC 起動時に前日になるバグ回避

    log.info("Date: %s, %d races", date_str, len(races))

    all_results = []
    for sid, rn in sorted(races):
        jcd = f"{sid:02d}"
        url = f"{BASE_URL}?rno={rn}&jcd={jcd}&hd={date_str}"
        try:
            html = fetch(url)
            race_result = parse_raceresult(html, sid, rn)
            all_results.append(race_result)
            status = "finished" if race_result["race_technique_number"] else "not yet"
            log.info("  Stadium %d Race %d: %s", sid, rn, status)
        except Exception as e:
            log.warning("  Stadium %d Race %d: %s", sid, rn, e)
        time.sleep(INTERVAL)

    # P1-B4: 部分失敗を含めた信頼度スコア（finished/total）
    finished_n = len([r for r in all_results if r.get('race_technique_number')])
    requested_n = len(races) if races else 1
    rel = finished_n / requested_n if requested_n > 0 else 1.0
    output = {
        "results": all_results,
        "updated_at": utc_iso_seconds(),  # PC-10
        "_meta": quality_header(
            schema_version=1,
            source_freshness_sec=time.monotonic() - _t_start,
            reliability_score=rel,
            scraper="results",
        ),
    }
    atomic_write_json(OUTPUT, output)

    log.info(
        "Done! %d finished races",
        len([r for r in all_results if r['race_technique_number']]),
    )


if __name__ == "__main__":
    main()
