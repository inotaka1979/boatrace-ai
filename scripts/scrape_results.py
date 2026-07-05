#!/usr/bin/env python3
"""
boatrace.jp公式サイトからレース結果（着順・払戻金）を取得し、
Open API互換のJSON形式で出力する。
"""

import json, os, re, sys, time, datetime, logging
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from time_utils import utc_iso_seconds, jst_now  # PC-10 / D-02 / FIX: JST aware
from http_utils import fetch_text, fetch_json  # PC-1: HTTP 共通化
from io_utils import atomic_write_json, quality_header  # P0-8 / P1-B4
from programs_source import load_local_official_programs  # 公式移行 Phase 2

# P1-C2: print → logging 統一（cron log の level 制御を可能にする）
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("results")

BASE_URL = "https://www.boatrace.jp/owpc/pc/race/raceresult"
PROG_API = "https://boatraceopenapi.github.io/programs/v2/today.json"
INTERVAL = 3
OUTPUT = "data/results/today.json"

# 2026-05-16: 全 run が 30 分 timeout で cancel される問題対処
#   並列 4 + per-request timeout 8s + retries 1 + 全体予算 1200s で hard guard。
#   元の 3s INTERVAL は parallel 化で per-worker rate ≒ 1.3req/s に保たれ politeness 維持。
FETCH_TIMEOUT = 8
FETCH_RETRIES = 1
PARALLEL_WORKERS = 4
WALL_BUDGET_SEC = 1200


def fetch(url: str) -> str:
    """URL から HTML を取得（http_utils.fetch_text の thin wrapper）。

    2026-05-16: timeout 20s → FETCH_TIMEOUT(8s) / retries DEFAULT(2) → FETCH_RETRIES(1)
    で高速失敗化、GHA 30 分 timeout 内に確実に収まるよう調整。
    """
    return fetch_text(url, timeout=FETCH_TIMEOUT, retries=FETCH_RETRIES)


def _fetch_one_race(args: tuple[int, int, str]) -> tuple[int, int, dict | None, str | None]:
    """並列ワーカー: 1 レース分の HTML を fetch & parse。例外は文字列で返す。"""
    sid, rn, date_str = args
    jcd = f"{sid:02d}"
    url = f"{BASE_URL}?rno={rn}&jcd={jcd}&hd={date_str}"
    try:
        html = fetch(url)
        return sid, rn, parse_raceresult(html, sid, rn), None
    except Exception as e:
        return sid, rn, None, str(e)[:80]


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
    # 公式移行 Phase 2: ローカル公式 programs (JST 当日・非空) を優先。別日/欠落なら openapi。
    prog = load_local_official_programs()
    if prog:
        log.info("using official local programs (boatrace.jp 由来, %d races)",
                 len(prog.get("programs", [])))
    try:
        if prog is None:
            prog = fetch_json(PROG_API)
    except Exception as e:
        # 2026-05-24: programs fetch 失敗時も既存 results を保持しつつ updated_at を
        #   refresh する (旧版は早期 return で何も書かず、freshness monitor から見ると
        #   ファイルが昨日のまま固定 = stale 検知が常時 fire するバグ)。
        log.error("Programs fetch failed: %s — preserving existing results, refreshing updated_at", e)
        existing = {}
        try:
            with open(OUTPUT, "r", encoding="utf-8") as f:
                existing = json.load(f) or {}
        except Exception:
            existing = {}
        existing["updated_at"] = utc_iso_seconds()
        existing.setdefault("results", [])
        existing.setdefault("_meta", {})["fetch_error"] = str(e)[:200]
        atomic_write_json(OUTPUT, existing)
        return

    programs = prog.get("programs", [])
    if not programs:
        # 2026-07-05: 旧版は空 results で上書きし、当日ぶんの蓄積を破壊していた
        #   (実障害: 07-04 18:46 に entries=0 で上書き→翌日昼まで結果が空のまま)。
        #   programs が一時的に取れないだけの可能性があるため、既存 results を
        #   保持して updated_at のみ refresh する(fetch 失敗時と同じ保護)。
        log.warning("No programs today — preserving existing results (empty-wipe 防止)")
        existing = {}
        try:
            with open(OUTPUT, "r", encoding="utf-8") as f:
                existing = json.load(f) or {}
        except Exception:
            existing = {}
        existing["updated_at"] = utc_iso_seconds()
        existing.setdefault("results", [])
        existing.setdefault("_meta", {})["fetch_error"] = "no programs"
        atomic_write_json(OUTPUT, existing)
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

    log.info("Date: %s, %d races (parallel x%d, budget %ds)", date_str, len(races), PARALLEL_WORKERS, WALL_BUDGET_SEC)

    # 2026-05-16: 全 run が 30m timeout で cancel される問題を解消するため並列化
    #   - workers=4 で per-worker rate を抑制し politeness 維持
    #   - WALL_BUDGET_SEC 経過で残タスク cancel → 部分結果を atomic_write_json
    #   - 旧 INTERVAL 3s sleep は廃止 (並列ワーカーが自然に分散)
    work = [(sid, rn, date_str) for sid, rn in sorted(races)]
    all_results: list[dict] = []
    fail_count = 0
    cancelled = 0
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as ex:
        futures = {ex.submit(_fetch_one_race, w): w for w in work}
        for fut in as_completed(futures):
            elapsed = time.monotonic() - started
            if elapsed > WALL_BUDGET_SEC:
                cancelled = sum(1 for f in futures if not f.done())
                for f in futures:
                    if not f.done():
                        f.cancel()
                log.warning("Budget %ds exceeded at %.1fs, cancelling %d remaining", WALL_BUDGET_SEC, elapsed, cancelled)
                break
            try:
                sid, rn, race_result, err = fut.result()
                if race_result is not None:
                    all_results.append(race_result)
                    status = "finished" if race_result["race_technique_number"] else "not yet"
                    log.info("  Stadium %d Race %d: %s", sid, rn, status)
                else:
                    fail_count += 1
                    log.warning("  Stadium %d Race %d: %s", sid, rn, err)
            except Exception as e:
                fail_count += 1
                log.warning("  worker exception: %s", e)
    elapsed = time.monotonic() - started
    log.info("Fetched %d/%d races in %.1fs (fail=%d, cancelled=%d)",
             len(all_results), len(races), elapsed, fail_count, cancelled)

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
