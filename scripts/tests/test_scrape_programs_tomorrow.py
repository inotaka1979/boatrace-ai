"""翌日の番組表を前の晩に取る (scripts/scrape_programs_tomorrow.py、2026-11-28) の回帰テスト

2026-11-28 の朝、番組表がどの経路からも当日分に切り替わっておらず、アプリは開催中の 14 場すべてを
「次節」と表示した。前の晩に公式の出走表を取っておき、日付が変わったら Worker がそれを配る。

  - 取る順番: 第 1 レースの締切が早い場から（朝の開催を先に確保する）
  - 1 件ずつ・間隔を空ける・内部期限で止めても取れた分は書く・次の run は続きから取る
  - 同じ日付の間、取れたレースは消さない。日付が変わったら持ち越さない
  - 403 が続いたら止める。読めないページと「データがありません」のページを区別して数える
  - 0 時以降（--target today）は今日の分の続き。一覧が無ければ月間日程の開催場を対象にする
  - scrape_all からの呼び出し（引数・timeout の関係）

    python3 -m unittest scripts.tests.test_scrape_programs_tomorrow -v
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import scrape_all  # noqa: E402
import scrape_programs_tomorrow as spt  # noqa: E402
import source_health  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
# 実ページ（2026-06-27 桐生 1R の出走表。test_programs_parse.py と同じもの）
with open(os.path.join(ROOT, "data", "schedule", "_debug_racelist.html"), encoding="utf-8") as _f:
    PAGE = _f.read()
# 「データがありません。」の見出しだけのページ（開催の無い日の形）
with open(os.path.join(os.path.dirname(__file__), "fixtures", "raceindex_noseries.html"), encoding="utf-8") as _f:
    NODATA = _f.read()
UNREADABLE = "<html><body><h2>出走表</h2><table><tbody><tr><td>形が変わった</td></tr></tbody></table></body></html>"

# 11/28 18:13 JST（夕方の run）→ 翌日は 11/29
EVENING = datetime.datetime(2026, 11, 28, 18, 13, tzinfo=spt.JST)
# 11/29 02:21 JST（0 時を過ぎて届いた run）→ 今日は 11/29
NIGHT = datetime.datetime(2026, 11, 29, 2, 21, tzinfo=spt.JST)
HD, ISO = "20261129", "2026-11-29"


def _listing(venues, hd=HD):
    """venues = {場: 第 1 レースの締切 "HH:MM"} → tomorrow.json の形"""
    out = {}
    for sid, first in venues.items():
        h, m = (int(x) for x in first.split(":"))
        races = []
        for r in range(1, 13):
            t = h * 60 + m + (r - 1) * 28
            races.append({"r": r, "t": "%02d:%02d" % (t // 60, t % 60), "b": [[1, 4320, "峰 竜太", 1]]})
        out[str(sid)] = {"label": "2日目", "races": races}
    return {"date": hd, "updated_at": "2026-11-28T09:10:00Z", "pending": [], "stadiums": out}


class _Site:
    """(場, R) ごとに応答を決められる取得元。時計を進めるだけで実際には待たない。"""

    def __init__(self, pages=None, sec=0.3, default=(200, PAGE)):
        self.pages = pages or {}
        self.sec = sec
        self.default = default
        self.now = 1000.0
        self.keys = []
        self.starts = []
        self.active = 0
        self.max_active = 0

    def clock(self):
        return self.now

    def sleep(self, s):
        self.now += max(0.0, s)

    def fetch(self, url, timeout=15):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.starts.append(self.now)
        sid = int(url.split("jcd=")[1][:2])
        rno = int(url.split("rno=")[1].split("&")[0])
        assert url.endswith("hd=" + HD), url
        self.keys.append((sid, rno))
        self.now += self.sec
        self.active -= 1
        page = self.pages.get((sid, rno), self.pages.get(sid, self.default))
        return page


def _setup(d, venues=None, hd=HD, schedule=None):
    os.makedirs(os.path.join(d, "schedule"), exist_ok=True)
    if venues is not None:
        with open(os.path.join(d, "schedule", "tomorrow.json"), "w", encoding="utf-8") as f:
            json.dump(_listing(venues, hd), f)
    if schedule is not None:
        with open(os.path.join(d, "schedule", "current.json"), "w", encoding="utf-8") as f:
            json.dump({"stadium_dates": {str(s): ["2026-11-27", ISO] for s in schedule}}, f)


_REAL_PARSE = spt.parse_racelist_program
_PARSED = {}
_patcher = None


def _fast_parse(html, sid, rno, hd):
    """同じページの解析を 1 回で済ませる（1 ページ 40 ms × 数百回を避ける。場・R・日付の欄は引数どおりに作り直す）。

    本物の解析と同じ結果になることは TestEveningRun.test_fast_parse_matches_the_real_parser で確かめる。
    """
    if html is not PAGE:
        return _REAL_PARSE(html, sid, rno, hd)
    if rno not in _PARSED:
        _PARSED[rno] = json.dumps(_REAL_PARSE(html, 1, rno, "20000101"))
    p = json.loads(_PARSED[rno])
    iso = f"{hd[0:4]}-{hd[4:6]}-{hd[6:8]}"
    p.update(race_stadium_number=sid, race_date=iso, race_closed_at=p["race_closed_at"].replace("2000-01-01", iso))
    return p


def setUpModule():
    global _patcher
    _patcher = mock.patch.object(spt, "parse_racelist_program", side_effect=_fast_parse)
    _patcher.start()


def tearDownModule():
    _patcher.stop()


def _run(d, site, now=EVENING, **kw):
    return spt.run(data_dir=d, now=now, fetch=site.fetch, sleep=site.sleep, clock=site.clock, **kw)


def _out(d):
    with open(os.path.join(d, "schedule", "programs_tomorrow.json"), encoding="utf-8") as f:
        return json.load(f)


def _status(d):
    with open(os.path.join(d, "_status.json"), encoding="utf-8") as f:
        return json.load(f)


class TestExpectedRaces(unittest.TestCase):
    def test_morning_venues_first(self):
        # 鳴門 (14) は 8:35、常滑 (8) は 10:27、大村 (24) は 15:20 → 朝の開催から
        want = spt.expected_races(_listing({24: "15:20", 8: "10:27", 14: "08:35"}), HD)
        self.assertEqual(len(want), 36)
        self.assertEqual([sid for sid, _ in want[::12]], [14, 8, 24])
        self.assertEqual([r for _, r in want[:12]], list(range(1, 13)))

    def test_same_first_deadline_orders_by_venue_number(self):
        want = spt.expected_races(_listing({20: "08:40", 6: "08:40"}), HD)
        self.assertEqual([sid for sid, _ in want[::12]], [6, 20])

    def test_listing_of_another_day_is_not_used(self):
        self.assertEqual(spt.expected_races(_listing({8: "10:27"}, hd="20261128"), HD), [])

    def test_broken_listing_does_not_raise(self):
        for bad in (None, [], "x", {"date": HD}, {"date": HD, "stadiums": []},
                    {"date": HD, "stadiums": {"8": None, "99": {"races": [{"r": 1}]}, "x": {}, "3": {"races": "?"}}},
                    {"date": HD, "stadiums": {"8": {"races": [{"r": 13}, {"r": 0}, {"r": True}, {"r": "2"}, None]}}}):
            self.assertEqual(spt.expected_races(bad, HD), [], bad)

    def test_races_without_time_go_last(self):
        lst = _listing({8: "10:27", 3: "09:00"})
        for r in lst["stadiums"]["3"]["races"]:
            del r["t"]
        self.assertEqual([sid for sid, _ in spt.expected_races(lst, HD)[::12]], [8, 3])


class TestEveningRun(unittest.TestCase):
    def test_fast_parse_matches_the_real_parser(self):
        for sid, rno in ((8, 1), (14, 7), (24, 12)):
            self.assertEqual(_fast_parse(PAGE, sid, rno, HD), _REAL_PARSE(PAGE, sid, rno, HD), (sid, rno))

    def test_fetches_every_listed_race_and_writes_openapi_shape(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27", 14: "08:35"})
            site = _Site()
            with mock.patch.object(spt, "parse_racelist_program", _REAL_PARSE):  # ここは本物の解析で通す
                s = _run(d, site)
            self.assertEqual(site.keys, [(14, r) for r in range(1, 13)] + [(8, r) for r in range(1, 13)])
            self.assertEqual((s["attempted"], s["updated"], s["missing"], s["written"]), (24, 24, 0, True))
            out = _out(d)
            self.assertEqual(out["race_date"], ISO)
            self.assertIs(out["partial"], False)
            self.assertEqual(out["expected"], 24)
            self.assertRegex(out["updated_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
            rows = out["programs"]
            self.assertEqual([(p["race_stadium_number"], p["race_number"]) for p in rows],
                             [(8, r) for r in range(1, 13)] + [(14, r) for r in range(1, 13)], "場・R の順")
            for p in rows:
                self.assertEqual(p["race_date"], ISO)
                self.assertTrue(p["race_closed_at"].startswith(ISO + " "))
                self.assertEqual(len(p["boats"]), 6)
                self.assertEqual([b["racer_boat_number"] for b in p["boats"]], [1, 2, 3, 4, 5, 6])
                self.assertTrue(all(1000 <= b["racer_number"] <= 9999 for b in p["boats"]))

    def test_one_request_at_a_time_with_an_interval(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            site = _Site(sec=0.1)
            _run(d, site)
            self.assertEqual(site.max_active, 1)
            gaps = [b - a for a, b in zip(site.starts, site.starts[1:])]
            self.assertTrue(all(g >= spt.INTERVAL - 1e-9 for g in gaps), gaps)

    def test_one_run_takes_a_whole_day_even_when_the_site_is_slow(self):
        # 2026-11-28 の夜: 翌日は 16 場 = 192 レース。公開（18 時ごろ）の後に届く run は 1 晩に 1〜2 回で、
        #   この日は 1 回目が公開の前に着いた（17:41 着で 0 場）。残った 1 回で取り切れる長さにする（1200 秒では 約 120）
        venues = {sid: "%02d:%02d" % (8 + i // 2, 35 if i % 2 == 0 else 5) for i, sid in enumerate(range(1, 17))}
        with tempfile.TemporaryDirectory() as d:
            _setup(d, venues)
            site = _Site(sec=9.5)
            s = _run(d, site)
            self.assertEqual((s["attempted"], s["updated"], s["missing"]), (192, 192, 0))
            self.assertLess(site.now - 1000.0, spt.BUDGET_SEC, "既定の内部期限の内に終わる")
            out = _out(d)
            self.assertIs(out["partial"], False)
            self.assertEqual((out["expected"], len(out["programs"])), (192, 192))
            self.assertEqual(site.max_active, 1, "長く取る時も 1 件ずつ")

    def test_slow_site_stops_at_the_budget_and_writes_what_it_got(self):
        # 公式サイトが 1 件 9.5 秒かかる日に、呼ぶ側が 1200 秒で切り上げさせた時（同じ run で racedata も取る時・
        #   job の残り時間が少ない時）。14 場 = 168 レースは取り切れない
        venues = {sid: "%02d:%02d" % (8 + i // 2, 35 if i % 2 == 0 else 5) for i, sid in enumerate(range(1, 15))}
        with tempfile.TemporaryDirectory() as d:
            _setup(d, venues)
            site = _Site(sec=9.5)
            s = _run(d, site, budget_sec=1200)
            self.assertGreaterEqual(s["attempted"], 110, "1200 秒で 110 レース以上")
            self.assertLessEqual(s["attempted"], 130)
            self.assertLessEqual(site.now - 1000.0, 1200 + 15, "期限の後は新しく取りに行かない")
            out = _out(d)
            self.assertIs(out["partial"], True)
            self.assertEqual(out["expected"], 168)
            self.assertEqual(len(out["programs"]), s["attempted"])
            # 朝の開催（締切の早い場）から取れている
            order = [sid for sid, _ in spt.expected_races(_listing(venues), HD)[::12]]
            got = {p["race_stadium_number"] for p in out["programs"]}
            self.assertTrue(set(order[:9]) <= got, (order, got))
            self.assertNotIn(order[-1], got)

            # 次の run は続きから取り、取れている分は取り直さない
            site2 = _Site(sec=9.5)
            s2 = _run(d, site2)
            self.assertEqual(s2["attempted"], 168 - s["attempted"])
            self.assertFalse(set(site2.keys) & set(site.keys))
            out2 = _out(d)
            self.assertIs(out2["partial"], False)
            self.assertEqual(len(out2["programs"]), 168)

    def test_short_budget_from_the_caller(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27", 14: "08:35"})
            site = _Site(sec=9.5)
            s = _run(d, site, budget_sec=60)
            self.assertEqual(s["attempted"], 7, "60 秒の期限の内に始められるのは 7 件（0 / 9.5 / … / 57 秒）")
            self.assertEqual(len(_out(d)["programs"]), 7)

    def test_nothing_to_do_without_a_listing(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, None, schedule=[8, 14])
            site = _Site()
            s = _run(d, site)
            self.assertEqual((s["expected"], s["attempted"], s["written"]), (0, 0, False))
            self.assertEqual(site.keys, [], "翌日分は、月間日程からは取りに行かない（公開前のページを叩かない）")
            self.assertFalse(os.path.exists(os.path.join(d, "schedule", "programs_tomorrow.json")))
            self.assertFalse(os.path.exists(os.path.join(d, "_status.json")))

    def test_complete_file_is_not_rewritten(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            _run(d, _Site())
            before = _out(d)
            st_before = _status(d)
            with mock.patch.object(spt, "utc_iso_seconds", return_value="2099-01-01T00:00:00Z"):
                site = _Site()
                s = _run(d, site)
            self.assertEqual((s["attempted"], s["written"], s["missing"]), (0, False, 0))
            self.assertEqual(site.keys, [])
            self.assertEqual(_out(d), before)
            self.assertEqual(_status(d), st_before, "取りに行かなかった run は記録を書き換えない")

    def test_newly_published_venue_is_added_and_the_rest_kept(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            _run(d, _Site())
            _setup(d, {8: "10:27", 24: "15:20"})  # 夜の開催が後から公開された
            site = _Site()
            s = _run(d, site)
            self.assertEqual(site.keys, [(24, r) for r in range(1, 13)])
            self.assertEqual(s["attempted"], 12)
            out = _out(d)
            self.assertEqual(len(out["programs"]), 24)
            self.assertEqual(out["expected"], 24)
            self.assertIs(out["partial"], False)


class TestFailures(unittest.TestCase):
    def test_failed_pages_are_left_for_the_next_run_and_nothing_is_lost(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            site = _Site(pages={(8, 5): (500, None), (8, 9): ("exc:TimeoutError", None), (8, 11): (200, UNREADABLE)})
            s = _run(d, site)
            self.assertEqual((s["attempted"], s["updated"], s["missing"]), (12, 9, 3))
            out = _out(d)
            self.assertIs(out["partial"], True)
            self.assertEqual([p["race_number"] for p in out["programs"]], [1, 2, 3, 4, 6, 7, 8, 10, 12])
            # 次の run: 残り 3 件だけ取りに行く。また失敗しても、取れている 9 件は残る
            site2 = _Site(default=(503, None))
            s2 = _run(d, site2)
            self.assertEqual(site2.keys, [(8, 5), (8, 9), (8, 11)])
            self.assertIs(s2["written"], False)
            self.assertEqual(len(_out(d)["programs"]), 9)

    def test_error_response_with_a_body_is_not_parsed(self):
        # 200 以外の応答は、本文が出走表の形をしていても使わない
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            s = _run(d, _Site(pages={(8, 3): (500, PAGE), (8, 4): (404, PAGE)}))
            self.assertEqual((s["updated"], s["missing"]), (10, 2))
            self.assertEqual([p["race_number"] for p in _out(d)["programs"]], [1, 2, 5, 6, 7, 8, 9, 10, 11, 12])

    def test_a_row_that_fails_validation_is_not_written(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            real = spt.parse_racelist_program

            def broken(html, sid, rno, hd):
                p = real(html, sid, rno, hd)
                if rno == 4:
                    p["boats"][0]["racer_number"] = 12  # 4 桁でない登録番号
                return p

            with mock.patch.object(spt, "parse_racelist_program", side_effect=broken):
                s = _run(d, _Site())
            self.assertEqual(s["missing"], 1)
            self.assertNotIn(4, [p["race_number"] for p in _out(d)["programs"]])

    def test_parser_exception_does_not_stop_the_run(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            real = spt.parse_racelist_program

            def boom(html, sid, rno, hd):
                if rno == 2:
                    raise ValueError("unexpected markup")
                return real(html, sid, rno, hd)

            with mock.patch.object(spt, "parse_racelist_program", side_effect=boom):
                s = _run(d, _Site())
            self.assertEqual((s["attempted"], s["updated"]), (12, 11))

    def test_stops_when_refused_and_reports_blocked(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27", 14: "08:35"})
            site = _Site(default=(403, None))
            s = _run(d, site)
            self.assertEqual(s["attempted"], 5, "403 が 5 回続いたら止める")
            self.assertIs(s["blocked"], True)
            self.assertFalse(os.path.exists(os.path.join(d, "schedule", "programs_tomorrow.json")))
            st = _status(d)["tasks"]["programs_tomorrow"]
            self.assertEqual((st["attempted"], st["updated"], st["http_403"], st["blocked"]), (5, 0, 5, True))
            with mock.patch.object(spt, "run", return_value=s):
                self.assertEqual(spt.main(["--data-dir", d]), 3)

    def test_blocked_run_keeps_what_an_earlier_run_got(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            _run(d, _Site())
            _setup(d, {8: "10:27", 24: "15:20"})
            before = _out(d)
            _run(d, _Site(default=(403, None)))
            after = _out(d)
            self.assertEqual(after["programs"], before["programs"], "取れていた 12 レースはそのまま")
            self.assertEqual((after["partial"], after["expected"]), (True, 24), "増えた分がまだ取れていないことは記録する")

    def test_status_distinguishes_unreadable_from_no_data(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        # 全部「読めないページ」= ページの形が変わった → 監視が検知する
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            _run(d, _Site(default=(200, UNREADABLE)))
            st = _status(d)
            self.assertEqual((st["tasks"]["programs_tomorrow"]["attempted"], st["tasks"]["programs_tomorrow"]["updated"]),
                             (12, 0))
            self.assertEqual(source_health.evaluate(st, now)["state"], "problem")
        # 全部「データがありません」（開催が無くなった場）→ 読めたページなので、監視は鳴らさない
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            s = _run(d, _Site(default=(200, NODATA)))
            self.assertEqual((s["no_data"], s["updated"], s["missing"]), (1, 0, 12))
            st = _status(d)
            t = st["tasks"]["programs_tomorrow"]
            self.assertEqual((t["attempted"], t["updated"], t["races"]), (1, 1, 0))
            self.assertEqual(source_health.evaluate(st, now)["state"], "ok")
            self.assertFalse(os.path.exists(os.path.join(d, "schedule", "programs_tomorrow.json")),
                             "1 レースも取れていない時は書かない")

    def test_response_time_is_recorded(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            with mock.patch.object(spt, "timed_call", side_effect=lambda fn, *a, **k: (fn(*a, **k), 9.4)):
                _run(d, _Site())
            t = _status(d)["tasks"]["programs_tomorrow"]
            self.assertEqual((t["ok"], t["avg_ms"], t["max_ms"]), (12, 9400, 9400))


class TestDayChange(unittest.TestCase):
    def test_yesterdays_file_is_not_carried_into_the_next_day(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27", 14: "08:35"})
            # 前の日の分（11/28 の番組表）が残っている
            old = {"updated_at": "2026-11-27T13:00:00Z", "race_date": "2026-11-28", "partial": False, "expected": 12,
                   "programs": [{"race_date": "2026-11-28", "race_stadium_number": 14, "race_number": r,
                                 "race_closed_at": "2026-11-28 08:35:00", "boats": []} for r in range(1, 13)]}
            with open(os.path.join(d, "schedule", "programs_tomorrow.json"), "w", encoding="utf-8") as f:
                json.dump(old, f)
            site = _Site()
            s = _run(d, site)
            self.assertEqual(s["attempted"], 24, "前の日の 14 場の分を「取得済み」と数えない")
            out = _out(d)
            self.assertEqual(out["race_date"], ISO)
            self.assertTrue(all(p["race_date"] == ISO for p in out["programs"]))
            self.assertEqual(len(out["programs"]), 24)

    def test_rows_of_another_day_inside_the_file_are_dropped(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            _run(d, _Site())
            doc = _out(d)
            doc["programs"][0]["race_date"] = "2026-11-28"  # 壊れた行が混ざっていた
            with open(os.path.join(d, "schedule", "programs_tomorrow.json"), "w", encoding="utf-8") as f:
                json.dump(doc, f)
            site = _Site()
            _run(d, site)
            self.assertEqual(site.keys, [(8, 1)], "その行だけ取り直す")
            self.assertTrue(all(p["race_date"] == ISO for p in _out(d)["programs"]))

    def test_after_midnight_continues_todays_file(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27", 14: "08:35"})
            site = _Site(sec=9.5)
            _run(d, site, budget_sec=120)  # 夕方は 13 レースで時間切れ（0 / 9.5 / … / 114 秒）
            n = len(_out(d)["programs"])
            self.assertEqual(n, 13)
            # 0 時を過ぎて届いた run: 「翌日」を対象にすると 11/30 になり何もしない。今日 (11/29) の続きを取る
            site2 = _Site()
            s2 = _run(d, site2, now=NIGHT, target="today")
            self.assertEqual((s2["date"], s2["source"], s2["attempted"]), (HD, "listing", 24 - n))
            out = _out(d)
            self.assertEqual((out["race_date"], out["partial"], len(out["programs"])), (ISO, False, 24))

            self.assertEqual(_run(d, _Site(), now=NIGHT)["expected"], 0, "0 時以降に target=tomorrow だと 11/30 = 一覧なし")

    def test_after_midnight_without_a_listing_uses_the_monthly_schedule(self):
        # 前の晩の run が 1 回も届かなかった → 一覧 (tomorrow.json) が無い。今日の出走表は公開済みなので日程から取る
        with tempfile.TemporaryDirectory() as d:
            _setup(d, None, schedule=[14, 8])
            site = _Site(pages={14: (200, NODATA)})  # 14 場は順延で開催なし
            s = _run(d, site, now=NIGHT, target="today")
            self.assertEqual((s["source"], s["expected"], s["attempted"]), ("schedule", 24, 13))
            self.assertEqual((s["updated"], s["no_data"], s["missing"]), (12, 1, 12))
            self.assertEqual([k for k in site.keys if k[0] == 14], [(14, 1)],
                             "開催の無い場は 1 ページだけ確かめる（残りの 11 ページを取りに行かない）")
            out = _out(d)
            self.assertEqual({p["race_stadium_number"] for p in out["programs"]}, {8})
            self.assertIs(out["partial"], True)

            # 次の run も、その場は 1 ページだけ確かめる（取れた場は取り直さない）
            site2 = _Site(pages={14: (200, NODATA)})
            s2 = _run(d, site2, now=NIGHT, target="today")
            self.assertEqual(site2.keys, [(14, 1)])
            self.assertEqual((s2["attempted"], s2["no_data"], s2["missing"]), (1, 1, 12))

    def test_a_single_page_without_data_does_not_stop_a_venue_that_has_programs(self):
        # 1 レースだけ「データがありません」（その場の番組表は出ている）。残りのレースは取る
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            site = _Site(pages={(8, 5): (200, NODATA)})
            s = _run(d, site)
            self.assertEqual(site.keys, [(8, r) for r in range(1, 13)])
            self.assertEqual((s["updated"], s["no_data"], s["missing"]), (11, 1, 1))
            # 次の run: 取れていた場なので、欠けた 1 レースだけ取りに行く。出ていれば埋まる
            site2 = _Site()
            s2 = _run(d, site2)
            self.assertEqual(site2.keys, [(8, 5)])
            self.assertEqual(s2["missing"], 0)

    def test_pages_without_data_are_each_retried_for_a_venue_kept_from_an_earlier_run(self):
        # 前の run で番組表が取れている場（ファイルに残っている）: 欠けたレースが続けて「データがありません」でも、
        #   1 ページで切り上げない（開催の無い場ではないので、どのレースも確かめる）
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27"})
            gaps = {(8, 5): (200, NODATA), (8, 6): (200, NODATA)}
            self.assertEqual(_run(d, _Site(pages=gaps))["missing"], 2)
            site2 = _Site(pages=gaps)
            s2 = _run(d, site2)
            self.assertEqual(site2.keys, [(8, 5), (8, 6)])
            self.assertEqual((s2["attempted"], s2["no_data"], s2["missing"]), (2, 2, 2))

    def test_venue_whose_pages_are_not_out_yet_is_retried_by_the_next_run(self):
        # 一覧（レース一覧のページ）には載ったが、出走表のページがまだ出ていない場。この run では 1 ページで切り上げ、
        #   次の run で取る
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {8: "10:27", 14: "08:35"})
            site = _Site(pages={14: (200, NODATA)})
            s = _run(d, site)
            self.assertEqual(site.keys, [(14, 1)] + [(8, r) for r in range(1, 13)])
            self.assertEqual((s["updated"], s["no_data"], s["missing"]), (12, 1, 12))
            site2 = _Site()
            s2 = _run(d, site2)
            self.assertEqual(site2.keys, [(14, r) for r in range(1, 13)])
            self.assertEqual(s2["missing"], 0)
            self.assertIs(_out(d)["partial"], False)

    def test_stale_listing_after_midnight_falls_back_to_the_schedule(self):
        with tempfile.TemporaryDirectory() as d:
            _setup(d, {3: "10:00"}, hd="20261128", schedule=[8])  # 一覧は前の日のまま
            site = _Site()
            s = _run(d, site, now=NIGHT, target="today")
            self.assertEqual(s["source"], "schedule")
            self.assertEqual({sid for sid, _ in site.keys}, {8})


class TestSchedulerWiring(unittest.TestCase):
    # 1 日分 = 16 場 192 レース（2026-11-29 の実数）。公式サイトが応答を遅らせている間は 1 件 約 9.5 秒 + 解析
    ONE_DAY_RACES = 192
    SEC_PER_RACE = 10

    def test_budget_and_timeout_relations(self):
        m = scrape_all
        self.assertEqual(m.PROGRAMS_TOMORROW_BUDGET_SEC, spt.BUDGET_SEC, "既定の内部期限をそろえる")
        self.assertGreaterEqual(m.PROGRAMS_AHEAD_MARGIN_SEC, 60, "取得中の 1 件 (最大 15 秒) + 書き出しの余裕")
        # 1 回の run で 1 日分を取り切れる長さ（最初の夜 = 1200 秒では 192 レース中 約 120 だった）
        one_day = self.ONE_DAY_RACES * self.SEC_PER_RACE
        self.assertGreaterEqual(m.PROGRAMS_TOMORROW_BUDGET_SEC, one_day)
        self.assertGreaterEqual(m.PROGRAMS_TODAY_AHEAD_BUDGET_SEC, one_day,
                                "夕方の run が 1 回も届かなかった夜は、0 時以降の 1 回で取り切る")
        # subprocess の timeout（内部期限 + 余裕）まで掛かっても job の予算 (42 分) に収まる
        for cap in (m.PROGRAMS_TOMORROW_BUDGET_SEC, m.PROGRAMS_TODAY_AHEAD_BUDGET_SEC):
            self.assertLess(cap + m.PROGRAMS_AHEAD_MARGIN_SEC, m.JOB_BUDGET_SEC)
        # racedata が後ろに控えている run は短い期限。real-time 系（夕方は約 11 分）の後でも racedata に 9 分は残る
        self.assertLess(m.PROGRAMS_TOMORROW_SHARED_BUDGET_SEC, m.PROGRAMS_TOMORROW_BUDGET_SEC)
        self.assertGreaterEqual(
            m.JOB_BUDGET_SEC - (m.PROGRAMS_TOMORROW_SHARED_BUDGET_SEC + m.PROGRAMS_AHEAD_MARGIN_SEC), 11 * 60 + 9 * 60)

    def _call(self, fn, left):
        """job の残りが left 秒の時の呼び出し（時計を止めて、残りがちょうど left 秒になるようにする）。"""
        calls = []
        with mock.patch.object(scrape_all, "_run_subprocess",
                               side_effect=lambda script, args=None, timeout_sec=600: calls.append(
                                   (script, args, timeout_sec)) or 0), \
             mock.patch.object(scrape_all.time, "monotonic", return_value=50000.0), \
             mock.patch.object(scrape_all, "_RUN_STARTED", 50000.0 - (scrape_all.JOB_BUDGET_SEC - left)):
            self.assertEqual(fn(), 0)
        return calls[0]

    def test_evening_call_passes_target_and_budget(self):
        script, args, timeout = self._call(scrape_all._scrape_programs_tomorrow, left=2500)
        self.assertEqual(script, "scrape_programs_tomorrow.py")
        self.assertEqual(args, ["--target", "tomorrow", "--budget-sec", "2100"])
        self.assertEqual(timeout, 2220)

    def test_evening_run_gets_what_the_job_has_left_after_the_realtime_tasks(self):
        # 2026-11-28 17:32 の run: real-time 系（結果・展示・オッズ・開催日タブ・出走の一覧）に 655 秒 → 残り 1865 秒。
        #   その中で取れるだけ取る（約 174 レース。以前の 1200 秒 = 約 120 レースより多い）
        _, args, timeout = self._call(scrape_all._scrape_programs_tomorrow, left=scrape_all.JOB_BUDGET_SEC - 655)
        self.assertEqual(timeout, scrape_all.JOB_BUDGET_SEC - 655)
        budget = int(args[3])
        self.assertEqual(budget, timeout - scrape_all.PROGRAMS_AHEAD_MARGIN_SEC)
        self.assertGreaterEqual(budget // self.SEC_PER_RACE, 170)

    def test_evening_call_is_short_when_racedata_follows(self):
        script, args, timeout = self._call(scrape_all._scrape_programs_tomorrow_shared, left=2500)
        self.assertEqual(script, "scrape_programs_tomorrow.py")
        self.assertEqual(args, ["--target", "tomorrow", "--budget-sec", "1200"])
        self.assertEqual(timeout, 1320)

    def test_night_call_targets_today(self):
        script, args, timeout = self._call(scrape_all._scrape_programs_today_ahead, left=2500)
        self.assertEqual(args, ["--target", "today", "--budget-sec", "2100"])
        self.assertEqual(timeout, 2220)

    def test_budget_shrinks_when_the_job_is_running_out_of_time(self):
        _, args, timeout = self._call(scrape_all._scrape_programs_tomorrow, left=500)
        self.assertLessEqual(timeout, 500)
        self.assertEqual(int(args[3]), timeout - scrape_all.PROGRAMS_AHEAD_MARGIN_SEC)
        _, args, timeout = self._call(scrape_all._scrape_programs_tomorrow, left=10)
        self.assertEqual((timeout, args[3]), (120, "60"), "残りが無くても最低限だけ試す（内部期限 < timeout）")
        self.assertLess(int(args[3]) + 15, timeout)

    def test_cli_arguments_reach_run(self):
        with mock.patch.object(spt, "run", return_value={"blocked": False}) as run:
            self.assertEqual(spt.main(["--data-dir", "x", "--target", "today", "--budget-sec", "77"]), 0)
        run.assert_called_once_with(data_dir="x", budget_sec=77, target="today")
        with mock.patch.object(spt, "run", return_value={}) as run:
            spt.main([])
        self.assertEqual(run.call_args.kwargs["target"], "tomorrow")


if __name__ == "__main__":
    unittest.main()
