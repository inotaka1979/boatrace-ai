"""PR-7: aggregate_form の recentResults / stadiumDB 再構築ロジックのテスト。

    python3 -m unittest scripts.tests.test_aggregate_form
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import aggregate_form as af  # noqa: E402


def _write(path: str, obj: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f)


def _prog(date, sid, rno, boats):
    return {"race_date": date, "race_stadium_number": sid, "race_number": rno,
            "boats": [{"racer_boat_number": bn, "racer_number": rn} for bn, rn in boats]}


def _result(date, sid, rno, boats):
    # boats: list of (boat, course, place)
    return {"race_date": date, "race_stadium_number": sid, "race_number": rno,
            "boats": [{"racer_boat_number": bn, "racer_course_number": c,
                       "racer_place_number": p, "racer_number": None} for bn, c, p in boats]}


class TestAggregateForm(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def _paths(self, prog_obj, res_obj, res2=None):
        pp = os.path.join(self.tmp.name, "programs.json")
        rp = os.path.join(self.tmp.name, "results.json")
        _write(pp, prog_obj)
        _write(rp, res_obj)
        paths = [rp]
        if res2 is not None:
            rp2 = os.path.join(self.tmp.name, "results2.json")
            _write(rp2, res2)
            paths.append(rp2)
        return [pp], paths

    def test_program_index_maps_boat_to_toban(self):
        progs, _ = self._paths(
            {"programs": [_prog("2026-07-26", 1, 1, [(1, 4001), (2, 4002)])]},
            {"results": []})
        idx = af.build_program_index(progs)
        self.assertEqual(idx[("2026-07-26", 1, 1, 1)], 4001)
        self.assertEqual(idx[("2026-07-26", 1, 1, 2)], 4002)

    def test_recent_results_via_join(self):
        progs, results = self._paths(
            {"programs": [_prog("2026-07-26", 1, 1, [(1, 4001), (2, 4002), (3, 4003)])]},
            {"results": [_result("2026-07-26", 1, 1, [(1, 1, 1), (2, 2, 2), (3, 3, 3)])]})
        idx = af.build_program_index(progs)
        recent, stadium, boats, mapped, nraces = af.aggregate(results, idx)
        self.assertEqual(nraces, 1)
        self.assertEqual(mapped, 3)
        self.assertEqual(recent["4001"], [1])
        self.assertEqual(recent["4002"], [2])
        self.assertEqual(stadium[1][1]["wins"], 1)
        self.assertEqual(stadium[1][1]["races"], 1)
        self.assertEqual(stadium[1][2]["wins"], 0)

    def test_chronological_order_across_days(self):
        progs, results = self._paths(
            {"programs": [
                _prog("2026-07-25", 1, 1, [(1, 4001)]),
                _prog("2026-07-26", 1, 1, [(1, 4001)])]},
            {"results": [_result("2026-07-26", 1, 1, [(1, 1, 2)])]},   # 新しい日
            {"results": [_result("2026-07-25", 1, 1, [(1, 1, 5)])]})   # 古い日
        idx = af.build_program_index(progs)
        recent, _, _, _, _ = af.aggregate(results, idx)
        # 昇順: 古い(5) → 新しい(2)、末尾が最新
        self.assertEqual(recent["4001"], [5, 2])

    def test_duplicate_race_deduped(self):
        # today.json と日次アーカイブに同じ (date,stadium,race) → 1 回だけ数える
        r = {"results": [_result("2026-07-26", 1, 1, [(1, 1, 1)])]}
        progs, results = self._paths(
            {"programs": [_prog("2026-07-26", 1, 1, [(1, 4001)])]}, r, r)
        idx = af.build_program_index(progs)
        recent, stadium, _, _, nraces = af.aggregate(results, idx)
        self.assertEqual(nraces, 1)
        self.assertEqual(recent["4001"], [1])
        self.assertEqual(stadium[1][1]["races"], 1)

    def test_empty_boats_skipped(self):
        progs, results = self._paths(
            {"programs": []},
            {"results": [{"race_date": "2026-07-26", "race_stadium_number": 1,
                          "race_number": 1, "boats": []}]})
        idx = af.build_program_index(progs)
        recent, stadium, boats, mapped, nraces = af.aggregate(results, idx)
        self.assertEqual(nraces, 0)
        self.assertEqual(len(recent), 0)

    def test_unmapped_boat_still_counts_stadium(self):
        # program に無い boat は recentResults に入らないが場別統計には数える
        progs, results = self._paths(
            {"programs": []},   # マッピング無し
            {"results": [_result("2026-07-26", 5, 3, [(1, 1, 1), (2, 2, 2)])]})
        idx = af.build_program_index(progs)
        recent, stadium, boats, mapped, nraces = af.aggregate(results, idx)
        self.assertEqual(mapped, 0)
        self.assertEqual(len(recent), 0)
        self.assertEqual(stadium[5][1]["wins"], 1)
        self.assertEqual(stadium[5][1]["races"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
