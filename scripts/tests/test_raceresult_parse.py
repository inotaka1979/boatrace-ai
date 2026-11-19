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


# 2026-11-20: 登録番号・進入コース・ST・決まり手を実際に読む（従来は決まり手を常に 1 = 逃げ、
#   進入 = 枠番、登録番号と ST は None にしていた）。fixture は boatrace.jp 2026-11-19 桐生 12R。
_FIXTURE_START = os.path.join(os.path.dirname(__file__), "fixtures", "raceresult_start_info.html")


class TestRaceresultStartInfo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(_FIXTURE_START, encoding="utf-8") as f:
            cls.html = f.read()
        cls.r = SR.parse_raceresult(cls.html, 1, 12)
        cls.by = {b["racer_boat_number"]: b for b in cls.r["boats"]}

    def test_racer_numbers(self):
        self.assertEqual(self.by[1]["racer_number"], 4471)
        self.assertEqual(self.by[6]["racer_number"], 5004)
        self.assertEqual(self.by[1]["racer_name"], "新田　　泰章")

    def test_start_timing(self):
        self.assertAlmostEqual(self.by[1]["racer_start_timing"], 0.13)
        self.assertAlmostEqual(self.by[5]["racer_start_timing"], 0.16)

    def test_technique_from_page(self):
        self.assertEqual(self.r["race_technique_name"], "逃げ")
        self.assertEqual(self.r["race_technique_number"], 1)
        self.assertEqual(self.r["_parse_v"], 2)
        self.assertNotIn("technique_unknown", self.r)

    def test_technique_other_than_nige(self):
        html = self.html.replace('<td class="is-fs16">逃げ</td>', '<td class="is-fs16">まくり差し</td>')
        r = SR.parse_raceresult(html, 1, 12)
        self.assertEqual(r["race_technique_number"], 4, "従来は常に 1 (逃げ) だった")

    def test_course_follows_start_order(self):
        # 前付け: 2 号艇が 1 コース、1 号艇が 2 コースに入った形にスタート情報の行を入れ替える
        a = '<span class="table1_boatImage1Number is-type1">1</span>'
        b = '<span class="table1_boatImage1Number is-type2">2</span>'
        html = self.html.replace(a, "@@A@@").replace(b, a).replace("@@A@@", b)
        r = SR.parse_raceresult(html, 1, 12)
        by = {x["racer_boat_number"]: x for x in r["boats"]}
        self.assertEqual(by[2]["racer_course_number"], 1)
        self.assertEqual(by[1]["racer_course_number"], 2)

    def test_unknown_technique_is_flagged(self):
        html = self.html.replace('<td class="is-fs16">逃げ</td>', '<td class="is-fs16"></td>')
        r = SR.parse_raceresult(html, 1, 12)
        self.assertEqual(r["race_technique_number"], 1, "確定の目印としては残す")
        self.assertTrue(r.get("technique_unknown"))

    def test_parse_st_variants(self):
        self.assertEqual(SR._parse_st(".13"), (0.13, None))
        self.assertEqual(SR._parse_st("F.01"), (-0.01, "F"))
        self.assertEqual(SR._parse_st("L"), (None, "L"))
        self.assertEqual(SR._parse_st(".08 まくり"), (0.08, None))
        self.assertEqual(SR._parse_st(""), (None, None))
