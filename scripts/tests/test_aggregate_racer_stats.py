"""選手・モーターの長期集計 (2026-11-20) の回帰テスト

  - 解析版 2 の結果だけを使い、確定レースの 90% 以上が版 2 の日だけ畳む
  - 畳んだ日は二度と足さない（月別加算の二重計上防止）、今日は畳まない
  - コース別成績 / 勝ち決まり手 / 1 コースの負け方 / ST（F・L 別）/ 展示 ST とのズレ / モーター
  - 24 か月より古い月を捨てる、アプリ用 view は直近 12 か月（モーター 6 か月）の合算

    python3 -m unittest scripts.tests.test_aggregate_racer_stats -v
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import aggregate_racer_stats as ag  # noqa: E402


def _race(sid, rno, order, tech=1, v=2, st=None, course=None, unknown=False, kinds=None):
    """order: 着順の艇番。racer_number = 4000 + 艇番。course は {艇番: コース}（既定 = 艇番）"""
    boats = []
    for place, bn in enumerate(order, start=1):
        b = {"racer_boat_number": bn, "racer_place_number": place,
             "racer_course_number": (course or {}).get(bn, bn),
             "racer_number": 4000 + bn, "racer_name": f"選手　{bn}",
             "racer_start_timing": (st or {}).get(bn, 0.15)}
        if kinds and bn in kinds:
            b["racer_start_kind"] = kinds[bn]
            b["racer_start_timing"] = None if kinds[bn] == "L" else -0.01
        boats.append(b)
    r = {"race_stadium_number": sid, "race_number": rno, "race_technique_number": tech, "boats": boats}
    if v:
        r["_parse_v"] = v
    if unknown:
        r["technique_unknown"] = True
    return r


def _write(d, domain, date, obj):
    os.makedirs(os.path.join(d, domain), exist_ok=True)
    with open(os.path.join(d, domain, date + ".json"), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


def _stats(d):
    with open(os.path.join(d, "db", ag.STATS_FILE), encoding="utf-8") as f:
        return json.load(f)


def _view(d):
    with open(os.path.join(d, "db", ag.VIEW_FILE), encoding="utf-8") as f:
        return json.load(f)


TODAY = datetime.date(2026, 11, 20)


class TestFold(unittest.TestCase):
    def test_course_technique_and_losses(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "results", "20261118", {"results": [
                _race(1, 1, [1, 2, 3, 4, 5, 6], tech=1),            # 1 号艇 逃げ
                _race(1, 2, [2, 1, 3, 4, 5, 6], tech=2),            # 2 号艇 差し → 1 号艇は差され
                _race(1, 3, [3, 4, 1, 2, 5, 6], tech=3),            # 3 号艇 まくり → 1 号艇は捲られ
            ]})
            ag.run(d, TODAY)
            m = _stats(d)["racers"]["4001"]["m"]["202611"]
            self.assertEqual(m["c"]["1"], [3, 1, 2, 3])
            self.assertEqual(m["kw"]["1"], {"1": 1})
            self.assertEqual(m["l1"], {"2": 1, "3": 1})
            self.assertEqual(_stats(d)["racers"]["4003"]["m"]["202611"]["kw"]["3"], {"3": 1})
            v = _view(d)["racers"]["4001"]
            self.assertEqual(v["c"]["1"], [3, 1, 2, 3])
            self.assertEqual(v["n"], "選手 1")

    def test_uses_actual_course_not_boat(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "results", "20261118", {"results": [
                _race(1, 1, [2, 1, 3, 4, 5, 6], tech=1, course={1: 2, 2: 1}),  # 前付け: 2 号艇が 1 コース
            ]})
            ag.run(d, TODAY)
            r = _stats(d)["racers"]
            self.assertIn("1", r["4002"]["m"]["202611"]["c"])
            self.assertIn("2", r["4001"]["m"]["202611"]["c"])

    def test_st_flying_late_and_exhibition_gap(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "results", "20261118", {"results": [
                _race(1, 1, [1, 2, 3, 4, 5, 6], st={1: 0.12}, kinds={5: "F", 6: "L"}),
            ]})
            _write(d, "previews", "20261118", {"races": [
                {"stadium": 1, "race": 1, "boats": {"1": {"racer_start_timing": 0.05}}},
            ]})
            ag.run(d, TODAY)
            r = _stats(d)["racers"]
            self.assertEqual(r["4001"]["m"]["202611"]["st"], [0.12, 1, 0, 0])
            self.assertEqual(r["4001"]["m"]["202611"]["sz"], [0.07, 0.07, 1])
            self.assertEqual(r["4005"]["m"]["202611"]["st"], [0, 0, 1, 0], "F は合計に入れず回数だけ")
            self.assertEqual(r["4006"]["m"]["202611"]["st"], [0, 0, 0, 1])
            self.assertEqual(_view(d)["racers"]["4001"]["sz"], [0.07, 0.07, 1])

    def test_motor_from_programs(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "results", "20261118", {"results": [_race(15, 1, [1, 2, 3, 4, 5, 6])]})
            _write(d, "programs", "20261118", {"programs": [{"race_stadium_number": 15, "race_number": 1, "boats": [
                {"racer_boat_number": 1, "racer_assigned_motor_number": 33},
                {"racer_boat_number": 2, "racer_assigned_motor_number": 12},
            ]}]})
            ag.run(d, TODAY)
            self.assertEqual(_view(d)["motors"]["15"]["33"], [1, 1, 1, 1])
            self.assertEqual(_view(d)["motors"]["15"]["12"], [1, 0, 1, 1])

    def test_unknown_technique_not_counted(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "results", "20261118", {"results": [_race(1, 1, [2, 1, 3, 4, 5, 6], unknown=True)]})
            ag.run(d, TODAY)
            m = _stats(d)["racers"]["4001"]["m"]["202611"]
            self.assertNotIn("l1", m)
            self.assertEqual(m["c"]["1"], [1, 0, 1, 1], "着順は数える")


class TestLedger(unittest.TestCase):
    def test_folds_each_day_once_and_skips_today(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "results", "20261118", {"results": [_race(1, 1, [1, 2, 3, 4, 5, 6])]})
            _write(d, "results", "20261120", {"results": [_race(1, 2, [1, 2, 3, 4, 5, 6])]})
            s1 = ag.run(d, TODAY)
            s2 = ag.run(d, TODAY)
            self.assertEqual(s1["folded"], ["20261118"])
            self.assertEqual(s2["folded"], [])
            self.assertEqual(_stats(d)["racers"]["4001"]["m"]["202611"]["c"]["1"][0], 1, "二重計上")

    def test_skips_day_with_old_parse_version(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "results", "20261118", {"results": [_race(1, r, [1, 2, 3, 4, 5, 6], v=None) for r in range(1, 11)]
                                             + [_race(1, 11, [1, 2, 3, 4, 5, 6])]})
            s = ag.run(d, TODAY)
            self.assertEqual(s["folded"], [])
            self.assertIn("20261118", s["skipped"])
            # 取り直して版 2 になれば畳む
            _write(d, "results", "20261118", {"results": [_race(1, r, [1, 2, 3, 4, 5, 6]) for r in range(1, 12)]})
            self.assertEqual(ag.run(d, TODAY)["folded"], ["20261118"])

    def test_prunes_old_months_and_view_window(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "db"))
            old = ag._empty_stats()
            old["racers"]["4001"] = {"m": {
                "202401": {"c": {"1": [5, 5, 5, 5]}},   # 24 か月より前 → 捨てる
                "202501": {"c": {"1": [4, 0, 0, 0]}},   # 残るが view の 12 か月の外
                "202611": {"c": {"1": [2, 1, 2, 2]}},
            }}
            with open(os.path.join(d, "db", ag.STATS_FILE), "w", encoding="utf-8") as f:
                json.dump(old, f)
            ag.run(d, TODAY)
            months = set(_stats(d)["racers"]["4001"]["m"])
            self.assertEqual(months, {"202501", "202611"})
            self.assertEqual(_view(d)["racers"]["4001"]["c"]["1"], [2, 1, 2, 2])


if __name__ == "__main__":
    unittest.main()
