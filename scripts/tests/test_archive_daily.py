"""FU-1: archive_daily の日付決定 / prune / アーカイブのテスト。

    python3 -m unittest scripts.tests.test_archive_daily
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import archive_daily as ad  # noqa: E402


class TestArchiveDate(unittest.TestCase):
    def test_prefers_race_date(self):
        now = datetime.datetime(2026, 7, 26, 12, 0)
        self.assertEqual(ad.archive_date({"race_date": "2026-07-20"}, now), "20260720")

    def test_falls_back_to_now(self):
        now = datetime.datetime(2026, 7, 26, 12, 0)
        self.assertEqual(ad.archive_date({}, now), "20260726")
        self.assertEqual(ad.archive_date({"race_date": None}, now), "20260726")


class TestPrune(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.now = datetime.datetime(2026, 7, 26, 12, 0)

    def _touch(self, name):
        with open(os.path.join(self.tmp.name, name), "w", encoding="utf-8") as f:
            f.write("{}")

    def test_prunes_old_keeps_recent_and_today(self):
        self._touch("20260101.json")   # 古い → 削除
        self._touch("20260720.json")   # 6 日前 → 保持
        self._touch("today.json")      # 対象外 → 保持
        self._touch("notes.txt")       # 対象外
        removed = ad.prune(self.tmp.name, keep_days=45, now=self.now)
        self.assertEqual(removed, 1)
        left = sorted(os.listdir(self.tmp.name))
        self.assertIn("20260720.json", left)
        self.assertIn("today.json", left)
        self.assertNotIn("20260101.json", left)

    def test_boundary_keep_days(self):
        # ちょうど keep_days 日前は保持、それより古いと削除
        keep = 10
        edge = (self.now.date() - datetime.timedelta(days=keep)).strftime("%Y%m%d")
        older = (self.now.date() - datetime.timedelta(days=keep + 1)).strftime("%Y%m%d")
        self._touch(f"{edge}.json")
        self._touch(f"{older}.json")
        removed = ad.prune(self.tmp.name, keep_days=keep, now=self.now)
        self.assertEqual(removed, 1)
        self.assertIn(f"{edge}.json", os.listdir(self.tmp.name))

    def test_ignores_malformed_names(self):
        self._touch("2026013.json")     # 7 桁 → 対象外
        self._touch("abcdefgh.json")    # 非数字 → 対象外
        removed = ad.prune(self.tmp.name, keep_days=1, now=self.now)
        self.assertEqual(removed, 0)

    def test_missing_dir_is_zero(self):
        self.assertEqual(ad.prune(os.path.join(self.tmp.name, "nope"), 45, self.now), 0)


class TestArchiveDomain(unittest.TestCase):
    def test_archive_domain_writes_dated_copy(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(tmp.name)
        os.makedirs("data/programs")
        with open("data/programs/today.json", "w", encoding="utf-8") as f:
            json.dump({"race_date": "2026-07-26", "programs": [{"x": 1}]}, f)
        now = datetime.datetime(2026, 7, 26, 12, 0)
        date = ad.archive_domain("programs", now)
        self.assertEqual(date, "20260726")
        self.assertTrue(os.path.exists("data/programs/20260726.json"))
        with open("data/programs/20260726.json", encoding="utf-8") as f:
            self.assertEqual(json.load(f)["programs"], [{"x": 1}])

    def test_archive_domain_missing_today_returns_none(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(tmp.name)
        self.assertIsNone(ad.archive_domain("odds", datetime.datetime(2026, 7, 26)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
