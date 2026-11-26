"""翌日の出走の取得 (scripts/scrape_tomorrow.py、2026-11-26) の回帰テスト

  - parse_raceindex: 公式の場別レース一覧 1 ページから 12 レース × 6 艇（登録番号・名前・級・締切時刻）
    フィクスチャは 2026-11-26 常滑の実ページから、開催日タブとレース一覧の表だけを抜き出したもの
  - 公開前（「データがありません」）の場は pending に残す。公開済みなのに読めないページは別に数える
  - 取れていた場を、取り直しの失敗・公開前の応答で消さない（同じ日付のあいだ）
  - 1 件ずつ・間隔を空ける・403 が続いたら止める・内部期限で止めても取れた分は書く

    python3 -m unittest scripts.tests.test_scrape_tomorrow -v
"""

from __future__ import annotations

import contextlib
import datetime
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import scrape_tomorrow as st  # noqa: E402
import source_health  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures")
with open(os.path.join(FIX, "raceindex_tokoname.html"), encoding="utf-8") as _f:
    PAGE = _f.read()
# 出走表の公開前（開催する場）: 開催日タブの下に「※ データはありません。」
with open(os.path.join(FIX, "raceindex_notyet.html"), encoding="utf-8") as _f:
    NOTYET = _f.read()
# その日に開催が無い場: 見出しが「データがありません。」
with open(os.path.join(FIX, "raceindex_noseries.html"), encoding="utf-8") as _f:
    NOSERIES = _f.read()
UNREADABLE = "<html><body><h2>レース一覧</h2><table><tbody><tr><td>形が変わった</td></tr></tbody></table></body></html>"

# 11/25 19:00 JST → 翌日は 11/26（フィクスチャの日付）
NOW = datetime.datetime(2026, 11, 25, 19, 0, tzinfo=st.JST)
VENUES = [3, 5, 8, 10, 11, 12, 15]


def _schedule(sids, day="2026-11-26"):
    return {"stadium_dates": {str(s): ["2026-11-20", day] for s in sids}}


class _Site:
    """場ごとに応答を決められる取得元。時計を進めるだけで実際には待たない。"""

    def __init__(self, pages=None, sec=0.3, default=(200, PAGE)):
        self.pages = pages or {}
        self.sec = sec
        self.default = default
        self.now = 1000.0
        self.urls = []
        self.starts = []

    def monotonic(self):
        return self.now

    def sleep(self, s):
        self.now += max(0.0, s)

    def fetch(self, url, timeout=15):
        self.starts.append(self.now)
        self.urls.append(url)
        self.now += self.sec
        sid = int(url.split("jcd=")[1][:2])
        return self.pages.get(sid, self.default)

    def sids(self):
        return [int(u.split("jcd=")[1][:2]) for u in self.urls]


def _run(d, site, now=NOW, **kw):
    with contextlib.ExitStack() as es:
        es.enter_context(mock.patch.object(st, "fetch_once", side_effect=site.fetch))
        es.enter_context(mock.patch.object(st.time, "monotonic", side_effect=site.monotonic))
        es.enter_context(mock.patch.object(st.time, "sleep", side_effect=site.sleep))
        return st.run(data_dir=d, now=now, **kw)


def _setup(d, sids=VENUES, day="2026-11-26"):
    os.makedirs(os.path.join(d, "schedule"), exist_ok=True)
    with open(os.path.join(d, "schedule", "current.json"), "w", encoding="utf-8") as f:
        json.dump(_schedule(sids, day), f)


def _out(d):
    with open(os.path.join(d, "schedule", "tomorrow.json"), encoding="utf-8") as f:
        return json.load(f)


def _status(d):
    with open(os.path.join(d, "_status.json"), encoding="utf-8") as f:
        return json.load(f)


