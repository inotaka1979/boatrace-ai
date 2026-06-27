#!/usr/bin/env python3
"""rt-fix3: scrape_racedata._extract_day_label の回帰テスト。

出走表(racelist)タブから「◯日目」(初日 / N日目 / 最終日) を取り出せること。
boatrace.jp 実HTML構造（is-active2 タブ）に基づく最小スニペットで検証。
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
try:
    from bs4 import BeautifulSoup
    import scrape_racedata as S

    _HAVE_DEPS = True
except Exception:  # bs4 等 未導入環境 (CI で requirements 未install) では skip
    _HAVE_DEPS = False

TAB = (
    '<ul class="tab2">'
    '<li><a href="?hd=20260625">6月25日<span>初日</span></a></li>'
    '<li><a href="?hd=20260626">6月26日<span>２日目</span></a></li>'
    '<li class="is-active2"><span class="tab2_inner">6月27日<span>{label}</span></span></li>'
    '<li><span class="tab2_inner">6月28日<span>４日目</span></span></li>'
    '<li><span class="tab2_inner">6月30日<span>最終日</span></span></li>'
    "</ul>"
)


def _label(active_label):
    soup = BeautifulSoup(TAB.format(label=active_label), "html.parser")
    return S._extract_day_label(soup)


@unittest.skipUnless(_HAVE_DEPS, "beautifulsoup4 未導入のため skip")
class TestDayLabel(unittest.TestCase):
    def test_n_day_fullwidth(self):
        self.assertEqual(_label("３日目"), "3日目")

    def test_first_day(self):
        self.assertEqual(_label("初日"), "初日")

    def test_last_day(self):
        self.assertEqual(_label("最終日"), "最終日")

    def test_two_digit(self):
        self.assertEqual(_label("１２日目"), "12日目")

    def test_no_active_returns_none(self):
        soup = BeautifulSoup("<ul><li>6月27日</li></ul>", "html.parser")
        self.assertIsNone(S._extract_day_label(soup))


if __name__ == "__main__":
    unittest.main(verbosity=2)
