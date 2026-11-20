"""開催日タブ（何日目 / 最終日 / 中止）とレース中止の判定 (2026-11-20) の回帰テスト

  - scrape_day_labels.parse_tabs: 公式の開催日タブを日付 + ラベルに（全角数字、年またぎ）
  - summarize: 今日のラベル、最終日、中止（今日が無ければ開催していない）
  - scrape_results.parse_raceresult: 「レース中止」ページは race_cancelled、確定扱い（取り直さない）

    python3 -m unittest scripts.tests.test_day_labels -v
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import scrape_day_labels as dl  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "raceresult_cancelled.html")


def _html():
    with open(FIX, encoding="utf-8") as f:
        return f.read()


class TestTabs(unittest.TestCase):
    def test_parse(self):
        tabs = dl.parse_tabs(_html(), 2026, (11, 20))
        self.assertEqual([t["date"] for t in tabs][:2], ["20261119", "20261120"])
        self.assertEqual([t["label"] for t in tabs], ["中止", "初日", "2日目", "3日目", "4日目", "最終日"])

    def test_year_wrap(self):
        html = '<ul class="tab2_tabs"><li>12月31日<span>初日</span></li><li>1月1日<span>2日目</span></li></ul>'
        self.assertEqual([t["date"] for t in dl.parse_tabs(html, 2027, (1, 1))], ["20261231", "20270101"])
        self.assertEqual([t["date"] for t in dl.parse_tabs(html, 2026, (12, 31))], ["20261231", "20270101"])

    def test_summarize(self):
        tabs = dl.parse_tabs(_html(), 2026, (11, 20))
        s = dl.summarize(tabs, "20261119")
        self.assertTrue(s["cancelled"])
        self.assertFalse(s["final"])
        s = dl.summarize(tabs, "20261124")
        self.assertEqual(s["label"], "最終日")
        self.assertTrue(s["final"])
        self.assertFalse(dl.summarize(tabs, "20261120")["final"])
        self.assertIsNone(dl.summarize(tabs, "20261125"), "今日のタブが無い = 開催していない")

    def test_no_tabs(self):
        self.assertEqual(dl.parse_tabs("<html></html>", 2026, (11, 20)), [])


try:
    import scrape_results as SR
    from bs4 import BeautifulSoup  # noqa: F401
    _HAVE = True
except Exception:
    _HAVE = False


@unittest.skipUnless(_HAVE, "bs4 missing")
class TestRaceCancelled(unittest.TestCase):
    def test_cancelled_page(self):
        r = SR.parse_raceresult(_html(), 9, 1, "20261119")
        self.assertTrue(r["race_cancelled"])
        self.assertIsNone(r["race_technique_number"])
        self.assertEqual(r["boats"], [])
        self.assertGreaterEqual(SR._completeness(r), SR.COMPLETENESS_FULL, "中止は取り直さない")

    def test_normal_page_not_cancelled(self):
        with open(os.path.join(os.path.dirname(__file__), "fixtures", "raceresult_new_markup.html"), encoding="utf-8") as f:
            r = SR.parse_raceresult(f.read(), 2, 1, "20260719")
        self.assertNotIn("race_cancelled", r)
        self.assertIsNotNone(r["race_technique_number"])


if __name__ == "__main__":
    unittest.main()