class TestParse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.races = st.parse_raceindex(PAGE)

    def test_twelve_races_with_six_boats_each(self):
        self.assertEqual([r["r"] for r in self.races], list(range(1, 13)))
        self.assertTrue(all(len(r["b"]) == 6 for r in self.races))
        self.assertTrue(all([b[0] for b in r["b"]] == [1, 2, 3, 4, 5, 6] for r in self.races))

    def test_deadline_time(self):
        self.assertEqual(self.races[0]["t"], "10:27")
        self.assertEqual(self.races[5]["t"], "12:43")
        self.assertEqual(self.races[11]["t"], "16:10")

    def test_racer_number_name_and_class(self):
        self.assertEqual(self.races[0]["b"][0], [1, 3618, "海野 ゆかり", 1])
        self.assertEqual(self.races[0]["b"][3], [4, 5045, "平川 香織", 2], "A2")
        self.assertEqual(self.races[5]["b"][4], [5, 4320, "峰 竜太", 1])
        for r in self.races:
            for b in r["b"]:
                self.assertRegex(str(b[1]), r"^\d{4}$")
                self.assertNotIn("\u3000", b[2], "全角空白は残さない")
                self.assertNotIn("  ", b[2])
                self.assertIn(b[3], (1, 2, 3, 4))

    def test_not_yet_published_page_has_no_races(self):
        # 2026-11-26 の初日、公開前の 5 場が「読めないページ」と数えられた（文言が「データはありません」で、
        # 「データがありません」しか見ていなかった）。実ページの形を固定する。
        for name, page in (("公開前", NOTYET), ("開催なし", NOSERIES)):
            self.assertEqual(st.parse_raceindex(page), [], name)
            self.assertTrue(st.is_not_published(page), name)
        self.assertIn("※ データはありません。", NOTYET)
        self.assertNotIn("データがありません", NOTYET)
        self.assertIn("データがありません。", NOSERIES)

    def test_not_yet_published_is_read_from_a_heading_only(self):
        ok = ("<h3 class='title12_title is-type1'>※ データはありません。</h3>",
              "<h3>\n  ※ データはありません。\n</h3>",
              "<h3>データはありません</h3>",
              "<h2 class='heading1_title'><span class='heading1_mainLabel'>データがありません。</span></h2>",
              "<h2>\n<span>\n データがありません。</span></h2>")
        for h in ok:
            self.assertTrue(st.is_not_published("<html><body>" + h + "</body></html>"), h)
        # 公開済みのページ・形の変わったページ・見出し以外の同じ文言は「公開前」ではない
        ng = (PAGE, UNREADABLE, "", None, "<p>※ データはありません。</p>", "<li><a href='#'>本日のデータはありません</a></li>",
              "<h3>レース一覧</h3><div>データはありません</div>", "<h3>出走表</h3>")
        for h in ng:
            self.assertFalse(st.is_not_published(h), repr(h)[:60])
        # 見出しの先頭が別の文なら違う
        self.assertFalse(st.is_not_published("<h3>お知らせ: データはありません</h3>"))

    def test_day_label_is_readable_before_the_races_are_published(self):
        # 公開前のページにも開催日タブはある（当日のタブはリンクではない）
        now = datetime.datetime(2026, 11, 27, 18, 0, tzinfo=st.JST)
        self.assertEqual(st._label_for(NOTYET, datetime.date(2026, 11, 28), now), "5日目")
        self.assertEqual(st._label_for(NOTYET, datetime.date(2026, 11, 29), now), "最終日")

    def test_garbage_does_not_raise(self):
        for bad in ("", None, "<html>", UNREADABLE, "<tbody><tr><td><a href='racelist?rno=99'>99R</a></td></tr></tbody>",
                    "<tbody><tr><td><a href='/x/racelist?rno=1&jcd=08'>1R</a></td><td>10:00</td></tr></tbody>"):
            self.assertEqual(st.parse_raceindex(bad), [], repr(bad)[:40])

    def test_missing_boat_keeps_the_frame_numbers_of_the_others(self):
        # 3 号艇が欠けた 5 艇立て: 4〜6 号艇の枠番がずれないこと
        html = PAGE.replace('<a href="/owpc/pc/data/racersearch/profile?toban=4050&amp;hd=20261126">田口　　節子</a>', "")
        self.assertNotEqual(html, PAGE)
        r1 = st.parse_raceindex(html)[0]
        self.assertEqual([b[0] for b in r1["b"]], [1, 2, 4, 5, 6])
        self.assertEqual(r1["b"][2], [4, 5045, "平川 香織", 2])

    def test_same_race_twice_uses_the_first(self):
        i = PAGE.index("<tbody>")
        j = PAGE.index("</tbody>", i) + len("</tbody>")
        dup = PAGE[:j] + PAGE[i:j].replace("toban=3618", "toban=9999") + PAGE[j:]
        races = st.parse_raceindex(dup)
        self.assertEqual(len(races), 12)
        self.assertEqual(races[0]["b"][0][1], 3618)

    def test_unreadable_time_and_class_are_left_empty(self):
        html = PAGE.replace("<td>10:27</td>", "<td>未定</td>").replace('<div class="is-fColor1 is-fs12">A1</div>', '<div class="is-fs12">？</div>', 1)
        r1 = st.parse_raceindex(html)[0]
        self.assertEqual(r1["t"], "")
        self.assertEqual(r1["b"][0], [1, 3618, "海野 ゆかり", 0])
        self.assertEqual(st.parse_raceindex(PAGE.replace("<td>10:27</td>", "<td>25:99</td>"))[0]["t"], "")

    def test_day_label_from_the_tabs(self):
        self.assertEqual(st._label_for(PAGE, datetime.date(2026, 11, 26), NOW), "3日目")
        self.assertEqual(st._label_for(PAGE, datetime.date(2026, 11, 29), NOW), "最終日")
        self.assertEqual(st._label_for(PAGE, datetime.date(2026, 12, 5), NOW), "")
        self.assertEqual(st._label_for("<html>", datetime.date(2026, 11, 26), NOW), "")


