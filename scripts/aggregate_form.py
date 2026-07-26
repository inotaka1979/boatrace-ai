#!/usr/bin/env python3
"""PR-7 (2026-07-26): data/results + data/programs から直近フォームと場別統計を再構築。

build_db.py Step 2 は競走成績 K ファイル (http://www1.mbrace.or.jp/od2/K/...) に
依存していたが、GitHub Actions の egress から到達できず 30 日分すべて失敗し、
stadiumDB.stadiums == {} / 全選手 recentResults == [] という静かな縮退を招いていた
(docs レビュー S-05)。既に稼働している scrape_results / scrape_programs の蓄積から
同じ情報を組み立てることで経路を 1 本化する。

入力:
    data/results/*.json  … 確定着順 (racer_place_number / racer_course_number)
    data/programs/*.json … 登番マッピング (results は racer_number=null のため join 必須)

出力 (atomic):
    data/db/racerDB.json  … 各選手の recentResults を in-place 更新 (時系列昇順・末尾が最新)
    data/db/stadiumDB.json … 場別コース勝率 (float) + totalRaces を再構築

冪等: 同じ入力で 2 回実行して同じ出力 (recentResults は毎回ゼロから再構築)。
silent success 禁止: 集計した races / mapped 件数を stdout に出し、0 なら exit 5。
"""

from __future__ import annotations

import glob
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402

RESULTS_GLOB = "data/results/*.json"
PROGRAMS_GLOB = "data/programs/*.json"
RACER_DB = "data/db/racerDB.json"
STADIUM_DB = "data/db/stadiumDB.json"
MAX_RECENT = 20   # getRacerForm は直近数レースしか見ないが余裕を持って保持


def _load(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_program_index(paths: list[str]) -> dict[tuple, int]:
    """(race_date, stadium, race, boat) -> racer_number(登番) の索引を作る。"""
    idx: dict[tuple, int] = {}
    for p in paths:
        try:
            d = _load(p)
        except (OSError, json.JSONDecodeError) as e:
            print(f"  skip programs {p}: {type(e).__name__}: {e}")
            continue
        for prog in d.get("programs", []) or []:
            date = prog.get("race_date")
            sid = prog.get("race_stadium_number")
            rno = prog.get("race_number")
            for b in prog.get("boats", []) or []:
                bn = b.get("racer_boat_number")
                rn = b.get("racer_number")
                if rn is None or bn is None:
                    continue
                idx[(date, sid, rno, bn)] = rn
    return idx


def aggregate(results_paths: list[str], prog_idx: dict[tuple, int]):
    """results を時系列に走査し (recent, stadium, 統計) を返す。"""
    seen: set[tuple] = set()
    entries: list[tuple] = []
    for p in sorted(results_paths):
        try:
            d = _load(p)
        except (OSError, json.JSONDecodeError) as e:
            print(f"  skip results {p}: {type(e).__name__}: {e}")
            continue
        for r in d.get("results", []) or []:
            boats = r.get("boats") or []
            if not boats:
                continue
            date = r.get("race_date")
            sid = r.get("race_stadium_number")
            rno = r.get("race_number")
            key = (date, sid, rno)
            if key in seen:   # today.json と日次アーカイブの重複を排除
                continue
            seen.add(key)
            entries.append((date, sid, rno, boats))

    entries.sort(key=lambda e: (e[0] or "", e[1] or 0, e[2] or 0))

    recent: dict[str, list[int]] = defaultdict(list)
    stadium: dict[int, dict[int, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: {"races": 0, "wins": 0})
    )
    total_boats = 0
    mapped = 0
    for date, sid, rno, boats in entries:
        for b in boats:
            place = b.get("racer_place_number")
            course = b.get("racer_course_number")
            bn = b.get("racer_boat_number")
            if isinstance(course, int) and 1 <= course <= 6:
                stadium[sid][course]["races"] += 1
                if place == 1:
                    stadium[sid][course]["wins"] += 1
            if isinstance(place, int) and 1 <= place <= 6:
                total_boats += 1
                rn = prog_idx.get((date, sid, rno, bn))
                if rn is not None:
                    mapped += 1
                    recent[str(rn)].append(place)
    return recent, stadium, total_boats, mapped, len(entries)


def main() -> int:
    results = glob.glob(RESULTS_GLOB)
    programs = glob.glob(PROGRAMS_GLOB)
    if not results:
        print("::error::data/results/*.json が 1 件も無い", file=sys.stderr)
        return 5

    prog_idx = build_program_index(programs)
    recent, stadium, total_boats, mapped, nraces = aggregate(results, prog_idx)
    print(
        f"races={nraces} boats={total_boats} mapped_to_toban={mapped} "
        f"racers_with_form={len(recent)} stadiums={len(stadium)}"
    )
    if nraces == 0:
        print("::error::確定レースが 0 件 (results はあるが boats が空)", file=sys.stderr)
        return 5

    # racerDB.recentResults を in-place 更新 (classNum / courseStats は build_db.py 由来を温存)
    rdb = _load(RACER_DB) if os.path.exists(RACER_DB) else {"racers": {}}
    racers = rdb.setdefault("racers", {})
    for toban, places in recent.items():
        rec = places[-MAX_RECENT:]
        if toban in racers and isinstance(racers[toban], dict):
            racers[toban]["recentResults"] = rec
        else:
            racers[toban] = {"recentResults": rec}
    rdb["updated_at"] = utc_iso_seconds()
    atomic_write_json(RACER_DB, rdb)

    # stadiumDB を再構築 (build_db.py と同じ float rate + totalRaces 形式)
    stadiums: dict[str, dict] = {}
    for sid, courses in stadium.items():
        cwr: dict[str, float] = {}
        total = 0
        for c, st in courses.items():
            if st["races"] > 0:
                cwr[str(c)] = round(st["wins"] / st["races"], 4)
            total += st["races"]
        stadiums[str(sid)] = {"courseWinRate": cwr, "totalRaces": total // 6}
    atomic_write_json(STADIUM_DB, {"updated_at": utc_iso_seconds(), "stadiums": stadiums})

    print(f"wrote {RACER_DB} ({len(racers)} racers) + {STADIUM_DB} ({len(stadiums)} stadiums)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
