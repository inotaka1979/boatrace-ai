"""今節成績を選手番号で引ける形にする build_series.py (2026-11-20) の回帰テスト

  - racedata の艇番を、その日の番組表で選手番号に引き直す
  - racedata 取得後に確定したレースで、その日の枠を埋める（n 走目 → その日の n 番目の枠）
  - 日目: ラベル（初日 / N日目）、最終日・ラベル無しは場の中の最後の埋まった枠、全員空なら初日
  - 1 レースも確定しなかった場（中止）は held=False

    python3 -m unittest scripts.tests.test_build_series -v
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import build_series as bs  # noqa: E402

D = "20261119"


def _w(d, rel, obj):
    p = os.path.join(d, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


def E(place, waku):
    return {"waku": waku, "course": waku, "place": place, "st": ".15"}


def _setup(d, label="3日目", results=True, racedata_boats=None):
    _w(d, "racedata/today.json", {"race_date": D, "racedata": [
        {"stadium": 15, "race": 3, "day_label": label, "boats": racedata_boats or [
            {"boat_number": 1, "current_series_results": [E(1, 1), None, E(3, 2), E(4, 5)]},
            {"boat_number": 2, "current_series_results": [E(6, 6)]},
        ]},
        {"stadium": 9, "race": 1, "day_label": None, "boats": [
            {"boat_number": 1, "current_series_results": [None] * 14},
        ]},
    ]})
    _w(d, f"programs/{D}.json", {"race_date": "2026-11-19", "programs": [
        {"race_stadium_number": 15, "race_number": 3, "boats": [
            {"racer_boat_number": 1, "racer_number": 4001}, {"racer_boat_number": 2, "racer_number": 4002}]},
        {"race_stadium_number": 15, "race_number": 9, "boats": [{"racer_boat_number": 4, "racer_number": 4001}]},
        {"race_stadium_number": 9, "race_number": 1, "boats": [{"racer_boat_number": 1, "racer_number": 4009}]},
    ]})
    rs = [{"race_stadium_number": 9, "race_number": 1, "race_technique_number": None, "boats": []}]
    if results:
        rs += [
            {"race_stadium_number": 15, "race_number": 3, "race_technique_number": 1, "_parse_v": 2, "boats": [
                {"racer_boat_number": 1, "racer_place_number": 2, "racer_course_number": 2,
                 "racer_start_timing": 0.11, "racer_number": 4001},
                {"racer_boat_number": 2, "racer_place_number": None, "racer_course_number": 1,
                 "racer_start_timing": -0.01, "racer_number": 4002},
            ]},
            {"race_stadium_number": 15, "race_number": 9, "race_technique_number": 2, "boats": [
                {"racer_boat_number": 4, "racer_place_number": 1, "racer_course_number": 4,
                 "racer_start_timing": None, "racer_number": None},
            ]},
        ]
    _w(d, f"results/{D}.json", {"results": rs})
    _w(d, f"previews/{D}.json", {"race_date": D, "races": [
        {"stadium": 15, "race": 9, "boats": {"4": {"racer_course_number": 3}}}]})


class TestBuild(unittest.TestCase):
    def test_maps_racer_and_fills_day(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            out = bs.build(d)
        s = out["stadiums"]["15"]
        self.assertEqual(out["date"], D)
        self.assertEqual((s["day"], s["final"], s["held"]), (3, False, True))
        r = s["racers"]["4001"]
        self.assertEqual(len(r), bs.SLOTS)
        self.assertEqual(r[3]["place"], 4, "前日まで（racedata）")
        self.assertEqual(r[4], {"waku": 1, "course": 2, "place": 2, "st": ".11"}, "3 日目 1 走目 (v2)")
        # 旧形式の結果: 進入は展示から、ST は無し。選手番号は番組表で引く
        self.assertEqual(r[5], {"waku": 4, "course": 3, "place": 1, "st": ""})
        # 失格（着順なし）も枠を消費し、F は "F"
        self.assertEqual(s["racers"]["4002"][4], {"waku": 2, "course": 1, "place": None, "st": "F"})

    def test_cancelled_and_first_day(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            s = bs.build(d)["stadiums"]["9"]
        self.assertEqual(s["day"], 1, "全員空なら初日")
        self.assertFalse(s["held"], "中止")

    def test_final_day_from_slots(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, label="最終日", results=False)
            s = bs.build(d)["stadiums"]["15"]
        self.assertTrue(s["final"])
        self.assertEqual(s["day"], 2, "最後の埋まった枠 (index 3) の日")

    def test_day_number(self):
        self.assertEqual(bs.day_number("初日"), 1)
        self.assertEqual(bs.day_number("４日目"), 4)
        self.assertIsNone(bs.day_number("最終日"))
        self.assertIsNone(bs.day_number(None))

    def test_no_racedata(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(bs.build(d))


if __name__ == "__main__":
    unittest.main()
