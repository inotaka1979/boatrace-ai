"""公式(boatrace.jp)出走表パーサ scrape_programs.parse_racelist_program の回帰テスト。

採取済み `data/schedule/_debug_racelist.html`（2026-06-27 桐生 1R）で全フィールドの
期待値一致を固定する。boatrace.jp の HTML 構造変更を CI で検知し、予測エンジンへ
silent に壊れた値が流れ込むのを防ぐのが目的。

bs4 が無い環境（CI gate は requirements を入れない）では skip する。

実行:
    python3 -m unittest scripts.tests.test_programs_parse
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    import scrape_programs as P  # noqa: E402
    _HAVE_DEPS = True
except Exception:  # bs4 未インストール等
    _HAVE_DEPS = False

_HTML_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'data', 'schedule', '_debug_racelist.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_HTML_PATH), 'bs4 or sample HTML missing')
class TestProgramsParse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(_HTML_PATH, encoding='utf-8') as f:
            html = f.read()
        cls.prg = P.parse_racelist_program(html, 1, 1, '20260627')

    def test_race_metadata(self):
        p = self.prg
        self.assertIsNotNone(p)
        self.assertEqual(p['race_stadium_number'], 1)
        self.assertEqual(p['race_number'], 1)
        self.assertEqual(p['race_date'], '2026-06-27')
        self.assertEqual(p['race_title'], 'サッポロビールカップ')
        self.assertEqual(p['race_grade_number'], 4)  # G3
        # 桐生(ナイター) 1R 締切 15:28
        self.assertEqual(p['race_closed_at'], '2026-06-27 15:28:00')

    def test_six_boats(self):
        self.assertEqual(len(self.prg['boats']), 6)
        wakus = [b['racer_boat_number'] for b in self.prg['boats']]
        self.assertEqual(wakus, [1, 2, 3, 4, 5, 6])

    def test_boat1_all_fields(self):
        b = self.prg['boats'][0]
        self.assertEqual(b['racer_number'], 3947)
        self.assertEqual(b['racer_name'], '寺本 昇平')
        self.assertEqual(b['racer_class_number'], 3)  # B1
        self.assertEqual(b['racer_branch_name'], '群馬')
        self.assertEqual(b['racer_birthplace'], '神奈川')
        self.assertEqual(b['racer_age'], 50)
        self.assertEqual(b['racer_weight'], 50.0)
        self.assertEqual(b['racer_flying_count'], 0)
        self.assertEqual(b['racer_late_count'], 0)
        self.assertEqual(b['racer_average_start_timing'], 0.17)
        self.assertEqual(b['racer_national_top_1_percent'], 4.36)
        self.assertEqual(b['racer_national_top_2_percent'], 15.69)
        self.assertEqual(b['racer_national_top_3_percent'], 37.25)
        self.assertEqual(b['racer_local_top_1_percent'], 5.33)
        self.assertEqual(b['racer_local_top_2_percent'], 30.95)
        self.assertEqual(b['racer_local_top_3_percent'], 52.38)
        self.assertEqual(b['racer_assigned_motor_number'], 44)
        self.assertEqual(b['racer_assigned_motor_top_2_percent'], 28.45)
        self.assertEqual(b['racer_assigned_motor_top_3_percent'], 44.83)
        self.assertEqual(b['racer_assigned_boat_number'], 43)
        self.assertEqual(b['racer_assigned_boat_top_2_percent'], 27.78)
        self.assertEqual(b['racer_assigned_boat_top_3_percent'], 42.86)

    def test_class_numbers(self):
        # 級別: 1=寺本(B1=3) ... 4=鈴木(A2=2) 5=北村(A1=1) 6=永井(A1=1)
        classes = [b['racer_class_number'] for b in self.prg['boats']]
        self.assertEqual(classes, [3, 3, 3, 2, 1, 1])

    def test_validate_passes(self):
        self.assertTrue(P._validate(self.prg))

    def test_validate_rejects_garbage(self):
        bad = {'boats': [{'racer_boat_number': 9, 'racer_number': 0,
                          'racer_national_top_1_percent': 0,
                          'racer_national_top_2_percent': 0}]}
        self.assertFalse(P._validate(bad))


if __name__ == '__main__':
    unittest.main()
