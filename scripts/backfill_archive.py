#!/usr/bin/env python3
"""確定済みレースの展示・オッズをアーカイブへ後追いで埋める (2026-11-20)。

背景:
  backtest で評価できているのは「番組表だけの朝予想」に近い。日次アーカイブ
  (data/{odds,previews}/YYYYMMDD.json) は scrape-all が締切前に取れた分しか持たず、
  展示の被覆 15%・三連単オッズ 13〜30%/日にとどまる。GitHub schedule の遅延で深夜に
  届く run は何もせず終わっていたので、その時間で確定済みレースの
    - 展示 (beforeinfo: 展示タイム / ST / 進入 / チルト)
    - オッズ (odds3t / oddstf / odds2tf: 締切後は確定オッズ)
  を取り直し、日付付きアーカイブにマージする。

  * 対象は「今日より前」の日付だけ。今日の日付ファイルは archive_daily.py が today.json から
    毎 run 上書きするため、ここで書いても消える。
  * 既にあるデータは上書きしない（欠けているレースだけ取る）。
  * 1 run の上限 (BACKFILL_MAX_RACES) と内部期限 (BACKFILL_BUDGET_SEC)。間隔は 0.5 秒（odds と同じ）。
  * 取得元のブロック (403 連続) を検知したら止める（http_utils.SourceBlockDetector）。
  * 取得状況は data/_status.json の tasks.backfill に記録する。

    python3 scripts/backfill_archive.py [--days 3] [--max-races 40]
"""

from __future__ import annotations

import argparse
import datetime
import json
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import SourceBlockDetector, fetch_once, timed_call, write_source_status  # noqa: E402
from io_utils import atomic_write_json  # noqa: E402
import scrape_odds_fast as odds_mod  # noqa: E402
import scrape_previews as prev_mod  # noqa: E402
import scrape_results as res_mod  # noqa: E402

BASE = "https://www.boatrace.jp/owpc/pc/race"
DATA = os.environ.get("BACKFILL_DATA_DIR", "data")
INTERVAL = 0.5
MAX_RACES = int(os.environ.get("BACKFILL_MAX_RACES", "40"))
BUDGET_SEC = int(os.environ.get("BACKFILL_BUDGET_SEC", "150"))
JST = datetime.timezone(datetime.timedelta(hours=9))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("backfill")


def _load(path: str) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def finished_races(results: dict | None) -> list[tuple[int, int]]:
    """着順が 3 艇以上ある確定レース (sid, rno) を返す。"""
    out = []
    for r in (results or {}).get("results") or []:
        places = [b for b in (r.get("boats") or []) if isinstance(b.get("racer_place_number"), int)]
        if len(places) >= 3 and r.get("race_stadium_number") and r.get("race_number"):
            out.append((int(r["race_stadium_number"]), int(r["race_number"])))
    return sorted(set(out))


def _has_exhibition(entry: dict | None) -> bool:
    boats = (entry or {}).get("boats")
    if not isinstance(boats, dict):
        return False
    return sum(1 for b in boats.values() if isinstance(b, dict) and (b.get("racer_exhibition_time") or 0) > 0) >= 4


def plan(date: str, data_dir: str = DATA) -> dict:
    """その日の「展示が無い」「三連単オッズが無い」確定レースを返す。"""
    results = _load(os.path.join(data_dir, "results", date + ".json"))
    odds = _load(os.path.join(data_dir, "odds", date + ".json")) or {}
    prev = _load(os.path.join(data_dir, "previews", date + ".json")) or {}
    have_odds = {(o.get("stadium"), o.get("race")) for o in odds.get("odds") or [] if o.get("trifecta")}
    prev_idx = {(p.get("stadium"), p.get("race")): p for p in prev.get("races") or []}
    need_odds, need_prev = [], []
    for k in finished_races(results):
        if k not in have_odds:
            need_odds.append(k)
        if not _has_exhibition(prev_idx.get(k)):
            need_prev.append(k)
    # 2026-11-20: 結果の解析版が古い（決まり手が常に逃げ・進入 = 枠番・登録番号 / ST なし）レースは取り直す。
    #   aggregate_racer_stats は解析版 2 の結果だけを集計する。
    need_res = sorted(
        (int(r["race_stadium_number"]), int(r["race_number"]))
        for r in (results or {}).get("results") or []
        if r.get("race_technique_number") and (r.get("_parse_v") or 0) < 2
        and r.get("race_stadium_number") and r.get("race_number"))
    return {"odds": need_odds, "previews": need_prev, "results": need_res}


