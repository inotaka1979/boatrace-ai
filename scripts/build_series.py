#!/usr/bin/env python3
"""今節成績を「選手番号」で引ける形に作り直す (2026-11-20)

data/racedata/today.json の今節成績 (current_series_results) は
  - 取得した時点まで（racedata は 1 日 1 回、朝〜昼に取る）の成績しか無く、その日の午後以降の結果が入らない
  - 艇番で並んでおり選手番号が無い（翌朝、前日の racedata を今日のレースに艇番で当てると別の選手の成績になる）
ため、racedata の日付の確定結果で「その日の分」を埋め直し、選手番号で引ける
data/racedata/series.json を書く。アプリは

  - 今日の racedata があればそれ + 今日の確定結果
  - まだ無ければ series.json（前日まで）+ 今日の確定結果（前日が最終日なら新しい節なので使わない）

で今節成績を表示する。ネットワークは使わない（ローカルの racedata / programs / results / previews だけ）。

出力:
  {"date": "YYYYMMDD", "updated_at": ..., "stadiums": {
      "<sid>": {"day": N, "day_label": "3日目", "final": false, "held": true,
                "racers": {"<登録番号>": [14 枠 (7 日 × 2 走) の {waku, course, place, st} or null]}}}}

    python3 scripts/build_series.py [--data-dir data]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402

SLOTS = 14  # 7 日 × 2 走（boatrace.jp の今節成績の並び）
OUT_FILE = "series.json"


def _load(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _date_of(obj) -> str:
    """ファイル / 先頭要素の race_date を YYYYMMDD で返す（無ければ ""）。"""
    if not isinstance(obj, dict):
        return ""
    rd = obj.get("race_date")
    if not rd:
        for key in ("programs", "results"):
            arr = obj.get(key) or []
            if arr and isinstance(arr[0], dict):
                rd = arr[0].get("race_date")
                break
    return str(rd or "").replace("-", "")


def _load_for_date(data_dir: str, domain: str, date: str):
    """その日のファイル（日付付きアーカイブ、無ければ同じ日付の today.json）。"""
    d = _load(os.path.join(data_dir, domain, date + ".json"))
    if d is not None and (_date_of(d) in ("", date)):
        return d
    d = _load(os.path.join(data_dir, domain, "today.json"))
    if d is not None and _date_of(d) == date:
        return d
    return None


def day_number(label) -> int | None:
    """「初日」→1、「3日目」→3。最終日・不明は None。"""
    if not label:
        return None
    s = str(label)
    if s.startswith("初日"):
        return 1
    m = re.search(r"(\d+)\s*日目", s.translate(str.maketrans("０１２３４５６７８９", "0123456789")))
    return int(m.group(1)) if m else None


def _st_str(v) -> str:
    """0.13 → ".13"（racedata と同じ表記）。"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return ""
    if f < 0:
        return "F"
    return ("%.2f" % f).lstrip("0") if f < 1 else "%.2f" % f


