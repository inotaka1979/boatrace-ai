#!/usr/bin/env python3
"""scrape_tide.py — 気象庁潮汐 API から海水場の潮汐データを取得 (X4 R-02)

正規 URL (2025-05-04 確認):
  https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/{YEAR}/{PORT}.txt

ボートレース海水場の対応港:
  平和島 (3)   → TK 東京
  江戸川 (5)   → TK 東京
  住之江 (10)  → OS 大阪
  蒲郡 (12)   → NG 名古屋（三河湾内）
  唐津 (14)   → KT 唐津
  若松 (15)   → 検証中（要 KM/KS の切替）
  大村 (24)   → OM 大村

TXT 構造（365 行 × 136 文字、各行 = 1 日）:
  0-71  : 24 個の 3 字幅整数 (毎時 0-23h の潮位 cm)
  72-77 : "YY M D" 例「25 5 4」= 2025年5月4日
  78-79 : 港コード "OS" 等
  80以降: 高潮/低潮の時刻と潮位 (HHMM 形式 + 潮位 cm、最大 4 個ずつ、欠は 9999)
"""

from __future__ import annotations

import asyncio
import os
import sys
import logging
from datetime import datetime, timedelta, timezone

import aiohttp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json
from time_utils import utc_iso_seconds, jst_now

STADIUM_PORT_MAP = {
    3:  "TK",   # 平和島
    5:  "TK",   # 江戸川
    10: "OS",   # 住之江
    12: "NG",   # 蒲郡（三河湾、名古屋港で代用）
    14: "KT",   # 唐津
    15: "KM",   # 若松（門司側関門で代用、要検証）
    24: "OM",   # 大村
}
SALTWATER_STADIUMS = set(STADIUM_PORT_MAP.keys())
ALL_STADIUMS = list(range(1, 25))

OUTPUT = "data/tide/today.json"
JMA_BASE = "https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (BoatRace Oracle)",
    # brotli 未対応環境でのデコード失敗を防ぐため br を除外
    "Accept-Encoding": "gzip, deflate",
}
TIMEOUT = 15

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("tide")


async def fetch_port_year(session: aiohttp.ClientSession, port: str, year: int) -> str | None:
    url = f"{JMA_BASE}/{year}/{port}.txt"
    try:
        async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as r:
            text = await r.text(encoding="utf-8", errors="replace")
            if r.status != 200 or "<!DOCTYPE html>" in text[:30]:
                return None
            return text
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        log.warning("port %s year %d fetch failed: %s", port, year, e)
        return None


def _parse_int_or_999(s: str) -> int | None:
    """3 字幅の値を int に。9999 は欠損として None。"""
    s = s.strip()
    if not s or s == "999" or s == "9999":
        return None
    try:
        return int(s)
    except ValueError:
        return None


def parse_day_line(line: str) -> dict | None:
    """JMA TXT 1 行をパースして 1 日分のデータを返す。"""
    if len(line) < 80:
        return None
    # 24 個の 3 字幅 = 72 字
    today_levels = []
    for h in range(24):
        try:
            v = int(line[h * 3:(h + 1) * 3])
            today_levels.append({"hour": h, "level_cm": v})
        except ValueError:
            today_levels.append({"hour": h, "level_cm": None})
    # YY M D
    try:
        yy = int(line[72:74])
        mm = int(line[74:76])
        dd = int(line[76:78])
    except ValueError:
        return None
    port_code = line[78:80]
    # 高潮 / 低潮: 80 以降に最大 4 個ずつ、各「HHMM(4字) + 潮位(3字) = 7字」
    high_tides = []
    low_tides = []
    pos = 80
    for _ in range(4):
        if pos + 7 > len(line):
            break
        time_str = line[pos:pos + 4].strip()
        lvl_str = line[pos + 4:pos + 7].strip()
        pos += 7
        if time_str and time_str not in ("9999", "99999"):
            try:
                t = int(time_str)
                hh, mm_t = t // 100, t % 100
                lvl = int(lvl_str) if lvl_str and lvl_str != "999" else None
                high_tides.append({"time": f"{hh:02d}:{mm_t:02d}", "level_cm": lvl})
            except ValueError:
                pass
    for _ in range(4):
        if pos + 7 > len(line):
            break
        time_str = line[pos:pos + 4].strip()
        lvl_str = line[pos + 4:pos + 7].strip()
        pos += 7
        if time_str and time_str not in ("9999", "99999"):
            try:
                t = int(time_str)
                hh, mm_t = t // 100, t % 100
                lvl = int(lvl_str) if lvl_str and lvl_str != "999" else None
                low_tides.append({"time": f"{hh:02d}:{mm_t:02d}", "level_cm": lvl})
            except ValueError:
                pass

    return {
        "yy": yy,
        "mm": mm,
        "dd": dd,
        "port": port_code,
        "today": today_levels,
        "high_tides": high_tides,
        "low_tides": low_tides,
    }


def extract_today(text: str, target_mm: int, target_dd: int) -> dict | None:
    """365 行から MM/DD 一致の行を探してパース"""
    for line in text.splitlines():
        if len(line) < 80:
            continue
        d = parse_day_line(line)
        if d and d["mm"] == target_mm and d["dd"] == target_dd:
            return {
                "today": d["today"],
                "high_tides": d["high_tides"],
                "low_tides": d["low_tides"],
            }
    return None


async def fetch_with_year_fallback(session, port: str, year: int):
    """当年の TXT が無ければ前年でフォールバック取得"""
    text = await fetch_port_year(session, port, year)
    if text:
        return text, year
    text = await fetch_port_year(session, port, year - 1)
    if text:
        return text, year - 1
    return None, None


async def async_main():
    now = jst_now()
    target_mm = now.month
    target_dd = now.day
    year = now.year

    out = {"updated_at": utc_iso_seconds(), "stadiums": {}}
    for sid in ALL_STADIUMS:
        if sid not in SALTWATER_STADIUMS:
            out["stadiums"][str(sid)] = {"type": "freshwater"}

    async with aiohttp.ClientSession() as session:
        tasks = {
            sid: asyncio.create_task(fetch_with_year_fallback(session, port, year))
            for sid, port in STADIUM_PORT_MAP.items()
        }
        for sid, task in tasks.items():
            text, used_year = await task
            entry = {"type": "saltwater", "port": STADIUM_PORT_MAP[sid]}
            if used_year:
                entry["year"] = used_year
            if text:
                td = extract_today(text, target_mm, target_dd)
                if td:
                    entry.update(td)
            out["stadiums"][str(sid)] = entry

    atomic_write_json(OUTPUT, out)
    saltwater_filled = sum(
        1 for sid in SALTWATER_STADIUMS
        if out["stadiums"][str(sid)].get("today")
    )
    log.info("Done. saltwater stadiums with data: %d/%d", saltwater_filled, len(SALTWATER_STADIUMS))


def main():
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
