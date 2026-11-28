#!/usr/bin/env python3
"""翌日の番組表（出走表）を前の晩に取っておく。

朝の番組表は、これまで非公式ミラー (openapi) が当日分に切り替わるのを待っていた。自前の取得
(scrape_programs.py) は GitHub の定時実行の遅れで、実際に走るのは昼前後になる。
2026-11-28 はミラーの切り替わりが遅れ、9:20 すぎまで前日の番組表のままで、アプリは開催している
14 場すべてを「次節」と表示した（鳴門 1R は 8:35 締切）。

公式の出走表は前日の夕方〜夜に公開される。前の晩に取って data/schedule/programs_tomorrow.json に置き、
日付が変わったら Worker がそれを配る（cloudflare-worker/worker.js の fetchProgramsBase）。
ファイル名は「翌日」だが、どの日の番組表かは中身の race_date で決まる（0 時を過ぎたら「今日の分」）。
当日の朝の窓（8:30 以降）には scrape_programs.py が data/programs/today.json を取り直すので、
このファイルが使われるのはそれまでの間。

取り方:
  - 対象は data/schedule/tomorrow.json（明日の出走。scrape_tomorrow.py）に載っている場のレース。
    まだ公開されていない場は取りに行かない（次の run で取る）。
  - 第 1 レースの締切が早い場から取る（朝の開催を先に確保する。夜の開催は、当日の取得でも間に合う）。
  - 1 件ずつ・間隔 0.5 秒・内部期限あり（既定 1200 秒）。取り切れなかった分は、次の run が続きから取る
    （同じ日付の間、取れたレースは消さない）。403 が続いたら止める。応答を速くする細工はしない。
  - 形は data/programs/today.json と同じ（openapi 互換）。partial = まだ取れていないレースがある。

  python3 scripts/scrape_programs_tomorrow.py                  翌日分を取る（夕方〜夜の run）
  python3 scripts/scrape_programs_tomorrow.py --target today   今日の分の続きを取る（0 時〜朝の run）。
      出走の一覧が無ければ（前の晩の run が 1 回も届かなかった時）、月間日程の開催場 × 12R を対象にする。
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
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402
from http_utils import SourceBlockDetector, fetch_once, timed_call, write_source_status  # noqa: E402
from scrape_programs import BASE_URL, RACES_PER_DAY, _validate, parse_racelist_program  # noqa: E402
from scrape_tomorrow import is_not_published, stadiums_on  # noqa: E402

log = logging.getLogger("programs_tomorrow")

JST = datetime.timezone(datetime.timedelta(hours=9))
INTERVAL = 0.5
# 1 件 9〜10 秒かかる日（公式サイトが自動取得への応答を遅らせている間）で、1 回に約 120 レース。
BUDGET_SEC = int(os.environ.get("PROGRAMS_TOMORROW_BUDGET_SEC", "1200"))
OUT_REL = os.path.join("schedule", "programs_tomorrow.json")
LIST_REL = os.path.join("schedule", "tomorrow.json")
SCHEDULE_REL = os.path.join("schedule", "current.json")


def _load(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def expected_races(listing, hd: str) -> list[tuple[int, int]]:
    """出走の一覧 (tomorrow.json) に載っている (場, R) を、第 1 レースの締切が早い場から並べて返す。

    日付の違う一覧・公開されていない場（stadiums に無い）は含めない。
    """
    if not isinstance(listing, dict) or listing.get("date") != hd:
        return []
    stadiums = listing.get("stadiums")
    if not isinstance(stadiums, dict):
        return []
    venues = []
    for key, v in stadiums.items():
        if not (str(key).isdigit() and 1 <= int(key) <= 24) or not isinstance(v, dict):
            continue
        races = [r for r in (v.get("races") or []) if isinstance(r, dict)]
        rnos = sorted({r["r"] for r in races
                       if isinstance(r.get("r"), int) and not isinstance(r.get("r"), bool) and 1 <= r["r"] <= 12})
        if not rnos:
            continue
        times = [r["t"] for r in races if isinstance(r.get("t"), str) and r["t"]]
        venues.append((min(times) if times else "99:99", int(key), rnos))
    venues.sort()
    return [(sid, rno) for _, sid, rnos in venues for rno in rnos]


def races_from_schedule(schedule, day: datetime.date) -> list[tuple[int, int]]:
    """月間日程 (current.json) でその日に開催のある場 × 12R。出走の一覧が無い時の代わり（当日分だけに使う）。"""
    return [(sid, rno) for sid in stadiums_on(schedule, day) for rno in range(1, RACES_PER_DAY + 1)]


def _kept_programs(old, iso: str) -> dict[tuple[int, int], dict]:
    """前の run までに取れているレース（同じ日付の行だけ。前の日の文書の行は 1 つも残らない）。"""
    out: dict[tuple[int, int], dict] = {}
    if not isinstance(old, dict) or not isinstance(old.get("programs"), list):
        return out
    for p in old["programs"]:
        if not isinstance(p, dict) or p.get("race_date") != iso:
            continue
        sid, rno = p.get("race_stadium_number"), p.get("race_number")
        if isinstance(sid, int) and isinstance(rno, int) and 1 <= sid <= 24 and 1 <= rno <= 12:
            out[(sid, rno)] = p
    return out


def run(data_dir: str = "data", now: datetime.datetime | None = None, budget_sec: int = BUDGET_SEC,
        target: str = "tomorrow", fetch=fetch_once, sleep=time.sleep, clock=time.monotonic) -> dict:
    """対象の日（target = tomorrow: 翌日 / today: 今日）の番組表のうち、まだ取れていないレースを取る。"""
    now = now or datetime.datetime.now(JST)
    day = (now + datetime.timedelta(days=1 if target == "tomorrow" else 0)).date()
    hd, iso = day.strftime("%Y%m%d"), day.isoformat()
    out_path = os.path.join(data_dir, OUT_REL)
    want = expected_races(_load(os.path.join(data_dir, LIST_REL)), hd)
    source = "listing"
    if not want and target == "today":
        # 前の晩の run が届かず、出走の一覧も無い。今日の出走表は公開済みなので、月間日程の開催場を対象にする
        #   （翌日分でこれをすると、公開前のページを 1 場 12 枚ずつ取りに行くことになるので、今日の分だけ）。
        want = races_from_schedule(_load(os.path.join(data_dir, SCHEDULE_REL)), day)
        source = "schedule"
    summary = {"date": hd, "target": target, "source": source, "expected": len(want), "attempted": 0,
               "updated": 0, "no_data": 0, "missing": len(want), "written": False}
    if not want:
        log.info("programs_tomorrow: %s の出走の一覧がまだ無い → 何もしない", hd)
        return summary

    old = _load(out_path)
    kept = _kept_programs(old, iso)
    todo = [k for k in want if k not in kept]
    block = SourceBlockDetector()
    deadline = clock() + budget_sec
    last = None
    got: dict[tuple[int, int], dict] = {}
    for sid, rno in todo:
        if block.blocked or clock() >= deadline:
            break
        if last is not None:
            wait = INTERVAL - (clock() - last)
            if wait > 0:
                sleep(wait)
        last = clock()
        (status, html), sec = timed_call(fetch, BASE_URL.format(rno=rno, jcd=sid, hd=hd), timeout=15)
        summary["attempted"] += 1
        block.record(status, sec)
        prg = None
        if status == 200 and html:
            try:
                prg = parse_racelist_program(html, sid, rno, hd)
            except Exception as e:  # noqa: BLE001
                log.warning("programs_tomorrow: %d-%dR を読めない (%s)", sid, rno, e)
            if prg and not _validate(prg):
                prg = None
        if prg:
            got[(sid, rno)] = prg
        elif status == 200 and is_not_published(html or ""):
            # 「データがありません」のページ（順延・中止で開催が無くなった場など）。読めたページとして数える
            #   （1 件も読めない = ページの形が変わった / 止められた、と区別する。scripts/source_health.py）。
            summary["no_data"] += 1
        else:
            log.warning("programs_tomorrow: %d-%dR を取れない (HTTP %s)", sid, rno, status)

    merged = {**kept, **got}
    missing = [k for k in want if k not in merged]
    body = {"race_date": iso, "partial": bool(missing), "expected": len(want),
            "programs": [merged[k] for k in sorted(merged)]}
    same = isinstance(old, dict) and all(old.get(k) == v for k, v in body.items())
    if body["programs"] and not same:
        atomic_write_json(out_path, {"updated_at": utc_iso_seconds(), **body})
        summary["written"] = True
    summary.update({"updated": len(got), "missing": len(missing), "races": len(merged), **block.stats()})
    if summary["attempted"]:
        # 取りに行った時だけ記録する（取り切った後の run は attempted 0 = 前の記録を上書きしない）。
        #   updated = 読めたページ（番組表が取れた + 「データがありません」と分かった）、races = 番組表が取れたレース
        write_source_status("programs_tomorrow",
                            {"attempted": summary["attempted"], "updated": len(got) + summary["no_data"],
                             "races": len(got), "missing": len(missing), **block.stats()},
                            path=os.path.join(data_dir, "_status.json"))
    log.info("programs_tomorrow %s: %d/%d レース（この run で %d 件取得、残り %d）",
             hd, len(merged), len(want), len(got), len(missing))
    return summary


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--budget-sec", type=int, default=BUDGET_SEC)
    ap.add_argument("--target", choices=["tomorrow", "today"], default="tomorrow",
                    help="tomorrow = 翌日分（夕方〜夜）/ today = 今日の分の続き（0 時〜朝）")
    a = ap.parse_args(argv)
    s = run(data_dir=a.data_dir, budget_sec=a.budget_sec, target=a.target)
    print("programs_tomorrow: " + json.dumps(s, ensure_ascii=False))
    return 3 if s.get("blocked") else 0


if __name__ == "__main__":
    sys.exit(main())
