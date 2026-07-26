"""P2-8: ファン手帳パーサのユニットテスト

ファン手帳は Shift-JIS 固定長レイアウトで、漢字（2 byte）を含むフィールドの
slice 位置が間違うと壊滅的なデータ破損につながる。最小限のサンプル行で
parse_fan_handbook の正常系・異常系を網羅する。

実行:
    python3 -m unittest scripts.tests.test_fan_handbook_parse
"""

from __future__ import annotations

import datetime
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from build_db import fan_handbook_urls, parse_fan_handbook  # noqa: E402


def _build_fan_record(
    toban: str = '4444',
    name: str = '高橋　二朗',
    kana: str = 'ﾀｶﾊｼ ｼﾞﾛｳ',
    branch: str = '東京',
    cls_str: str = 'B1',
    age: int = 76,
    weight: int = 50,
    win_rate_x100: int = 425,    # 4.25
    top2_rate_x10: int = 380,    # 38.0
) -> bytes:
    """ファン手帳の 1 行分を組み立てる（最小フィールドのみ厳密、残りは padding）。"""
    def b(s: str, n: int) -> bytes:
        v = s.encode('shift_jis', errors='replace')
        return v.ljust(n, b' ')[:n]

    line = b''
    line += b(toban, 4)
    line += b(name, 16)
    line += b(kana, 15)
    line += b(branch, 4)
    line += b(cls_str, 2)
    line += b(' ', 1)        # nengo
    line += b('660101', 6)   # birthday
    line += b('M', 1)        # gender
    line += b(f'{age:02d}', 2)
    line += b('170', 3)      # height
    line += b(f'{weight:02d}', 2)
    line += b('A', 2)        # blood
    line += b(f'{win_rate_x100:04d}', 4)
    line += b(f'{top2_rate_x10:04d}', 4)
    line += b('001', 3)      # first
    line += b('010', 3)      # second
    line += b('150', 3)      # total_races
    line += b('00', 2)       # yusyutsu
    line += b('00', 2)       # yusyo
    line += b('016', 3)      # avg_st = 0.16
    # course stats × 6
    for c in range(1, 7):
        line += b('025', 3)  # entries
        line += b('400', 4)  # c_top2 = 40.0
        line += b('016', 3)  # c_st = 0.16
        line += b('300', 3)  # c_st_rank
    # padding to ~416 bytes
    line += b' ' * (420 - len(line))
    return line


class TestFanHandbookParse(unittest.TestCase):
    def test_normal_record(self):
        line = _build_fan_record()
        racers = parse_fan_handbook(line + b'\n')
        self.assertIn('4444', racers)
        r = racers['4444']
        self.assertEqual(r.get('name'), '高橋　二朗')
        self.assertEqual(r.get('classNum'), 3)   # B1 -> 3
        self.assertAlmostEqual(r.get('winRate', 0), 4.25, places=2)
        self.assertAlmostEqual(r.get('top2Rate', 0), 38.0, places=1)
        self.assertEqual(r.get('age'), 76)
        # コース別 entries が6コース分そろう
        cs = r.get('courseStats', {})
        for c in range(1, 7):
            self.assertIn(str(c), cs, f'course {c} missing')
            self.assertEqual(cs[str(c)]['entries'], 25)

    def test_class_a1(self):
        line = _build_fan_record(cls_str='A1')
        r = parse_fan_handbook(line + b'\n')['4444']
        self.assertEqual(r.get('classNum'), 1)

    def test_unknown_class_falls_back_to_b2(self):
        line = _build_fan_record(cls_str='XX')
        r = parse_fan_handbook(line + b'\n')['4444']
        self.assertEqual(r.get('classNum'), 4)   # 不明 -> B2 fallback

    def test_short_line_skipped(self):
        # 200 bytes 未満は skip
        line = b'4444' + b' ' * 100
        racers = parse_fan_handbook(line + b'\n')
        self.assertNotIn('4444', racers)

    def test_non_numeric_toban_skipped(self):
        line = _build_fan_record(toban='ABCD')
        racers = parse_fan_handbook(line + b'\n')
        self.assertNotIn('ABCD', racers)

    def test_str_input_accepted(self):
        # str を渡しても bytes に encode されて parse される
        line_bytes = _build_fan_record()
        line_str = line_bytes.decode('shift_jis', errors='replace')
        r = parse_fan_handbook(line_str + '\n')
        self.assertIn('4444', r)

    def test_kanji_field_alignment(self):
        # 漢字を含むフィールド（name）の後でも、後続の数値フィールドが正しく取れる
        line = _build_fan_record(name='山田太郎', age=30)
        r = parse_fan_handbook(line + b'\n')['4444']
        self.assertEqual(r.get('age'), 30)   # ずれていれば異なる値が読まれる


class TestFanHandbookUrls(unittest.TestCase):
    """B-02: ファン手帳 URL の期を現在日付から算出する。"""

    @staticmethod
    def _dt(y: int, m: int, d: int) -> datetime.datetime:
        return datetime.datetime(y, m, d)

    def test_summer_uses_current_april(self):
        # 5〜10 月は当年 4 月公表版
        urls = fan_handbook_urls(self._dt(2026, 7, 26))
        self.assertTrue(urls[0].endswith('/fan2604.lzh'), urls[0])

    def test_early_year_uses_prev_october(self):
        # 1〜4 月は前年 10 月公表版
        urls = fan_handbook_urls(self._dt(2026, 3, 15))
        self.assertTrue(urls[0].endswith('/fan2510.lzh'), urls[0])

    def test_november_uses_current_october(self):
        # 11〜12 月は当年 10 月公表版
        urls = fan_handbook_urls(self._dt(2026, 11, 2))
        self.assertTrue(urls[0].endswith('/fan2610.lzh'), urls[0])

    def test_january_crosses_year(self):
        urls = fan_handbook_urls(self._dt(2026, 1, 5))
        self.assertTrue(urls[0].endswith('/fan2510.lzh'), urls[0])

    def test_always_three_candidates_newest_first(self):
        for dt in (self._dt(2026, 7, 26), self._dt(2026, 3, 15),
                   self._dt(2026, 11, 2), self._dt(2026, 1, 5)):
            urls = fan_handbook_urls(dt)
            self.assertEqual(len(urls), 3)
            # 新しい順（fanYYMM が降順）
            tags = [u.rsplit('/fan', 1)[1].split('.')[0] for u in urls]
            self.assertEqual(tags, sorted(tags, reverse=True), tags)

    def test_all_https_kibetsu(self):
        for u in fan_handbook_urls(self._dt(2026, 7, 26)):
            self.assertTrue(u.startswith('https://'), u)
            self.assertIn('/kibetsu/', u, u)


if __name__ == '__main__':
    unittest.main(verbosity=2)
