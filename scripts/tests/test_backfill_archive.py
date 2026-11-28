"""確定済みレースの展示・オッズのアーカイブ後追い (2026-11-20) の回帰テスト

  - plan: 確定レースのうち、三連単オッズ / 展示 (4 艇以上の展示タイム) が無いものだけを対象にする
  - merge: 既にあるデータは上書きしない、後追い分には _backfilled を付ける
  - run: 今日の日付は触らない（archive_daily が today.json から毎 run 上書きするため）
  - run: 取得元のブロック (403 連続) で止まり、data/_status.json の tasks.backfill に記録する
  - 2026-11-26: 応答が 1 件 10 秒でも上限の 40 レースに届く内部期限 / 期限で止まっても取れた分は書く /
    取りに行く順番が場に偏らない

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


class _SlowSite:
    """応答に sec 秒かかる取得元。時計 (time.monotonic) を進めるだけで、実際には待たない。"""

    def __init__(self, sec):
        self.sec = sec
        self.now = 1000.0
        self.urls = []

    def monotonic(self):
        return self.now

    def sleep(self, s):
        self.now += max(0.0, s)

    def fetch(self, url, timeout=15):
        self.urls.append(url)
        self.now += self.sec
        return 200, "<html/>"

    def patches(self):
        return [mock.patch.object(bf, "fetch_once", side_effect=self.fetch),
                mock.patch.object(bf.time, "monotonic", side_effect=self.monotonic),
                mock.patch.object(bf.time, "sleep", side_effect=self.sleep),
                mock.patch.object(bf.odds_mod, "parse_trifecta", return_value={"1-2-3": 5.0}),
                mock.patch.object(bf.odds_mod, "parse_win", return_value={"1": 1.5}),
                mock.patch.object(bf.prev_mod, "parse_beforeinfo", return_value={
                    b: {"exhibition_time": 6.7, "start_timing": 0.1, "tilt": 0, "course": b} for b in range(1, 7)})]


def _run_with(site, **kw):
    import contextlib

    with contextlib.ExitStack() as st:
        for p in site.patches():
            st.enter_context(p)
        return bf.run(**kw)


def _race_of(url):
    q = dict(kv.split("=") for kv in url.split("?", 1)[1].split("&"))
    return int(q["jcd"]), int(q["rno"])


class TestSlowSource(unittest.TestCase):
    """boatrace.jp が応答を 1 件 8〜10 秒遅らせている時 (2026-11-26, RUNBOOK §11.2)。"""

    TODAY = datetime.date(2026, 11, 26)
    VENUES = [5, 8, 10, 11, 12, 13, 15, 17, 18, 19, 20, 21, 24]

    def _day(self, d, date="20261125"):
        _write(d, "results", date, _results([(s, r, True) for s in self.VENUES for r in range(1, 13)]))

    def test_default_budget_reaches_the_race_limit_at_ten_seconds_per_page(self):
        # 導入時の 150 秒では 16〜17 件 = 6〜8 レースしか取れていなかった
        self.assertGreaterEqual(bf.BUDGET_SEC, bf.MAX_RACES * bf.PAGES_PER_RACE * bf.SLOW_SEC_PER_PAGE)
        site = _SlowSite(9.5)
        with tempfile.TemporaryDirectory() as d:
            self._day(d)
            s = _run_with(site, days=1, data_dir=d, today=self.TODAY)
            self.assertEqual(len(_read(d, "odds", "20261125")["odds"]), bf.MAX_RACES)
            self.assertEqual(len(_read(d, "previews", "20261125")["races"]), bf.MAX_RACES)
        self.assertEqual(s["attempted"], bf.MAX_RACES)
        self.assertEqual(s["updated"], bf.MAX_RACES)
        self.assertEqual(s["requests"], bf.MAX_RACES * bf.PAGES_PER_RACE)

    def test_stops_at_the_deadline_and_keeps_what_it_got(self):
        site = _SlowSite(9.5)
        with tempfile.TemporaryDirectory() as d:
            self._day(d)
            s = _run_with(site, days=1, budget_sec=150, data_dir=d, today=self.TODAY)
            odds = _read(d, "odds", "20261125")["odds"]
            prev = _read(d, "previews", "20261125")["races"]
            with open(os.path.join(d, "_status.json"), encoding="utf-8") as fh:
                st = json.load(fh)
        # 9.5 秒ごとに 1 件: 0 秒〜142.5 秒に 16 件。期限 (150 秒) の後は 1 件も送らない。
        #   本番の記録（11/20〜11/26 の毎晩: 16〜17 件、odds +5 / previews +6）と同じ数になる
        self.assertEqual(s["requests"], 16)
        self.assertEqual(len(site.urls), 16)
        self.assertEqual((len(odds), len(prev)), (5, 6), "期限までに取れた分は書き出す")
        self.assertEqual(st["tasks"]["backfill"]["ok"], 16)
        self.assertEqual(st["tasks"]["backfill"]["avg_ms"], 9500, "遅かったことが記録に残る")

    def test_one_request_at_a_time_with_the_interval(self):
        # 遅延を避けるために同時に送らない: 次のリクエストは、前の応答の後・間隔を空けてから
        site = _SlowSite(9.5)
        starts = []
        orig = site.fetch

        def fetch(url, timeout=15):
            starts.append(site.now)
            return orig(url, timeout=timeout)

        site.fetch = fetch
        with tempfile.TemporaryDirectory() as d:
            self._day(d)
            _run_with(site, days=1, budget_sec=100, data_dir=d, today=self.TODAY)
        self.assertGreaterEqual(len(starts), 5)
        gaps = [b - a for a, b in zip(starts, starts[1:])]
        self.assertTrue(all(g >= 9.5 for g in gaps), gaps)

    def test_fast_source_finishes_early(self):
        site = _SlowSite(0.3)
        starts = []
        orig = site.fetch

        def fetch(url, timeout=15):
            starts.append(site.now)
            return orig(url, timeout=timeout)

        site.fetch = fetch
        with tempfile.TemporaryDirectory() as d:
            self._day(d)
            t0 = site.now
            s = _run_with(site, days=1, data_dir=d, today=self.TODAY)
        self.assertEqual(s["attempted"], bf.MAX_RACES)
        self.assertLess(site.now - t0, 120, "速い晩は上限のレース数で終わる（期限いっぱいまで粘らない）")
        gaps = [b - a for a, b in zip(starts, starts[1:])]
        self.assertTrue(all(g >= bf.INTERVAL - 1e-9 for g in gaps), "応答が速くても、取得の間隔 (0.5 秒) は空ける")

    def test_order_is_spread_across_venues(self):
        keys = [(s, r) for s in self.VENUES for r in range(1, 13)]
        order = bf._spread("20261125", keys)
        self.assertEqual(sorted(order), sorted(keys), "並べ替えるだけ（増減なし）")
        self.assertEqual(order, bf._spread("20261125", list(reversed(keys))), "同じ日付なら入力の順に依らず同じ順番")
        self.assertNotEqual(order, bf._spread("20261124", keys), "日付が変われば順番も変わる")
        head = order[: bf.MAX_RACES]
        self.assertGreaterEqual(len({s for s, _ in head}), 10, "先頭 40 レースが 13 場中 10 場以上にまたがる")
        self.assertGreaterEqual(len({r for _, r in head}), 10, "レース番号も偏らない")
        self.assertLessEqual(max(sum(1 for s, _ in head if s == v) for v in self.VENUES), 8, "1 つの場に集中しない")

    def test_run_fetches_in_the_spread_order_and_resumes(self):
        site = _SlowSite(0.3)
        with tempfile.TemporaryDirectory() as d:
            self._day(d)
            _run_with(site, days=1, max_races=20, data_dir=d, today=self.TODAY)
            first = []
            for u in site.urls:
                if _race_of(u) not in first:
                    first.append(_race_of(u))
            keys = [(s, r) for s in self.VENUES for r in range(1, 13)]
            self.assertEqual(first, bf._spread("20261125", keys)[:20])
            self.assertGreaterEqual(len({s for s, _ in first}), 8, "番号順なら 2 場 (5 と 8) だけになる")
            # 次の run は、埋まったレースを飛ばして続きから
            site2 = _SlowSite(0.3)
            _run_with(site2, days=1, max_races=20, data_dir=d, today=self.TODAY)
            second = {_race_of(u) for u in site2.urls}
            self.assertEqual(len(second), 20)
            self.assertFalse(second & set(first), "前の run で埋めたレースを取り直した")

    def test_subprocess_timeout_is_longer_than_the_budget_and_fits_the_job(self):
        import re

        import scrape_all

        # kill の最終保険は、内部期限 + 取得中の 1 件 (時間切れ 15 秒) + 書き出し より長い
        self.assertGreaterEqual(scrape_all.BACKFILL_TIMEOUT_SEC, bf.BUDGET_SEC + 60)
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        with open(os.path.join(root, ".github", "workflows", "scrape-all.yml"), encoding="utf-8") as fh:
            m = re.search(r"^\s*timeout-minutes:\s*(\d+)", fh.read(), re.M)
        self.assertIsNotNone(m)
        # 夜間の run は backfill のほかに day_labels（6 時台。13 場 × 約 10 秒）と集計が走る。job の timeout に余裕を残す
        self.assertLessEqual(scrape_all.BACKFILL_TIMEOUT_SEC + 600, int(m.group(1)) * 60)
        self.assertGreaterEqual(scrape_all.BACKFILL_MARGIN_SEC, 60, "取得中の 1 件 (最大 15 秒) + 書き出しの余裕")
        self.assertEqual(scrape_all.BACKFILL_TIMEOUT_SEC - scrape_all.BACKFILL_MARGIN_SEC, bf.BUDGET_SEC,
                         "時間に余裕のある run（ふだんの夜）は、スクリプトの既定と同じ内部期限")

    def _call_from_scrape_all(self, left):
        """job の残りが left 秒の時に scrape_all が backfill をどう呼ぶか。呼ばなければ None。"""
        from unittest import mock

        import scrape_all

        calls = []
        # 時計を止めて、残りがちょうど left 秒になるようにする
        with mock.patch.object(scrape_all, "_run_subprocess",
                               side_effect=lambda script, args=None, timeout_sec=600: calls.append(
                                   (script, args, timeout_sec)) or 0), \
             mock.patch.object(scrape_all.time, "monotonic", return_value=50000.0), \
             mock.patch.object(scrape_all, "_RUN_STARTED", 50000.0 - (scrape_all.JOB_BUDGET_SEC - left)):
            self.assertEqual(scrape_all._backfill_archive(), 0)
        return calls[0] if calls else None

    def test_scrape_all_gives_the_full_budget_on_an_ordinary_night(self):
        import scrape_all

        # 番組表の続きが無い夜（0 時以降の run は、ほかに時間のかかる作業が無い）
        script, args, timeout = self._call_from_scrape_all(left=scrape_all.JOB_BUDGET_SEC - 5)
        self.assertEqual(script, "backfill_archive.py")
        self.assertEqual(args, ["--budget-sec", str(bf.BUDGET_SEC)])
        self.assertEqual(timeout, scrape_all.BACKFILL_TIMEOUT_SEC)

    def test_scrape_all_fits_backfill_into_what_the_job_has_left(self):
        import scrape_all

        # 2026-11-28: 同じ run で先に番組表（最大 37 分）を取った後。固定の 22 分を足すと job の timeout (50 分) を
        #   超え、commit まで届かずにその run の成果（取った番組表を含む）が消える。残り時間に収める
        after_programs = scrape_all.JOB_BUDGET_SEC - (
            scrape_all.PROGRAMS_TODAY_AHEAD_BUDGET_SEC + scrape_all.PROGRAMS_AHEAD_MARGIN_SEC)
        self.assertLess(after_programs, scrape_all.BACKFILL_TIMEOUT_SEC, "この場面は、固定の timeout だと予算を超える")
        _, args, timeout = self._call_from_scrape_all(left=after_programs)
        self.assertLessEqual(timeout, after_programs)
        self.assertEqual(args, ["--budget-sec", str(timeout - scrape_all.BACKFILL_MARGIN_SEC)])
        self.assertGreaterEqual(int(args[1]), scrape_all.BACKFILL_MIN_BUDGET_SEC)
        self.assertLess(int(args[1]) + 15, timeout, "内部期限 + 取得中の 1 件 < kill の timeout")

    def test_scrape_all_skips_backfill_when_no_time_is_left(self):
        import scrape_all

        for left in (-300, 0, 60, scrape_all.BACKFILL_MARGIN_SEC + scrape_all.BACKFILL_MIN_BUDGET_SEC - 1):
            self.assertIsNone(self._call_from_scrape_all(left=left), left)
        # 1 レース分の時間があれば行う
        call = self._call_from_scrape_all(left=scrape_all.BACKFILL_MARGIN_SEC + scrape_all.BACKFILL_MIN_BUDGET_SEC + 5)
        self.assertIsNotNone(call)
        self.assertEqual(call[1], ["--budget-sec", str(scrape_all.BACKFILL_MIN_BUDGET_SEC + 5)])

    def test_budget_argument_reaches_run(self):
        from unittest import mock

        with mock.patch.object(bf, "run", return_value={}) as run:
            bf.main(["--budget-sec", "345"])
        self.assertEqual(run.call_args.kwargs.get("budget_sec"), 345)


if __name__ == "__main__":
    unittest.main()
