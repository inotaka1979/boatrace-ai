"""raceresult パーサの回帰テスト (2026-07-19 markup 変更対応の固定)。

実障害: boatrace.jp が raceresult の markup を変更 (テーブル class 刷新 +
払戻券種ラベル th→td rowspan) し、旧 .table1 / th 前提のパースが全滅。
07-18 は archive 180 レース全て finished=0、Worker は openapi ミラー欠落場
(07-19 の場5) で「着順のみ・払戻なし」が数十分継続。
フィクスチャは probe の実採取 HTML (場2 戸田 1R 20260719) を縮小したもの。
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    import scrape_results as SR
    from bs4 import BeautifulSoup  # noqa: F401
    _HAVE_DEPS = True
except Exception:
    _HAVE_DEPS = False

_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "raceresult_new_markup.html")


@unittest.skipUnless(_HAVE_DEPS, "bs4 missing")
class TestRaceresultParse(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with open(_FIXTURE, encoding="utf-8") as f:
            cls.html = f.read()
        cls.r = SR.parse_raceresult(cls.html, 2, 1)

    def test_boats_all_six(self):
        self.assertEqual(len(self.r["boats"]), 6)
        by_place = {b["racer_place_number"]: b["racer_boat_number"] for b in self.r["boats"]}
        self.assertEqual(by_place, {1: 4, 2: 2, 3: 3, 4: 1, 5: 5, 6: 6})

    def test_finished(self):
        self.assertEqual(self.r["race_technique_number"], 1)

    def test_racer_name_stripped(self):
        first = [b for b in self.r["boats"] if b["racer_place_number"] == 1][0]
        # 登番 4444 は除去され氏名だけ残る
        self.assertNotIn("4444", first["racer_name"])
        self.assertIn("ヤマダ", first["racer_name"])

    def test_trifecta_new_markup(self):
        # 券種ラベルが td rowspan (旧 th ではない) でも抽出できる
        self.assertEqual(self.r["payouts"]["trifecta"],
                         [{"combination": "4-2-3", "amount": 5350}])

    def test_exacta_and_win(self):
        self.assertEqual(self.r["payouts"]["exacta"],
                         [{"combination": "4-2", "amount": 1930}])
        self.assertEqual(self.r["payouts"]["win"],
                         [{"combination": "4", "amount": 860}])

    def test_trio_dead_heat_continuation(self):
        # rowspan 継続行 (同着 2 本目、ラベル無し) が直前券種に入る
        self.assertEqual(self.r["payouts"]["trio"],
                         [{"combination": "2=3=4", "amount": 1020},
                          {"combination": "1=2=4", "amount": 980}])

    def test_nbsp_filler_rows_excluded(self):
        # &nbsp; 埋め草行が混入しない (各券種の件数が実データ数と一致)
        self.assertEqual(len(self.r["payouts"]["trifecta"]), 1)
        self.assertEqual(len(self.r["payouts"]["win"]), 1)

    def test_unfinished_page_returns_none(self):
        # 結果未掲載 (着順 tbody 無し) は technique=None で汚染しない
        r = SR.parse_raceresult("<html><body><table><tbody><tr><td>データはありません</td></tr></tbody></table></body></html>", 2, 1)
        self.assertIsNone(r["race_technique_number"])
        self.assertEqual(r["boats"], [])


if __name__ == "__main__":
    unittest.main()
