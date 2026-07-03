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


_TSU = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'tsu_sttenji_R01.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_TSU),
                     'bs4 or sample HTML missing')
class TestTsuSttenji(unittest.TestCase):
    """津型(ajax_yosou だが req=sttenji=展示情報 にオリジナル展示)の回帰テスト。

    津は req=cyokuzen が直前情報(展示評価)で、オリジナル展示は別タブ sttenji。
    表は col4-7=展示タイム/一周/まわり足/直線 のヘッダ駆動形式で
    parse_naruto_cyokuzen でそのまま解析できることを固定する。
    """

    @classmethod
    def setUpClass(cls):
        with open(_TSU, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_naruto_cyokuzen(f.read(), 9, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 9)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.85)       # col4 展示タイム
        self.assertEqual(b['lap_time'], 38.10)     # col5 一周
        self.assertEqual(b['turn_time'], 4.54)     # col6 まわり足
        self.assertEqual(b['straight_time'], 8.57)  # col7 直線

    def test_value_ranges(self):
        for b in self.race['boats']:
            self.assertTrue(6.0 <= b['ex_time'] <= 8.0, b)
            self.assertTrue(34.0 <= b['lap_time'] <= 40.0, b)
            self.assertTrue(4.0 <= b['turn_time'] <= 8.0, b)

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


_TOKUYAMA = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'tokuyama_cyokuzen_R01.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_TOKUYAMA),
                     'bs4 or sample HTML missing')
class TestTokuyamaCyokuzen(unittest.TestCase):
    """徳山型(ajax_yosou だが直線列なし=展示/一周/まわり足のみ)の回帰テスト。

    直線を必須にしていたため徳山が弾かれていた不具合の修正を固定する。
    """

    @classmethod
    def setUpClass(cls):
        with open(_TOKUYAMA, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_naruto_cyokuzen(f.read(), 18, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 18)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_no_straight(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.85)      # 展示タイム
        self.assertEqual(b['lap_time'], 37.14)    # 一周
        self.assertEqual(b['turn_time'], 11.50)   # まわり足
        self.assertEqual(b['straight_time'], 0.0)  # 直線列なし → 0

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


_BIWAKO = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'biwako_cyokuzen_kind2_R01.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_BIWAKO),
                     'bs4 or sample HTML missing')
class TestBiwakoModules(unittest.TestCase):
    """びわこ型(独自CMS modules/yosou/cyokuzen.php?kind=2)の回帰テスト。

    表は col5-8=展示/一周/まわり足/直線 のヘッダ駆動形式で、ajax_yosou と同じ
    parse_naruto_cyokuzen で解析できることを固定する。
    """

    @classmethod
    def setUpClass(cls):
        with open(_BIWAKO, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_naruto_cyokuzen(f.read(), 11, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 11)
        self.assertEqual(self.race['race_number'], 1)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.78)       # col5 展示
        self.assertEqual(b['lap_time'], 37.82)     # col6 一周
        self.assertEqual(b['turn_time'], 5.85)     # col7 まわり足
        self.assertEqual(b['straight_time'], 8.07)  # col8 直線

    def test_value_ranges(self):
        for b in self.race['boats']:
            self.assertTrue(6.0 <= b['ex_time'] <= 8.0, b)
            self.assertTrue(34.0 <= b['lap_time'] <= 40.0, b)
            self.assertTrue(4.5 <= b['turn_time'] <= 8.0, b)
            self.assertTrue(7.0 <= b['straight_time'] <= 9.0, b)

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


_KIRYU_REAL = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'kiryu_ajax_R08.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_KIRYU_REAL),
                     'bs4 or sample HTML missing')
class TestKiryuCyokuzenReal(unittest.TestCase):
    """桐生(実 ajax_cyokuzen 応答)の回帰テスト。

    現行は col4=展示/col5=半周/col6=まわり足/col7=直線(ラベルは画像)。
    parse_kiryu_cyokuzen の col4 後ろ3セルフォールバックで解析できることを固定。
    桐生は「一周」でなく半周を lap_time に格納する。
    """

    @classmethod
    def setUpClass(cls):
        with open(_KIRYU_REAL, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_kiryu_cyokuzen(f.read(), 1, 8)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 1)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.83)       # col4 展示
        self.assertEqual(b['lap_time'], 18.34)     # col5 半周
        self.assertEqual(b['turn_time'], 4.73)     # col6 まわり足
        self.assertEqual(b['straight_time'], 7.43)  # col7 直線

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