def build(data_dir: str = "data") -> dict | None:
    rd = _load(os.path.join(data_dir, "racedata", "today.json"))
    if not isinstance(rd, dict) or not rd.get("racedata"):
        return None
    date = _date_of(rd)
    if not date:
        return None
    programs = _load_for_date(data_dir, "programs", date) or {}
    results = _load_for_date(data_dir, "results", date) or {}
    previews = _load_for_date(data_dir, "previews", date) or {}

    # (sid, rno) → {艇番: 登録番号}
    racer_of: dict[tuple[int, int], dict[int, str]] = {}
    for p in programs.get("programs") or []:
        key = (p.get("race_stadium_number"), p.get("race_number"))
        racer_of[key] = {b.get("racer_boat_number"): str(b["racer_number"])
                         for b in p.get("boats") or [] if b.get("racer_number")}
    # 展示の進入（v1 の結果は進入が枠番のままなので、こちらを使う）
    pv_course: dict[tuple[int, int], dict[int, int]] = {}
    for r in previews.get("races") or previews.get("previews") or []:
        key = (r.get("stadium") or r.get("race_stadium_number"), r.get("race") or r.get("race_number"))
        boats = r.get("boats") or {}
        items = boats.items() if isinstance(boats, dict) else ((b.get("racer_boat_number"), b) for b in boats)
        pv_course[key] = {int(k): b.get("racer_course_number") for k, b in items
                          if isinstance(b, dict) and b.get("racer_course_number")}

    stadiums: dict[str, dict] = {}
    for e in rd["racedata"]:
        sid, rno = e.get("stadium"), e.get("race")
        st = stadiums.setdefault(str(sid), {"day": None, "day_label": None, "racers": {}})
        if e.get("day_label") and not st["day_label"]:
            st["day_label"] = e["day_label"]
        mapping = racer_of.get((sid, rno), {})
        for b in e.get("boats") or []:
            rno_s = mapping.get(b.get("boat_number")) or (str(b["racer_number"]) if b.get("racer_number") else None)
            arr = b.get("current_series_results")
            if not rno_s or not isinstance(arr, list):
                continue
            slots = (list(arr) + [None] * SLOTS)[:SLOTS]
            st["racers"].setdefault(rno_s, slots)

    for sid, st in stadiums.items():
        n = day_number(st["day_label"])
        if n is None:
            # 最終日・ラベル無し: 場の中で最も後ろの埋まった枠の日。
            #   全員が空なら初日（2 日目以降なら誰かは前日までに走っている）
            last = [i for slots in st["racers"].values() for i, x in enumerate(slots) if x]
            n = (max(last) // 2 + 1) if last else (1 if st["racers"] else None)
        st["day"] = n
        st["final"] = bool(st["day_label"] and "最終" in str(st["day_label"]))

    # その日の確定結果で、その日の枠を埋め直す（racedata 取得後のレースが入る）
    by_sid: dict[int, list] = {}
    for r in results.get("results") or []:
        if r.get("race_technique_number") is None or not r.get("boats"):
            continue  # 未確定
        by_sid.setdefault(r.get("race_stadium_number"), []).append(r)
    for sid, st in stadiums.items():
        # 中止で 1 レースも確定しなかった日は節の日数が進まない（翌日も同じ日目）
        st["held"] = int(sid) in by_sid if by_sid else None
    for sid, races in by_sid.items():
        st = stadiums.get(str(sid))
        if not st or not st["day"] or st["day"] > SLOTS // 2:
            continue
        base = (st["day"] - 1) * 2
        nth: dict[str, int] = {}
        for r in sorted(races, key=lambda x: x.get("race_number") or 0):
            key = (sid, r.get("race_number"))
            v2 = r.get("_parse_v") == 2
            for b in r.get("boats") or []:
                place = b.get("racer_place_number")  # 失格・欠場は None（枠は消費する）
                bn = b.get("racer_boat_number")
                rno_s = (str(b["racer_number"]) if b.get("racer_number") else None) or racer_of.get(key, {}).get(bn)
                if not rno_s or rno_s not in st["racers"]:
                    continue
                k = nth.get(rno_s, 0)
                nth[rno_s] = k + 1
                if k >= 2:
                    continue
                course = b.get("racer_course_number") if v2 else pv_course.get(key, {}).get(bn)
                st["racers"][rno_s][base + k] = {
                    "waku": bn, "course": course, "place": place,
                    "st": _st_str(b.get("racer_start_timing")) if v2 else "",
                }

    return {"date": date, "updated_at": utc_iso_seconds(), "stadiums": stadiums}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data-dir", default="data")
    args = ap.parse_args()
    out = build(args.data_dir)
    if out is None:
        print("build_series: racedata が無い → skip")
        return 0
    atomic_write_json(os.path.join(args.data_dir, "racedata", OUT_FILE), out)
    n = sum(len(s["racers"]) for s in out["stadiums"].values())
    print(f"build_series: {out['date']} {len(out['stadiums'])} 場 / {n} 選手")
    return 0


if __name__ == "__main__":
    sys.exit(main())
