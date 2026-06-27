"""programs_source.load_local_official_programs の回帰テスト。

公式移行 Phase 2: previews/results/racedata がローカル公式 programs を読む際の
「JST当日・非空のときのみ採用、別日/欠落/空は None で openapi フォールバック」を固定する。
wrong-day バグ(別日のページをスクレイプ)再発防止が目的。

実行: python3 -m unittest scripts.tests.test_programs_source
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from programs_source import load_local_official_programs  # noqa: E402

_JST = timezone(timedelta(hours=9))


def _today_iso() -> str:
    return datetime.now(_JST).strftime('%Y-%m-%d')


def _write(tmp: str, obj) -> str:
    p = os.path.join(tmp, 'today.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(obj, f)
    return p


class TestLoadOfficialPrograms(unittest.TestCase):
    def test_fresh_today_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = _write(tmp, {
                'race_date': _today_iso(),
                'programs': [{'race_stadium_number': 1, 'race_number': 1,
                              'race_date': _today_iso()}],
            })
            d = load_local_official_programs(p)
            self.assertIsNotNone(d)
            self.assertEqual(len(d['programs']), 1)

    def test_stale_yesterday_rejected(self):
        y = (datetime.now(_JST) - timedelta(days=1)).strftime('%Y-%m-%d')
        with tempfile.TemporaryDirectory() as tmp:
            p = _write(tmp, {'race_date': y, 'programs': [{'race_number': 1}]})
            self.assertIsNone(load_local_official_programs(p))

    def test_empty_programs_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = _write(tmp, {'race_date': _today_iso(), 'programs': []})
            self.assertIsNone(load_local_official_programs(p))

    def test_missing_file_returns_none(self):
        self.assertIsNone(load_local_official_programs('/nonexistent/today.json'))

    def test_broken_json_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, 'today.json')
            with open(p, 'w', encoding='utf-8') as f:
                f.write('{not json')
            self.assertIsNone(load_local_official_programs(p))

    def test_no_race_date_falls_back_to_first_program(self):
        # トップレベル race_date 欠落でも programs[0].race_date が当日なら採用
        with tempfile.TemporaryDirectory() as tmp:
            p = _write(tmp, {'programs': [{'race_number': 1, 'race_date': _today_iso()}]})
            self.assertIsNotNone(load_local_official_programs(p))


if __name__ == '__main__':
    unittest.main()
