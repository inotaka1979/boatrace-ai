#!/usr/bin/env python3
"""scrape_tide.py — 気象庁潮汐 API から海水場の潮汐データを取得 (X4 R-02)

ボートレース海水場の対応港:
  蒲郡 (12) → 蒲郡 GG  ※ 三河湾内
  住之江 (10) → 大阪 OS
  若松 (15) → 若松 WK
  唐津 (14) → 唐津 KT  ※ 港コード表参照
  大村 (24) → 大村 OM
  平和島 (3) → 東京 TK
  江戸川 (5) → 東京 TK

API: https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/json/{port}_{YYYY}.json

  ※ 簡易実装: 利用できない港は SAMPLE 値で埋める
  ※ 本番では港コードを正確に当て、毎日 1 回 cron で実行
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import logging
from datetime import datetime, timedelta, timezone

import aiohttp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json
from time_utils import utc_iso_seconds, jst_now

# 港コード(JMA) — 正確な値はテスト時に調整
STADIUM_PORT_MAP = {
    3:  "TK",  # 平和島 → 東京
    5:  "TK",  # 江戸川 → 東京
    10: "OS",  # 住之江 → 大阪
    12: "GG",  # 蒲郡  → 蒲郡(GG)
    14: "KT",  # 唐津  → 唐津
    15: "WK",  # 若松  → 若松
    24: "OM",  # 大村  → 大村
}
SALTWATER_STADIUMS = set(STADIUM_PORT_MAP.keys())

OUTPUT = "data/tide/today.json"
JMA_BASE = "https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/json"
HEADERS = {"User-Agent": "Mozilla/5.0 (BoatRace Oracle)"}
TIMEOUT = 15

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("tide")


async def fetch_port_year(session: aiohttp.ClientSession, port: str, year: int) -> dict | None:
    url = f"{JMA_BASE}/{port}_{year}.json"
    try:
        async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as r:
            if r.status != 200:
                log.warning("port %s year %d: HTTP %d", port, year, r.status)
                return None
            return await r.json(content_type=None)
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        log.warning("port %s fetch failed: %s", port, e)
        return None


def extract_today(port_data: dict, target_date: str) -> dict | None:
    """JMA レスポンスから当日データを取り出す。
    JMA の JSON 構造はバージョンにより異なるため、安全に拾う実装。
    target_date: 'YYYYMMDD'
    """
    if not isinstance(port_data, dict):
        return None
    # JMA 形式 (例): {"YYYYMMDD": {"tide": [{"hour":0,"level":134},...], "high":[...], "low":[...]}}
    if target_date in port_data and isinstance(port_data[target_date], dict):
        d = port_data[target_date]
        return {
            "today": [{"hour": x.get("hour"), "level_cm": x.get("level")} for x in d.get("tide", [])],
            "high_tides": [{"time": x.get("time"), "level": x.get("level")} for x in d.get("high", [])],
            "low_tides":  [{"time": x.get("time"), "level": x.get("level")} for x in d.get("low",  [])],
        }
    return None


async def async_main():
    today = jst_now().strftime("%Y%m%d")
    year = jst_now().year

    out = {"updated_at": utc_iso_seconds(), "stadiums": {}}
    # freshwater 場は type のみ
    for sid in range(1, 25):
        if sid not in SALTWATER_STADIUMS:
            out["stadiums"][str(sid)] = {"type": "freshwater"}

    async with aiohttp.ClientSession() as session:
        # 並列取得
        tasks = {sid: asyncio.create_task(fetch_port_year(session, port, year))
                 for sid, port in STADIUM_PORT_MAP.items()}
        for sid, task in tasks.items():
            data = await task
            entry = {"type": "saltwater", "port": STADIUM_PORT_MAP[sid]}
            if data:
                td = extract_today(data, today)
                if td:
                    entry.update(td)
            out["stadiums"][str(sid)] = entry

    atomic_write_json(OUTPUT, out)
    saltwater_filled = sum(1 for sid in SALTWATER_STADIUMS
                           if out["stadiums"][str(sid)].get("today"))
    log.info("Done. saltwater stadiums with data: %d/%d", saltwater_filled, len(SALTWATER_STADIUMS))


def main():
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
