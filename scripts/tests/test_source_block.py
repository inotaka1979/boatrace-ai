"""取得元ブロックの検知と通知（2026-11-20）の回帰テスト

11/18 から boatrace.jp が aiohttp のリクエストを HTTP 403 で拒否し、オッズ・展示が全件
取れなくなった。失敗した run も updated_at を更新するため鮮度監視は緑のままで、展示側は
1 run で 270 回 403 を叩いていた。次を固定する:

  - SourceBlockDetector: 成功 0 件で 403 が続いたらブロック判定、1 件でも 200 なら判定しない
  - odds / previews / results: ブロック判定後はリクエストしない、403 は再試行しない
  - odds / previews: aiohttp ではなく共通の urllib クライアント (fetch_once) を使う
  - source_health.evaluate: _status.json から「中身ゼロ」を検出する

    python3 -m unittest scripts.tests.test_source_block -v
"""

from __future__ import annotations

import asyncio
import datetime
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import http_utils  # noqa: E402
import scrape_odds_fast as odds  # noqa: E402
import scrape_previews as prev  # noqa: E402
import scrape_results as res  # noqa: E402
import source_health  # noqa: E402

UTC = datetime.timezone.utc


class _NoWait:
    async def acquire(self):
        return None


class TestDetector(unittest.TestCase):
    def test_blocks_after_threshold_403_without_success(self):
        d = http_utils.SourceBlockDetector(threshold=3)
        for _ in range(2):
            d.record(403)
        self.assertFalse(d.blocked)
        d.record(403)
        self.assertTrue(d.blocked)
        self.assertEqual(d.stats(), {"ok": 0, "http_403": 3, "blocked": True})

    def test_single_success_prevents_block(self):
        d = http_utils.SourceBlockDetector(threshold=3)
        d.record(200)
        for _ in range(10):
            d.record(403)
        self.assertFalse(d.blocked, "個別ページの 403 で全体を止めない")

    def test_404_and_exceptions_do_not_count(self):
        d = http_utils.SourceBlockDetector(threshold=2)
        for s in (404, 500, "exc:TimeoutError", None):
            d.record(s)
        self.assertFalse(d.blocked)
        self.assertEqual(d.forbidden, 0)


class TestFetchOnce(unittest.TestCase):
    def test_http_error_returns_status(self):
        err = http_utils.HTTPError("u", 403, "Forbidden", {}, None)
        with mock.patch.object(http_utils, "urlopen", side_effect=err):
            self.assertEqual(http_utils.fetch_once("https://x"), (403, None))

    def test_network_error_returns_exc_string(self):
        with mock.patch.object(http_utils, "urlopen", side_effect=TimeoutError()):
            self.assertEqual(http_utils.fetch_once("https://x"), ("exc:TimeoutError", None))

    def test_sends_honest_user_agent(self):
        seen = {}

        class _Resp:
            status = 200

            def read(self):
                return "ok".encode()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake(req, timeout):
            seen["ua"] = req.get_header("User-agent")
            return _Resp()

        with mock.patch.object(http_utils, "urlopen", side_effect=fake):
            self.assertEqual(http_utils.fetch_once("https://x"), (200, "ok"))
        self.assertEqual(seen["ua"], http_utils.USER_AGENT)

    def test_fetch_bytes_raises_status_error_with_code(self):
        err = http_utils.HTTPError("u", 403, "Forbidden", {}, None)
        with mock.patch.object(http_utils, "urlopen", side_effect=err):
            with self.assertRaises(http_utils.HTTPStatusError) as cm:
                http_utils.fetch_bytes("https://x", retries=0)
        self.assertEqual(cm.exception.status, 403)
        self.assertIsInstance(cm.exception, RuntimeError, "既存の except RuntimeError と互換")


class TestOddsFetch(unittest.TestCase):
    def _run(self, statuses, block):
        calls = []

        def fake(url, timeout=15, **kw):
            calls.append(url)
            return statuses[min(len(calls) - 1, len(statuses) - 1)]

        with mock.patch.object(odds, "fetch_once", side_effect=fake):
            out = asyncio.run(odds.fetch(None, _NoWait(), "https://x", retries=4, block=block))
        return out, calls

    def test_403_is_not_retried(self):
        out, calls = self._run([(403, None)], http_utils.SourceBlockDetector())
        self.assertIsNone(out)
        self.assertEqual(len(calls), 1)

    def test_no_request_after_block(self):
        b = http_utils.SourceBlockDetector(threshold=1)
        b.record(403)
        out, calls = self._run([(200, "x")], b)
        self.assertIsNone(out)
        self.assertEqual(calls, [])

    def test_repeated_403_trips_detector(self):
        b = http_utils.SourceBlockDetector(threshold=3)
        for _ in range(3):
            self._run([(403, None)], b)
        self.assertTrue(b.blocked)
        _, calls = self._run([(200, "x")], b)
        self.assertEqual(calls, [])

    def test_success_returns_text(self):
        out, _ = self._run([(200, "<html>")], http_utils.SourceBlockDetector())
        self.assertEqual(out, "<html>")

    def test_does_not_use_aiohttp_for_boatrace(self):
        # session に None を渡しても動く = aiohttp の session を使っていない
        out, _ = self._run([(200, "ok")], http_utils.SourceBlockDetector())
        self.assertEqual(out, "ok")


