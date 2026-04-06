#!/usr/bin/env python3
"""scrape_odds_fast.py — asyncio版 高速オッズ取得"""

import asyncio, json, os, time, logging
from datetime import datetime, timezone
import aiohttp
from bs4 import BeautifulSoup

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
    soup = BeautifulSoup(html, "html.parser"); odds = {}
    points = soup.select("td.oddsPoint")
    combos = [f"{i}-{j}" for i in range(1, 7) for j in range(1, 7) if i != j]
    for k, el in enumerate(points):
        if k >= len(combos): break
        try:
            v = float(el.get_text(strip=True))
            if v > 0: odds[combos[k]] = v
        except ValueError: pass
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
    return result

def get_finished():
    finished = set()
    if os.path.exists(PREVIEWS):
        try:
            with open(PREVIEWS) as f:
                for r in json.load(f).get("races", []):
                    if r.get("finished"): finished.add((r["stadium"], r["race"]))
        except Exception: pass
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
            with open(OUTPUT) as f:
                for r in json.load(f).get("odds", []): existing[(r["stadium"], r["race"])] = r
        except Exception: pass
    sem = asyncio.Semaphore(CONCURRENCY); limiter = RateLimiter(INTERVAL); results = {}
    async with aiohttp.ClientSession() as session:
        async def task(s, r):
            async with sem: results[(s, r)] = await scrape_race(session, limiter, s, r, date_str)
        t0 = time.monotonic()
        await asyncio.gather(*[task(s, r) for s, r in active])
        elapsed = time.monotonic() - t0
    updated = 0
    for key, data in results.items():
        if data.get("win") or data.get("exacta"): existing[key] = data; updated += 1
    for s, r in sorted(races):
        if (s, r) not in existing: existing[(s, r)] = {"stadium": s, "race": r}
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump({"updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00","Z"),
                    "odds": [existing[k] for k in sorted(existing.keys())]}, f, ensure_ascii=False)
    log.info("Done! %d scraped, %d updated in %.1fs", len(active), updated, elapsed)

def main(): asyncio.run(async_main())
if __name__ == "__main__": main()