_KARATSU = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'karatsu_yosou_cyokuzen_R01.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_KARATSU),
                     'bs4 or sample HTML missing')
class TestKaratsuYosouCyokuzen(unittest.TestCase):
    """唐津(yosou-cyokuzen フルページ)の回帰テスト。

    唐津は ajax_cyokuzen.php が 404 で、同ベンダーの表を含むフルページ
    /sp/index.php?page=yosou-cyokuzen&race=N から取得する(probe 2026-07-02)。
    本体セルが col5-1/col5-2/col5-3 の主経路で解析できることを固定
    (桐生実データは col4 後ろ3セルのフォールバック経路のみカバー)。
    """

    @classmethod
    def setUpClass(cls):
        with open(_KARATSU, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_kiryu_cyokuzen(f.read(), 23, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 23)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.75)        # col4 展示
        self.assertEqual(b['lap_time'], 36.95)      # col5-1 一周
        self.assertEqual(b['turn_time'], 5.62)      # col5-2 まわり足
        self.assertEqual(b['straight_time'], 7.31)  # col5-3 直線

    def test_all_boats_primary_path(self):
        laps = [b['lap_time'] for b in self.race['boats']]
        self.assertEqual(laps, [36.95, 37.20, 37.41, 36.88, 37.60, 37.33])

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


_KOJIMA = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'kojima_yoso0501.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_KOJIMA),
                     'bs4 or sample HTML missing')
class TestKojimaYoso(unittest.TestCase):
    """児島(実 kyogi yoso0501.htm、probe 2026-07-03 採取)の回帰テスト。

    住之江と同じ kyogi 配信だがヘッダ 2 行 + 位置ベース 7 セルの変種のため
    parse_kojima_yoso で解析する。住之江パーサでは None になる(=フォールバック
    順序が効いている)ことも固定する。
    """

    @classmethod
    def setUpClass(cls):
        with open(_KOJIMA, encoding='utf-8', errors='replace') as f:
            cls.html = f.read()
        cls.race = S.parse_kojima_yoso(cls.html, 16, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 16)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.81)        # 位置3 展示タイム
        self.assertEqual(b['lap_time'], 37.13)      # 位置4 一周
        self.assertEqual(b['turn_time'], 6.00)      # 位置5 まわり足
        self.assertEqual(b['straight_time'], 6.67)  # 位置6 直線

    def test_all_boats(self):
        laps = [b['lap_time'] for b in self.race['boats']]
        self.assertEqual(laps, [37.13, 36.77, 37.37, 37.0, 37.17, 36.93])

    def test_suminoe_parser_returns_none(self):
        # 2 行ヘッダのため住之江パーサは None → scrape 側のフォールバックが児島を拾う
        self.assertIsNone(S.parse_suminoe_yoso(self.html, 16, 1))

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


_SUMINOE = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'suminoe_yoso0505.htm'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_SUMINOE),
                     'bs4 or sample HTML missing')
class TestSuminoeYoso(unittest.TestCase):
    """住之江型(yoso05RR=直前情報予想)の回帰テスト。

    時刻列 th が全て col10・枠セルが waku01.. で col 駆動が効かないため、
    ヘッダ並び順に基づく位置ベースの parse_suminoe_yoso で解析する(直線列なし)。
    """

    @classmethod
    def setUpClass(cls):
        with open(_SUMINOE, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_suminoe_yoso(f.read(), 12, 5)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 12)
        self.assertEqual(self.race['race_number'], 5)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.87)       # 展示
        self.assertEqual(b['lap_time'], 37.55)     # 一周
        self.assertEqual(b['turn_time'], 11.55)    # まわり足
        self.assertEqual(b['straight_time'], 0.0)  # 直線列なし

    def test_all_boats(self):
        laps = [b['lap_time'] for b in self.race['boats']]
        self.assertEqual(laps, [37.55, 37.56, 38.05, 37.33, 38.64, 38.28])

    def test_start_timing(self):
        # スタート展示 ST(dl dt/dd.boatN)。boat2 は F.03=フライング(負)。
        st = {b['racer_boat_number']: b.get('st_time') for b in self.race['boats']}
        self.assertEqual(st[1], 0.10)
        self.assertEqual(st[2], -0.03)
        self.assertEqual(st[4], 0.01)

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


