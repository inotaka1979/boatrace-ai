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
        # FA-10 (2026-08-11): results の鮮度ゲートも stub する。
        #   本クラスは「時刻だけ評価」する意図だが _age_minutes だけ stub されておらず、
        #   実ファイル data/results/today.json の更新時刻を読んでいた。scraper cron が
        #   直前に commit していると age < 20 分になり test_evening_22_30_in_window が
        #   落ちる（＝チェックアウトのタイミング次第で成否が変わるフレーク）。実際に
        #   age=4.5 分の状態で再現。時刻の網羅性を検証したいのだから鮮度は固定する。
        #   鮮度ゲート自体は test_results_age_gated が個別に stub して検証している。
        self._orig_age = scrape_all._age_minutes
        scrape_all._age_minutes = lambda path: 999.0
        # 2026-08-11: racedata の中身ゲートも stub する（FA-10 と同じ理由）。
        #   実ファイル data/racedata/today.json を読むため、stub しないと
        #   チェックアウト内容で racedata の要否が変わりフレークになる。
        self._orig_rd = scrape_all._racedata_has_empty
        scrape_all._racedata_has_empty = lambda path: False

    def tearDown(self):
        scrape_all._is_fresh_today = self._orig
        scrape_all._age_minutes = self._orig_age
        scrape_all._racedata_has_empty = self._orig_rd

    def _at(self, h, m):
        now = datetime.datetime(2026, 5, 17, h, m, tzinfo=JST)
        return _names(scrape_all._decide_tasks(now, force_all=False))

    def test_pre_race_hours_no_tasks(self):
        # 2026-11-20: 開催日タブ（何日目 / 中止）だけは 6 時から取る
        # 2026-11-28: 朝の窓の前は、今日の番組表の続き (programs(today)) も取る
        self.assertEqual(self._at(7, 0), ["day_labels", "programs(today)"])
        self.assertNotIn("day_labels", self._at(5, 30))
        self.assertNotIn("day_labels", self._at(23, 10))

    def test_tide_window_07_30(self):
        tasks = self._at(7, 30)
        self.assertIn("tide", tasks)
        self.assertIn("schedule(quick)", tasks)

    def test_old_racedata_window_09_30_picks_up(self):
        tasks = self._at(9, 30)
        self.assertIn("racedata", tasks)
        # rt-fix P0-2 (2026-06-04): prerender は index.html を書き換え、
        #   複数 workflow の push を非マージ衝突させる唯一の原因だったため
        #   scrape-all の commit 対象から除外した。
        self.assertNotIn("prerender", tasks)

    def test_delayed_cron_09_58_picks_up(self):
        # OLD bug: h==9 and 28<=m<=35 missed this minute
        tasks = self._at(9, 58)
        self.assertIn("racedata", tasks)
        # rt-fix P0-2: prerender は scrape-all から分離済
        self.assertNotIn("prerender", tasks)

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
        # 2026-11-20: 夜間はアーカイブの後追い (backfill) を行う（スクレイプの real-time 系は無し）
        # 2026-11-26: 23 時台は翌日の出走 (tomorrow) も取る。時間のかかる backfill より先に
        # 2026-11-28: 翌日の番組表 (programs(tomorrow)) は、出走の一覧 (tomorrow) の直後
        tasks = self._at(23, 0)
        self.assertEqual(tasks, ["tomorrow", "programs(tomorrow)", "backfill"])
        self.assertEqual(self._at(0, 30), ["programs(today)", "backfill"],
                         "日付が変わったら翌日の出走は取らず、今日の番組表の続きを取る")

    def test_programs_ahead_evening_is_tomorrow_and_before_morning_is_today(self):
        # 2026-11-28: 番組表を前もって取る。夕方〜夜 = 翌日分、0 時〜朝の窓 (8:30) の前 = 今日の分の続き。
        #   日中（朝の窓〜14 時台）はどちらも取らない（今日の番組表は programs が取り直す）
        for h, m in ((15, 0), (18, 13), (22, 18), (23, 59)):
            tasks = self._at(h, m)
            self.assertIn("programs(tomorrow)", tasks, (h, m))
            self.assertNotIn("programs(today)", tasks, (h, m))
            self.assertEqual(tasks.index("programs(tomorrow)"), tasks.index("tomorrow") + 1,
                             "一覧 (tomorrow) を作った直後に取る")
        for h, m in ((0, 0), (2, 21), (4, 12), (6, 48), (8, 0), (8, 29)):
            tasks = self._at(h, m)
            self.assertIn("programs(today)", tasks, (h, m))
            self.assertNotIn("programs(tomorrow)", tasks, (h, m))
        for h, m in ((8, 30), (9, 0), (11, 39), (14, 59)):
            tasks = self._at(h, m)
            self.assertNotIn("programs(today)", tasks, (h, m))
            self.assertNotIn("programs(tomorrow)", tasks, (h, m))
            self.assertIn("programs", tasks, "朝の窓では今日の番組表を公式ページから取り直す")

    def test_programs_ahead_comes_before_the_slow_tasks(self):
        night = self._at(2, 21)
        self.assertLess(night.index("programs(today)"), night.index("backfill"))
        evening = self._at(22, 18)
        for fast in ("results", "previews", "odds"):
            self.assertLess(evening.index(fast), evening.index("programs(tomorrow)"), fast)
        self.assertLess(evening.index("programs(tomorrow)"), evening.index("racedata"))

    def test_tomorrow_runs_in_the_evening_only(self):
        # 翌日の出走表は前日の午後〜夜に公開される。15〜23 時の run で毎回取り直す
        for h in (15, 16, 19, 22, 23):
            self.assertIn("tomorrow", self._at(h, 10), h)
        for h in (0, 3, 6, 8, 12, 14):
            self.assertNotIn("tomorrow", self._at(h, 10), h)

    def test_tomorrow_comes_after_realtime_tasks_and_before_slow_ones(self):
        tasks = self._at(22, 30)
        for fast in ("results", "previews", "odds"):
            self.assertLess(tasks.index(fast), tasks.index("tomorrow"), fast)
        self.assertLess(tasks.index("tomorrow"), tasks.index("racedata"))

    def test_backfill_only_at_night(self):
        for h in (23, 0, 3, 6):
            self.assertIn("backfill", self._at(h, 10), h)
        for h in (7, 8, 12, 22):
            self.assertNotIn("backfill", self._at(h, 10), h)

    def test_results_age_gated(self):
        # 2026-07-05 (結果更新停止の3層修正): 旧「毎時 25-35 分の窓」から
        # 「10-22 時 & results が 20 分以上古ければ毎 tick」の鮮度ゲートに変更。
        # (旧テストは 30 分窓の仕様を固定しており、変更後は常に fail していた)
        orig = scrape_all._age_minutes
        try:
            scrape_all._age_minutes = lambda path: 999.0
            self.assertIn("results", self._at(10, 15))   # 窓内 + stale → 取る
            self.assertIn("results", self._at(10, 31))
            self.assertNotIn("results", self._at(9, 50))  # 窓外 (h<10)
            scrape_all._age_minutes = lambda path: 5.0
            self.assertNotIn("results", self._at(10, 31))  # fresh → skip
        finally:
            scrape_all._age_minutes = orig


