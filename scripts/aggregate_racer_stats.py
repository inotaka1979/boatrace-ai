#!/usr/bin/env python3
"""選手・モーターの長期集計 (2026-11-20)。

日次アーカイブ (data/results・previews・programs/YYYYMMDD.json) は 45〜180 日で消えるため、確定した日を
1 日ずつ月別の集計に畳み込み、data/db/racer_stats.json に最大 MONTHS_KEPT か月残す。
アプリ用には直近の窓で合算した小さい data/db/racer_stats_view.json を書く。

集計するもの（選手は登録番号、モーターは場 × モーター番号）:
  c   コース別 [出走, 1着, 2連対, 3連対]
  kw  コース別の勝ち決まり手 {決まり手番号: 回数}（1 コースなら逃げ率）
  l1  1 コースで負けたときの勝者の決まり手（2 差され / 3 捲られ / 4 捲られ差し / 5 抜かれ / 6 恵まれ）
  st  本番 ST [合計, 件数, F 回数, L 回数]（F / L は合計に入れない）
  sz  本番 ST − 展示 ST [合計, 絶対値の合計, 件数]（展示と本番のスタートのズレ）
  motor  [出走, 1着, 2連対, 3連対]

入力の条件:
  * 結果は scrape_results の解析版 2 (`_parse_v >= 2`: 登録番号・進入コース・ST・決まり手を実際に読んだもの)
    だけを使う。旧版は決まり手が常に 1 (逃げ)、進入 = 枠番だったため集計を汚す。
  * 今日 (JST) の日付は畳まない（結果が揃っていない）。確定レースの 90% 以上が解析版 2 の日だけを畳み、
    畳んだ日は processed に記録して二度と足さない（月別の加算なので二重計上を防ぐ）。

    python3 scripts/aggregate_racer_stats.py [--data data] [--today YYYYMMDD]
"""

from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402

JST = datetime.timezone(datetime.timedelta(hours=9))
MONTHS_KEPT = 24
VIEW_MONTHS = 12          # 選手: 直近 12 か月
MOTOR_VIEW_MONTHS = 6     # モーター: 直近 6 か月（場ごとに年 1 回程度入れ替わる）
MIN_V2_RATIO = 0.9
STATS_FILE = "racer_stats.json"
VIEW_FILE = "racer_stats_view.json"
_DATED = re.compile(r"^(\d{8})\.json$")


