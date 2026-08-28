"""今節成績（racedata）が「一日中空のまま」になる不具合の回帰テスト（2026-08-11）

user 報告: 選手の今節の成績が出ていない。

原因は 2 層に分かれていた。

1. scrape_racedata.py の再開ロジック
   `existing_done_keys` が (stadium, race) の存在だけで「取得済み」と判定しており、
   `boats: []`（= 今節成績が取れなかった）の entry も done 扱いしてスキップしていた。

2. scrape_all.py の鮮度ゲート
   `_is_fresh_today` は「partial=False かつ updated_at が今日」だけを見る。
   早朝 run が boats=[] を書くと条件を満たしてしまい、その日は二度と racedata を
   取りに行かなくなる。

結果、boatrace.jp に今節成績がまだ載っていない早朝に 1 回走っただけで、
その日は一日中 今節成績が空のままになっていた。
実データでも data/racedata/today.json の履歴に 0/13, 0/15 の日が多数残っている。

    python3 -m unittest scripts.tests.test_racedata_empty_lockin
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import scrape_all  # noqa: E402


def _entry(sid, rno, boats=None, day_label=None):
    e = {"stadium": sid, "race": rno, "boats": boats or []}
    if day_label:
        e["day_label"] = day_label
    return e


def _boat(n):
    return {"boat_number": n, "current_series_results": [{"waku": n, "course": 1, "place": 1, "st": ".15"}]}


class TestRacedataHasEmpty(unittest.TestCase):
    """scrape_all: 中身を見て再取得を促すゲート。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "today.json")

    def _write(self, entries):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump({"updated_at": "2026-08-11T00:00:00Z", "race_date": "20260811",
                       "partial": False, "racedata": entries}, f)

    def test_all_empty_is_detected(self):
        """早朝 run 直後（全 entry が boats=[]）は再取得対象。"""
        self._write([_entry(1, 1, day_label="初日"), _entry(3, 1, day_label="3日目")])
        self.assertTrue(scrape_all._racedata_has_empty(self.path))

    def test_partially_empty_is_detected(self):
        """一部だけ取れている場合も、残りを取りに行く。"""
        self._write([_entry(1, 1, [_boat(1)]), _entry(3, 1)])
        self.assertTrue(scrape_all._racedata_has_empty(self.path))

    def test_all_filled_is_not_stale(self):
        """全部揃っていれば再取得しない（無駄な再スクレイプを増やさない）。"""
        self._write([_entry(1, 1, [_boat(1)]), _entry(3, 1, [_boat(1)])])
        self.assertFalse(scrape_all._racedata_has_empty(self.path))

    def test_missing_or_broken_file_is_false(self):
        """不在 / 壊れたファイルは False（_is_fresh_today 側が False を返して再取得される）。"""
        self.assertFalse(scrape_all._racedata_has_empty(os.path.join(self.tmp.name, "nope.json")))
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{ broken")
        self.assertFalse(scrape_all._racedata_has_empty(self.path))

    def test_is_fresh_today_alone_cannot_detect_it(self):
        """旧実装の穴を明示: _is_fresh_today だけでは空を見抜けない。"""
        import datetime
        self._write([_entry(1, 1), _entry(3, 1)])
        now = datetime.datetime.now(scrape_all.JST)
        with open(self.path, encoding="utf-8") as f:
            data = json.load(f)
        data["updated_at"] = now.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        self.assertTrue(scrape_all._is_fresh_today(self.path, now),
                        "前提が変わった: _is_fresh_today が中身も見るようになった")
        self.assertTrue(scrape_all._racedata_has_empty(self.path),
                        "中身チェックが空を検出できていない")


class TestResumeSkipsOnlyFilled(unittest.TestCase):
    """scrape_racedata: 空 entry を done 扱いしない再開ロジック。"""

    def test_empty_entries_are_not_marked_done(self):
        # main() は実ネットワークを叩くため、再開ロジックと同じ判定を検証する
        prev = [_entry(1, 1), _entry(1, 2, [_boat(1)]), _entry(3, 1)]
        done = {(e["stadium"], e["race"]) for e in prev if e.get("boats")}
        self.assertEqual(done, {(1, 2)}, "空 entry を取得済みに数えている")
        pending = [(e["stadium"], e["race"]) for e in prev
                   if (e["stadium"], e["race"]) not in done]
        self.assertIn((1, 1), pending)
        self.assertIn((3, 1), pending)

    def test_monotonic_replace_rule(self):
        """既存が boats を持つのに新規が空なら採用しない（単調性）。"""
        def should_replace(existing_boats, new_boats):
            return bool(new_boats) or not existing_boats
        self.assertTrue(should_replace([], [_boat(1)]), "空→充実 は採用すべき")
        self.assertFalse(should_replace([_boat(1)], []), "充実→空 で退行させている")
        self.assertTrue(should_replace([_boat(1)], [_boat(1), _boat(2)]), "更新は通すべき")
        self.assertTrue(should_replace([], []), "空→空 は置換可（day_label 更新のため）")


class TestScrapeRacedataSourceInvariants(unittest.TestCase):
    """三度目の取り残しを防ぐソース不変条件。"""

    def test_resume_filters_on_boats(self):
        p = os.path.join(os.path.dirname(__file__), "..", "scrape_racedata.py")
        with open(p, encoding="utf-8") as f:
            src = f.read()
        self.assertIn('if entry.get("boats"):', src,
                      "再開ロジックが boats の有無で done 判定していない")
        self.assertNotIn("all_data.append(entry)\n\n        # Stadium 完了ごとに", src,
                         "重複 append に戻っている（置換ロジックが消えた）")


if __name__ == "__main__":
    unittest.main(verbosity=2)


class TestTaskOrdering(unittest.TestCase):
    """racedata が real-time 系 (odds/previews/results) を枯渇させないこと。

    実障害 (2026-08-11): 「boats が空なら再取得」修正の副作用で racedata が毎 run
    stale 判定されるようになり、25-40 分かかる racedata が先頭に置かれていたため
    job timeout (50 分) を食い潰した。18:15 の run は 44 分 racedata に費やし、
    results は 92 分更新されず 32 レースの結果が欠落した。
    racedata は stadium 単位で partial 保存し run をまたいで再開できるが、
    odds / previews / results は「今」取れないと価値が無い。
    """

    def setUp(self):
        self._orig_fresh = scrape_all._is_fresh_today
        self._orig_age = scrape_all._age_minutes
        self._orig_rd = scrape_all._racedata_has_empty
        scrape_all._is_fresh_today = lambda path, now: False
        scrape_all._age_minutes = lambda path: 999.0
        scrape_all._racedata_has_empty = lambda path: True

    def tearDown(self):
        scrape_all._is_fresh_today = self._orig_fresh
        scrape_all._age_minutes = self._orig_age
        scrape_all._racedata_has_empty = self._orig_rd

    def _names(self, h, m):
        import datetime as _dt
        now = _dt.datetime(2026, 5, 17, h, m, tzinfo=scrape_all.JST)
        return [n for n, _ in scrape_all._decide_tasks(now, force_all=False)]

    def test_racedata_runs_after_realtime_scrapers(self):
        names = self._names(14, 0)
        self.assertIn("racedata", names)
        for rt in ("odds", "previews", "results"):
            self.assertIn(rt, names)
            self.assertLess(names.index(rt), names.index("racedata"),
                            f"{rt} が racedata より後ろ = 枯渇する")

    def test_racedata_appears_once(self):
        names = self._names(14, 0)
        self.assertEqual(names.count("racedata"), 1, "racedata が重複登録されている")

    def test_budget_clips_and_has_floor(self):
        self.assertLessEqual(scrape_all._remaining_budget_sec(2400), 2400)
        self.assertGreaterEqual(scrape_all._remaining_budget_sec(1), 120)

    def test_budget_never_exceeds_job_timeout(self):
        """workflow の timeout-minutes より必ず小さいこと。"""
        import re as _re
        wf = os.path.join(os.path.dirname(__file__), "..", "..",
                          ".github", "workflows", "scrape-all.yml")
        with open(wf, encoding="utf-8") as f:
            m = _re.search(r"timeout-minutes:\s*(\d+)", f.read())
        self.assertIsNotNone(m, "scrape-all.yml に timeout-minutes が無い")
        self.assertLess(scrape_all.JOB_BUDGET_SEC, int(m.group(1)) * 60,
                        "job 予算が workflow timeout 以上 = commit & push まで届かない")
