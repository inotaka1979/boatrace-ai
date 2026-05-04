"""P2: _io.atomic_write_json と _time のユニットテスト

実行:
    python3 scripts/tests/test_io_time.py
    pytest scripts/tests/test_io_time.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from io_utils import atomic_write_json, safe_load_json
from time_utils import (
    JST,
    first_of_next_month,
    jst_now,
    jst_today_str,
    utc_iso_seconds,
    utc_now,
)


class TestAtomicWriteJson(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_basic_write(self):
        path = os.path.join(self.tmp, "out.json")
        atomic_write_json(path, {"a": 1, "b": [1, 2, 3]})
        with open(path) as f:
            data = json.load(f)
        self.assertEqual(data, {"a": 1, "b": [1, 2, 3]})

    def test_overwrite_atomic(self):
        path = os.path.join(self.tmp, "out.json")
        atomic_write_json(path, {"v": 1})
        atomic_write_json(path, {"v": 2})
        with open(path) as f:
            self.assertEqual(json.load(f), {"v": 2})

    def test_no_leftover_tempfile(self):
        path = os.path.join(self.tmp, "out.json")
        atomic_write_json(path, {"v": 1})
        leftovers = [f for f in os.listdir(self.tmp) if f.startswith(".tmp_")]
        self.assertEqual(leftovers, [], f"leftover tempfiles: {leftovers}")

    def test_ensures_parent_dir(self):
        path = os.path.join(self.tmp, "nested", "deep", "out.json")
        atomic_write_json(path, {"v": 1})
        self.assertTrue(os.path.exists(path))

    def test_failure_does_not_clobber_existing(self):
        path = os.path.join(self.tmp, "out.json")
        atomic_write_json(path, {"v": "good"})

        class Unserializable:
            pass

        with self.assertRaises(TypeError):
            atomic_write_json(path, {"bad": Unserializable()})

        with open(path) as f:
            self.assertEqual(json.load(f), {"v": "good"})

        leftovers = [f for f in os.listdir(self.tmp) if f.startswith(".tmp_")]
        self.assertEqual(leftovers, [], f"leftover tempfiles after failure: {leftovers}")

    def test_safe_load_json_missing(self):
        self.assertIsNone(safe_load_json(os.path.join(self.tmp, "nope.json")))
        self.assertEqual(safe_load_json(os.path.join(self.tmp, "nope.json"), default={}), {})

    def test_safe_load_json_corrupt_raises(self):
        path = os.path.join(self.tmp, "bad.json")
        with open(path, "w") as f:
            f.write("{ not valid json")
        with self.assertRaises(json.JSONDecodeError):
            safe_load_json(path)


class TestTime(unittest.TestCase):
    def test_utc_iso_seconds_format(self):
        s = utc_iso_seconds()
        # "YYYY-MM-DDTHH:MM:SSZ" 形式（マイクロ秒なし）
        self.assertRegex(s, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_utc_now_aware(self):
        t = utc_now()
        self.assertIsNotNone(t.tzinfo)

    def test_jst_now_aware(self):
        t = jst_now()
        self.assertEqual(t.utcoffset().total_seconds(), 9 * 3600)

    def test_jst_today_str_format(self):
        s = jst_today_str()
        self.assertRegex(s, r"^\d{8}$")

    # D-06 翌月計算の境界テスト
    def test_first_of_next_month_normal(self):
        d = datetime(2026, 5, 4, 12, 30, tzinfo=JST)
        self.assertEqual(first_of_next_month(d), datetime(2026, 6, 1, 0, 0, 0, tzinfo=JST))

    def test_first_of_next_month_jan_end(self):
        d = datetime(2026, 1, 31, 23, 59, tzinfo=JST)
        self.assertEqual(first_of_next_month(d), datetime(2026, 2, 1, 0, 0, 0, tzinfo=JST))

    def test_first_of_next_month_feb_29_leap(self):
        d = datetime(2024, 2, 29, 12, 0, tzinfo=JST)
        self.assertEqual(first_of_next_month(d), datetime(2024, 3, 1, 0, 0, 0, tzinfo=JST))

    def test_first_of_next_month_dec_to_jan(self):
        d = datetime(2026, 12, 31, 23, 59, tzinfo=JST)
        self.assertEqual(first_of_next_month(d), datetime(2027, 1, 1, 0, 0, 0, tzinfo=JST))

    def test_first_of_next_month_feb_1(self):
        # 旧実装 `replace(day=1)+timedelta(days=32)` のバグ:
        # 2/1 → 2/1 + 32d = 3/5（翌月初ではない）
        d = datetime(2026, 2, 1, 0, 0, tzinfo=JST)
        self.assertEqual(first_of_next_month(d), datetime(2026, 3, 1, 0, 0, 0, tzinfo=JST))


if __name__ == "__main__":
    unittest.main(verbosity=2)
