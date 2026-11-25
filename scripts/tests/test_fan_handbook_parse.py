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
import build_db  # noqa: E402
from build_db import fan_handbook_urls, parse_fan_handbook, parse_fan_handbook_ext  # noqa: E402


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


def _build_full_record(
    toban: str = '4320',
    name: str = '峰　　　　竜　太',
    nengo: str = 'S',
    birth: str = '600330',       # 昭和 60 年 3 月 30 日
    sex: str = '1',
    height: str = '171',
    blood: str = 'B ',
    first: int = 47,
    second: int = 22,
    yusyutsu: int = 10,
    yusyo: int = 2,
    classes: tuple = ('A1', 'A1', 'A2'),
    prev_ability: int = 7700,
    cur_ability: int = 7500,
    year: str = '2027',
    half: str = '1',
    d_from: str = '20260501',
    d_to: str = '20261031',
    ki: int = 95,
    flks: tuple = ((1, 0, 0, 0, 0, 0, 0, 0),) + ((0, 0, 0, 0, 0, 0, 0, 0),) * 5,   # コース別 F L0 L1 K0 K1 S0 S1 S2
    no_course: tuple = (0, 0, 0, 0),   # コースなし L0 L1 K0 K1
    birthplace: str = '佐　賀',
) -> bytes:
    """ファン手帳の 1 行（416 bytes）を、公表レイアウトどおりに組み立てる。"""
    def b(s: str, n: int) -> bytes:
        v = s.encode('shift_jis', errors='replace')
        assert len(v) <= n, (s, n)
        return v.ljust(n, b' ')

    line = b(toban, 4) + b(name, 16) + b('ﾐﾈ ﾘｭｳﾀ', 15) + b('佐賀', 4) + b('A1', 2)
    line += b(nengo, 1) + b(birth, 6) + b(sex, 1) + b('41', 2) + b(height, 3) + b('52', 2) + b(blood, 2)
    line += b('0885', 4) + b('0633', 4) + b(f'{first:03d}', 3) + b(f'{second:03d}', 3) + b('109', 3)
    line += b(f'{yusyutsu:02d}', 2) + b(f'{yusyo:02d}', 2) + b('012', 3)
    for _ in range(6):
        line += b('020', 3) + b('0500', 4) + b('013', 3) + b('270', 3)
    assert len(line) == 160, len(line)
    for c in classes:
        line += b(c, 2)
    line += b(f'{prev_ability:04d}', 4) + b(f'{cur_ability:04d}', 4)
    line += b(year, 4) + b(half, 1) + b(d_from, 8) + b(d_to, 8) + b(f'{ki:03d}', 3)
    assert len(line) == 198, len(line)
    for c in range(6):
        line += b''.join(b(f'{n:03d}', 3) for n in (5, 4, 3, 2, 1, 0))
        line += b''.join(b(f'{n:02d}', 2) for n in flks[c])
    assert len(line) == 402, len(line)
    line += b''.join(b(f'{n:02d}', 2) for n in no_course)
    line += b(birthplace, 6)
    assert len(line) == 416, len(line)
    return line


