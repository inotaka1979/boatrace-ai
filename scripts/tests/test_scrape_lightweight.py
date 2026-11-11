"""scrape-all 軽量化（2026-11-11）の回帰テスト

実測で確認した「1 run 42 分を毎回使い切る」構造を直した変更を固定する。

  - odds:    全 active (111-144 レース × 3 ページ) を回して 300s timeout に毎回 kill され、
             何も書かれなかった → 締切 60 分以内に限定 + 内部期限で必ず書き出す
  - results: 確定済 114 レース + 締切前 7 レースを毎回再取得 (336s) → 両方 skip
  - racedata: 逐次 30s/レースで +55 レース/run、全件揃うのは 21 時台 → 場単位 4 並列
  - 順序:    results → previews → odds（odds が results の確定を使えるように）

    python3 -m unittest scripts.tests.test_scrape_lightweight -v
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import scrape_all  # noqa: E402
import scrape_odds_fast as odds  # noqa: E402
import scrape_racedata as rd  # noqa: E402
import scrape_results as res  # noqa: E402

JST = datetime.timezone(datetime.timedelta(hours=9))
NOW = datetime.datetime(2026, 11, 11, 16, 20, tzinfo=JST)


def _close(minutes_from_now: float) -> datetime.datetime:
    return NOW + datetime.timedelta(minutes=minutes_from_now)


def _src(name: str) -> str:
    with open(os.path.join(os.path.dirname(__file__), "..", name), encoding="utf-8") as f:
        return f.read()


def _program(sid, rno, close_dt=None):
    p = {"race_stadium_number": sid, "race_number": rno, "race_date": "2026-11-11"}
    if close_dt is not None:
        p["race_closed_at"] = close_dt.strftime("%Y-%m-%d %H:%M:%S")
    return p


# ---------------------------------------------------------------------------
# odds
# ---------------------------------------------------------------------------
class TestOddsTargets(unittest.TestCase):
    def test_window_filters_and_sorts_by_closeness(self):
        closing = {
            (7, 4): _close(15),     # 対象
            (19, 4): _close(23),    # 対象
            (24, 4): _close(32),    # 対象
            (7, 5): _close(41),     # 対象
            (7, 6): _close(70),     # 窓外 (60 分より先)
            (7, 7): _close(130),    # 窓外
            (16, 12): _close(-3),   # 締切直後 (grace 内) → 対象
            (22, 11): _close(-25),  # 締切から 25 分 → 窓外
        }
        active = list(closing.keys())
        got = odds.select_odds_targets(active, closing, NOW, window_min=60, grace_min=5, max_races=36)
        self.assertEqual(got, [(16, 12), (7, 4), (19, 4), (24, 4), (7, 5)])

    def test_cap_keeps_the_closest(self):
        closing = {(1, r): _close(r * 4) for r in range(1, 13)}  # 4..48 分
        got = odds.select_odds_targets(list(closing), closing, NOW, max_races=3)
        self.assertEqual(got, [(1, 1), (1, 2), (1, 3)])

    def test_no_closing_info_falls_back_to_capped_active(self):
        active = [(1, r) for r in range(1, 13)]
        got = odds.select_odds_targets(active, {}, NOW, max_races=5)
        self.assertEqual(got, active[:5])

    def test_unknown_closing_is_excluded_when_others_are_known(self):
        closing = {(1, 1): _close(10)}
        got = odds.select_odds_targets([(1, 1), (1, 2)], closing, NOW)
        self.assertEqual(got, [(1, 1)])

    def test_empty_active(self):
        self.assertEqual(odds.select_odds_targets([], {(1, 1): _close(1)}, NOW), [])

    def test_parse_closing_map(self):
        progs = [_program(1, 1, _close(10)), _program(1, 2), {"race_stadium_number": 1, "race_number": 3, "race_closed_at": "bogus"}]
        m = odds.parse_closing_map(progs)
        self.assertEqual(set(m), {(1, 1)})
        self.assertEqual(m[(1, 1)], _close(10))

    def test_finished_from_results_filters_date_and_requires_confirmation(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "today.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump({"results": [
                    {"race_stadium_number": 4, "race_number": 1, "race_date": "2026-11-11", "race_technique_number": 1},
                    {"race_stadium_number": 4, "race_number": 2, "race_date": "2026-11-11", "race_technique_number": None},
                    {"race_stadium_number": 4, "race_number": 3, "race_date": "2026-11-10", "race_technique_number": 1},
                ]}, f)
            self.assertEqual(odds.get_finished_from_results(p, "20261111"), {(4, 1)})
            self.assertEqual(odds.get_finished_from_results(os.path.join(d, "nope.json"), "20261111"), set())

    def test_internal_budget_is_below_subprocess_timeout(self):
        """内部期限が scrape_all の kill (300s) より手前でなければ、書き出しに到達しない。"""
        src = _src("scrape_all.py")
        self.assertIn('_run_subprocess("scrape_odds_fast.py", timeout_sec=300)', src)
        self.assertLessEqual(odds.ODDS_BUDGET_SEC, 300 - 30)
        self.assertLessEqual(odds.ODDS_MAX_RACES * 3 * odds.INTERVAL, odds.ODDS_BUDGET_SEC,
                             "上限レース数 × 3 ページ × 間隔 が内部期限を超えている")


# ---------------------------------------------------------------------------
# results
# ---------------------------------------------------------------------------
def _result(sid, rno, *, technique=1, boats=True, trifecta=True, date="2026-11-11"):
    return {
        "race_stadium_number": sid, "race_number": rno, "race_date": date,
        "race_technique_number": technique,
        "boats": [{"racer_place_number": 1}] if boats else [],
        "payouts": {"trifecta": [{"combination": "1-2-3", "amount": 1000}] if trifecta else []},
    }


class TestResultsTargets(unittest.TestCase):
    def test_skips_complete_and_not_closed(self):
        races = {(1, 1), (1, 2), (1, 3), (1, 4)}
        complete = {(1, 1)}
        closing = {(1, 2): _close(-10), (1, 3): _close(+20)}   # (1,4) は締切不明
        targets, sk_c, sk_nc = res.select_fetch_targets(races, complete, closing, NOW)
        self.assertEqual(targets, [(1, 2), (1, 4)])
        self.assertEqual((sk_c, sk_nc), (1, 1))

    def test_grace_minutes(self):
        races = {(1, 1)}
        closing = {(1, 1): _close(-2)}
        t, _, nc = res.select_fetch_targets(races, set(), closing, NOW, grace_min=5)
        self.assertEqual((t, nc), ([], 1))
        t, _, nc = res.select_fetch_targets(races, set(), closing, NOW, grace_min=0)
        self.assertEqual((t, nc), ([(1, 1)], 0))

    def test_load_complete_keys_threshold_and_date(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "today.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump({"results": [
                    _result(4, 1),                              # 完全 → skip 対象
                    _result(4, 2, trifecta=False),              # 払戻未掲出 → 再取得
                    _result(4, 3, technique=None, boats=False, trifecta=False),  # 未確定
                    _result(4, 4, date="2026-11-10"),           # 前日 → 無視
                ]}, f)
            self.assertEqual(res._load_complete_keys(p, "20261111"), {(4, 1)})
            self.assertEqual(res._load_complete_keys(os.path.join(d, "nope.json"), "20261111"), set())

    def test_full_refetch_env_is_documented_in_source(self):
        src = _src("scrape_results.py")
        self.assertIn('RESULTS_REFETCH_ALL', src)
        self.assertIn("select_fetch_targets(", src)


# ---------------------------------------------------------------------------
# racedata
# ---------------------------------------------------------------------------
def _boat(n):
    return {"boat_number": n, "current_series_results": [{"waku": n, "course": 1, "place": 1, "st": ".15"}]}


class TestRacedataMergeAndParallel(unittest.TestCase):
    def test_merge_entry_append_replace_monotonic(self):
        data = []
        rd._merge_entry(data, {"stadium": 1, "race": 1, "boats": []})
        self.assertEqual(len(data), 1)
        # 空→充実: 置換
        rd._merge_entry(data, {"stadium": 1, "race": 1, "boats": [_boat(1)], "day_label": "2日目"})
        self.assertEqual(len(data), 1)
        self.assertTrue(data[0]["boats"])
        # 充実→空: 退行させない
        rd._merge_entry(data, {"stadium": 1, "race": 1, "boats": []})
        self.assertTrue(data[0]["boats"])
        self.assertEqual(data[0]["day_label"], "2日目")
        # 更新 (day_label 無し) は通し、既存 day_label を引き継ぐ
        rd._merge_entry(data, {"stadium": 1, "race": 1, "boats": [_boat(1), _boat(2)]})
        self.assertEqual(len(data[0]["boats"]), 2)
        self.assertEqual(data[0]["day_label"], "2日目")
        # 別レースは append
        rd._merge_entry(data, {"stadium": 1, "race": 2, "boats": []})
        self.assertEqual(len(data), 2)

    def test_scrape_stadium_is_sequential_per_worker_and_merges_parts(self):
        calls = []
        orig_rl, orig_bi, orig_sleep = rd.scrape_racelist, rd.scrape_beforeinfo, rd.time.sleep
        try:
            rd.scrape_racelist = lambda jcd, rno, d: (calls.append(("rl", jcd, rno)) or ([_boat(1), _boat(2)], "初日"))
            rd.scrape_beforeinfo = lambda jcd, rno, d: (calls.append(("bi", jcd, rno)) or {2: ["キャブ"]})
            rd.time.sleep = lambda s: calls.append(("sleep", s))
            entries = rd._scrape_stadium(7, [3, 4], "20261111")
        finally:
            rd.scrape_racelist, rd.scrape_beforeinfo, rd.time.sleep = orig_rl, orig_bi, orig_sleep
        self.assertEqual([e["race"] for e in entries], [3, 4])
        self.assertEqual(entries[0]["day_label"], "初日")
        self.assertEqual(entries[0]["boats"][1]["parts_replaced"], ["キャブ"])
        self.assertEqual(entries[0]["boats"][0]["parts_replaced"], [])
        # 1 レース = racelist → sleep → beforeinfo → sleep の順を守る（per-worker politeness）
        self.assertEqual([c[0] for c in calls][:4], ["rl", "sleep", "bi", "sleep"])
        self.assertEqual(sum(1 for c in calls if c[0] == "sleep"), 4)
        self.assertTrue(all(c[1] == rd.INTERVAL for c in calls if c[0] == "sleep"))

    def test_main_uses_stadium_level_parallelism(self):
        src = _src("scrape_racedata.py")
        self.assertIn("ex.submit(_scrape_stadium,", src)
        self.assertIn("RACEDATA_WORKERS", src)
        self.assertGreaterEqual(rd.RACEDATA_WORKERS, 2)
        self.assertLessEqual(rd.RACEDATA_WORKERS, 6, "boatrace.jp への合計レートを上げすぎない")


# ---------------------------------------------------------------------------
# scrape_all ordering
# ---------------------------------------------------------------------------
class TestRealtimeOrder(unittest.TestCase):
    def setUp(self):
        self._o = (scrape_all._is_fresh_today, scrape_all._age_minutes, scrape_all._racedata_has_empty)
        scrape_all._is_fresh_today = lambda path, now: True
        scrape_all._age_minutes = lambda path: 999.0
        scrape_all._racedata_has_empty = lambda path: False

    def tearDown(self):
        scrape_all._is_fresh_today, scrape_all._age_minutes, scrape_all._racedata_has_empty = self._o

    def _names(self, force_all=False, h=14):
        now = datetime.datetime(2026, 11, 11, h, 0, tzinfo=JST)
        return [n for n, _ in scrape_all._decide_tasks(now, force_all=force_all)]

    def test_results_before_previews_before_odds(self):
        for force in (False, True):
            names = self._names(force_all=force)
            self.assertLess(names.index("results"), names.index("previews"), names)
            self.assertLess(names.index("previews"), names.index("odds"), names)

    def test_morning_without_results_still_has_previews_and_odds(self):
        names = self._names(h=9)
        self.assertNotIn("results", names)
        self.assertIn("previews", names)
        self.assertIn("odds", names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
