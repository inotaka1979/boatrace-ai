"""選手ごとの出走ログ (scripts/build_racer_log.py、2026-11-26) の回帰テスト

  - 解析版 2 の結果: 登録番号・進入・ST・決まり手つきの行
  - 解析版 1 の結果: 番組表で選手を当てて「着順のみ」の行（番組表が無ければ作らない）
  - 着順の付かなかった艇: out_boats の表記 / 番組表にいるのに結果に出てこない艇は理由不明 ("?")
  - 今日のレースは入れない。日付はファイル名ではなく各レースの race_date で決める
  - 直近の日付は毎回作り直し、古い日付は既存のログを引き継ぐ（アーカイブが消えても残る）
  - 内容が変わらなければ何も書かない

    python3 -m unittest scripts.tests.test_build_racer_log -v
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import build_racer_log as bl  # noqa: E402

TODAY = datetime.date(2026, 11, 26)


def _boat(bn, place, rid=None, course=None, st=None, kind=None):
    b = {"racer_boat_number": bn, "racer_place_number": place, "racer_course_number": course or bn,
         "racer_name": "x", "racer_start_timing": st, "racer_number": rid}
    if kind:
        b["racer_start_kind"] = kind
    return b


def v2(sid, rno, date, boats, tech=1, out=None, **extra):
    r = {"race_stadium_number": sid, "race_number": rno, "race_date": date, "race_technique_number": tech,
         "boats": boats, "_course_from_start": True, "_parse_v": 2}
    if out:
        r["out_boats"] = out
    r.update(extra)
    return r


def v1(sid, rno, date, order):
    """解析版 1: 着順と艇番だけ（登録番号・ST なし、進入は枠番、決まり手は常に 1）"""
    return {"race_stadium_number": sid, "race_number": rno, "race_date": date, "race_technique_number": 1,
            "boats": [{"racer_boat_number": bn, "racer_place_number": i + 1, "racer_course_number": bn,
                       "racer_name": None, "racer_start_timing": None, "racer_number": None}
                      for i, bn in enumerate(order)]}


def prog(sid, rno, date, ids, grade=5):
    return {"race_stadium_number": sid, "race_number": rno, "race_date": date, "race_grade_number": grade,
            "boats": [{"racer_boat_number": i + 1, "racer_number": rid} for i, rid in enumerate(ids)]}


def six(ids, places=(1, 2, 3, 4, 5, 6), st=0.15):
    return [_boat(i + 1, places[i], ids[i], st=st) for i in range(6)]


IDS = [4001, 4002, 4003, 4004, 4005, 4006]


class _Dir:
    def __init__(self):
        self._t = tempfile.TemporaryDirectory()
        self.d = self._t.name

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self._t.cleanup()

    def write(self, domain, name, key, rows):
        os.makedirs(os.path.join(self.d, domain), exist_ok=True)
        with open(os.path.join(self.d, domain, name + ".json"), "w", encoding="utf-8") as f:
            json.dump({key: rows}, f)

    def results(self, name, rows):
        self.write("results", name, "results", rows)

    def programs(self, name, rows):
        self.write("programs", name, "programs", rows)

    def remove(self, domain, name):
        os.remove(os.path.join(self.d, domain, name + ".json"))

    def build(self, today=TODAY, **kw):
        return bl.build(data_dir=self.d, today=today, **kw)

    def shard(self, n):
        p = os.path.join(self.d, "db", "racer_log", f"{n:02d}.json")
        if not os.path.exists(p):
            return None
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    def rows(self, rid):
        s = self.shard(rid % 100)
        return (s or {}).get("racers", {}).get(str(rid), [])

    def index(self):
        with open(os.path.join(self.d, "db", "racer_log", "index.json"), encoding="utf-8") as f:
            return json.load(f)

    def mtimes(self):
        out = {}
        base = os.path.join(self.d, "db", "racer_log")
        for n in sorted(os.listdir(base)):
            out[n] = os.stat(os.path.join(base, n)).st_mtime_ns
        return out


class TestEntries(unittest.TestCase):
    def test_v2_race_has_course_st_technique_and_grade(self):
        with _Dir() as d:
            boats = [_boat(3, 1, 4001, course=2, st=0.06), _boat(1, 2, 4002, course=1, st=0.14),
                     _boat(2, 3, 4003, course=3, st=0.21), _boat(4, 4, 4004, st=0.18),
                     _boat(5, 5, 4005, st=0.2), _boat(6, 6, 4006, st=0.33)]
            d.results("20261125", [v2(8, 12, "2026-11-25", boats, tech=4)])
            d.programs("20261125", [prog(8, 12, "2026-11-25", [4002, 4003, 4001, 4004, 4005, 4006], grade=1)])
            s = d.build()
            #                  ymd       sid rno 枠 進入 ST 着 決 理由 グレード
            self.assertEqual(d.rows(4001), [[20261125, 8, 12, 3, 2, 6, 1, 4, "", 1]])
            self.assertEqual(d.rows(4002), [[20261125, 8, 12, 1, 1, 14, 2, 4, "", 1]])
            self.assertEqual(d.rows(4006), [[20261125, 8, 12, 6, 6, 33, 6, 4, "", 1]])
            self.assertEqual((s["racers"], s["entries"]), (6, 6))
            self.assertEqual(d.index()["detail_from"], "20261125")

    def test_shard_is_registration_number_mod_100(self):
        with _Dir() as d:
            ids = [4320, 3305, 5000, 4099, 4420, 12345]
            d.results("20261125", [v2(8, 1, "2026-11-25", six(ids))])
            d.build()
            self.assertEqual(sorted(d.shard(20)["racers"]), ["4320", "4420"])
            self.assertIn("3305", d.shard(5)["racers"])
            self.assertIn("5000", d.shard(0)["racers"])
            self.assertIn("4099", d.shard(99)["racers"])
            self.assertIn("12345", d.shard(45)["racers"])
            self.assertEqual(d.shard(20)["v"], 1)

    def test_v1_race_gets_racers_from_the_program_and_keeps_only_the_place(self):
        with _Dir() as d:
            d.results("20261118", [v1(15, 11, "2026-11-18", [2, 1, 3, 4, 5, 6])])
            d.programs("20261118", [prog(15, 11, "2026-11-18", IDS, grade=2)])
            d.build()
            # 進入・ST は分からない。解析版 1 の決まり手（常に 1）は使わない
            self.assertEqual(d.rows(4002), [[20261118, 15, 11, 2, None, None, 1, 0, "", 2]])
            self.assertEqual(d.rows(4001), [[20261118, 15, 11, 1, None, None, 2, 0, "", 2]])
            self.assertEqual(d.index()["detail_from"], "")

    def test_v1_race_without_a_program_is_skipped(self):
        with _Dir() as d:
            d.results("20261118", [v1(15, 11, "2026-11-18", [2, 1, 3, 4, 5, 6])])
            s = d.build()
            self.assertEqual(s["entries"], 0)

    def test_v2_race_without_a_program_still_works(self):
        with _Dir() as d:
            d.results("20261125", [v2(8, 1, "2026-11-25", six(IDS))])
            d.build()
            self.assertEqual(d.rows(4001), [[20261125, 8, 1, 1, 1, 15, 1, 1, "", 0]])

    def test_boats_without_a_place_keep_their_reason(self):
        with _Dir() as d:
            boats = [_boat(5, 1, 4005, st=0.29), _boat(2, 2, 4002, st=0.26), _boat(1, 3, 4001, st=0.32), _boat(6, 4, 4006, st=0.47)]
            out = [{"racer_boat_number": 3, "racer_out": "落", "racer_course_number": 3, "racer_start_timing": 0.33, "racer_number": 4003},
                   {"racer_boat_number": 4, "racer_out": "F", "racer_course_number": 4, "racer_start_timing": -0.01, "racer_number": 4004}]
            d.results("20261120", [v2(17, 5, "2026-11-20", boats, tech=2, out=out)])
            d.programs("20261120", [prog(17, 5, "2026-11-20", IDS)])
            d.build()
            self.assertEqual(d.rows(4003), [[20261120, 17, 5, 3, 3, 33, 0, 2, "落", 5]])
            self.assertEqual(d.rows(4004), [[20261120, 17, 5, 4, 4, -1, 0, 2, "F", 5]])
            self.assertEqual(d.rows(4005)[0][6], 1)

    def test_program_boat_missing_from_the_result_is_an_unknown_non_finisher(self):
        # out_boats を持たない結果（2026-11-26 より前に取ったもの）: 番組表にいるのに着順の無い艇
        with _Dir() as d:
            boats = [_boat(5, 1, 4005), _boat(2, 2, 4002), _boat(1, 3, 4001), _boat(6, 4, 4006)]
            d.results("20261120", [v2(17, 5, "2026-11-20", boats, tech=2)])
            d.programs("20261120", [prog(17, 5, "2026-11-20", IDS)])
            d.build()
            self.assertEqual(d.rows(4003), [[20261120, 17, 5, 3, None, None, 0, 2, "?", 5]])
            self.assertEqual(d.rows(4004), [[20261120, 17, 5, 4, None, None, 0, 2, "?", 5]])
            # v1 でも同じ
            d.results("20261118", [v1(15, 2, "2026-11-18", [1, 2, 3, 4])])
            d.programs("20261118", [prog(15, 2, "2026-11-18", IDS)])
            d.build()
            self.assertEqual(d.rows(4006)[-1], [20261118, 15, 2, 6, None, None, 0, 0, "?", 5])

    def test_f_or_l_mark_is_kept_even_with_a_place(self):
        with _Dir() as d:
            boats = six(IDS)
            boats[2] = _boat(3, 3, 4003, st=-0.02, kind="F")
            d.results("20261125", [v2(8, 1, "2026-11-25", boats)])
            d.build()
            self.assertEqual(d.rows(4003), [[20261125, 8, 1, 3, 3, -2, 3, 1, "F", 0]])

    def test_unknown_technique_and_unread_course_are_left_empty(self):
        with _Dir() as d:
            r = v2(8, 1, "2026-11-25", six(IDS), tech=1, technique_unknown=True)
            r2 = v2(8, 2, "2026-11-25", six(IDS), tech=3)
            r2["_course_from_start"] = False
            d.results("20261125", [r, r2])
            d.build()
            rows = {e[2]: e for e in d.rows(4002)}
            self.assertEqual(rows[1][7], 0, "決まり手が読めなかったレース")
            self.assertEqual(rows[1][4], 2)
            self.assertIsNone(rows[2][4], "スタート情報を読めなかったレースの進入は出さない")
            self.assertEqual(rows[2][7], 3)

    def test_cancelled_and_unfinished_races_are_excluded(self):
        with _Dir() as d:
            cancelled = v2(8, 1, "2026-11-25", [], tech=0, race_cancelled=True)
            not_yet = v2(8, 2, "2026-11-25", six(IDS), tech=0)
            two = v2(8, 3, "2026-11-25", six(IDS)[:2])
            ok = v2(8, 4, "2026-11-25", six(IDS))
            d.results("20261125", [cancelled, not_yet, two, ok])
            d.build()
            self.assertEqual([e[2] for e in d.rows(4001)], [4])

    def test_bad_values_do_not_break_the_build(self):
        with _Dir() as d:
            boats = six(IDS)
            boats[0]["racer_start_timing"] = "0.15"
            boats[1]["racer_start_timing"] = float("nan")
            boats[2]["racer_course_number"] = 9
            boats[3]["racer_number"] = None
            boats[4]["racer_boat_number"] = 0
            d.results("20261125", [v2(8, 1, "2026-11-25", boats), "x", None, {"boats": "x"},
                                   v2(8, None, "2026-11-25", six(IDS)), v2(8, 2, "not-a-date", six(IDS))])
            d.write("results", "20261124", "results", {"not": "a list"})
            d.build()
            self.assertEqual(d.rows(4001), [[20261125, 8, 1, 1, 1, None, 1, 1, "", 0]])
            self.assertEqual(d.rows(4002)[0][5], None)
            self.assertEqual(d.rows(4003)[0][4], None)
            self.assertEqual(d.rows(4004), [], "登録番号の分からない艇")
            self.assertEqual(d.rows(4005), [], "艇番のおかしい艇")
            self.assertEqual(len(d.rows(4006)), 1)


class TestDates(unittest.TestCase):
    def test_today_is_excluded(self):
        with _Dir() as d:
            d.results("20261126", [v2(8, 1, "2026-11-26", six(IDS))])
            d.results("20261125", [v2(8, 2, "2026-11-25", six(IDS))])
            d.build()
            self.assertEqual([e[0] for e in d.rows(4001)], [20261125])
            # 翌日になれば入る
            d.build(today=datetime.date(2026, 11, 27))
            self.assertEqual([e[0] for e in d.rows(4001)], [20261126, 20261125])

    def test_date_comes_from_the_race_not_the_file_name(self):
        # 日付が変わった直後、今日の日付のファイルに前日のレースが入っていることがある
        with _Dir() as d:
            d.results("20261126", [v2(8, 1, "2026-11-25", six(IDS))])
            d.build()
            self.assertEqual(d.rows(4001), [[20261125, 8, 1, 1, 1, 15, 1, 1, "", 0]])

    def test_same_race_in_two_files_uses_the_better_one(self):
        with _Dir() as d:
            d.results("20261125", [v2(8, 1, "2026-11-25", six(IDS, st=0.11))])
            d.results("20261126", [v1(8, 1, "2026-11-25", [1, 2, 3, 4, 5, 6])])
            d.programs("20261125", [prog(8, 1, "2026-11-25", IDS)])
            d.build()
            self.assertEqual(len(d.rows(4001)), 1)
            self.assertEqual(d.rows(4001)[0][5], 11, "解析版 2 のほうを使う")
            with _Dir() as e:
                # ファイルの順が逆でも同じ
                e.results("20261124", [v2(8, 1, "2026-11-25", six(IDS, st=0.11))])
                e.results("20261125", [v1(8, 1, "2026-11-25", [1, 2, 3, 4, 5, 6])])
                e.programs("20261125", [prog(8, 1, "2026-11-25", IDS)])
                e.build()
                self.assertEqual(e.rows(4001)[0][5], 11)

    def test_newest_first_and_later_race_first(self):
        with _Dir() as d:
            d.results("20261125", [v2(8, 3, "2026-11-25", six(IDS)), v2(8, 11, "2026-11-25", six(IDS))])
            d.results("20261124", [v2(8, 5, "2026-11-24", six(IDS))])
            d.results("20261123", [v2(15, 9, "2026-11-23", six(IDS))])
            d.build()
            self.assertEqual([(e[0], e[2]) for e in d.rows(4001)],
                             [(20261125, 11), (20261125, 3), (20261124, 5), (20261123, 9)])

    def test_cap_per_racer_and_age_limit(self):
        with _Dir() as d:
            day = datetime.date(2026, 11, 25)
            for i in range(40):
                dt = day - datetime.timedelta(days=i)
                d.results(dt.strftime("%Y%m%d"), [v2(8, 1, dt.isoformat(), six(IDS)), v2(8, 7, dt.isoformat(), six(IDS))])
            d.build()
            rows = d.rows(4001)
            self.assertEqual(len(rows), bl.MAX_PER_RACER)
            self.assertEqual(rows[0][0], 20261125)
            self.assertEqual(rows[-1][0], int((day - datetime.timedelta(days=29)).strftime("%Y%m%d")))
            # 400 日より古い行は捨てる
            later = datetime.date(2027, 12, 31)
            d.build(today=later)
            self.assertEqual(d.rows(4001), [])


class TestIncremental(unittest.TestCase):
    def test_second_run_writes_nothing(self):
        with _Dir() as d:
            d.results("20261125", [v2(8, 1, "2026-11-25", six(IDS))])
            first = d.build()
            self.assertGreater(first["written"], 0)
            before = d.mtimes()
            idx = d.index()
            second = d.build()
            self.assertEqual(second["written"], 0)
            self.assertEqual(d.mtimes(), before, "内容が同じなのにファイルを書き直した")
            self.assertEqual(d.index(), idx)

    def test_old_dates_survive_after_the_archive_is_gone(self):
        with _Dir() as d:
            d.results("20261101", [v2(8, 1, "2026-11-01", six(IDS))])
            d.results("20261125", [v2(8, 2, "2026-11-25", six(IDS))])
            d.build()
            self.assertEqual([e[0] for e in d.rows(4001)], [20261125, 20261101])
            d.remove("results", "20261101")  # 保存期間を過ぎてアーカイブから消えた
            d.results("20261126", [v2(8, 3, "2026-11-26", six(IDS))])
            d.build(today=datetime.date(2026, 11, 27))
            self.assertEqual([e[0] for e in d.rows(4001)], [20261126, 20261125, 20261101])

    def test_recent_dates_are_rebuilt_when_the_result_improves(self):
        # 解析版 1 で作った行が、結果の取り直し（解析版 2）で詳しくなる
        with _Dir() as d:
            d.results("20261124", [v1(8, 1, "2026-11-24", [1, 2, 3, 4, 5, 6])])
            d.programs("20261124", [prog(8, 1, "2026-11-24", IDS)])
            d.build()
            self.assertEqual(d.rows(4001), [[20261124, 8, 1, 1, None, None, 1, 0, "", 5]])
            d.results("20261124", [v2(8, 1, "2026-11-24", six(IDS, st=0.12), tech=1)])
            d.build()
            self.assertEqual(d.rows(4001), [[20261124, 8, 1, 1, 1, 12, 1, 1, "", 5]])

    def test_dates_older_than_the_window_are_not_rebuilt(self):
        with _Dir() as d:
            d.results("20261110", [v2(8, 1, "2026-11-10", six(IDS, st=0.12))])
            d.build()
            d.results("20261110", [v2(8, 1, "2026-11-10", six(IDS, st=0.3))])  # 窓の外の日付が変わっても
            d.build()
            self.assertEqual(d.rows(4001)[0][5], 12, "直近 7 日より前は作り直さない")
            d.build(full=True)
            self.assertEqual(d.rows(4001)[0][5], 30, "--full なら全部作り直す")

    def test_old_date_never_seen_before_is_still_built(self):
        # しばらく止まっていた後: 窓（7 日）より古いが、ログにまだ 1 行も無い日付
        with _Dir() as d:
            d.results("20261125", [v2(8, 1, "2026-11-25", six(IDS))])
            d.build()
            d.results("20261110", [v2(15, 3, "2026-11-10", six(IDS))])
            s = d.build()
            self.assertFalse(s["bootstrap"])
            self.assertEqual([e[0] for e in d.rows(4001)], [20261125, 20261110])

    def test_recent_date_without_archive_data_keeps_existing_rows(self):
        with _Dir() as d:
            d.results("20261125", [v2(8, 1, "2026-11-25", six(IDS))])
            d.build()
            d.remove("results", "20261125")  # 直近の日付のファイルが（事故で）無くなっても
            d.build()
            self.assertEqual([e[0] for e in d.rows(4001)], [20261125], "既存の行を消さない")

    def test_bootstrap_without_index_rebuilds_everything(self):
        with _Dir() as d:
            d.results("20261101", [v2(8, 1, "2026-11-01", six(IDS))])
            s = d.build()
            self.assertTrue(s["bootstrap"])
            self.assertEqual(len(d.rows(4001)), 1)
            self.assertFalse(d.build()["bootstrap"])

    def test_broken_existing_files_are_ignored(self):
        with _Dir() as d:
            d.results("20261125", [v2(8, 1, "2026-11-25", six(IDS))])
            d.build()
            base = os.path.join(d.d, "db", "racer_log")
            with open(os.path.join(base, "01.json"), "w", encoding="utf-8") as f:
                f.write("{broken")
            with open(os.path.join(base, "02.json"), "w", encoding="utf-8") as f:
                json.dump({"v": 1, "racers": {"4002": [[20261101, 8, 1, 2, 2, 15, 2, 1, "", 0], ["x"], [1, 2], None], "abc": [[1]]}}, f)
            d.build()
            self.assertEqual(d.rows(4001), [[20261125, 8, 1, 1, 1, 15, 1, 1, "", 0]])
            self.assertEqual([e[0] for e in d.rows(4002)], [20261125, 20261101], "形の合う行だけ引き継ぐ")
            self.assertNotIn("abc", d.shard(2)["racers"])

    def test_index_summarises_the_log(self):
        with _Dir() as d:
            d.results("20261118", [v1(15, 11, "2026-11-18", [1, 2, 3, 4, 5, 6])])
            d.programs("20261118", [prog(15, 11, "2026-11-18", IDS)])
            d.results("20261125", [v2(8, 1, "2026-11-25", six(IDS))])
            d.build()
            idx = d.index()
            self.assertEqual({k: idx[k] for k in ("v", "from", "to", "detail_from", "racers", "entries")},
                             {"v": 1, "from": "20261118", "to": "20261125", "detail_from": "20261125", "racers": 6, "entries": 12})
            self.assertRegex(idx["updated_at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class TestWiring(unittest.TestCase):
    def test_scrape_all_runs_it_after_the_archive_and_never_fails_the_run(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        with open(os.path.join(root, "scripts", "scrape_all.py"), encoding="utf-8") as f:
            src = f.read()
        i_arc = src.index('_run_subprocess("archive_daily.py"')
        i_log = src.index('_run_subprocess("build_racer_log.py"')
        self.assertGreater(i_log, i_arc, "アーカイブの後に作る")
        block = src[i_log - 200: i_log + 400]
        self.assertIn("try:", block)
        self.assertIn("non-fatal", block)

    def test_committed_data_matches_the_format(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        base = os.path.join(root, "data", "db", "racer_log")
        with open(os.path.join(base, "index.json"), encoding="utf-8") as f:
            idx = json.load(f)
        n = 0
        for i in range(bl.SHARDS):
            with open(os.path.join(base, f"{i:02d}.json"), encoding="utf-8") as f:
                d = json.load(f)
            for rid, rows in d["racers"].items():
                self.assertEqual(int(rid) % bl.SHARDS, i)
                self.assertLessEqual(len(rows), bl.MAX_PER_RACER)
                self.assertEqual(rows, sorted(rows, key=bl._sort_key), rid)
                for e in rows:
                    self.assertTrue(bl._valid_entry(e), (rid, e))
                    n += 1
        self.assertEqual(n, idx["entries"])


if __name__ == "__main__":
    unittest.main()