def _load(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _empty_stats() -> dict:
    return {"version": 1, "processed": {}, "racers": {}, "motors": {}}


def _bump(arr: list, idx_vals: list[tuple[int, float]]) -> None:
    for i, v in idx_vals:
        arr[i] += v


def _vec(d: dict, key: str, n: int) -> list:
    v = d.get(key)
    if not isinstance(v, list) or len(v) != n:
        v = [0] * n
        d[key] = v
    return v


def _finished(r: dict) -> bool:
    return bool(r.get("race_technique_number")) and sum(
        1 for b in r.get("boats") or [] if isinstance(b.get("racer_place_number"), int)) >= 3


def day_quality(results: dict | None) -> tuple[int, int]:
    """(確定レース数, うち解析版 2 の数)"""
    rs = [r for r in (results or {}).get("results") or [] if _finished(r)]
    return len(rs), sum(1 for r in rs if (r.get("_parse_v") or 0) >= 2)


def fold_day(stats: dict, date: str, results: dict, previews: dict | None, programs: dict | None) -> int:
    """1 日分を月別集計に足す。足したレース数を返す。"""
    month = date[:6]
    pv_idx = {}
    for p in (previews or {}).get("races") or []:
        pv_idx[(p.get("stadium"), p.get("race"))] = p.get("boats") or {}
    motor_idx = {}
    for p in (programs or {}).get("programs") or []:
        for b in p.get("boats") or []:
            motor_idx[(p.get("race_stadium_number"), p.get("race_number"), b.get("racer_boat_number"))] = \
                b.get("racer_assigned_motor_number")
    racers = stats.setdefault("racers", {})
    motors = stats.setdefault("motors", {})
    n = 0
    for r in (results or {}).get("results") or []:
        if not _finished(r) or (r.get("_parse_v") or 0) < 2:
            continue
        sid, rno = r.get("race_stadium_number"), r.get("race_number")
        tech = None if r.get("technique_unknown") else r.get("race_technique_number")
        boats = [b for b in r.get("boats") or [] if isinstance(b.get("racer_place_number"), int)]
        winner = next((b for b in boats if b["racer_place_number"] == 1), None)
        pv = pv_idx.get((sid, rno)) or {}
        n += 1
        for b in boats:
            place = b["racer_place_number"]
            course = b.get("racer_course_number")
            bn = b.get("racer_boat_number")
            # モーター（programs が残っている日だけ）
            mno = motor_idx.get((sid, rno, bn))
            if mno:
                mv = _vec(motors.setdefault(str(sid), {}).setdefault(str(mno), {}), month, 4)
                _bump(mv, [(0, 1), (1, place == 1), (2, place <= 2), (3, place <= 3)])
            rid = b.get("racer_number")
            if not rid or not isinstance(course, int) or not 1 <= course <= 6:
                continue
            ent = racers.setdefault(str(rid), {"m": {}})
            if b.get("racer_name"):
                ent["name"] = re.sub(r"\s+", " ", str(b["racer_name"]).replace("　", " ")).strip()
            m = ent["m"].setdefault(month, {})
            cv = _vec(m.setdefault("c", {}), str(course), 4)
            _bump(cv, [(0, 1), (1, place == 1), (2, place <= 2), (3, place <= 3)])
            if tech:
                if place == 1:
                    kw = m.setdefault("kw", {}).setdefault(str(course), {})
                    kw[str(tech)] = kw.get(str(tech), 0) + 1
                elif course == 1 and winner is not None:
                    l1 = m.setdefault("l1", {})
                    l1[str(tech)] = l1.get(str(tech), 0) + 1
            st = b.get("racer_start_timing")
            kind = b.get("racer_start_kind")
            sv = _vec(m, "st", 4)
            if kind == "F":
                sv[2] += 1
            elif kind == "L":
                sv[3] += 1
            elif isinstance(st, (int, float)):
                sv[0] = round(sv[0] + st, 4)
                sv[1] += 1
                ex = (pv.get(str(bn)) or {}).get("racer_start_timing")
                if isinstance(ex, (int, float)) and 0 <= ex < 1:
                    zv = _vec(m, "sz", 3)
                    d = st - ex
                    zv[0] = round(zv[0] + d, 4)
                    zv[1] = round(zv[1] + abs(d), 4)
                    zv[2] += 1
    return n


def prune_months(stats: dict, today: datetime.date, keep: int = MONTHS_KEPT) -> bool:
    """keep か月より古い月を捨てる。何か捨てたら True。"""
    removed = False
    y, mo = today.year, today.month
    for _ in range(keep - 1):
        mo -= 1
        if mo == 0:
            y, mo = y - 1, 12
    cutoff = f"{y:04d}{mo:02d}"
    for ent in stats.get("racers", {}).values():
        for k in [k for k in ent.get("m", {}) if k < cutoff]:
            del ent["m"][k]
            removed = True
    for sm in stats.get("motors", {}).values():
        for mv in sm.values():
            for k in [k for k in mv if k < cutoff]:
                del mv[k]
                removed = True
    stats["racers"] = {k: v for k, v in stats.get("racers", {}).items() if v.get("m")}
    return removed


def _months_back(today: datetime.date, n: int) -> list[str]:
    out = []
    y, mo = today.year, today.month
    for _ in range(n):
        out.append(f"{y:04d}{mo:02d}")
        mo -= 1
        if mo == 0:
            y, mo = y - 1, 12
    return out


def build_view(stats: dict, today: datetime.date) -> dict:
    """直近 VIEW_MONTHS か月（モーターは MOTOR_VIEW_MONTHS）で合算したアプリ用の小さい集計。"""
    months = set(_months_back(today, VIEW_MONTHS))
    racers = {}
    for rid, ent in stats.get("racers", {}).items():
        c, kw, l1 = {}, {}, {}
        st = [0.0, 0, 0, 0]
        sz = [0.0, 0.0, 0]
        for mk, m in ent.get("m", {}).items():
            if mk not in months:
                continue
            for cs, v in (m.get("c") or {}).items():
                acc = c.setdefault(cs, [0, 0, 0, 0])
                for i in range(4):
                    acc[i] += v[i]
            for cs, d in (m.get("kw") or {}).items():
                acc = kw.setdefault(cs, {})
                for t, k in d.items():
                    acc[t] = acc.get(t, 0) + k
            for t, k in (m.get("l1") or {}).items():
                l1[t] = l1.get(t, 0) + k
            for i, v in enumerate(m.get("st") or []):
                st[i] += v
            for i, v in enumerate(m.get("sz") or []):
                sz[i] += v
        if not c:
            continue
        out = {"c": c}
        if ent.get("name"):
            out["n"] = ent["name"]
        if kw:
            out["kw"] = kw
        if l1:
            out["l1"] = l1
        if st[1]:
            out["st"] = [round(st[0] / st[1], 3), st[1], st[2], st[3]]
        elif st[2] or st[3]:
            out["st"] = [None, 0, st[2], st[3]]
        if sz[2]:
            out["sz"] = [round(sz[0] / sz[2], 3), round(sz[1] / sz[2], 3), sz[2]]
        racers[rid] = out
    mmonths = set(_months_back(today, MOTOR_VIEW_MONTHS))
    motors = {}
    for sid, sm in stats.get("motors", {}).items():
        for mno, mv in sm.items():
            acc = [0, 0, 0, 0]
            for mk, v in mv.items():
                if mk in mmonths:
                    for i in range(4):
                        acc[i] += v[i]
            if acc[0]:
                motors.setdefault(sid, {})[mno] = acc
    mlist = sorted(months)
    return {
        "updated_at": utc_iso_seconds(),
        "window": {"racers": [mlist[0], mlist[-1]] if mlist else None, "racer_months": VIEW_MONTHS,
                   "motor_months": MOTOR_VIEW_MONTHS},
        "processed_days": len(stats.get("processed", {})),
        "racers": racers,
        "motors": motors,
    }


def run(data_dir: str = "data", today: datetime.date | None = None) -> dict:
    today = today or datetime.datetime.now(JST).date()
    today_s = today.strftime("%Y%m%d")
    db_dir = os.path.join(data_dir, "db")
    stats_path = os.path.join(db_dir, STATS_FILE)
    stats = _load(stats_path) or _empty_stats()
    if not isinstance(stats.get("processed"), dict):
        stats["processed"] = {}
    folded, skipped = [], {}
    dates = sorted(_DATED.match(os.path.basename(p)).group(1)
                   for p in glob.glob(os.path.join(data_dir, "results", "*.json"))
                   if _DATED.match(os.path.basename(p)))
    for date in dates:
        if date >= today_s or date in stats["processed"]:
            continue
        results = _load(os.path.join(data_dir, "results", date + ".json"))
        total, v2 = day_quality(results)
        if total == 0:
            continue
        if v2 / total < MIN_V2_RATIO:
            skipped[date] = f"v2 {v2}/{total}"
            continue
        n = fold_day(stats, date, results,
                     _load(os.path.join(data_dir, "previews", date + ".json")),
                     _load(os.path.join(data_dir, "programs", date + ".json")))
        stats["processed"][date] = n
        folded.append(date)
    pruned = prune_months(stats, today)
    # processed は直近 MONTHS_KEPT か月ぶんだけ残す（集計から消えた月の記録は不要）
    cutoff = min(_months_back(today, MONTHS_KEPT))
    stats["processed"] = {d: v for d, v in stats["processed"].items() if d[:6] >= cutoff}
    stats["updated_at"] = utc_iso_seconds()
    if folded or pruned or not os.path.exists(stats_path):
        atomic_write_json(stats_path, stats)
    view = build_view(stats, today)
    atomic_write_json(os.path.join(db_dir, VIEW_FILE), view)
    return {"folded": folded, "skipped": skipped, "racers": len(view["racers"]),
            "motors": sum(len(v) for v in view["motors"].values())}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
    ap.add_argument("--today", default=None, help="YYYYMMDD（テスト用）")
    a = ap.parse_args(argv)
    today = datetime.datetime.strptime(a.today, "%Y%m%d").date() if a.today else None
    s = run(a.data, today)
    print(json.dumps(s, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
