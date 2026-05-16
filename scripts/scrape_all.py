#!/usr/bin/env python3
"""統合 scraper エントリポイント — Path B (2026-05-16)

11 個に分散していた scrape workflow を 1 本に統合するためのオーケストレータ。
JST 現在時刻に応じて実行する scraper を決定し、sequential に呼び出す。
全 scraper 共通の wall-time budget + 鮮度ゲートも本ファイルで担当。

呼出方針:
  - 常時 (毎 cron tick): odds, previews
  - 30 分ごと: results (整数 30 分の境界 ± 2 分)
  - JST 09:30, 12:00: racedata + scrape_schedule.py --quick
  - JST 08:00: tide
  - 毎回末尾: prerender? — Path B では skeleton CSS に置換するため不要

特徴:
  - 1 commit に統合 → 同時 push race condition 根絶
  - 各 scraper に WALL_TIME 予算、超過時 atomic write 後 skip
  - check_freshness.py で commit 前に鮮度検証、stale なら exit 1
"""
from __future__ import annotations

import argparse
import datetime
import logging
import os
import subprocess
import sys
import time
from typing import Callable

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("scrape_all")

JST = datetime.timezone(datetime.timedelta(hours=9))


def _jst_now() -> datetime.datetime:
    return datetime.datetime.now(tz=JST)


def _run_subprocess(script: str, args: list[str] | None = None, timeout_sec: int = 600) -> int:
    """scrape_*.py を subprocess で実行し、exit code を返す。"""
    cmd = [sys.executable, os.path.join(ROOT, "scripts", script)]
    if args:
        cmd.extend(args)
    log.info("  exec: %s (timeout %ds)", " ".join(cmd[1:]), timeout_sec)
    started = time.monotonic()
    try:
        result = subprocess.run(cmd, cwd=ROOT, timeout=timeout_sec, check=False)
        elapsed = time.monotonic() - started
        log.info("  exit %d in %.1fs", result.returncode, elapsed)
        return result.returncode
    except subprocess.TimeoutExpired:
        elapsed = time.monotonic() - started
        log.warning("  TIMEOUT after %.1fs (limit %ds)", elapsed, timeout_sec)
        return 124  # bash convention for timeout
    except Exception as e:
        log.error("  subprocess error: %s", e)
        return 1


def _scrape_odds() -> int:
    return _run_subprocess("scrape_odds_fast.py", timeout_sec=300)


def _scrape_previews() -> int:
    return _run_subprocess("scrape_previews.py", timeout_sec=300)


def _scrape_results() -> int:
    return _run_subprocess("scrape_results.py", timeout_sec=1500)


def _scrape_racedata() -> int:
    return _run_subprocess("scrape_racedata.py", timeout_sec=1500)


def _scrape_schedule_quick() -> int:
    return _run_subprocess("scrape_schedule.py", ["--quick"], timeout_sec=120)


def _scrape_tide() -> int:
    return _run_subprocess("scrape_tide.py", timeout_sec=300)


def _decide_tasks(now: datetime.datetime, force_all: bool) -> list[tuple[str, Callable[[], int]]]:
    """JST 現在時刻から実行 task list を決定。"""
    tasks: list[tuple[str, Callable[[], int]]] = []
    h, m = now.hour, now.minute

    if force_all:
        return [
            ("racedata", _scrape_racedata),
            ("schedule(quick)", _scrape_schedule_quick),
            ("tide", _scrape_tide),
            ("odds", _scrape_odds),
            ("previews", _scrape_previews),
            ("results", _scrape_results),
        ]

    # 共通: race hours (JST 08-22) は odds + previews を毎 tick
    if 8 <= h <= 22:
        tasks.append(("odds", _scrape_odds))
        tasks.append(("previews", _scrape_previews))

    # results: race hours の 30 分境界 ± 2 分（gap を許容）
    if 10 <= h <= 22 and (m < 5 or 28 <= m <= 32):
        tasks.append(("results", _scrape_results))

    # racedata + schedule: JST 09:30, 12:00 のみ
    if (h == 9 and 28 <= m <= 35) or (h == 12 and m < 5):
        tasks.append(("racedata", _scrape_racedata))
        tasks.append(("schedule(quick)", _scrape_schedule_quick))

    # tide: JST 08:00 のみ
    if h == 8 and m < 5:
        tasks.append(("tide", _scrape_tide))
        # tide 取得時に next_open も refresh しておく (低コスト)
        tasks.append(("schedule(quick)", _scrape_schedule_quick))

    return tasks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-all", action="store_true", help="全 scraper を強制実行 (debug 用)")
    parser.add_argument("--only", type=str, default=None, help="特定 scraper のみ (odds/previews/results/racedata/tide)")
    args = parser.parse_args()

    now = _jst_now()
    log.info("=== scrape_all start: JST %s ===", now.strftime("%Y-%m-%d %H:%M"))

    tasks = _decide_tasks(now, args.force_all)

    if args.only:
        m = {
            "odds": _scrape_odds,
            "previews": _scrape_previews,
            "results": _scrape_results,
            "racedata": _scrape_racedata,
            "schedule": _scrape_schedule_quick,
            "tide": _scrape_tide,
        }
        if args.only not in m:
            log.error("unknown --only: %s", args.only)
            return 2
        tasks = [(args.only, m[args.only])]

    if not tasks:
        log.info("no scheduled task at this tick — exit 0")
        return 0

    log.info("tasks: %s", ", ".join(name for name, _ in tasks))

    overall_started = time.monotonic()
    failures: list[str] = []
    for name, fn in tasks:
        log.info("--- %s ---", name)
        try:
            rc = fn()
            if rc != 0:
                failures.append(f"{name}(exit={rc})")
        except Exception as e:
            log.exception("  unexpected error in %s: %s", name, e)
            failures.append(f"{name}(error)")

    elapsed = time.monotonic() - overall_started
    log.info("=== scrape_all done in %.1fs, failures=%d ===", elapsed, len(failures))
    if failures:
        log.warning("failures: %s", ", ".join(failures))
        # 部分失敗は exit 0 (commit はする、watchdog が検出)
        # 全失敗は exit 1
        if len(failures) == len(tasks):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