class TestFanHandbookExt(unittest.TestCase):
    """2026-11-25: 選手ページ用の追加項目（parse_fan_handbook が読み飛ばしている欄）。"""

    def test_all_fields(self):
        out = parse_fan_handbook_ext(_build_full_record() + b'\r\n')
        self.assertEqual(out['term'], {'year': 2027, 'half': 1, 'from': '2026-05-01', 'to': '2026-10-31'})
        self.assertEqual(out['racers']['4320'], {
            'b': '1985-03-30', 's': 1, 'h': 171, 'bl': 'B', 'bp': '佐賀', 'ki': 95,
            'w': [47, 22], 'y': [10, 2], 'pc': [1, 1, 2], 'ab': [75.0, 77.0], 'fl': [1, 0, 0, 0],
        })

    def test_same_record_feeds_both_parsers(self):
        # 同じ行を既存パーサも読める（レイアウトの解釈が食い違っていない）
        line = _build_full_record() + b'\n'
        base = parse_fan_handbook(line)['4320']
        self.assertEqual((base['classNum'], base['age'], base['weight'], base['totalRaces']), (1, 41, 52, 109))
        self.assertAlmostEqual(base['winRate'], 8.85)
        self.assertEqual(base['courseStats']['1']['places'], [5, 4, 3, 2, 1, 0])
        self.assertNotIn('b', base)   # 追加項目は racerDB.json に混ぜない

    def test_japanese_era_to_gregorian(self):
        for nengo, ymd, want in (('S', '240426', '1949-04-26'), ('H', '010108', '1989-01-08'),
                                 ('H', '210924', '2009-09-24'), ('R', '020501', '2020-05-01')):
            r = parse_fan_handbook_ext(_build_full_record(nengo=nengo, birth=ymd))['racers']['4320']
            self.assertEqual(r.get('b'), want, (nengo, ymd))

    def test_unreadable_values_are_omitted_not_guessed(self):
        r = parse_fan_handbook_ext(_build_full_record(
            nengo='X', birth='600330', sex='9', height='000', blood='??', classes=('A1', 'XX', '  '),
            prev_ability=0, cur_ability=0, ki=0, birthplace='      ',
        ))['racers']['4320']
        for key in ('b', 's', 'h', 'bl', 'bp', 'ki', 'ab'):
            self.assertNotIn(key, r, key)
        self.assertEqual(r['pc'], [1, 0, 0])
        bad_date = parse_fan_handbook_ext(_build_full_record(birth='601340'))['racers']['4320']
        self.assertNotIn('b', bad_date)   # 13 月 40 日

    def test_fl_counts_sum_all_courses_and_no_course(self):
        flks = (
            (1, 0, 1, 0, 0, 0, 0, 0),   # 1 コース: F1, L1(責任) 1
            (0, 1, 0, 1, 1, 0, 0, 0),   # 2 コース: L0 1, K0 1, K1 1
            (1, 0, 0, 0, 0, 1, 1, 1),   # 3 コース: F1, S0 S1 S2 各 1
        ) + ((0,) * 8,) * 3
        r = parse_fan_handbook_ext(_build_full_record(flks=flks, no_course=(1, 0, 0, 2)))['racers']['4320']
        self.assertEqual(r['fl'], [2, 3, 4, 3])   # F=2, L=1+1+1, K=1+1+2, S=3

    def test_kanji_name_does_not_shift_later_fields(self):
        r = parse_fan_handbook_ext(_build_full_record(name='堀之内　　紀代子', ki=83, birthplace='岡　山'))['racers']['4320']
        self.assertEqual((r['ki'], r['bp'], r['h']), (83, '岡山', 171))

    def test_short_or_non_numeric_lines_are_skipped(self):
        raw = b'4320' + b' ' * 300 + b'\n' + _build_full_record(toban='ABCD') + b'\n' + _build_full_record(toban='5001') + b'\n'
        out = parse_fan_handbook_ext(raw)
        self.assertEqual(list(out['racers']), ['5001'])

    def test_term_is_the_majority_and_none_when_unreadable(self):
        raw = b'\n'.join([
            _build_full_record(toban='5001'), _build_full_record(toban='5002'),
            _build_full_record(toban='5003', d_from='20251101', d_to='20260430', year='2026', half='2'),
        ])
        self.assertEqual(parse_fan_handbook_ext(raw)['term']['from'], '2026-05-01')
        none = parse_fan_handbook_ext(_build_full_record(d_from='        ', d_to='        '))
        self.assertIsNone(none['term'])
        self.assertEqual(parse_fan_handbook_ext(b'')['racers'], {})


class TestBuildDbWritesExtFile(unittest.TestCase):
    """main(): racer_ext.json を別ファイルに書き、racerDB.json には追加項目を混ぜない。"""

    def _run_main(self, fan_bytes, tmp):
        import json
        saved = (build_db.download, build_db.extract_lzh_bytes, build_db.OUTPUT_RACER, build_db.OUTPUT_STADIUM,
                 build_db.OUTPUT_RACER_EXT, sys.argv)
        build_db.download = lambda url: b'lzh'
        build_db.extract_lzh_bytes = lambda data: fan_bytes
        build_db.OUTPUT_RACER = os.path.join(tmp, 'db', 'racerDB.json')
        build_db.OUTPUT_STADIUM = os.path.join(tmp, 'db', 'stadiumDB.json')
        build_db.OUTPUT_RACER_EXT = os.path.join(tmp, 'db', 'racer_ext.json')
        sys.argv = ['build_db.py']
        try:
            rc = build_db.main()
        finally:
            (build_db.download, build_db.extract_lzh_bytes, build_db.OUTPUT_RACER, build_db.OUTPUT_STADIUM,
             build_db.OUTPUT_RACER_EXT, sys.argv) = saved

        def load(name):
            path = os.path.join(tmp, 'db', name)
            if not os.path.exists(path):
                return None
            with open(path, encoding='utf-8') as f:
                return json.load(f)
        return rc, load('racerDB.json'), load('racer_ext.json')

    def test_writes_ext_separately(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            raw = _build_full_record(toban='4320') + b'\n' + _build_full_record(toban='5001', ki=120) + b'\n'
            rc, db, ext = self._run_main(raw, tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(sorted(ext['racers']), ['4320', '5001'])
        self.assertEqual(ext['racers']['5001']['ki'], 120)
        self.assertEqual(ext['term']['to'], '2026-10-31')
        self.assertRegex(ext['source'], r'^fan\d{4}$')
        self.assertTrue(ext['updated_at'])
        # racerDB.json の形は従来どおり（起動のたびに読むファイルを太らせない）
        self.assertEqual(sorted(db['racers']['4320']), sorted([
            'name', 'kana', 'branch', 'classNum', 'age', 'weight', 'winRate', 'top2Rate', 'avgST',
            'totalRaces', 'courseStats', 'recentResults']))

    def test_keeps_existing_ext_when_nothing_parsed(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, 'db'))
            with open(os.path.join(tmp, 'db', 'racer_ext.json'), 'w', encoding='utf-8') as f:
                f.write('{"racers": {"1": {"ki": 1}}}')
            # 既存パーサは読めるが（200 bytes 以上）、追加項目の欄まで届かない短い行
            rc, db, ext = self._run_main(_build_fan_record()[:300] + b'\n', tmp)
        self.assertEqual(rc, 0)
        self.assertIn('4444', db['racers'])
        self.assertEqual(ext, {'racers': {'1': {'ki': 1}}})   # 空で上書きしない


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