class TestPreviewsFetch(unittest.TestCase):
    def setUp(self):
        self._orig = prev.BLOCK
        prev.BLOCK = http_utils.SourceBlockDetector(threshold=2)

    def tearDown(self):
        prev.BLOCK = self._orig

    def test_403_not_retried_and_blocks(self):
        calls = []

        def fake(url, timeout=15, **kw):
            calls.append(url)
            return 403, None

        with mock.patch.object(prev, "fetch_once", side_effect=fake):
            for _ in range(5):
                asyncio.run(prev.fetch_with_retry(None, "https://x", _NoWait(), retries=2))
        # 旧実装: 1 URL につき 3 回 × 5 = 15 回。今は 1 回ずつ、ブロック判定 (2 回) 以降は 0 回。
        self.assertEqual(len(calls), 2)
        self.assertTrue(prev.BLOCK.blocked)

    def test_uses_honest_user_agent(self):
        self.assertEqual(prev.HEADERS["User-Agent"], http_utils.USER_AGENT)


class TestResultsFetch(unittest.TestCase):
    def setUp(self):
        self._orig = res.BLOCK
        res.BLOCK = http_utils.SourceBlockDetector(threshold=2)

    def tearDown(self):
        res.BLOCK = self._orig

    def test_stops_after_block(self):
        calls = []

        def fake(url):
            calls.append(url)
            raise http_utils.HTTPStatusError("fetch_bytes 403: x", 403)

        with mock.patch.object(res, "fetch", side_effect=fake):
            out = [res._fetch_one_race((1, r, "20261119")) for r in range(1, 6)]
        self.assertEqual(len(calls), 2)
        self.assertEqual(out[-1][3], "source blocked")


class TestWriteStatus(unittest.TestCase):
    def test_merges_tasks_and_sets_flag(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "_status.json")
            http_utils.write_source_status("results", {"attempted": 3, "updated": 3, "blocked": False}, path=p)
            http_utils.write_source_status("odds", {"attempted": 7, "updated": 0, "blocked": True}, path=p)
            st = json.load(open(p, encoding="utf-8"))
        self.assertEqual(set(st["tasks"]), {"results", "odds"})
        self.assertTrue(st["source_blocked"])
        self.assertIn("at", st["tasks"]["odds"])

    def test_broken_file_is_replaced(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "_status.json")
            open(p, "w").write("[1,2")
            http_utils.write_source_status("odds", {"blocked": False}, path=p)
            self.assertFalse(json.load(open(p))["source_blocked"])


class TestSourceHealth(unittest.TestCase):
    NOW = datetime.datetime(2026, 11, 19, 8, 12, tzinfo=UTC)

    def _st(self, **tasks):
        at = self.NOW.isoformat().replace("+00:00", "Z")
        return {"tasks": {k: {**v, "at": v.get("at", at)} for k, v in tasks.items()}}

    def test_blocked_is_problem(self):
        v = source_health.evaluate(self._st(odds={"attempted": 7, "updated": 0, "http_403": 7, "blocked": True}), self.NOW)
        self.assertEqual(v["state"], "problem")
        self.assertIn("odds", v["lines"][0])

    def test_zero_content_without_403_is_problem(self):
        v = source_health.evaluate(self._st(previews={"attempted": 76, "updated": 0}), self.NOW)
        self.assertEqual(v["state"], "problem")

    def test_small_attempt_zero_is_ok(self):
        v = source_health.evaluate(self._st(odds={"attempted": 2, "updated": 0}), self.NOW)
        self.assertEqual(v["state"], "ok")

    def test_old_records_are_ignored(self):
        old = (self.NOW - datetime.timedelta(hours=5)).isoformat()
        v = source_health.evaluate(self._st(odds={"attempted": 7, "updated": 0, "blocked": True, "at": old}), self.NOW)
        self.assertEqual(v["state"], "unknown", "深夜の no-op run で issue を開閉しない")

    def test_missing_file_is_unknown(self):
        self.assertEqual(source_health.evaluate({}, self.NOW)["state"], "unknown")


if __name__ == "__main__":
    unittest.main()
