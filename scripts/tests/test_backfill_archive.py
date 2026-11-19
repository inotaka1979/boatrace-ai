"""確定済みレースの展示・オッズのアーカイブ後追い (2026-11-20) の回帰テスト

  - plan: 確定レースのうち、三連単オッズ / 展示 (4 艇以上の展示タイム) が無いものだけを対象にする
  - merge: 既にあるデータは上書きしない、後追い分には _backfilled を付ける
  - run: 今日の日付は触らない（archive_daily が today.json から毎 run 上書きするため）
  - run: 取得元のブロック (403 連続) で止まり、data/_status.json の tasks.backfill に記録する

    python3 -m unittest scripts.tests.test_backfill_archive -v
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import backfill_archive as bf  # noqa: E402


def _results(races):
    return {"results": [
        {"race_stadium_number": s, "race_number": r,
         "boats": [{"racer_boat_number": b, "racer_place_number": b} for b in range(1, 7)] if fin else []}
        for s, r, fin in races
    ]}


def _write(d, domain, date, obj):
    os.makedirs(os.path.join(d, domain), exist_ok=True)
    with open(os.path.join(d, domain, date + ".json"), "w", encoding="utf-8") as f:
        json.dump(obj, f)


def _read(d, domain, date):
    with open(os.path.join(d, domain, date + ".json"), encoding="utf-8") as f:
        return json.load(f)


EXH = {str(b): {"racer_exhibition_time": 6.7} for b in range(1, 7)}


class TestPlan(unittest.TestCase):
    def test_only_finished_and_missing(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "results", "20261118", _results([(1, 1, True), (1, 2, True), (1, 3, False)]))
            _write(d, "odds", "20261118", {"odds": [{"stadium": 1, "race": 1, "trifecta": {"1-2-3": 5.0}}]})
            _write(d, "previews", "20261118", {"races": [{"stadium": 1, "race": 2, "boats": EXH}]})
            p = bf.plan("20261118", d)
        self.assertEqual(p["odds"], [(1, 2)])
        self.assertEqual(p["previews"], [(1, 1)])

    def test_partial_exhibition_counts_as_missing(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "results", "20261118", _results([(1, 1, True)]))
            _write(d, "previews", "20261118", {"races": [{"stadium": 1, "race": 1, "boats": {"1": {"racer_exhibition_time": 6.7}}}]})
            self.assertEqual(bf.plan("20261118", d)["previews"], [(1, 1)])


class TestMerge(unittest.TestCase):
    def test_does_not_overwrite_existing(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "odds", "20261118", {"odds": [{"stadium": 1, "race": 1, "trifecta": {"1-2-3": 5.0}}]})
            n = bf.merge_odds("20261118", {(1, 1): {"trifecta": {"1-2-3": 9.9}}, (1, 2): {"trifecta": {"1-2-3": 7.0}, "win": {"1": 1.5}}}, d)
            got = {(o["stadium"], o["race"]): o for o in _read(d, "odds", "20261118")["odds"]}
        self.assertEqual(n, 1)
        self.assertEqual(got[(1, 1)]["trifecta"]["1-2-3"], 5.0)
        self.assertTrue(got[(1, 2)]["_backfilled"])
        self.assertEqual(got[(1, 2)]["win"], {"1": 1.5})

    def test_previews_merge_keeps_other_fields(self):
        with tempfile.TemporaryDirectory() as d:
            _write(d, "previews", "20261118", {"race_date": "2026-11-18", "races": [{"stadium": 1, "race": 1, "boats": {}, "finished": True}]})
            n = bf.merge_previews("20261118", {(1, 1): {"boats": EXH}}, d)
            r = _read(d, "previews", "20261118")
        self.assertEqual(n, 1)
        self.assertEqual(r["race_date"], "2026-11-18")
        self.assertTrue(r["races"][0]["finished"])
        self.assertEqual(r["races"][0]["boats"]["3"]["racer_exhibition_time"], 6.7)


class TestRun(unittest.TestCase):
    def _setup(self, d, date):
        _write(d, "results", date, _results([(1, 1, True), (1, 2, True), (1, 3, True)]))

    def test_skips_today_and_fills_past(self):
        today = datetime.date(2026, 11, 19)
        seen = []

        def fake_fetch(url, timeout=15):
            seen.append(url)
            return 200, "<html/>"

        with tempfile.TemporaryDirectory() as d:
            self._setup(d, "20261119")  # 今日: 触らない
            self._setup(d, "20261118")
            with mock.patch.object(bf, "fetch_once", side_effect=fake_fetch), \
                 mock.patch.object(bf, "INTERVAL", 0), \
                 mock.patch.object(bf.odds_mod, "parse_trifecta", return_value={"1-2-3": 5.0}), \
                 mock.patch.object(bf.odds_mod, "parse_win", return_value={"1": 1.5}), \
                 mock.patch.object(bf.prev_mod, "parse_beforeinfo", return_value={1: {"exhibition_time": 6.7, "start_timing": 0.1, "tilt": 0, "course": 1}}):
                s = bf.run(days=2, max_races=10, budget_sec=30, data_dir=d, today=today)
            self.assertFalse(os.path.exists(os.path.join(d, "odds", "20261119.json")), "今日のファイルを書いた")
            self.assertEqual(len(_read(d, "odds", "20261118")["odds"]), 3)
            self.assertEqual(len(_read(d, "previews", "20261118")["races"]), 3)
            st = json.load(open(os.path.join(d, "_status.json"), encoding="utf-8"))
        self.assertTrue(all("hd=20261118" in u for u in seen))
        self.assertEqual(s["updated"], 3)
        self.assertIn("backfill", st["tasks"])

    def test_stops_on_block(self):
        calls = []

        def fake_fetch(url, timeout=15):
            calls.append(url)
            return 403, None

        with tempfile.TemporaryDirectory() as d:
            for i in range(1, 4):
                _write(d, "results", "2026111" + str(i), _results([(1, r, True) for r in range(1, 13)]))
            with mock.patch.object(bf, "fetch_once", side_effect=fake_fetch), mock.patch.object(bf, "INTERVAL", 0):
                s = bf.run(days=3, max_races=40, budget_sec=30, data_dir=d, today=datetime.date(2026, 11, 14))
            st = json.load(open(os.path.join(d, "_status.json"), encoding="utf-8"))
        self.assertTrue(s["blocked"])
        self.assertEqual(len(calls), bf.SourceBlockDetector().threshold, "ブロック検知後もリクエストした")
        self.assertTrue(st["source_blocked"])


if __name__ == "__main__":
    unittest.main()
