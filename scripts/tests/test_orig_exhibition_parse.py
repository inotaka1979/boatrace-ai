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


_KIRYU_EMPTY = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'kiryu_cyokuzen_R03_empty.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_KIRYU_EMPTY),
                     'bs4 or sample HTML missing')
class TestKiryuCyokuzenEmpty(unittest.TestCase):
    """桐生型(ajax_cyokuzen)の展示前レスポンス: テーブルは在るが時刻は無い。

    展示前は誤データを出さず、時刻 0.0 / _has_times False になることを固定する。
    """

    @classmethod
    def setUpClass(cls):
        with open(_KIRYU_EMPTY, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_kiryu_cyokuzen(f.read(), 1, 3)

    def test_table_found_six_boats(self):
        # 半周/まわり足/直線 のヘッダを持つ表を見つけ、6 艇を返す
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 1)
        self.assertEqual(self.race['race_number'], 3)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat_numbers(self):
        wakus = [b['racer_boat_number'] for b in self.race['boats']]
        self.assertEqual(wakus, [1, 2, 3, 4, 5, 6])

    def test_no_times_before_exhibition(self):
        # 展示前(col5-7 = 「表示するデータがありません」)は全時刻 0.0
        for b in self.race['boats']:
            self.assertEqual(b['lap_time'], 0.0, b)
            self.assertEqual(b['turn_time'], 0.0, b)
            self.assertEqual(b['straight_time'], 0.0, b)

    def test_has_times_false(self):
        # 誤データを出さない: 展示前は _has_times False → 出力に含めない
        self.assertFalse(S._has_times(self.race))


_TODA_XML = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'toda_original_R01.xml'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_TODA_XML),
                     'deps or sample XML missing')
class TestTodaOriginal(unittest.TestCase):
    """戸田型(race_table_original.xml)パーサの回帰テスト。

    採取済み 2026-06-28 戸田 1R XML で teiban/ttime/rnd/cnr/str の抽出と
    一周/まわり足/直線 への対応(値域)を固定する。
    """

    @classmethod
    def setUpClass(cls):
        with open(_TODA_XML, 'rb') as f:
            cls.race = S.parse_toda_original(f.read(), 2, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 2)
        self.assertEqual(self.race['race_number'], 1)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.78)     # ttime
        self.assertEqual(b['lap_time'], 37.20)   # rnd=一周
        self.assertEqual(b['turn_time'], 5.85)   # cnr=まわり足
        self.assertEqual(b['straight_time'], 6.93)  # str=直線

    def test_value_ranges_confirm_mapping(self):
        for b in self.race['boats']:
            self.assertTrue(6.0 <= b['ex_time'] <= 8.0, b)        # 展示
            self.assertTrue(34.0 <= b['lap_time'] <= 40.0, b)     # 一周
            self.assertTrue(4.5 <= b['turn_time'] <= 8.0, b)      # まわり足
            self.assertTrue(6.0 <= b['straight_time'] <= 8.0, b)  # 直線

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


_GAMA = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'gamagori_recomend_R01.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_GAMA),
                     'bs4 or sample HTML missing')
class TestGamagoriRecomend(unittest.TestCase):
    """蒲郡型(recomend 予想紙htm)パーサの回帰テスト。

    採取済み 2026-06-28 蒲郡 1R 周回テーブルで 展示/一周/まわり足/直線 を固定。
    """

    @classmethod
    def setUpClass(cls):
        with open(_GAMA, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_gamagori_recomend(f.read(), 7, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 7)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.69)
        self.assertEqual(b['lap_time'], 37.57)   # 一周
        self.assertEqual(b['turn_time'], 5.17)   # まわり足
        self.assertEqual(b['straight_time'], 6.36)  # 直線

    def test_value_ranges(self):
        for b in self.race['boats']:
            self.assertTrue(34.0 <= b['lap_time'] <= 40.0, b)    # 一周
            self.assertTrue(4.5 <= b['turn_time'] <= 8.0, b)     # まわり足

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


if __name__ == '__main__':
    unittest.main()
