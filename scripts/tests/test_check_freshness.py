"""Unit tests for scripts/check_freshness.py (Phase 0 of REDESIGN.md)

確実に動くことを検証するため、固定タイムスタンプ + 一時ファイルで
全 exit code パスを通す。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import check_freshness as cf  # noqa: E402


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class CheckCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "today.json")
        self.now = datetime(2026, 5, 11, 12, 0, 0, tzinfo=timezone.utc)

    def _write(self, payload: dict) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def test_fresh_returns_ok(self) -> None:
        self._write({"updated_at": _iso(self.now - timedelta(minutes=3))})
        code, msg = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_OK, msg)
        self.assertIn("OK", msg)

    def test_stale_returns_stale(self) -> None:
        self._write({"updated_at": _iso(self.now - timedelta(minutes=15))})
        code, msg = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_STALE, msg)
        self.assertIn("STALE", msg)

    def test_boundary_just_under_threshold(self) -> None:
        self._write({"updated_at": _iso(self.now - timedelta(minutes=10))})
        code, _ = cf.check(self.path, max_age_min=10, now=self.now)
        # 10 分ちょうどは「閾値以下」として OK 扱い
        self.assertEqual(code, cf.EXIT_OK)

    def test_boundary_just_over_threshold(self) -> None:
        self._write(
            {"updated_at": _iso(self.now - timedelta(minutes=10, seconds=1))}
        )
        code, _ = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_STALE)

    def test_missing_file(self) -> None:
        code, msg = cf.check(
            os.path.join(self.tmp.name, "absent.json"),
            max_age_min=10,
            now=self.now,
        )
        self.assertEqual(code, cf.EXIT_MISSING)
        self.assertIn("MISSING", msg)

    def test_malformed_json(self) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{not json")
        code, msg = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_MALFORMED)
        self.assertIn("MALFORMED", msg)

    def test_missing_field(self) -> None:
        self._write({"foo": "bar"})
        code, msg = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_MALFORMED)
        self.assertIn("field", msg)

    def test_non_string_field(self) -> None:
        self._write({"updated_at": 123})
        code, msg = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_MALFORMED)

    def test_unparseable_timestamp(self) -> None:
        self._write({"updated_at": "yesterday"})
        code, msg = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_MALFORMED)
        self.assertIn("parse", msg)

    def test_root_not_dict(self) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(["not", "a", "dict"], f)
        code, msg = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_MALFORMED)

    def test_dotted_field_path(self) -> None:
        self._write(
            {
                "meta": {
                    "header": {"generated_at": _iso(self.now - timedelta(minutes=2))}
                }
            }
        )
        code, _ = cf.check(
            self.path,
            max_age_min=10,
            field="meta.header.generated_at",
            now=self.now,
        )
        self.assertEqual(code, cf.EXIT_OK)

    def test_dotted_field_path_missing(self) -> None:
        self._write({"meta": {}})
        code, _ = cf.check(
            self.path,
            max_age_min=10,
            field="meta.header.generated_at",
            now=self.now,
        )
        self.assertEqual(code, cf.EXIT_MALFORMED)

    def test_future_timestamp_treated_ok(self) -> None:
        # clock skew で未来時刻が来た場合は stale ではなく OK 扱い
        self._write({"updated_at": _iso(self.now + timedelta(minutes=2))})
        code, msg = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_OK)
        self.assertIn("future", msg)

    def test_naive_timestamp_treated_as_utc(self) -> None:
        # ISO8601 で tz 情報無しの文字列も UTC として解釈する
        naive = "2026-05-11T11:55:00"
        self._write({"updated_at": naive})
        code, _ = cf.check(self.path, max_age_min=10, now=self.now)
        self.assertEqual(code, cf.EXIT_OK)


class MainCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "today.json")

    def _write(self, payload: dict) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def test_main_returns_0_on_fresh(self) -> None:
        self._write({"updated_at": _iso(datetime.now(timezone.utc))})
        rc = cf.main([self.path, "--max-age-min", "10"])
        self.assertEqual(rc, 0)

    def test_main_warning_mode_returns_0_on_stale(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(hours=2)
        self._write({"updated_at": _iso(old)})
        rc = cf.main([self.path, "--max-age-min", "10"])
        # warning mode (default): exit 0
        self.assertEqual(rc, 0)

    def test_main_strict_mode_returns_2_on_stale(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(hours=2)
        self._write({"updated_at": _iso(old)})
        rc = cf.main([self.path, "--max-age-min", "10", "--strict"])
        self.assertEqual(rc, cf.EXIT_STALE)

    def test_main_missing_file_returns_3_even_warning(self) -> None:
        rc = cf.main([os.path.join(self.tmp.name, "absent.json"), "--max-age-min", "10"])
        # missing は warning でも fail
        self.assertEqual(rc, cf.EXIT_MISSING)

    def test_main_malformed_returns_4(self) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{bad")
        rc = cf.main([self.path, "--max-age-min", "10"])
        self.assertEqual(rc, cf.EXIT_MALFORMED)


class CheckContentTests(unittest.TestCase):
    """S-05: 中身の充足度検証。updated_at が新しくても空なら不足を主張する。"""

    def test_min_keys_empty_is_insufficient(self) -> None:
        code, msg = cf.check_content({"stadiums": {}}, min_keys={"stadiums": 20})
        self.assertEqual(code, cf.EXIT_INSUFFICIENT, msg)
        self.assertIn("INSUFFICIENT", msg)

    def test_min_keys_enough_is_ok(self) -> None:
        stadiums = {str(i): {"courseWinRate": {}} for i in range(1, 25)}
        code, _ = cf.check_content({"stadiums": stadiums}, min_keys={"stadiums": 20})
        self.assertEqual(code, cf.EXIT_OK)

    def test_min_keys_absent_path_is_malformed(self) -> None:
        # silent OK にしない: 検証対象パスが無いのは設定 or データの異常
        code, msg = cf.check_content({"foo": {}}, min_keys={"nosuch": 1})
        self.assertEqual(code, cf.EXIT_MALFORMED, msg)

    def test_min_ratio_all_empty_is_insufficient(self) -> None:
        racers = {str(t): {"recentResults": []} for t in range(4000, 4020)}
        code, msg = cf.check_content(
            {"racers": racers}, min_ratio={"racers.recentResults": 0.5}
        )
        self.assertEqual(code, cf.EXIT_INSUFFICIENT, msg)

    def test_min_ratio_sixty_percent_meets_threshold(self) -> None:
        racers = {}
        for t in range(4000, 4010):
            filled = (t - 4000) < 6   # 6/10 = 0.6 非空
            racers[str(t)] = {"recentResults": [1, 2, 3] if filled else []}
        code, _ = cf.check_content(
            {"racers": racers}, min_ratio={"racers.recentResults": 0.5}
        )
        self.assertEqual(code, cf.EXIT_OK)

    def test_min_ratio_absent_container_is_malformed(self) -> None:
        code, msg = cf.check_content({}, min_ratio={"racers.recentResults": 0.5})
        self.assertEqual(code, cf.EXIT_MALFORMED, msg)

    def test_min_ratio_empty_container_is_insufficient(self) -> None:
        code, _ = cf.check_content({"racers": {}}, min_ratio={"racers.recentResults": 0.5})
        self.assertEqual(code, cf.EXIT_INSUFFICIENT)


class ContentCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "db.json")

    def _write(self, payload: dict) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def test_fresh_but_empty_strict_returns_5(self) -> None:
        self._write({"updated_at": _iso(datetime.now(timezone.utc)), "stadiums": {}})
        rc = cf.main([self.path, "--max-age-min", "2880", "--min-keys", "stadiums=20", "--strict"])
        self.assertEqual(rc, cf.EXIT_INSUFFICIENT)

    def test_fresh_but_empty_warning_returns_0(self) -> None:
        self._write({"updated_at": _iso(datetime.now(timezone.utc)), "stadiums": {}})
        rc = cf.main([self.path, "--max-age-min", "2880", "--min-keys", "stadiums=20"])
        self.assertEqual(rc, 0)

    def test_stale_reported_before_content(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(days=5)
        self._write({"updated_at": _iso(old), "stadiums": {}})
        rc = cf.main(
            [self.path, "--max-age-min", "2880", "--min-keys", "stadiums=20", "--strict"]
        )
        # stale を先に報告 (5 ではなく 2)
        self.assertEqual(rc, cf.EXIT_STALE)

    def test_absent_path_returns_malformed(self) -> None:
        self._write({"updated_at": _iso(datetime.now(timezone.utc))})
        rc = cf.main([self.path, "--max-age-min", "2880", "--min-keys", "nosuch=1", "--strict"])
        self.assertEqual(rc, cf.EXIT_MALFORMED)

    def test_bad_spec_returns_malformed(self) -> None:
        self._write({"updated_at": _iso(datetime.now(timezone.utc)), "stadiums": {}})
        rc = cf.main([self.path, "--max-age-min", "2880", "--min-keys", "stadiums20"])
        self.assertEqual(rc, cf.EXIT_MALFORMED)

    def test_fresh_and_full_returns_0(self) -> None:
        stadiums = {str(i): {} for i in range(1, 25)}
        self._write({"updated_at": _iso(datetime.now(timezone.utc)), "stadiums": stadiums})
        rc = cf.main([self.path, "--max-age-min", "2880", "--min-keys", "stadiums=20", "--strict"])
        self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
