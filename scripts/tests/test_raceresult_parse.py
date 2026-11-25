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


# 2026-11-26: 着順の付かなかった艇（落水・転覆・F・欠場 など）を out_boats に残す。
#   選手ごとの出走ログから、F や転覆のレースが抜け落ちていた。フィクスチャは 2026-11-20 宮島 5R の実ページ
#   （3 号艇 落水・4 号艇 転覆）。
_FIXTURE_OUT = os.path.join(os.path.dirname(__file__), "fixtures", "raceresult_nonfinishers.html")


@unittest.skipUnless(_HAVE_DEPS, "bs4 missing")
class TestRaceresultNonFinishers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(_FIXTURE_OUT, encoding="utf-8") as f:
            cls.html = f.read()
        cls.r = SR.parse_raceresult(cls.html, 17, 5, "20261120")
        cls.out = {b["racer_boat_number"]: b for b in cls.r.get("out_boats", [])}

    def test_placed_boats_are_unchanged(self):
        # boats は「着順のある艇」のまま（既存の利用側の前提を変えない）
        self.assertEqual([(b["racer_boat_number"], b["racer_place_number"]) for b in self.r["boats"]],
                         [(5, 1), (2, 2), (1, 3), (6, 4)])
        self.assertTrue(all(1 <= b["racer_place_number"] <= 6 for b in self.r["boats"]))
        self.assertEqual(self.r["race_technique_name"], "差し")
        self.assertEqual(self.r["_parse_v"], SR.RESULT_PARSE_VERSION)

    def test_boats_without_a_place_are_recorded_separately(self):
        self.assertEqual(sorted(self.out), [3, 4])
        self.assertEqual(self.out[3]["racer_out"], "落")
        self.assertEqual(self.out[4]["racer_out"], "転")
        self.assertEqual(self.out[3]["racer_number"], 3602)
        self.assertEqual(self.out[4]["racer_number"], 5106)
        self.assertEqual(self.out[3]["racer_name"].replace("　", ""), "奥平拓也")

    def test_they_get_course_and_start_timing_from_the_start_table(self):
        self.assertEqual((self.out[3]["racer_course_number"], self.out[3]["racer_start_timing"]), (3, 0.33))
        self.assertEqual((self.out[4]["racer_course_number"], self.out[4]["racer_start_timing"]), (4, 0.35))
        by = {b["racer_boat_number"]: b for b in self.r["boats"]}
        self.assertEqual((by[5]["racer_course_number"], by[5]["racer_start_timing"]), (5, 0.29))

    def test_flying_start_is_normalised_and_marked(self):
        # 全角の Ｆ と、スタート情報の F.01
        html = self.html.replace('<td class="is-fs14">落</td>', '<td class="is-fs14">Ｆ</td>')
        html = html.replace('<span class="table1_boatImage1TimeInner ">.33', '<span class="table1_boatImage1TimeInner ">F.01')
        r = SR.parse_raceresult(html, 17, 5, "20261120")
        b = {x["racer_boat_number"]: x for x in r["out_boats"]}[3]
        self.assertEqual(b["racer_out"], "F")
        self.assertEqual(b["racer_start_timing"], -0.01)
        self.assertEqual(b["racer_start_kind"], "F")

    def test_other_labels(self):
        for raw, want in (("Ｌ", "L"), ("失", "失"), ("欠", "欠"), ("妨", "妨"), ("エ", "エ"), ("不", "不"), ("沈", "沈"), ("L", "L")):
            html = self.html.replace('<td class="is-fs14">落</td>', f'<td class="is-fs14">{raw}</td>')
            r = SR.parse_raceresult(html, 17, 5, "20261120")
            self.assertEqual({x["racer_boat_number"]: x for x in r["out_boats"]}[3]["racer_out"], want, raw)

    def test_out_label_rules(self):
        self.assertEqual(SR._out_label("Ｆ"), "F")
        self.assertEqual(SR._out_label(" 転 "), "転")
        self.assertEqual(SR._out_label("没"), "没", "知らない表記でも 1 文字の漢字は拾う")
        for no in ("", None, "１", "3", "単勝", "複勝", "3連単", "ab", "X", "－－"):
            self.assertIsNone(SR._out_label(no), repr(no))

    def test_payout_rows_are_not_mistaken_for_boats(self):
        # 払戻の表にも「見出し / 艇番 / 金額」の行がある（単勝・複勝）。登録番号が無い行は艇として拾わない
        self.assertTrue(all(b.get("racer_number") for b in self.r["out_boats"]))
        self.assertEqual(len(self.r["boats"]) + len(self.r["out_boats"]), 6)
        self.assertTrue(self.r["payouts"]["win"], "単勝の払戻は払戻として読めている")
        html = self.html.replace('<td class="is-fs14">落</td>', '<td class="is-fs14">単勝</td>')
        r = SR.parse_raceresult(html, 17, 5, "20261120")
        self.assertEqual(sorted(b["racer_boat_number"] for b in r.get("out_boats", [])), [4])

    def test_row_without_a_registration_number_is_not_a_boat(self):
        # 表記と艇番があっても、登録番号の読めない行は艇として記録しない（解析は止めない）
        html = self.html.replace('<span class="is-fs12">5106</span>', '<span class="is-fs12"></span>')
        self.assertNotEqual(html, self.html)
        r = SR.parse_raceresult(html, 17, 5, "20261120")
        self.assertEqual(sorted(b["racer_boat_number"] for b in r["out_boats"]), [3])
        self.assertEqual(len(r["boats"]), 4)

    def test_no_key_when_every_boat_finished(self):
        with open(_FIXTURE_START, encoding="utf-8") as f:
            r = SR.parse_raceresult(f.read(), 1, 12)
        self.assertNotIn("out_boats", r)
        self.assertEqual(len(r["boats"]), 6)

    def test_same_boat_is_not_counted_twice(self):
        # 「着順なし」の行の艇番が、着順のある艇（5 号艇）や先に出た着順なしの艇（3 号艇）と同じでも、重ねて数えない
        for dup in (5, 3):
            html = self.html.replace('<td class="is-fs14 is-fBold is-boatColor4">4</td>',
                                     f'<td class="is-fs14 is-fBold is-boatColor4">{dup}</td>')
            self.assertNotEqual(html, self.html)
            r = SR.parse_raceresult(html, 17, 5, "20261120")
            nums = [b["racer_boat_number"] for b in r["boats"]] + [b["racer_boat_number"] for b in r.get("out_boats", [])]
            self.assertEqual(sorted(nums), [1, 2, 3, 5, 6], dup)
