"""スクレイパのデータ破壊経路 回帰テスト（2026-08-11 追加）

監査で見つかった 3 つの不可逆なデータ損失に対するガードを固定する。

1. scrape_results: 全 fetch 失敗 / 部分 run が当日の確定結果を上書きしていた
   （本ファイル冒頭に「168/168 read timeout」の実障害記録あり）。
2. build_db: ファン手帳取得失敗時に {"racers": {}} を書いて commit していた。
3. scrape_odds: 日跨ぎガードが無く前日オッズを今日として保持していた
   （実測: 本日非開催 10 場 120 レース分が残存）。

    python3 -m unittest scripts.tests.test_scraper_dataloss
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import scrape_results as sr  # noqa: E402


def _race(sid, rno, date="2026-08-11", finished=True, boats=True, payout=True):
    return {
        "race_stadium_number": sid,
        "race_number": rno,
        "race_date": date,
        "race_technique_number": 1 if finished else None,
        "boats": [{"racer_boat_number": 1, "racer_place_number": 1}] if boats else [],
        "payouts": {"trifecta": [{"combination": "1-2-3", "amount": 500}]} if payout else {},
    }


class TestResultsMonotonicMerge(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "today.json")

    def _write(self, results):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump({"results": results}, f)

    def test_total_failure_does_not_wipe_existing(self):
        """全 fetch 失敗 (fresh=[]) でも既存の確定結果が残る。"""
        self._write([_race(1, 1), _race(1, 2)])
        merged = sr._merge_with_existing(self.path, [], "20260811")
        self.assertEqual(len(merged), 2)
        self.assertTrue(all(r["race_technique_number"] for r in merged))

    def test_partial_run_does_not_shrink(self):
        """部分 run (1 レースのみ) が 12 レース分の既存を subset で上書きしない。"""
        self._write([_race(1, n) for n in range(1, 13)])
        merged = sr._merge_with_existing(self.path, [_race(1, 1)], "20260811")
        self.assertEqual(len(merged), 12)

    def test_unfinished_does_not_overwrite_finished(self):
        """未確定の新データが確定済みの既存を上書きしない。"""
        self._write([_race(2, 5, finished=True)])
        merged = sr._merge_with_existing(
            self.path, [_race(2, 5, finished=False, boats=False, payout=False)], "20260811")
        self.assertEqual(len(merged), 1)
        self.assertTrue(merged[0]["race_technique_number"], "確定済みが未確定で潰された")

    def test_finished_replaces_unfinished(self):
        """確定した新データは未確定の既存を正しく置き換える（前進は妨げない）。"""
        self._write([_race(2, 5, finished=False, boats=False, payout=False)])
        merged = sr._merge_with_existing(self.path, [_race(2, 5, finished=True)], "20260811")
        self.assertTrue(merged[0]["race_technique_number"])

    def test_previous_day_entries_are_dropped(self):
        """前日のエントリは持ち越さない。"""
        self._write([_race(3, 1, date="2026-08-10")])
        merged = sr._merge_with_existing(self.path, [_race(3, 2)], "20260811")
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["race_number"], 2)

    def test_missing_file_is_not_fatal(self):
        merged = sr._merge_with_existing(
            os.path.join(self.tmp.name, "nope.json"), [_race(1, 1)], "20260811")
        self.assertEqual(len(merged), 1)

    def test_count_finished(self):
        self._write([_race(1, 1), _race(1, 2, finished=False)])
        self.assertEqual(sr._count_finished(self.path), 1)
        self.assertEqual(sr._count_finished(os.path.join(self.tmp.name, "nope.json")), 0)


class TestCompleteness(unittest.TestCase):
    def test_ordering(self):
        finished = sr._completeness(_race(1, 1))
        no_payout = sr._completeness(_race(1, 1, payout=False))
        unfinished = sr._completeness(_race(1, 1, finished=False, boats=False, payout=False))
        self.assertGreater(finished, no_payout)
        self.assertGreater(no_payout, unfinished)
        self.assertEqual(sr._completeness(None), -1)


class TestBuildDbGuard(unittest.TestCase):
    def test_aborts_before_writing_empty_racer_db(self):
        """ファン手帳が 1 件も取れないとき、既存 racerDB を上書きせず exit 5。"""
        import build_db  # noqa: PLC0415
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(tmp.name)
        os.makedirs("data/db")
        sentinel = {"updated_at": "x", "racers": {"4001": {"name": "既存", "classNum": 1}}}
        with open("data/db/racerDB.json", "w", encoding="utf-8") as f:
            json.dump(sentinel, f)
        # 全 URL 取得失敗を再現
        orig = build_db.download
        build_db.download = lambda url: (_ for _ in ()).throw(OSError("network down"))
        self.addCleanup(setattr, build_db, "download", orig)
        rc = build_db.main()
        self.assertEqual(rc, 5, "空 racerDB でも 0 を返している")
        with open("data/db/racerDB.json", encoding="utf-8") as f:
            self.assertEqual(json.load(f), sentinel, "既存 racerDB が破壊された")


if __name__ == "__main__":
    unittest.main(verbosity=2)