def merge_results(date: str, fetched: dict, data_dir: str = DATA) -> int:
    """取り直した結果 (解析版 2) で同じレースの旧版を置き換える。確定していない取得結果は捨てる。"""
    path = os.path.join(data_dir, "results", date + ".json")
    cur = _load(path)
    if not cur:
        return 0
    n = 0
    out = []
    for r in cur.get("results") or []:
        k = (r.get("race_stadium_number"), r.get("race_number"))
        new = fetched.get(k)
        if new and new.get("race_technique_number") and (new.get("_parse_v") or 0) >= 2 \
                and (r.get("_parse_v") or 0) < 2:
            # 旧版にしか無い項目（払戻など）は残す
            merged = dict(r)
            merged.update({kk: vv for kk, vv in new.items() if vv not in (None, [], {})})
            merged["_backfilled"] = True
            out.append(merged)
            n += 1
        else:
            out.append(r)
    if n:
        cur["results"] = out
        atomic_write_json(path, cur)
    return n


def merge_odds(date: str, fetched: dict, data_dir: str = DATA) -> int:
    path = os.path.join(data_dir, "odds", date + ".json")
    cur = _load(path) or {"race_date": date, "odds": []}
    idx = {(o.get("stadium"), o.get("race")): o for o in cur.get("odds") or []}
    added = 0
    for (sid, rno), entry in fetched.items():
        old = idx.get((sid, rno))
        if old and old.get("trifecta"):
            continue  # 既にあるものは上書きしない
        merged = dict(old or {"stadium": sid, "race": rno})
        for k in ("win", "exacta", "trifecta"):
            if entry.get(k) and not merged.get(k):
                merged[k] = entry[k]
        merged["_backfilled"] = True  # 締切後に取得した確定オッズ
        idx[(sid, rno)] = merged
        added += 1
    if added:
        cur["odds"] = [idx[k] for k in sorted(idx, key=lambda x: (x[0] or 0, x[1] or 0))]
        atomic_write_json(path, cur)
    return added


def merge_previews(date: str, fetched: dict, data_dir: str = DATA) -> int:
    path = os.path.join(data_dir, "previews", date + ".json")
    cur = _load(path) or {"race_date": date, "races": []}
    idx = {(p.get("stadium"), p.get("race")): p for p in cur.get("races") or []}
    added = 0
    for (sid, rno), parsed in fetched.items():
        old = idx.get((sid, rno))
        if _has_exhibition(old):
            continue
        merged = dict(old or {"stadium": sid, "race": rno})
        merged["boats"] = parsed.get("boats") or {}
        if parsed.get("weather"):
            merged["weather"] = parsed["weather"]
        merged["_backfilled"] = True
        idx[(sid, rno)] = merged
        added += 1
    if added:
        cur["races"] = [idx[k] for k in sorted(idx, key=lambda x: (x[0] or 0, x[1] or 0))]
        atomic_write_json(path, cur)
    return added


class _Fetcher:
    def __init__(self, block: SourceBlockDetector, deadline: float):
        self.block = block
        self.deadline = deadline
        self._last = 0.0
        self.requests = 0

    def get(self, url: str) -> str | None:
        if self.block.blocked or time.monotonic() >= self.deadline:
            return None
        wait = INTERVAL - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()
        (status, text), sec = timed_call(fetch_once, url, timeout=15)
        self.requests += 1
        self.block.record(status, sec)
        if status == 403:
            log.warning("HTTP 403 for %s", url)
        return text if status == 200 else None


def _odds_for(f: _Fetcher, sid: int, rno: int, hd: str) -> dict:
    q = f"rno={rno}&jcd={sid:02d}&hd={hd}"
    out = {}
    html = f.get(f"{BASE}/odds3t?{q}")
    if html:
        tri = odds_mod.parse_trifecta(html)
        if tri:
            out["trifecta"] = tri
    if not out:
        return out  # 三連単が取れないレースは単勝も取りに行かない
    html = f.get(f"{BASE}/oddstf?{q}")
    if html:
        w = odds_mod.parse_win(html)
        if w:
            out["win"] = w
    return out


