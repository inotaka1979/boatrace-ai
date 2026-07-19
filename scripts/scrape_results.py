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
#   並列 4 + per-request timeout + retries 1 + 全体予算 1200s で hard guard。
#   元の 3s INTERVAL は parallel 化で per-worker rate ≒ 1.3req/s に保たれ politeness 維持。
# 2026-07-05: FETCH_TIMEOUT 8→25s。GHA からの raceresult 取得が 168/168 全て
#   「read timed out」で全滅する実障害(同 run の odds/previews は成功=接続自体は可、
#   raceresult ページだけ datacenter IP への応答が遅い)。25s でも全滅なら
#   WALL_BUDGET で従来どおり打ち切られるため悪化はしない。
FETCH_TIMEOUT = 25
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


# 2026-07-19: boatrace.jp raceresult の markup 変更 (テーブル class 刷新 +
#   払戻券種ラベル th→td rowspan) で旧 .table1 ベースのパースが全滅
#   (実障害: 07-18 は archive 180 レース全て finished=0)。
#   worker.js parseRaceresultHTML と同じ「全 tbody 走査」方式に書き換え:
#   - 着順: 各 tbody 先頭 tr の td0=着順 / td1=艇番 (全角数字対応)
#   - 払戻: 先頭セル (th/td どちらでも) が券種名ならラベル行、rowspan 継続行
#     (同着) は直前ラベルを引き継ぐ。&nbsp; 埋め草行は組番に数字が無いので除外。
_PAYOUT_LABELS = {
    "3連単": "trifecta", "3連複": "trio", "2連単": "exacta",
    "2連複": "quinella", "拡連複": "quinella_place", "単勝": "win", "複勝": "place",
}


def _zen_to_int(s: str) -> int | None:
    """全角/半角数字文字列を int に。数値でなければ None。"""
    t = str(s or "").strip().translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    return int(t) if t.isdigit() else None


def parse_raceresult(html: str, stadium: int, race_num: int) -> dict:
    """raceresult ページの HTML から 1 レース分の結果を抽出する。

    Args:
        html: raceresult ページの生 HTML
        stadium: 場番号 (1..24)
        race_num: レース番号 (1..12)

    Returns:
        Open API 互換の dict。結果未掲載/パース不完全なら
        race_technique_number=None が返る (KV/archive を汚さない)。
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
    except ImportError:
        # BeautifulSoupなしのフォールバック (従来挙動を維持)
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

    soup = BeautifulSoup(html, "html.parser")
    places_seen: set[int] = set()
    boats_seen: set[int] = set()

    for tbody in soup.find_all("tbody"):
        rows = tbody.find_all("tr")
        if not rows:
            continue

        # (a) 着順 tbody: 1 tbody = 1 着 (先頭 tr の td0=着順, td1=艇番)
        tds = rows[0].find_all("td")
        if len(tds) >= 3:
            place = _zen_to_int(tds[0].get_text(strip=True))
            boat_num = _zen_to_int(tds[1].get_text(strip=True))
            if (place is not None and boat_num is not None
                    and 1 <= place <= 6 and 1 <= boat_num <= 6
                    and place not in places_seen and boat_num not in boats_seen):
                places_seen.add(place)
                boats_seen.add(boat_num)
                name = tds[2].get_text(" ", strip=True)
                name = re.sub(r"\s*\d{4,5}\s*", "", name).strip()
                result["boats"].append(
                    {
                        "racer_boat_number": boat_num,
                        "racer_place_number": place,
                        "racer_course_number": boat_num,
                        "racer_name": name,
                        "racer_start_timing": None,
                        "racer_number": None,
                    }
                )
                continue

        # (b) 払戻 tbody
        text = tbody.get_text()
        if not any(k in text for k in _PAYOUT_LABELS):
            continue
        current = None
        for row in rows:
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["th", "td"])]
            if not cells:
                continue
            first = re.sub(r"\s+", "", cells[0])
            if first in _PAYOUT_LABELS:
                current = _PAYOUT_LABELS[first]
                combo = cells[1] if len(cells) > 1 else ""
                amount_txt = cells[2] if len(cells) > 2 else ""
            else:
                combo = cells[0]
                amount_txt = cells[1] if len(cells) > 1 else ""
            if not current:
                continue
            combo = re.sub(r"\s+", "", combo)
            if not re.search(r"\d", combo):
                continue  # &nbsp; 埋め草行
            m = re.search(r"\d[\d,]*", amount_txt.replace("¥", "").replace("円", ""))
            if not m:
                continue
            amount = int(m.group().replace(",", ""))
            if amount <= 0:
                continue
            result["payouts"][current].append({"combination": combo, "amount": amount})

    # sanity check (worker と同一): 上位 3 着 + 1着 が揃って初めて確定扱い
    has_first = any(b["racer_place_number"] == 1 for b in result["boats"])
    if len(result["boats"]) >= 3 and has_first:
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
