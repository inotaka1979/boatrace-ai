"""scrape_all._decide_tasks / _is_fresh_today のユニットテスト

2026-05-17: GHA cron 遅延で racedata が 10 日間停止した事故への根本対策。
時刻窓を広げ、内側で「今日のデータか」を冪等チェックするロジックを検証する。
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import tempfile
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import scrape_all  # noqa: E402

JST = datetime.timezone(datetime.timedelta(hours=9))


def _names(tasks):
    return [name for name, _ in tasks]


class TestIsFreshToday(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        )
        self.path = self.tmp.name
        self.tmp.close()
        self.now = datetime.datetime(2026, 5, 17, 14, 0, tzinfo=JST)

    def tearDown(self):
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass

    def _write(self, data: dict):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def test_missing_file_returns_false(self):
        os.unlink(self.path)
        self.assertFalse(scrape_all._is_fresh_today(self.path, self.now))

    def test_no_updated_at_returns_false(self):
        self._write({"racedata": []})
        self.assertFalse(scrape_all._is_fresh_today(self.path, self.now))

    def test_today_updated_at_returns_true(self):
        self._write({"updated_at": "2026-05-17T01:00:00Z"})
        self.assertTrue(scrape_all._is_fresh_today(self.path, self.now))

    def test_yesterday_updated_at_returns_false(self):
        # 2026-05-16T14:00:00Z = 2026-05-16 23:00 JST → yesterday
        self._write({"updated_at": "2026-05-16T14:00:00Z"})
        self.assertFalse(scrape_all._is_fresh_today(self.path, self.now))

    def test_ten_days_old_returns_false(self):
        self._write({"updated_at": "2026-05-07T00:43:38Z"})
        self.assertFalse(scrape_all._is_fresh_today(self.path, self.now))

    def test_generated_at_fallback(self):
        self._write({"generated_at": "2026-05-17T01:00:00Z"})
        self.assertTrue(scrape_all._is_fresh_today(self.path, self.now))

    def test_malformed_timestamp_returns_false(self):
        self._write({"updated_at": "not-an-iso-string"})
        self.assertFalse(scrape_all._is_fresh_today(self.path, self.now))

    def test_jst_boundary_handled(self):
        # 23:30 UTC = 08:30 JST next day
        self._write({"updated_at": "2026-05-16T23:30:00Z"})
        now_morning = datetime.datetime(2026, 5, 17, 9, 0, tzinfo=JST)
        self.assertTrue(scrape_all._is_fresh_today(self.path, now_morning))

    def test_partial_true_returns_false(self):
        # 今日付の partial=True は途中保存なので fresh と扱わない
        self._write({"updated_at": "2026-05-17T05:00:00Z", "partial": True})
        self.assertFalse(scrape_all._is_fresh_today(self.path, self.now))

    def test_partial_false_returns_true(self):
        self._write({"updated_at": "2026-05-17T05:00:00Z", "partial": False})
        self.assertTrue(scrape_all._is_fresh_today(self.path, self.now))


class TestDecideTasksTimingMatrix(unittest.TestCase):
    """時刻 × データ鮮度の matrix で task list の正当性を検証。"""

    def setUp(self):
        # racedata / schedule / tide を「stale」前提に固定 (
        # _is_fresh_today を monkey-patch して時刻だけ評価)
        self._orig = scrape_all._is_fresh_today
        scrape_all._is_fresh_today = lambda path, now: False

    def tearDown(self):
        scrape_all._is_fresh_today = self._orig

    def _at(self, h, m):
        now = datetime.datetime(2026, 5, 17, h, m, tzinfo=JST)
        return _names(scrape_all._decide_tasks(now, force_all=False))

    def test_pre_race_hours_no_tasks(self):
        self.assertEqual(self._at(7, 0), [])

    def test_tide_window_07_30(self):
        tasks = self._at(7, 30)
        self.assertIn("tide", tasks)
        self.assertIn("schedule(quick)", tasks)

    def test_old_racedata_window_09_30_picks_up(self):
        tasks = self._at(9, 30)
        self.assertIn("racedata", tasks)
        self.assertIn("prerender", tasks)

    def test_delayed_cron_09_58_picks_up(self):
        # OLD bug: h==9 and 28<=m<=35 missed this minute
        tasks = self._at(9, 58)
        self.assertIn("racedata", tasks)
        self.assertIn("prerender", tasks)

    def test_delayed_cron_12_45_picks_up(self):
        # OLD bug: h==12 and m<5 missed this minute
        tasks = self._at(12, 45)
        self.assertIn("racedata", tasks)

    def test_afternoon_14_40_still_picks_up(self):
        # Before: window ended at 12:05; after: window runs through 22
        tasks = self._at(14, 40)
        self.assertIn("racedata", tasks)

    def test_evening_22_30_in_window(self):
        tasks = self._at(22, 30)
        self.assertIn("racedata", tasks)
        self.assertIn("results", tasks)

    def test_late_night_23_00_outside_window(self):
        tasks = self._at(23, 0)
        self.assertEqual(tasks, [])

    def test_results_window_30_minute_boundary(self):
        # h=10, m in [25,35] → results
        self.assertIn("results", self._at(10, 31))
        # h=10, m=15 → no results
        self.assertNotIn("results", self._at(10, 15))


class TestDecideTasksIdempotency(unittest.TestCase):
    """fresh データ時は scraper を skip し、stale 時のみ fetch することを検証。"""

    def setUp(self):
        self._orig = scrape_all._is_fresh_today

    def tearDown(self):
        scrape_all._is_fresh_today = self._orig

    def test_skip_when_data_all_fresh(self):
        scrape_all._is_fresh_today = lambda path, now: True
        now = datetime.datetime(2026, 5, 17, 14, 0, tzinfo=JST)
        tasks = _names(scrape_all._decide_tasks(now, force_all=False))
        self.assertNotIn("racedata", tasks)
        self.assertNotIn("prerender", tasks)
        self.assertNotIn("tide", tasks)
        # odds / previews は freshness 関係なく毎 tick 取る (race hours)
        self.assertIn("odds", tasks)
        self.assertIn("previews", tasks)

    def test_force_all_returns_everything(self):
        now = datetime.datetime(2026, 5, 17, 14, 0, tzinfo=JST)
        tasks = _names(scrape_all._decide_tasks(now, force_all=True))
        for expected in (
            "racedata",
            "schedule(quick)",
            "tide",
            "odds",
            "previews",
            "results",
            "prerender",
        ):
            self.assertIn(expected, tasks)


if __name__ == "__main__":
    unittest.main(verbosity=2)
