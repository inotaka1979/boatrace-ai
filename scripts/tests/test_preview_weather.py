"""直前情報の気象を data/previews と過去日アーカイブに入れる (2026-11-27)

直前情報ページの展示は読んでいたが、同じページにある「水面気象情報」は読んでいなかった
（上流の previews の気象は遅れて届くので、それまでのレースはアプリの気象欄が「風: --- 0m」のままだった。
data/previews と日次アーカイブには気象が無かった）。

  - parse_weather: 実ページ（展示後 / 展示前 / 結果ページ）から読む。Worker の解析と同じ値になる
  - weather_as_of / weather_fits_race: 気象の欄の見出し（◯R時点 / HH:MM現在）で、そのレースの締切前の値かを判定
  - scrape_race: 展示と一緒に気象を入れる。別の時刻の気象は入れない
  - backfill_archive: 過去日のページは「◯R時点」の値だけを使う（1R のページはその日の最後の値を出す）

    python3 -m unittest scripts.tests.test_preview_weather -v
"""

from __future__ import annotations

import asyncio
import datetime
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import backfill_archive as bf  # noqa: E402
import scrape_previews as sp  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def _read(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return f.read()


PAGE = _read("beforeinfo_naruto_R01.html")          # 2026-11-27 鳴門 1R（展示後、「7:45現在」）
PAGE_PRE = _read("beforeinfo_kiryu_R12_pre.html")   # 2026-11-27 桐生 12R（展示前、気象の欄は空白）
# 公式ページに載っている値
OFFICIAL_WEATHER = {
    "temperature": 11, "wind_speed": 1, "water_temperature": 18, "wave_height": 1,
    "weather_number": 1, "wind_direction": 13,
}
OFFICIAL_ET = {"1": 6.84, "2": 6.77, "3": 6.81, "4": 6.79, "5": 6.75, "6": 6.83}
CLOSE_0835 = 8 * 60 + 35


def _unit(title, data):
    return ('<div class="weather1_bodyUnitLabel"><span class="weather1_bodyUnitLabelTitle">' + title + "</span>\n"
            '<span class="weather1_bodyUnitLabelData">' + data + "</span></div>")


def _block(inner):
    return '<div class="weather1"><div class="weather1_body">' + inner + "</div></div>"


def _titled(title):
    return '<div class="weather1"><p class="weather1_title">' + title + '</p><div class="weather1_body"></div></div>'


class TestParseWeather(unittest.TestCase):
    def test_real_page_after_exhibition(self):
        self.assertEqual(sp.parse_weather(PAGE), OFFICIAL_WEATHER)

    def test_real_page_before_exhibition_is_none(self):
        """展示前は欄が空白で、天候の画像にだけ「不明」の番号が付く。気象ありにしない。"""
        self.assertIn("is-weather7", PAGE_PRE)
        self.assertIsNone(sp.parse_weather(PAGE_PRE))
        self.assertIsNone(sp.parse_beforeinfo(PAGE_PRE))

    def test_result_page_block_has_the_same_shape(self):
        self.assertEqual(sp.parse_weather(_read("raceresult_start_info.html")), {
            "temperature": 7, "wind_speed": 5, "water_temperature": 13, "wave_height": 4,
            "weather_number": 1, "wind_direction": 2,
        })
        self.assertEqual(sp.parse_weather(_read("raceresult_nonfinishers.html")), {
            "temperature": 9, "wind_speed": 5, "water_temperature": 20, "wave_height": 5,
            "weather_number": 1, "wind_direction": 15,
        })

    def test_no_block_or_bad_input(self):
        for bad in ("<html></html>", "", None, 5, b"weather1_body"):
            self.assertIsNone(sp.parse_weather(bad), repr(bad))

    def test_only_read_fields_are_returned(self):
        self.assertEqual(sp.parse_weather(_block(_unit("風速", "3m") + _unit("波高", "2cm"))),
                         {"wind_speed": 3, "wave_height": 2})

    def test_zero_is_a_measurement_and_calm_is_17(self):
        html = _block(_unit("気温", "0.0℃") + _unit("風速", "0m") + '<p class="weather1_bodyUnitImage is-wind17"></p>'
                      + _unit("水温", "9.5℃") + _unit("波高", "0cm"))
        self.assertEqual(sp.parse_weather(html), {
            "temperature": 0, "wind_speed": 0, "water_temperature": 9.5, "wave_height": 0, "wind_direction": 17,
        })

    def test_negative_temperature(self):
        self.assertEqual(sp.parse_weather(_block(_unit("気温", "-1.5℃")))["temperature"], -1.5)

    def test_unknown_labels_are_ignored(self):
        self.assertEqual(sp.parse_weather(_block(_unit("湿度", "40%") + _unit("__class__", "7") + _unit("風速", "2m"))),
                         {"wind_speed": 2})

    def test_compass_image_is_not_the_wind_direction(self):
        w = sp.parse_weather(_block('<p class="weather1_bodyUnitImage is-direction15"></p>' + _unit("風速", "2m")))
        self.assertNotIn("wind_direction", w)

    def test_no_number_means_none_even_with_images(self):
        html = _block(_unit("風速", "&nbsp;") + '<p class="weather1_bodyUnitImage is-wind5"></p>'
                      '<p class="weather1_bodyUnitImage is-weather2"></p>')
        self.assertIsNone(sp.parse_weather(html))

    def test_values_are_plain_numbers(self):
        for k, v in sp.parse_weather(PAGE).items():
            self.assertIn(type(v), (int, float), k)
        # 「11.0℃」「1m」は整数で出す（run のたびに 11.0 / 11 が入れ替わる差分を作らない）。小数は小数のまま
        self.assertEqual(json.dumps(sp.parse_weather(PAGE), sort_keys=True),
                         '{"temperature": 11, "water_temperature": 18, "wave_height": 1, '
                         '"weather_number": 1, "wind_direction": 13, "wind_speed": 1}')
        self.assertEqual(json.dumps(sp.parse_weather(_block(_unit("水温", "9.5℃")))), '{"water_temperature": 9.5}')


class TestWeatherAsOf(unittest.TestCase):
    def test_real_titles(self):
        self.assertEqual(sp.weather_as_of(PAGE), ("clock", 7 * 60 + 45))
        self.assertIsNone(sp.weather_as_of(PAGE_PRE))
        # 2026-11-19 桐生のページを後日開いた時の見出し（12R / 1R）
        self.assertEqual(sp.weather_as_of(_titled("水面気象情報　11R時点")), ("race", 11))
        self.assertEqual(sp.weather_as_of(_titled("水面気象情報　20:34現在")), ("clock", 20 * 60 + 34))
        self.assertIsNone(sp.weather_as_of(_titled("水面気象情報　&nbsp;")))
        self.assertIsNone(sp.weather_as_of(_titled("水面気象情報")))
        for bad in ("<html></html>", "", None, 5):
            self.assertIsNone(sp.weather_as_of(bad), repr(bad))

    def test_at_race_needs_an_earlier_race(self):
        self.assertTrue(sp.weather_fits_race(("race", 11), 12))
        self.assertTrue(sp.weather_fits_race(("race", 3), 12))       # 前のレースが中止の時
        self.assertFalse(sp.weather_fits_race(("race", 12), 12))
        self.assertFalse(sp.weather_fits_race(("race", 11), 1, 600))
        self.assertFalse(sp.weather_fits_race(("race", 0), 5))

    def test_clock_needs_the_deadline_and_a_time_near_it(self):
        self.assertTrue(sp.weather_fits_race(("clock", 7 * 60 + 45), 1, CLOSE_0835))
        self.assertTrue(sp.weather_fits_race(("clock", CLOSE_0835 - 180), 1, CLOSE_0835))
        self.assertFalse(sp.weather_fits_race(("clock", CLOSE_0835 - 181), 1, CLOSE_0835))
        self.assertTrue(sp.weather_fits_race(("clock", CLOSE_0835 + 10), 1, CLOSE_0835))
        self.assertFalse(sp.weather_fits_race(("clock", CLOSE_0835 + 11), 1, CLOSE_0835))
        # 2026-11-19 桐生 1R（締切 15 時台）のページを後日開くと「20:34現在」
        self.assertFalse(sp.weather_fits_race(("clock", 20 * 60 + 34), 1, 15 * 60 + 25))
        self.assertFalse(sp.weather_fits_race(("clock", 7 * 60 + 45), 1))
        self.assertFalse(sp.weather_fits_race(("clock", 7 * 60 + 45), 1, None))

    def test_unreadable_title_is_not_used(self):
        self.assertFalse(sp.weather_fits_race(None, 5, 600))
        self.assertFalse(sp.weather_fits_race(("?", 5), 5, 600))

    def test_same_window_as_the_worker(self):
        """Worker (cloudflare-worker/worker.js) と同じ範囲を使う。"""
        with open(os.path.join(os.path.dirname(__file__), "..", "..", "cloudflare-worker", "worker.js"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn("const WEATHER_CLOCK_BEFORE_MIN = %d;" % sp.WX_CLOCK_BEFORE_MIN, src)
        self.assertIn("const WEATHER_CLOCK_AFTER_MIN = %d;" % sp.WX_CLOCK_AFTER_MIN, src)


def _run_scrape_race(html, rno=1, close_min=CLOSE_0835, action=None):
    async def fake_fetch(session, url, limiter, retries=0):
        return html

    async def go():
        with mock.patch.object(sp, "fetch_with_retry", fake_fetch):
            return await sp.scrape_race(None, None, 14, rno, "20261127",
                                        action or sp.RaceAction.FETCH_EXHIBITION, close_min)
    return asyncio.run(go())


class TestScrapeRace(unittest.TestCase):
    def test_weather_comes_with_the_exhibition(self):
        d = _run_scrape_race(PAGE)
        self.assertEqual({k: v["racer_exhibition_time"] for k, v in d["boats"].items()}, OFFICIAL_ET)
        self.assertEqual(d["weather"], OFFICIAL_WEATHER)

    def test_before_exhibition_nothing_is_stored(self):
        d = _run_scrape_race(PAGE_PRE, rno=12, close_min=20 * 60 + 38)
        self.assertEqual(d["boats"], {})
        self.assertNotIn("weather", d)

    def test_clock_reading_far_from_the_deadline_is_not_stored(self):
        """後から開いた 1R のページ（「現在」= その時刻の値）。展示は入れるが、気象は入れない。"""
        d = _run_scrape_race(PAGE.replace("7:45現在", "20:34現在"))
        self.assertEqual(len(d["boats"]), 6)
        self.assertNotIn("weather", d)

    def test_without_the_deadline_a_clock_reading_is_not_stored(self):
        d = _run_scrape_race(PAGE, close_min=None)
        self.assertEqual(len(d["boats"]), 6)
        self.assertNotIn("weather", d)

    def test_at_race_reading_is_stored_without_the_deadline(self):
        d = _run_scrape_race(PAGE.replace("7:45現在", "11R時点"), rno=12, close_min=None)
        self.assertEqual(d["weather"], OFFICIAL_WEATHER)

    def test_unreadable_weather_block_keeps_the_exhibition(self):
        d = _run_scrape_race(PAGE.replace("weather1_body", "weatherX_body"))
        self.assertEqual(len(d["boats"]), 6)
        self.assertNotIn("weather", d)

    def test_batch_passes_the_deadline_of_each_race(self):
        seen = {}

        async def fake_scrape_race(session, limiter, sid, rno, date_str, action, close_min=None):
            seen[(sid, rno)] = close_min
            return {"stadium": sid, "race": rno, "boats": {}}

        jst = datetime.timezone(datetime.timedelta(hours=9))
        closing = {(14, 1): datetime.datetime(2026, 11, 27, 8, 35, tzinfo=jst),
                   (14, 12): datetime.datetime(2026, 11, 27, 14, 13, tzinfo=jst)}
        targets = [(14, 1, sp.RaceAction.FETCH_EXHIBITION, 1), (14, 12, sp.RaceAction.FETCH_EXHIBITION, 2),
                   (3, 5, sp.RaceAction.FETCH_EXHIBITION, 3)]

        async def go():
            with mock.patch.object(sp, "scrape_race", fake_scrape_race):
                return await sp.scrape_batch(targets, "20261127", closing)
        asyncio.run(go())
        self.assertEqual(seen, {(14, 1): 515, (14, 12): 853, (3, 5): None})


class TestBackfill(unittest.TestCase):
    class _F:
        def __init__(self, html):
            self.html = html
            self.urls = []

        def get(self, url):
            self.urls.append(url)
            return self.html

    def test_past_page_of_race_1_gets_no_weather(self):
        """過去日の 1R のページは、その日の最後の計測値を「現在」として出す（2026-11-19 桐生 1R: 20:34現在）。"""
        f = self._F(PAGE.replace("7:45現在", "20:34現在"))
        got = bf._preview_for(f, 1, 1, "20261119")
        self.assertEqual(len(got["boats"]), 6)
        self.assertIsNone(got["weather"])
        self.assertIn("beforeinfo?rno=1&jcd=01&hd=20261119", f.urls[0])

    def test_past_page_of_race_12_gets_the_reading_at_race_11(self):
        got = bf._preview_for(self._F(PAGE.replace("7:45現在", "11R時点")), 1, 12, "20261119")
        self.assertEqual(got["weather"], OFFICIAL_WEATHER)
        self.assertEqual(got["boats"]["1"]["racer_exhibition_time"], 6.84)

    def test_even_a_morning_clock_reading_is_not_used_for_past_dates(self):
        """過去日では「現在」の値がいつのものか確かめられないので、朝の時刻でも使わない。"""
        self.assertIsNone(bf._preview_for(self._F(PAGE), 14, 1, "20261127")["weather"])

    def test_merge_writes_weather_and_keeps_existing_rows(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "previews"))
            have = {"stadium": 1, "race": 2, "boats": {str(b): {"racer_exhibition_time": 6.7} for b in range(1, 7)},
                    "weather": {"wind_speed": 9}}
            with open(os.path.join(d, "previews", "20261119.json"), "w", encoding="utf-8") as f:
                json.dump({"race_date": "20261119", "races": [have]}, f)
            fetched = {
                (1, 12): bf._preview_for(self._F(PAGE.replace("7:45現在", "11R時点")), 1, 12, "20261119"),
                (1, 1): bf._preview_for(self._F(PAGE.replace("7:45現在", "20:34現在")), 1, 1, "20261119"),
                (1, 2): bf._preview_for(self._F(PAGE.replace("7:45現在", "1R時点")), 1, 2, "20261119"),
            }
            self.assertEqual(bf.merge_previews("20261119", fetched, d), 2)
            with open(os.path.join(d, "previews", "20261119.json"), encoding="utf-8") as f:
                rows = {(r["stadium"], r["race"]): r for r in json.load(f)["races"]}
        self.assertEqual(rows[(1, 12)]["weather"], OFFICIAL_WEATHER)
        self.assertTrue(rows[(1, 12)]["_backfilled"])
        self.assertNotIn("weather", rows[(1, 1)])
        self.assertEqual(len(rows[(1, 1)]["boats"]), 6)
        self.assertEqual(rows[(1, 2)]["weather"], {"wind_speed": 9}, "既にあった行を上書きした")


class TestMergeScraped(unittest.TestCase):
    """取得結果を、これまでのデータに合わせる (merge_scraped)。"""

    BOATS = {str(b): {"racer_exhibition_time": 6.7 + b / 100} for b in range(1, 7)}

    def _row(self, **kw):
        row = {"stadium": 14, "race": 1, "boats": {}, "finished": False, "result": None, "_scraped_at": 100.0}
        row.update(kw)
        return row

    def test_new_exhibition_brings_its_weather(self):
        existing = {}
        n = sp.merge_scraped(existing, {(14, 1): self._row(boats=self.BOATS, weather=OFFICIAL_WEATHER)})
        self.assertEqual(n, 1)
        self.assertEqual(existing[(14, 1)]["weather"], OFFICIAL_WEATHER)

    def test_refetch_without_weather_keeps_the_earlier_weather(self):
        existing = {(14, 1): self._row(boats=self.BOATS, weather=OFFICIAL_WEATHER)}
        sp.merge_scraped(existing, {(14, 1): self._row(boats=self.BOATS, _scraped_at=200.0)})
        self.assertEqual(existing[(14, 1)]["weather"], OFFICIAL_WEATHER)
        self.assertEqual(existing[(14, 1)]["_scraped_at"], 200.0)

    def test_refetch_with_weather_replaces_it(self):
        existing = {(14, 1): self._row(boats=self.BOATS, weather={"wind_speed": 9})}
        sp.merge_scraped(existing, {(14, 1): self._row(boats=self.BOATS, weather=OFFICIAL_WEATHER)})
        self.assertEqual(existing[(14, 1)]["weather"], OFFICIAL_WEATHER)

    def test_result_only_keeps_exhibition_and_weather(self):
        existing = {(14, 1): self._row(boats=self.BOATS, weather=OFFICIAL_WEATHER)}
        res = {"places": [{"place": 1, "boat": 1}]}
        n = sp.merge_scraped(existing, {(14, 1): self._row(finished=True, result=res, _scraped_at=300.0)})
        self.assertEqual(n, 1)
        row = existing[(14, 1)]
        self.assertTrue(row["finished"])
        self.assertEqual(row["result"], res)
        self.assertEqual(row["boats"], self.BOATS)
        self.assertEqual(row["weather"], OFFICIAL_WEATHER)

    def test_nothing_fetched_keeps_existing(self):
        existing = {(14, 1): self._row(boats=self.BOATS, weather=OFFICIAL_WEATHER)}
        n = sp.merge_scraped(existing, {(14, 1): self._row(), (14, 2): self._row(race=2)})
        self.assertEqual(n, 0)
        self.assertEqual(existing[(14, 1)]["weather"], OFFICIAL_WEATHER)
        self.assertEqual(existing[(14, 2)]["boats"], {})

    def test_a_crashed_race_does_not_break_the_others(self):
        """取得が例外で落ちたレースは None で届く。従来はここで例外になり、全レースの書き出しまで失敗した。"""
        existing = {(14, 1): self._row(boats=self.BOATS, weather=OFFICIAL_WEATHER)}
        scraped = {(14, 1): None, (14, 2): self._row(race=2, boats=self.BOATS, weather={"wind_speed": 2}), (14, 3): None}
        n = sp.merge_scraped(existing, scraped)
        self.assertEqual(n, 1)
        self.assertEqual(existing[(14, 1)]["weather"], OFFICIAL_WEATHER)
        self.assertEqual(existing[(14, 2)]["weather"], {"wind_speed": 2})
        self.assertNotIn((14, 3), existing)


class _FixedClock(datetime.datetime):
    """async_main が読む「今」を固定する（締切と気象の計測時刻の関係が、走らせる時刻で変わらないように）。"""
    fixed = None

    @classmethod
    def now(cls, tz=None):
        return cls.fixed.astimezone(tz) if tz else cls.fixed


class TestAsyncMainEndToEnd(unittest.TestCase):
    """async_main を最後まで走らせる（取得だけ差し替える）。

    2026-11-27 まで、_write_output はファイルを書いた直後に毎回 NameError で終了していた。
    どのテストも async_main / _write_output を動かしていなかったので、1 週間気付かなかった。
    """

    JST = datetime.timezone(datetime.timedelta(hours=9))
    PROGRAMS = {"programs": [
        {"race_stadium_number": 14, "race_number": 1, "race_date": "2026-11-27", "race_closed_at": "2026-11-27 08:35:00"},
        {"race_stadium_number": 14, "race_number": 2, "race_date": "2026-11-27", "race_closed_at": "2026-11-27 09:03:00"},
        {"race_stadium_number": 14, "race_number": 12, "race_date": "2026-11-27", "race_closed_at": "2026-11-27 14:13:00"},
    ]}

    def _run(self, hour, minute, fetch, existing=None):
        """(出力 JSON, 記録された取得状況) を返す。"""
        from http_utils import SourceBlockDetector
        _FixedClock.fixed = datetime.datetime(2026, 11, 27, hour, minute, tzinfo=self.JST)
        recorded = {}
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "previews", "today.json")
            if existing is not None:
                os.makedirs(os.path.dirname(out))
                with open(out, "w", encoding="utf-8") as f:
                    json.dump(existing, f)
            with mock.patch.object(sp, "OUTPUT", out), \
                    mock.patch.object(sp, "SCRAPE_STATE", os.path.join(d, "previews", ".state.json")), \
                    mock.patch.object(sp, "PROGRAMS_CACHE", os.path.join(d, "previews", ".cache.json")), \
                    mock.patch.object(sp, "BLOCK", SourceBlockDetector()), \
                    mock.patch.object(sp, "datetime", _FixedClock), \
                    mock.patch.object(sp, "load_local_official_programs", lambda: self.PROGRAMS), \
                    mock.patch.object(sp, "fetch_with_retry", fetch), \
                    mock.patch.object(sp, "write_source_status", lambda task, stats: recorded.update({task: stats})):
                asyncio.run(sp.async_main())
            with open(out, encoding="utf-8") as f:
                return json.load(f), recorded

    @staticmethod
    def _fetch(pages):
        async def fake(session, url, limiter, retries=0):
            for key, html in pages.items():
                if key in url:
                    if isinstance(html, Exception):
                        raise html
                    return html
            return None
        return fake

    def test_exhibition_and_weather_reach_the_output_and_the_status(self):
        out, rec = self._run(8, 10, self._fetch({"beforeinfo?rno=1&": PAGE, "beforeinfo?rno=2&": PAGE_PRE}))
        rows = {(r["stadium"], r["race"]): r for r in out["races"]}
        self.assertEqual(sorted(rows), [(14, 1), (14, 2), (14, 12)])
        self.assertEqual({k: v["racer_exhibition_time"] for k, v in rows[(14, 1)]["boats"].items()}, OFFICIAL_ET)
        self.assertEqual(rows[(14, 1)]["weather"], OFFICIAL_WEATHER)
        self.assertEqual(rows[(14, 2)]["boats"], {})
        self.assertNotIn("weather", rows[(14, 2)])
        for r in out["races"]:
            self.assertFalse([k for k in r if k.startswith("_")], "内部用の項目が出力に残っている")
        self.assertEqual(out["race_date"], "20261127")
        st = rec["previews"]
        # 1R = 展示あり、2R = 展示前のページ（読めたが中身なし）。12R は締切が遠いので取りに行かない
        self.assertEqual((st["attempted"], st["updated"], st["exhibition"], st["weather"]), (2, 2, 1, 1))
        self.assertIn("http_403", st)

    def test_only_pre_exhibition_pages_still_count_as_read(self):
        """展示前のレースしか無い回を「1 件も取れていない」と記録しない（取得元ブロックの通知が誤って開く）。"""
        _, rec = self._run(8, 10, self._fetch({"beforeinfo": PAGE_PRE}))
        st = rec["previews"]
        self.assertEqual((st["attempted"], st["updated"], st["exhibition"], st["weather"]), (2, 2, 0, 0))

    def test_unreachable_source_is_recorded_as_nothing_read(self):
        _, rec = self._run(8, 10, self._fetch({}))
        st = rec["previews"]
        self.assertEqual((st["attempted"], st["updated"]), (2, 0))

    def test_no_targets_still_writes_and_records(self):
        """取りに行くレースが無い回（深夜など）。従来はここも NameError で終了していた。"""
        out, rec = self._run(3, 0, self._fetch({"beforeinfo": PAGE}))
        self.assertEqual(len(out["races"]), 3)
        self.assertEqual((rec["previews"]["attempted"], rec["previews"]["updated"]), (0, 0))

    def test_one_crashing_race_does_not_lose_the_others(self):
        out, rec = self._run(8, 10, self._fetch({"beforeinfo?rno=1&": PAGE, "beforeinfo?rno=2&": RuntimeError("boom")}))
        rows = {(r["stadium"], r["race"]): r for r in out["races"]}
        self.assertEqual(rows[(14, 1)]["weather"], OFFICIAL_WEATHER)
        self.assertEqual(rows[(14, 2)]["boats"], {})
        self.assertEqual((rec["previews"]["attempted"], rec["previews"]["exhibition"]), (2, 1))

    def test_weather_survives_a_later_result_only_run(self):
        """締切後の回（結果だけ取る）で、前の回に入れた展示・気象が消えない。"""
        existing = {"updated_at": "2026-11-26T23:10:00Z", "race_date": "20261127", "races": [
            {"stadium": 14, "race": 1, "boats": {str(b): {"racer_exhibition_time": 6.8} for b in range(1, 7)},
             "weather": OFFICIAL_WEATHER, "finished": False, "result": None},
        ]}
        out, rec = self._run(8, 40, self._fetch({}), existing)
        row = [r for r in out["races"] if r["race"] == 1][0]
        self.assertEqual(row["weather"], OFFICIAL_WEATHER)
        self.assertEqual(len(row["boats"]), 6)


if __name__ == "__main__":
    unittest.main()