def _preview_for(f: _Fetcher, sid: int, rno: int, hd: str) -> dict | None:
    html = f.get(f"{BASE}/beforeinfo?rno={rno}&jcd={sid:02d}&hd={hd}")
    if not html:
        return None
    boats = prev_mod.parse_beforeinfo(html)
    if not boats:
        return None
    # scrape_previews.scrape_race と同じ変換（アーカイブの live スキーマ）
    return {"boats": {
        str(bn): {
            "racer_exhibition_time": d.get("exhibition_time"),
            "racer_start_timing": d.get("start_timing"),
            "racer_tilt_adjustment": d.get("tilt"),
            "racer_course_number": d.get("course"),
            "racer_propeller": d.get("propeller", ""),
            "racer_parts_replaced": d.get("parts_replaced", ""),
            "racer_adjust_weight": d.get("adjust_weight", 0.0),
        }
        for bn, d in boats.items()
    }}


def _result_for(f: "_Fetcher", sid: int, rno: int, hd: str) -> dict | None:
    html = f.get(f"{BASE}/raceresult?rno={rno}&jcd={sid:02d}&hd={hd}")
    if not html:
        return None
    r = res_mod.parse_raceresult(html, sid, rno, hd)
    return r if r.get("race_technique_number") else None


def run(days: int = 3, max_races: int = MAX_RACES, budget_sec: int = BUDGET_SEC, data_dir: str = DATA,
        today: datetime.date | None = None, only: str | None = None) -> dict:
    """only: None = 全部 / "results" = 結果の取り直しだけ（初回の一括変換用）"""
    today = today or datetime.datetime.now(JST).date()
    block = SourceBlockDetector()
    f = _Fetcher(block, time.monotonic() + budget_sec)
    summary = {"dates": {}, "attempted": 0, "updated": 0}
    left = max_races
    # 新しい日付から（直近の方が backtest の検証期間に入りやすい）
    for d in range(1, days + 1):
        if left <= 0 or block.blocked or time.monotonic() >= f.deadline:
            break
        date = (today - datetime.timedelta(days=d)).strftime("%Y%m%d")
        p = plan(date, data_dir)
        if only == "results":
            p["odds"], p["previews"] = [], []
        keys = sorted(set(p["odds"]) | set(p["previews"]) | set(p["results"]))[:left]
        if not keys:
            continue
        got_odds, got_prev, got_res = {}, {}, {}
        for sid, rno in keys:
            if block.blocked or time.monotonic() >= f.deadline:
                break
            summary["attempted"] += 1
            left -= 1
            if (sid, rno) in p["results"]:
                rr = _result_for(f, sid, rno, date)
                if rr:
                    got_res[(sid, rno)] = rr
            if (sid, rno) in p["previews"]:
                pv = _preview_for(f, sid, rno, date)
                if pv:
                    got_prev[(sid, rno)] = pv
            if (sid, rno) in p["odds"]:
                od = _odds_for(f, sid, rno, date)
                if od:
                    got_odds[(sid, rno)] = od
        a = merge_odds(date, got_odds, data_dir)
        b = merge_previews(date, got_prev, data_dir)
        c = merge_results(date, got_res, data_dir)
        summary["updated"] += len(set(got_odds) | set(got_prev) | set(got_res))
        summary["dates"][date] = {"need_odds": len(p["odds"]), "need_previews": len(p["previews"]),
                                  "need_results": len(p["results"]),
                                  "added_odds": a, "added_previews": b, "upgraded_results": c}
        log.info("%s: odds +%d (need %d), previews +%d (need %d), results v2 +%d (need %d)",
                 date, a, len(p["odds"]), b, len(p["previews"]), c, len(p["results"]))
    summary["requests"] = f.requests
    summary.update(block.stats())
    write_source_status("backfill", {"attempted": summary["attempted"], "updated": summary["updated"], **block.stats()},
                        path=os.path.join(data_dir, "_status.json"))
    return summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--max-races", type=int, default=MAX_RACES)
    ap.add_argument("--budget-sec", type=int, default=BUDGET_SEC)
    ap.add_argument("--only", choices=["results"], default=None)
    a = ap.parse_args(argv)
    s = run(days=a.days, max_races=a.max_races, budget_sec=a.budget_sec, only=a.only)
    log.info("backfill done: %s", json.dumps({k: v for k, v in s.items() if k != "dates"}))
    if s.get("blocked"):
        log.error("SOURCE BLOCKED — boatrace.jp が HTTP 403 を返し続けたため中止")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
