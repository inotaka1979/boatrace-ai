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

    # ---- 2026-11-26: 「止められてはいないが遅い」を残す
    def test_slow_responses_are_noted_without_changing_the_state(self):
        v = source_health.evaluate(
            self._st(backfill={"attempted": 7, "updated": 7, "ok": 16, "avg_ms": 9350, "max_ms": 10230}), self.NOW
        )
        self.assertEqual(v["state"], "ok", "遅いだけでは problem にしない（issue を開かない）")
        self.assertEqual(v["lines"], [])
        self.assertEqual(v["notes"], ["backfill: 応答が遅い（取れた 16 件の平均 9.3 秒、最大 10.2 秒）"])

    def test_normal_speed_has_no_notes_key(self):
        v = source_health.evaluate(self._st(odds={"attempted": 9, "updated": 9, "ok": 27, "avg_ms": 310, "max_ms": 900}), self.NOW)
        self.assertEqual(v, {"state": "ok", "lines": []}, "通常時の出力の形は従来どおり")

    def test_slow_threshold_boundary(self):
        mk = lambda avg, ok: source_health.evaluate(self._st(odds={"attempted": 9, "updated": 9, "ok": ok, "avg_ms": avg}), self.NOW)  # noqa: E731
        self.assertNotIn("notes", mk(source_health.SLOW_AVG_MS - 1, 20))
        self.assertIn("notes", mk(source_health.SLOW_AVG_MS, 20))
        self.assertNotIn("notes", mk(9000, source_health.SLOW_MIN_OK - 1), "1〜2 件だけでは判断しない")
        self.assertIn("notes", mk(9000, source_health.SLOW_MIN_OK))
        self.assertEqual(mk(9000, 20)["notes"], ["odds: 応答が遅い（取れた 20 件の平均 9.0 秒）"], "最大値が無くても出す")

    def test_slow_note_ignores_old_and_malformed_records(self):
        old = (self.NOW - datetime.timedelta(hours=5)).isoformat()
        v = source_health.evaluate(self._st(backfill={"ok": 16, "avg_ms": 9350, "at": old}), self.NOW)
        self.assertEqual(v, {"state": "unknown", "lines": []}, "古い記録は見ない")
        for bad in ("9350", None, True, [9350], {"v": 1}):
            v = source_health.evaluate(self._st(odds={"attempted": 9, "updated": 9, "ok": 20, "avg_ms": bad}), self.NOW)
            self.assertEqual(v, {"state": "ok", "lines": []}, f"avg_ms={bad!r}")
        v = source_health.evaluate(self._st(odds={"attempted": 9, "updated": 9, "ok": "20", "avg_ms": 9000}), self.NOW)
        self.assertNotIn("notes", v, "件数が数値でない記録では判断しない")

    def test_problem_and_slow_are_reported_together(self):
        v = source_health.evaluate(
            self._st(previews={"attempted": 76, "updated": 0, "ok": 5, "avg_ms": 9000, "max_ms": 9900}), self.NOW
        )
        self.assertEqual(v["state"], "problem")
        self.assertEqual(len(v["lines"]), 1)
        self.assertEqual(len(v["notes"]), 1)


