#!/usr/bin/env python3
"""scrape_odds_fast.py — asyncio版 高速オッズ取得"""

import asyncio, json, os, sys, time, logging
import aiohttp
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # P2 D-01
from time_utils import utc_iso_seconds  # P2 D-02 / D-10

PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
ODDS_BASE = "https://www.boatrace.jp/owpc/pc/race"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
OUTPUT = "data/odds/today.json"
PREVIEWS = "data/previews/today.json"
CONCURRENCY = 5
INTERVAL = 0.3

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("odds")

class RateLimiter:
    def __init__(self, iv):
        self._iv = iv; self._last = 0.0; self._lock = asyncio.Lock()
    async def acquire(self):
        async with self._lock:
            w = self._iv - (time.monotonic() - self._last)
            if w > 0: await asyncio.sleep(w)
            self._last = time.monotonic()

async def fetch(session, limiter, url, retries=2):
    for attempt in range(retries + 1):
        try:
            await limiter.acquire()
            async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200: return await r.text()
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            if attempt == retries: log.warning("Failed %s: %s", url, e)
            else: await asyncio.sleep(1)
    return None

def parse_win(html):
    soup = BeautifulSoup(html, "html.parser"); odds = {}
    for tbl in soup.select("table.is-w495")[:1]:
        for row in tbl.select("tbody tr"):
            tds = row.select("td")
            if len(tds) >= 3:
                boat = tds[0].get_text(strip=True); val = tds[2].get_text(strip=True)
                if "-" in val and "." in val: val = val.split("-")[0]
                try:
                    v = float(val)
                    if v > 0: odds[boat] = v
                except ValueError: pass
    return odds