_OMURA = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'omura_syussou_R_sample.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_OMURA),
                     'bs4 or sample HTML missing')
class TestOmura(unittest.TestCase):
    """大村型(omurakyotei.jp 出走表ページ内 直前展示表)の回帰テスト。

    位置ベース: 枠/ST/展示タイム/一周/まわり足/直線/チルト、枠=waku{N}。
    ST も同表から取得(st_time)。
    """

    @classmethod
    def setUpClass(cls):
        with open(_OMURA, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_omura(f.read(), 24, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 24)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.93)
        self.assertEqual(b['lap_time'], 37.40)
        self.assertEqual(b['turn_time'], 6.47)
        self.assertEqual(b['straight_time'], 7.30)
        self.assertEqual(b['st_time'], 0.39)

    def test_all_st(self):
        st = [b.get('st_time') for b in self.race['boats']]
        self.assertEqual(st, [0.39, 0.14, 0.17, 0.07, 0.05, 0.23])

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


_MIYA_REAL = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'miyajima_reload_part7_R01.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_MIYA_REAL),
                     'bs4 or sample HTML missing')
class TestMiyajimaReloadReal(unittest.TestCase):
    """宮島(実 kaisai_reload 応答 part[7])の回帰テスト。

    実データは 枠/選手名/体重/チルト/展示/一周/まわり足/直線 の位置ベース表
    (td に col クラス無し、枠は先頭セルの 1-6)。parse_miyajima_shukai が
    ヘッダ位置駆動でこれを解析できることを固定する(旧 dt[8]→全文検索の修正を担保)。
    """

    @classmethod
    def setUpClass(cls):
        with open(_MIYA_REAL, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_miyajima_shukai(f.read(), 17, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 17)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1_values(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.71)
        self.assertEqual(b['lap_time'], 37.13)
        self.assertEqual(b['turn_time'], 5.48)
        self.assertEqual(b['straight_time'], 7.19)

    def test_all_laps(self):
        laps = [b['lap_time'] for b in self.race['boats']]
        self.assertEqual(laps, [37.13, 37.76, 38.06, 37.73, 37.76, 37.47])

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


_MIYA = os.path.join(
    os.path.dirname(__file__), 'fixtures', 'miyajima_shukai_synthetic.html'
)


@unittest.skipUnless(_HAVE_DEPS and os.path.exists(_MIYA),
                     'bs4 or sample HTML missing')
class TestMiyajimaShukai(unittest.TestCase):
    """宮島型(kaisai_reload dt[8])ヘッダ駆動パーサのロジック固定。

    合成 fixture(枠/展示/一周/まわり足/直線 の標準的な表)でヘッダ位置駆動の
    抽出を検証。実 dt[8] 構造は宮島開催日に最終確認する。
    """

    @classmethod
    def setUpClass(cls):
        with open(_MIYA, encoding='utf-8', errors='replace') as f:
            cls.race = S.parse_miyajima_shukai(f.read(), 17, 1)

    def test_shape(self):
        self.assertIsNotNone(self.race)
        self.assertEqual(self.race['race_stadium_number'], 17)
        self.assertEqual(len(self.race['boats']), 6)

    def test_boat1(self):
        b = self.race['boats'][0]
        self.assertEqual(b['racer_boat_number'], 1)
        self.assertEqual(b['ex_time'], 6.70)
        self.assertEqual(b['lap_time'], 37.50)
        self.assertEqual(b['turn_time'], 5.20)
        self.assertEqual(b['straight_time'], 6.40)

    def test_header_driven_columns(self):
        wakus = [b['racer_boat_number'] for b in self.race['boats']]
        self.assertEqual(wakus, [1, 2, 3, 4, 5, 6])
        for b in self.race['boats']:
            self.assertTrue(34.0 <= b['lap_time'] <= 40.0, b)

    def test_has_times(self):
        self.assertTrue(S._has_times(self.race))


if __name__ == '__main__':
    unittest.main()
