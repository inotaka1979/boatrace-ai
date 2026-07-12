"""月間日程パーサの回帰テスト (2026-07-12 実障害の修正固定)。

実障害: 公式16場開催に対し schedule/programs が11場。原因は2つ:
  1. 日付軸を「月初を含む週の月曜始まり」と仮定 → 実ページは土曜始まり等で
     全日付が +2 日ズレ、節の記録範囲から本日が外れて欠落(多摩川/平和島/江戸川)
  2. GRADE_MAP 未対応クラス(Takumi/Venus/Rookie)の節が丸ごと脱落(三国/びわこ)

修正: ヘッダ先頭日('27土'→27)アンカーの実カレンダー張り付け + 未知
is-gradeColor* も開催として拾うフォールバック。
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    import scrape_schedule as S
    _HAVE_DEPS = True
except Exception:
    _HAVE_DEPS = False


_HTML = """
<table class="is-spritedNone1">
<tr><th>ボートレース</th><th>27土</th><th>28日</th><th>29月</th><th>30火</th>
<th>1水</th><th>2木</th><th>3金</th><th>4土</th></tr>
<tr><th><a href="/owpc/pc/race/monthlyschedule?jcd=10&ym=202607">三国</a></th>
<td class=""></td>
<td class="is-gradeColorTakumi" colspan="3">マスターズリーグ</td>
<td class=""></td>
<td class="is-gradeColorNewGrade" colspan="2">未知グレード杯</td>
<td class=""></td>
</tr>
<tr><th><a href="/owpc/pc/race/monthlyschedule?jcd=11&ym=202607">びわこ</a></th>
<td class="is-gradeColorVenus" colspan="2">ヴィーナス</td>
<td class=""></td><td class=""></td><td class=""></td>
<td class="is-gradeColorIppan" colspan="3">一般戦</td>
</tr>
</table>
"""


@unittest.skipUnless(_HAVE_DEPS, 'bs4 missing')
class TestScheduleAxis(unittest.TestCase):

    def setUp(self):
        self.r = S.parse_schedule_html(_HTML, 2026, 7)

    def test_header_anchored_dates(self):
        # ヘッダ '27土' → 前月 6/27 起点。Takumi 節 = 6/28-30 (旧実装は +2 ズレ)
        self.assertEqual(
            self.r["stadium_dates"]["10"][:3],
            ["2026-06-28", "2026-06-29", "2026-06-30"])

    def test_takumi_and_venus_captured(self):
        grades = {e["grade"] for e in self.r["events"]}
        self.assertIn("マスターズ", grades)   # 三国が欠落していた原因
        self.assertIn("ヴィーナス", grades)   # びわこが欠落していた原因

    def test_unknown_grade_fallback(self):
        # 未知の is-gradeColor* も開催として拾う(将来グレードで再発させない)
        ev = [e for e in self.r["events"] if e["grade"] == "NewGrade"]
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0]["dates"], ["2026-07-02", "2026-07-03"])

    def test_month_boundary(self):
        # びわこ Venus = 6/27-28、一般 = 7/2-4 (月跨ぎが正しく解決される)
        self.assertEqual(self.r["stadium_dates"]["11"],
                         ["2026-06-27", "2026-06-28",
                          "2026-07-02", "2026-07-03", "2026-07-04"])

    def test_fallback_axis_without_header(self):
        # ヘッダ日付が読めない場合は旧ロジック(月曜仮定)に落ちる
        axis = S._build_date_axis(2026, 7, 5, None)
        self.assertEqual(axis[0], "2026-06-29")
        axis2 = S._build_date_axis(2026, 7, 5, "ボートレース")  # 数字なし
        self.assertEqual(axis2[0], "2026-06-29")

    def test_january_prev_month_rollover(self):
        # 1 月ページが前年 12 月末始まりのケース
        axis = S._build_date_axis(2026, 1, 5, "29月")
        self.assertEqual(axis[0], "2025-12-29")


if __name__ == "__main__":
    unittest.main()
