"""鳴門オリジナル展示パーサ scrape_orig_exhibition.parse_naruto_cyokuzen の回帰テスト。

採取済み data/_debug/naruto_cyokuzen_03.html(2026-06-28 鳴門 3R)で
一周/まわり足/直線/展示タイムの抽出を固定する。bs4 が無い環境では skip。

実行: python3 -m unittest scripts.tests.test_orig_exhibition_parse
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    import scrape_orig_exhibition as S  # noqa: E402
    _HAVE_DEPS = True
except Exception:
    _HAVE_DEPS = False

_HTML = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'naruto_cyokuzen_03.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_HTML), 'bs4 or sample HTML missing')
class TestNarutoCyokuzen(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(_HTML, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_naruto_cyokuzen(f.read(), 14, 3)

    def test_race_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 14)
        self.assertEqual(self.race['race_number'], 3)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_times(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.79)
        self.assertEqual(b['lap_time'], 35.97)
        self.assertEqual(b['turn_time'], 5.50)
        self.assertEqual(b['straight_time'], 6.93)

    def test_header_driven_columns(self):
        # 鳴門は 展示=col4/一周=col5/まわり足=col6/直線=col7。値の妥当域で列対応の正しさを確認。
        for b in self.race['boats']:
            self.assertTrue(6.0 <= b['ex_time'] <= 8.0, b)       # 展示(直線150m)
            self.assertTrue(34.0 <= b['lap_time'] <= 40.0, b)    # 一周
            self.assertTrue(4.5 <= b['turn_time'] <= 8.0, b)     # まわり足

    def test_all_boats_lap_times(self):
        laps = [b['lap_time'] for b in self.race['boats']]
        self.assertEqual(laps, [35.97, 36.67, 36.90, 36.83, 37.34, 36.82])

    def test_turn_times(self):
        turns = [b['turn_time'] for b in self.race['boats']]
        self.assertEqual(turns, [5.50, 5.57, 5.50, 5.63, 6.36, 6.29])

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


if __name__ == '__main__':
    unittest.main()