class TestResponseTime(unittest.TestCase):
    """取れたリクエストの応答時間を集計して data/_status.json に残す (2026-11-26)。"""

    def test_stats_report_average_and_max_of_successful_requests(self):
        d = http_utils.SourceBlockDetector()
        for sec in (9.4, 0.2, 9.9):
            d.record(200, sec)
        self.assertEqual(d.stats(), {"ok": 3, "http_403": 0, "blocked": False, "avg_ms": 6500, "max_ms": 9900})

    def test_stats_shape_is_unchanged_when_nothing_was_timed(self):
        d = http_utils.SourceBlockDetector()
        d.record(200)
        d.record(403)
        self.assertEqual(d.stats(), {"ok": 1, "http_403": 1, "blocked": False})

    def test_only_successful_responses_are_timed(self):
        d = http_utils.SourceBlockDetector()
        d.record(200, 0.3)
        d.record(403, 30.0)
        d.record("exc:TimeoutError", 15.0)
        d.record(404, 20.0)
        self.assertEqual(d.stats(), {"ok": 1, "http_403": 1, "blocked": False, "avg_ms": 300, "max_ms": 300})

    def test_bad_elapsed_values_are_ignored_but_the_request_still_counts(self):
        d = http_utils.SourceBlockDetector()
        for bad in (None, float("nan"), float("inf"), -1.0, True, "0.3", [0.3]):
            d.record(200, bad)
        self.assertEqual(d.stats(), {"ok": 7, "http_403": 0, "blocked": False})
        d.record(200, 0)
        self.assertEqual(d.stats()["avg_ms"], 0)

    def test_timed_call_returns_result_and_elapsed_seconds(self):
        clock = iter([100.0, 109.5])
        with mock.patch.object(http_utils.time, "monotonic", side_effect=lambda: next(clock)):
            out, sec = http_utils.timed_call(lambda a, b=0: (a, b), 1, b=2)
        self.assertEqual(out, (1, 2))
        self.assertAlmostEqual(sec, 9.5)

    def test_timed_call_propagates_exceptions(self):
        def boom():
            raise ValueError("x")

        with self.assertRaises(ValueError):
            http_utils.timed_call(boom)

    def _slow(self, fn, *a, **kw):  # timed_call の代わり: 中身は本物を呼び、経過秒だけ固定する
        return fn(*a, **kw), 9.5

    def test_odds_records_response_time(self):
        b = http_utils.SourceBlockDetector()
        with mock.patch.object(odds, "fetch_once", return_value=(200, "<html>")), \
                mock.patch.object(odds, "timed_call", side_effect=self._slow):
            out = asyncio.run(odds.fetch(None, _NoWait(), "https://x", retries=0, block=b))
        self.assertEqual(out, "<html>")
        self.assertEqual(b.stats()["avg_ms"], 9500)

    def test_previews_records_response_time(self):
        orig = prev.BLOCK
        prev.BLOCK = http_utils.SourceBlockDetector()
        try:
            with mock.patch.object(prev, "fetch_once", return_value=(200, "<html>")), \
                    mock.patch.object(prev, "timed_call", side_effect=self._slow):
                out = asyncio.run(prev.fetch_with_retry(None, "https://x", _NoWait(), retries=0))
            self.assertEqual(out, "<html>")
            self.assertEqual(prev.BLOCK.stats()["avg_ms"], 9500)
        finally:
            prev.BLOCK = orig

    def test_results_records_response_time(self):
        orig = res.BLOCK
        res.BLOCK = http_utils.SourceBlockDetector()
        try:
            with mock.patch.object(res, "fetch", return_value="<html></html>"), \
                    mock.patch.object(res, "parse_raceresult", return_value={"ok": 1}), \
                    mock.patch.object(res, "timed_call", side_effect=self._slow):
                sid, rn, data, err = res._fetch_one_race((1, 2, "20261125"))
            self.assertEqual((sid, rn, data, err), (1, 2, {"ok": 1}, None))
            self.assertEqual(res.BLOCK.stats()["avg_ms"], 9500)
        finally:
            res.BLOCK = orig

    def test_backfill_records_response_time(self):
        import backfill_archive as bf

        b = http_utils.SourceBlockDetector()
        f = bf._Fetcher(b, deadline=float("inf"))
        with mock.patch.object(bf, "fetch_once", return_value=(200, "<html>")), \
                mock.patch.object(bf, "INTERVAL", 0), \
                mock.patch.object(bf, "timed_call", side_effect=self._slow):
            self.assertEqual(f.get("https://x"), "<html>")
        self.assertEqual(b.stats()["avg_ms"], 9500)
        self.assertEqual(f.requests, 1)

    def test_scrapers_measure_inside_the_worker_thread(self):
        # asyncio.to_thread(timed_call, fetch_once, ...) の形であること。
        # await の外側で測ると、スレッドの順番待ち（遅延時は同時実行数が増えて詰まる）まで応答時間に入る
        for mod in (odds, prev):
            with open(mod.__file__, encoding="utf-8") as fh:
                src = fh.read()
            self.assertRegex(src, r"asyncio\.to_thread\(\s*timed_call,\s*fetch_once,", mod.__name__)

    def test_status_file_keeps_the_timing(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "_status.json")
            b = http_utils.SourceBlockDetector()
            b.record(200, 9.4)
            http_utils.write_source_status("backfill", {"attempted": 1, "updated": 1, **b.stats()}, path=p)
            with open(p, encoding="utf-8") as fh:
                st = json.load(fh)
        self.assertEqual(st["tasks"]["backfill"]["avg_ms"], 9400)
        self.assertEqual(st["tasks"]["backfill"]["max_ms"], 9400)

    def test_workflow_prints_a_notice_for_each_note(self):
        # scrape-all.yml の「Source health alert」が notes を ::notice:: として出す 1 行を、そのまま bash で実行する
        import re
        import subprocess

        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        with open(os.path.join(root, ".github", "workflows", "scrape-all.yml"), encoding="utf-8") as fh:
            yml = fh.read()
        m = re.search(r"^\s*(printf '%s' \"\$verdict\" \| python3 -c '[^\n]*notes[^\n]*)$", yml, re.M)
        self.assertIsNotNone(m, "notes を出す行が scrape-all.yml にある")
        line = m.group(1)

        def run(verdict):
            r = subprocess.run(["bash", "-c", line], env={**os.environ, "verdict": json.dumps(verdict, ensure_ascii=False)},
                               capture_output=True, text=True, timeout=30)
            return r.returncode, r.stdout, r.stderr

        code, out, err = run({"state": "ok", "lines": [], "notes": ["backfill: 応答が遅い（取れた 16 件の平均 9.3 秒）", "odds: 応答が遅い"]})
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out.splitlines(), ["::notice::boatrace.jp backfill: 応答が遅い（取れた 16 件の平均 9.3 秒）",
                                            "::notice::boatrace.jp odds: 応答が遅い"])
        self.assertEqual(run({"state": "ok", "lines": []}), (0, "", ""), "notes が無ければ何も出さない（エラーも出さない）")
        code, out, _ = run("not a verdict")
        self.assertEqual((code, out), (0, ""), "判定が読めなくても step を失敗させない")


if __name__ == "__main__":
    unittest.main()