class TestDecideTasksIdempotency(unittest.TestCase):
    """fresh データ時は scraper を skip し、stale 時のみ fetch することを検証。"""

    def setUp(self):
        self._orig = scrape_all._is_fresh_today
        # 2026-08-11: racedata の中身ゲートも stub（実ファイル依存のフレークを作らない）
        self._orig_rd = scrape_all._racedata_has_empty
        scrape_all._racedata_has_empty = lambda path: False

    def tearDown(self):
        scrape_all._is_fresh_today = self._orig
        scrape_all._racedata_has_empty = self._orig_rd

    def test_racedata_refetched_when_boats_empty(self):
        """fresh でも boats が空なら再取得する（今節成績が一日中空になる不具合の防止）。"""
        scrape_all._is_fresh_today = lambda path, now: True
        scrape_all._racedata_has_empty = lambda path: True
        now = datetime.datetime(2026, 5, 17, 14, 0, tzinfo=JST)
        tasks = _names(scrape_all._decide_tasks(now, force_all=False))
        self.assertIn("racedata", tasks, "空 racedata が再取得されない")

    def test_programs_tomorrow_is_cut_short_only_when_racedata_follows(self):
        """翌日の番組表は 1 回で 1 日分を取る長さ。同じ run で racedata も取る時だけ短くする（2026-11-28）。"""
        evening = datetime.datetime(2026, 11, 28, 22, 18, tzinfo=JST)
        scrape_all._is_fresh_today = lambda path, now: True  # racedata は取り終わっている（ふだんの夕方）
        tasks = dict(scrape_all._decide_tasks(evening, force_all=False))
        self.assertNotIn("racedata", tasks)
        self.assertIs(tasks["programs(tomorrow)"], scrape_all._scrape_programs_tomorrow)

        scrape_all._racedata_has_empty = lambda path: True  # 今節成績がまだ埋まっていない
        tasks = dict(scrape_all._decide_tasks(evening, force_all=False))
        self.assertIn("racedata", tasks)
        self.assertIs(tasks["programs(tomorrow)"], scrape_all._scrape_programs_tomorrow_shared)

        # 23 時台は racedata の窓の外（この run では取らない）→ 長い期限
        late = datetime.datetime(2026, 11, 28, 23, 10, tzinfo=JST)
        tasks = dict(scrape_all._decide_tasks(late, force_all=False))
        self.assertNotIn("racedata", tasks)
        self.assertIs(tasks["programs(tomorrow)"], scrape_all._scrape_programs_tomorrow)

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
        ):
            self.assertIn(expected, tasks)
        # rt-fix P0-2: prerender は scrape-all から分離 (index.html 衝突源の除去)
        self.assertNotIn("prerender", tasks)


if __name__ == "__main__":
    unittest.main(verbosity=2)