def parse_exacta(html):
    """2連単パーサー (30 通り)
    boatrace.jp odds2tf の HTML 構造:
      tbody tr × 5 行
      各 tr に 12 td: 6 列 × (2着_td, oddsPoint_td)
      1着 は列位置で決まる
    """
    soup = BeautifulSoup(html, "html.parser")
    odds = {}
    target_table = None
    for tbl in soup.find_all("table"):
        if tbl.select("td.oddsPoint"):
            target_table = tbl
            break
    if not target_table:
        return odds
    for row in target_table.select("tbody tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) != 12:
            continue
        for col in range(6):
            base = col * 2
            try:
                ni = int(cells[base].get_text(strip=True))
                cv = cells[base + 1]
                if "oddsPoint" not in (cv.get("class") or []):
                    continue
                v = float(cv.get_text(strip=True))
                ichi = col + 1
                if 1 <= ichi <= 6 and 1 <= ni <= 6 and ichi != ni and v > 0:
                    odds["{}-{}".format(ichi, ni)] = v
            except (ValueError, TypeError):
                pass
    return odds

# F7: 3連単パーサー（120 通り）— td 構造を正確に読む
# boatrace.jp odds3t HTML 構造:
#   tbody tr × 20 行（5 つの 2着 × 4 行）
#   行は 4 行 1 グループ。先頭行のみ各列 (2着, 3着, odds) の 18 td、
#   続く 3 行は各列 (3着, odds) の 12 td（2着は先頭行から継承）
#   1着 は列位置で決まる（col 0 → 1着=1, col 1 → 1着=2, ...）
def parse_trifecta(html):
    soup = BeautifulSoup(html, "html.parser")
    odds = {}
    target_table = None
    for tbl in soup.find_all("table"):
        if tbl.select("td.oddsPoint"):
            target_table = tbl
            break
    if not target_table:
        return odds
    current_seconds = [None] * 6   # 各列の現在の 2着
    for row in target_table.select("tbody tr"):
        cells = row.find_all("td", recursive=False)
        n = len(cells)
        if n == 18:
            # グループ先頭行: 各列 (2着, 3着, odds)
            stride = 3
            offset_san = 1
            offset_odds = 2
            update_second = True
        elif n == 12:
            # グループ続行行: 各列 (3着, odds)
            stride = 2
            offset_san = 0
            offset_odds = 1
            update_second = False
        else:
            continue
        for col in range(6):
            base = col * stride
            if base + offset_odds >= n:
                break
            if update_second:
                try:
                    current_seconds[col] = int(cells[base].get_text(strip=True))
                except (ValueError, TypeError):
                    current_seconds[col] = None
            try:
                san = int(cells[base + offset_san].get_text(strip=True))
                cv = cells[base + offset_odds]
                if "oddsPoint" not in (cv.get("class") or []):
                    continue
                v = float(cv.get_text(strip=True))
                ichi = col + 1
                ni = current_seconds[col]
                if ni is None:
                    continue
                if 1 <= ichi <= 6 and 1 <= ni <= 6 and 1 <= san <= 6 \
                        and ichi != ni and ichi != san and ni != san and v > 0:
                    odds["{}-{}-{}".format(ichi, ni, san)] = v
            except (ValueError, TypeError):
                pass
    return odds

async def scrape_race(session, limiter, sid, rn, date_str):
    jcd = f"{sid:02d}"; result = {"stadium": sid, "race": rn}
    html = await fetch(session, limiter, f"{ODDS_BASE}/oddstf?rno={rn}&jcd={jcd}&hd={date_str}")
    if html:
        w = parse_win(html)
        if w: result["win"] = w
    html = await fetch(session, limiter, f"{ODDS_BASE}/odds2tf?rno={rn}&jcd={jcd}&hd={date_str}")
    if html:
        e = parse_exacta(html)
        if e: result["exacta"] = e
    # F7: 3連単
    html = await fetch(session, limiter, f"{ODDS_BASE}/odds3t?rno={rn}&jcd={jcd}&hd={date_str}")
    if html:
        t = parse_trifecta(html)
        if t: result["trifecta"] = t
    return result

def get_finished():
    """確定レース集合を取得。読み込み失敗は warn にとどめ、既存スクレイプ範囲は維持 (D-04)。"""
    finished = set()
    if not os.path.exists(PREVIEWS):
        return finished
    try:
        with open(PREVIEWS, encoding="utf-8") as f:
            for r in json.load(f).get("races", []):
                if r.get("finished"):
                    finished.add((r["stadium"], r["race"]))
    except (json.JSONDecodeError, OSError) as e:
        log.warning("get_finished: load failed (%s) — fallback to empty set", e)
    return finished

async def async_main():
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    log.info("Fetching programs...")
    async with aiohttp.ClientSession() as session:
        async with session.get(PROGRAMS_URL, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=15)) as r:
            prog = await r.json()
    programs = prog.get("programs", [])
    if not programs: log.info("No programs"); return
    races = set(); date_str = ""
    for p in programs:
        s, r = p.get("race_stadium_number"), p.get("race_number")
        if s and r: races.add((s, r))
        if not date_str: date_str = p.get("race_date", "").replace("-", "")
    finished = get_finished(); active = sorted(races - finished)
    log.info("%d total, %d finished, %d active", len(races), len(finished), len(active))
    existing = {}
    if os.path.exists(OUTPUT):
        try:
            with open(OUTPUT, encoding="utf-8") as f:
                for r in json.load(f).get("odds", []): existing[(r["stadium"], r["race"])] = r
        except (json.JSONDecodeError, OSError) as e:
            log.warning("existing odds load failed (%s) — start from empty", e)
    sem = asyncio.Semaphore(CONCURRENCY); limiter = RateLimiter(INTERVAL); results = {}
    async with aiohttp.ClientSession() as session:
        async def task(s, r):
            async with sem: results[(s, r)] = await scrape_race(session, limiter, s, r, date_str)
        t0 = time.monotonic()
        await asyncio.gather(*[task(s, r) for s, r in active])
        elapsed = time.monotonic() - t0
    # D-03: スクレイプ失敗（win も exacta も無し）の場合は既存値を保持し、
    #        プレースホルダ {stadium,race} で上書きしない
    updated = 0
    for key, data in results.items():
        # F7: trifecta も判定対象に追加
        if data.get("win") or data.get("exacta") or data.get("trifecta"):
            existing[key] = data
            updated += 1
    for s, r in sorted(races):
        if (s, r) not in existing:
            existing[(s, r)] = {"stadium": s, "race": r}
    # D-01: atomic write
    atomic_write_json(OUTPUT, {
        "updated_at": utc_iso_seconds(),
        "odds": [existing[k] for k in sorted(existing.keys())],
    })
    log.info("Done! %d scraped, %d updated in %.1fs", len(active), updated, elapsed)

def main(): asyncio.run(async_main())
if __name__ == "__main__": main()