class TestSchedule(unittest.TestCase):
    def test_stadiums_on_a_day(self):
        sch = {"stadium_dates": {"1": ["2026-11-27"], "8": ["2026-11-26", "2026-11-27"], "12": ["2026-11-26"],
                                 "99": ["2026-11-27"], "x": ["2026-11-27"], "3": "2026-11-27"}}
        self.assertEqual(st.stadiums_on(sch, datetime.date(2026, 11, 27)), [1, 8])
        for bad in (None, {}, {"stadium_dates": []}, []):
            self.assertEqual(st.stadiums_on(bad, datetime.date(2026, 11, 27)), [])

    def test_tomorrow_is_the_next_day_in_japan_time(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, [8], day="2026-11-27")
            # 11/26 23:30 JST（UTC ではまだ 11/26 14:30）→ 翌日は 11/27
            site = _Site()
            s = _run(d, site, now=datetime.datetime(2026, 11, 26, 23, 30, tzinfo=st.JST))
            self.assertEqual(s["date"], "20261127")
            self.assertIn("hd=20261127", site.urls[0])
            # 同じ瞬間を UTC で渡しても同じ日付にはならない（呼ぶ側は JST を渡す）ことを固定しておく
            self.assertEqual(_out(d)["date"], "20261127")

    def test_no_schedule_or_no_stadium_does_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            site = _Site()
            s = _run(d, site)
            self.assertEqual((s["expected"], s["attempted"]), (0, 0))
            self.assertFalse(os.path.exists(os.path.join(d, "schedule", "tomorrow.json")))
            _setup(d, VENUES, day="2026-12-31")
            _run(d, site)
            self.assertEqual(site.urls, [])


