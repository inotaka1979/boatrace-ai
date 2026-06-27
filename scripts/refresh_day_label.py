#!/usr/bin/env python3
"""既存 racedata/today.json に「◯日目」(day_label) だけを軽量 backfill する。

scrape_racedata の通常フローは再開ロジックで取得済みレースをスキップするため、
当日すでに取得済みの racedata には day_label が付かない。本スクリプトは写真DLや
全レース再取得を行わず、day_label が未設定の場のみ出走表(racelist)を 1 場 1 回引いて
day_label を全 entry に付与する。push(マージ)トリガーで自動実行する想定。
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402
import scrape_racedata as S  # noqa: E402

RACEDATA = "data/racedata/today.json"


def main() -> int:
    if not os.path.exists(RACEDATA):
        print("no racedata file")
        return 0
    with open(RACEDATA, encoding="utf-8") as f:
        d = json.load(f)
    rd = d.get("racedata") or []
    if not rd:
        print("empty racedata")
        return 0
    date_str = str(d.get("race_date") or "").replace("-", "")

    by_sid: dict = {}
    for e in rd:
        by_sid.setdefault(e.get("stadium"), []).append(e)

    changed = 0
    for sid, entries in by_sid.items():
        if sid is None:
            continue
        if all(e.get("day_label") for e in entries):
            continue
        jcd = f"{int(sid):02d}"
        rno0 = entries[0].get("race", 1)
        try:
            _, label = S.scrape_racelist(jcd, rno0, date_str)
        except Exception as ex:
            print(f"  stadium {sid} fail: {ex}")
            label = None
        if label:
            for e in entries:
                e["day_label"] = label
            changed += len(entries)
            print(f"  stadium {sid}: day_label = {label}")
        time.sleep(0.3)

    if changed:
        d["updated_at"] = utc_iso_seconds()
        atomic_write_json(RACEDATA, d)
    print(f"day_label backfilled on {changed} entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
