#!/usr/bin/env python3
"""統合 scraper エントリポイント — Path B (2026-05-16, ping 2026-05-17T00:58Z)

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
import json
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


def _scrape_programs() -> int:
    # 公式 boatrace.jp racelist → openapi 互換 programs。10 場 × 12R ≒ 120 fetch。
    #   番組表は日次でほぼ静的なため 1 日 1 回（朝）取れれば十分。
    return _run_subprocess("scrape_programs.py", timeout_sec=1800)


def _scrape_racedata() -> int:
    # D7 (2026-05-17): GHA runner 上では boatrace.jp scrape が遅く
    #   race loop ~20 min + photo DL 600s で 1500s を超過し silent timeout。
    #   2400s (40 min) に拡張。実 fetch は通常 25-30 min で完了。
    return _run_subprocess("scrape_racedata.py", timeout_sec=2400)


def _scrape_schedule_quick() -> int:
    return _run_subprocess("scrape_schedule.py", ["--quick"], timeout_sec=120)


def _scrape_tide() -> int:
    return _run_subprocess("scrape_tide.py", timeout_sec=300)


def _prerender_top() -> int:
    return _run_subprocess("prerender_top.py", timeout_sec=120)


def _is_fresh_today(path: str, now_jst: datetime.datetime) -> bool:
    """data/<scope>/today.json が今日 (JST) の完了データかを判定する。

    True なら fetch 不要、False なら要更新。判定ロジック:
      - file 不在 → False (要更新)
      - JSON parse 失敗 / updated_at 欠落 → False (要更新)
      - updated_at が today (JST) より前 → False (要更新)
      - partial=True (途中保存) → False (残り stadium 補完が必要)
      - 上記以外 → True (fresh)

    2026-05-17: GHA cron の遅延 (15-30 分) で時刻ベースの起動条件を
    すり抜ける問題への根本対策。時刻窓を広げ、内側で「今日のデータか」を
    冪等チェックすることで、毎 tick で「足りなければ取る / 足りていれば skip」
    が成立する。さらに partial=True で stadium 単位の途中保存もサポート。
    """
    full = os.path.join(ROOT, path) if not os.path.isabs(path) else path
    if not os.path.exists(full):
        return False
    try:
        with open(full, encoding="utf-8") as f:
            data = json.load(f)
        # partial=True は scrape_racedata.py が stadium 単位で書いた
        # 途中保存。残り stadium の補完が必要なので fresh とは扱わない。
        if data.get("partial") is True:
            return False
        ts = data.get("updated_at") or data.get("generated_at")
        if not ts:
            return False
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        dt = datetime.datetime.fromisoformat(ts).astimezone(JST)
        return dt.date() == now_jst.date()
    except Exception as e:
        log.warning("  freshness check failed for %s: %s", path, e)
        return False


def _age_minutes(path: str) -> float:
    """data ファイルの updated_at 経過分数。読めない/欠落は無限大扱い(要更新)。"""
    full = os.path.join(ROOT, path) if not os.path.isabs(path) else path
    try:
        with open(full, encoding="utf-8") as f:
            ts = (json.load(f) or {}).get("updated_at")
        if not ts:
            return float("inf")
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        dt = datetime.datetime.fromisoformat(ts)
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        return (now_utc - dt).total_seconds() / 60.0
    except Exception:
        return float("inf")


def _decide_tasks(now: datetime.datetime, force_all: bool) -> list[tuple[str, Callable[[], int]]]:
    """JST 現在時刻から実行 task list を決定。

    2026-05-17 改善方針 (人手不要の自己回復):
      - odds / previews: race hours は毎 tick 取得 (リアルタイム性が必要)
      - results: 30 分窓広め (cron 遅延耐性)
      - racedata / schedule / tide: 時刻窓は広く取り、内側で「今日のデータか」
        を冪等にチェック。Open API 公開遅延や GHA cron 遅延があっても
        次の tick で必ず取得される。
    """
    tasks: list[tuple[str, Callable[[], int]]] = []
    h, m = now.hour, now.minute

    if force_all:
        # 2026-06-04 (rt-fix P0-2): prerender は index.html を書き換え、
        #   複数 workflow の push を非マージ衝突させる唯一の原因だったため
        #   scrape の commit 対象から除外（index.html は skeleton + JS render）。
        return [
            ("schedule(quick)", _scrape_schedule_quick),
            ("programs", _scrape_programs),
            ("racedata", _scrape_racedata),
            ("tide", _scrape_tide),
            ("odds", _scrape_odds),
            ("previews", _scrape_previews),
            ("results", _scrape_results),
        ]

    # racedata stale 時の優先実行: GHA job timeout (25 min) と odds の timeout
    # 5 min が重なると racedata (~15 min) が完走できない事故が発生。
    # stale な racedata は 1 日 1 回しか走らないので先に取り、その後 odds 等を走らせる。
    racedata_window = (h == 8 and m >= 30) or (9 <= h <= 22)
    racedata_stale = racedata_window and not _is_fresh_today("data/racedata/today.json", now)
    if racedata_stale:
        tasks.append(("racedata", _scrape_racedata))
        tasks.append(("schedule(quick)", _scrape_schedule_quick))

    # programs（公式番組表）: 番組表は日次でほぼ静的。本日分が未取得なら朝の窓で 1 回取得。
    #   一覧元の current.json を使うため schedule(quick) を先に確実に走らせる。
    if racedata_window and not _is_fresh_today("data/programs/today.json", now):
        if not any(name == "schedule(quick)" for name, _ in tasks):
            tasks.append(("schedule(quick)", _scrape_schedule_quick))
        tasks.append(("programs", _scrape_programs))

    # 共通: race hours (JST 08-22) は odds + previews を毎 tick
    if 8 <= h <= 22:
        tasks.append(("odds", _scrape_odds))
        tasks.append(("previews", _scrape_previews))

    # results: 鮮度ベース (2026-07-05)。
    # 旧条件は「実行時の分が 0-9 or 25-35」の分窓だったが、GHA の schedule 間引きで
    #   実行時刻が不定になると丸一日 skip し得る(実障害: 07-05 に 10:17 実行で
    #   results タスクが走らず、前日から results が空のまま)。
    #   updated_at が 20 分より古ければ毎 tick で取得する(冪等。並列は
    #   concurrency:scrape-all で防止されるため安全)。
    if 10 <= h <= 22 and _age_minutes("data/results/today.json") >= 20:
        tasks.append(("results", _scrape_results))

    # racedata fresh だが next_open.json は古い場合 (前日跨ぎ等) の単独 refresh。
    # racedata stale 時は上の優先 block で既に処理済み。
    if (
        racedata_window
        and not racedata_stale
        and not _is_fresh_today("data/schedule/next_open.json", now)
    ):
        tasks.append(("schedule(quick)", _scrape_schedule_quick))

    # tide: JST 07:30-09:30 で「今日のデータでなければ取る」
    tide_window = (h == 7 and m >= 30) or h == 8 or (h == 9 and m < 30)
    if tide_window and not _is_fresh_today("data/tide/today.json", now):
        tasks.append(("tide", _scrape_tide))
        # tide 取得時に next_open も refresh (低コスト、未取得なら埋める)
        if not any(name == "schedule(quick)" for name, _ in tasks):
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
            "programs": _scrape_programs,
            "schedule": _scrape_schedule_quick,
            "tide": _scrape_tide,
            "prerender": _prerender_top,
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