class TestRun(unittest.TestCase):
    def test_all_published(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            site = _Site()
            s = _run(d, site)
            out = _out(d)
            self.assertEqual(out["date"], "20261126")
            self.assertEqual(sorted(out["stadiums"], key=int), [str(x) for x in VENUES])
            self.assertEqual(out["pending"], [])
            self.assertEqual(out["stadiums"]["8"]["label"], "3日目")
            self.assertEqual(len(out["stadiums"]["8"]["races"]), 12)
            self.assertRegex(out["updated_at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
            self.assertEqual((s["expected"], s["attempted"], s["published"], s["pending"], s["unreadable"]), (7, 7, 7, 0, 0))
            self.assertEqual(site.sids(), VENUES, "場番号の順に 1 ページずつ")
            self.assertTrue(all("raceindex?jcd=" in u and u.endswith("hd=20261126") for u in site.urls))
            t = _status(d)["tasks"]["tomorrow"]
            self.assertEqual((t["attempted"], t["updated"], t["published"], t["ok"]), (7, 7, 7, 7))

    def test_not_yet_published_venues_are_pending_and_not_a_problem(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            s = _run(d, _Site(pages={5: (200, NOTYET), 12: (200, NOSERIES)}))
            out = _out(d)
            self.assertEqual(out["pending"], [5, 12])
            self.assertNotIn("5", out["stadiums"])
            self.assertEqual((s["published"], s["pending"], s["unreadable"]), (5, 2, 0))
            # 公開前の場も「読めたページ」に数える（初日は 14 場中 5 場が公開前で updated が 9 になっていた）
            t = _status(d)["tasks"]["tomorrow"]
            self.assertEqual((t["attempted"], t["updated"], t["published"]), (7, 7, 5))
            # 全場が公開前でも「取れていない」とは扱わない（夕方の早い時刻には普通に起きる）
            _run(d, _Site(default=(200, NOTYET)))
            st_ = _status(d)
            self.assertEqual((st_["tasks"]["tomorrow"]["attempted"], st_["tasks"]["tomorrow"]["updated"]), (7, 7))
            v = source_health.evaluate(st_, datetime.datetime.now(datetime.timezone.utc))
            self.assertEqual(v["state"], "ok")

    def test_unreadable_pages_are_counted_and_raise_the_alarm_when_all_fail(self):
        # 公開済みに見える（「データがありません」ではない）のに 1 レースも読めない = ページの形が変わった
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            s = _run(d, _Site(default=(200, UNREADABLE)))
            self.assertEqual((s["published"], s["unreadable"], s["pending"]), (0, 7, 7))
            st_ = _status(d)
            self.assertEqual((st_["tasks"]["tomorrow"]["attempted"], st_["tasks"]["tomorrow"]["updated"]), (7, 0))
            v = source_health.evaluate(st_, datetime.datetime.now(datetime.timezone.utc))
            self.assertEqual(v["state"], "problem")
            self.assertIn("tomorrow", v["lines"][0])

    def test_an_error_response_is_not_counted_as_not_yet_published(self):
        # 200 以外の応答は、本文に「データはありません」があっても「読めたページ」に数えない
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            s = _run(d, _Site(default=(404, NOTYET)))
            self.assertEqual((s["published"], s["pending"], s["unreadable"]), (0, 7, 0))
            t = _status(d)["tasks"]["tomorrow"]
            self.assertEqual((t["attempted"], t["updated"], t["ok"]), (7, 0, 0))

    def test_keeps_a_venue_already_fetched_when_the_refetch_fails(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            _run(d, _Site())
            first = _out(d)
            for bad in ((500, None), ("exc:TimeoutError", None), (200, NOTYET), (200, UNREADABLE), (200, "")):
                _run(d, _Site(pages={8: bad}))
                out = _out(d)
                self.assertEqual(out["stadiums"]["8"], first["stadiums"]["8"], repr(bad)[:30])
                self.assertEqual(out["pending"], [])

    def test_refetch_updates_a_venue(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            _run(d, _Site())
            changed = PAGE.replace("toban=3618", "toban=4444")
            s = _run(d, _Site(pages={8: (200, changed)}))
            self.assertTrue(s["written"])
            self.assertEqual(_out(d)["stadiums"]["8"]["races"][0]["b"][0][1], 4444)
            self.assertEqual(_out(d)["stadiums"]["3"]["races"][0]["b"][0][1], 3618)

    def test_old_file_of_another_date_is_not_carried_over(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            _run(d, _Site())
            # 翌日: 開催する場が変わり、まだ公開前
            _setup(d, [8, 20], day="2026-11-27")
            s = _run(d, _Site(default=(200, NOTYET)), now=NOW + datetime.timedelta(days=1))
            out = _out(d)
            self.assertEqual((out["date"], out["stadiums"], out["pending"]), ("20261127", {}, [8, 20]))
            self.assertEqual(s["published"], 0)

    def test_unchanged_content_is_not_rewritten(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            self.assertTrue(_run(d, _Site())["written"])
            p = os.path.join(d, "schedule", "tomorrow.json")
            before = (os.stat(p).st_mtime_ns, _out(d)["updated_at"])
            self.assertFalse(_run(d, _Site())["written"])
            self.assertEqual((os.stat(p).st_mtime_ns, _out(d)["updated_at"]), before)

    def test_stops_when_blocked(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, list(range(1, 15)))
            site = _Site(default=(403, None))
            s = _run(d, site)
            self.assertTrue(s["blocked"])
            self.assertEqual(len(site.urls), st.SourceBlockDetector().threshold, "ブロック検知後もリクエストした")
            self.assertEqual(len(_out(d)["pending"]), 14)
            self.assertTrue(_status(d)["source_blocked"])

    def test_stops_at_the_deadline_and_writes_what_it_has(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, list(range(1, 15)))
            site = _Site(sec=9.5)
            s = _run(d, site, budget_sec=60)
            # 0 / 9.5 / … / 57 秒に 7 件。期限（60 秒）の後は送らない
            self.assertEqual(len(site.urls), 7)
            out = _out(d)
            self.assertEqual(sorted(out["stadiums"], key=int), [str(i) for i in range(1, 8)])
            self.assertEqual(out["pending"], list(range(8, 15)))
            self.assertEqual(s["attempted"], 7)
            self.assertEqual(_status(d)["tasks"]["tomorrow"]["avg_ms"], 9500, "遅かったことが記録に残る")

    def test_default_budget_covers_a_full_day_at_ten_seconds_per_page(self):
        # 開催は多い日で 18 場。1 ページ 10 秒でも内部期限に収まること
        self.assertGreaterEqual(st.BUDGET_SEC, 18 * 10)
        with tempfile.TemporaryDirectory() as d:
            _setup(d, list(range(1, 19)))
            site = _Site(sec=10.0)
            s = _run(d, site)
            self.assertEqual((s["published"], s["pending"]), (18, 0))

    def test_one_request_at_a_time_with_the_interval(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d)
            fast = _Site(sec=0.1)
            _run(d, fast)
            gaps = [b - a for a, b in zip(fast.starts, fast.starts[1:])]
            self.assertTrue(all(g >= st.INTERVAL - 1e-9 for g in gaps), gaps)
            slow = _Site(sec=9.5)
            _run(d, slow)
            gaps = [b - a for a, b in zip(slow.starts, slow.starts[1:])]
            self.assertTrue(all(g >= 9.5 for g in gaps), "前の応答を待ってから次を送る")


class TestContract(unittest.TestCase):
    """アプリ側のテスト (test_tomorrow.js) が読む tomorrow_sample.json は、この scraper の出力そのもの。"""

    def test_sample_fixture_is_what_the_scraper_writes(self):
        with open(os.path.join(FIX, "tomorrow_sample.json"), encoding="utf-8") as f:
            sample = json.load(f)
        with tempfile.TemporaryDirectory() as d:
            _setup(d, [8, 12])
            _run(d, _Site(pages={12: (200, NOTYET)}))
            out = _out(d)
        self.assertEqual(sorted(out), ["date", "pending", "stadiums", "updated_at"])
        self.assertEqual(sorted(sample), sorted(out), "キーの構成が同じ")
        self.assertEqual(out["date"], sample["date"])
        self.assertEqual(out["pending"], sample["pending"])
        self.assertEqual(out["stadiums"]["8"], sample["stadiums"]["8"], "常滑の 12 レースが一致")
        # 場 20 は、形だけ同じにした手書きの 1 レース
        r = sample["stadiums"]["20"]["races"][0]
        self.assertEqual(sorted(r), sorted(out["stadiums"]["8"]["races"][0]))
        self.assertEqual(sorted(sample["stadiums"]["20"]), sorted(out["stadiums"]["8"]))


class TestWiring(unittest.TestCase):
    def test_subprocess_timeout_is_longer_than_the_budget(self):
        import re

        import scrape_all

        with open(scrape_all.__file__, encoding="utf-8") as f:
            src = f.read()
        m = re.search(r'_run_subprocess\("scrape_tomorrow\.py", timeout_sec=(\d+)\)', src)
        self.assertIsNotNone(m)
        self.assertGreaterEqual(int(m.group(1)), st.BUDGET_SEC + 60)

    def test_output_path(self):
        self.assertEqual(st.OUT_REL, os.path.join("schedule", "tomorrow.json"))


if __name__ == "__main__":
    unittest.main()
