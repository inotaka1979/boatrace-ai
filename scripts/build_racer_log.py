#!/usr/bin/env python3
"""選手ごとの出走ログを作る (2026-11-26)

選手詳細の「出走ログ」（日付・場・レース・枠・進入・ST・着順・決まり手）の元データ。
ネットワークは使わない（ローカルの日次アーカイブだけ）。

入力:
  data/results/YYYYMMDD.json    確定結果。解析版 2（2026-11-20 以降）は登録番号・進入・ST・決まり手を持つ。
                                解析版 1 は着順と艇番だけなので、番組表で選手を当てて「着順のみ」の行にする。
  data/programs/YYYYMMDD.json   番組表。選手の登録番号（解析版 1 の結果用）、着順の付かなかった艇の検出、グレード。

出力:
  data/db/racer_log/NN.json     NN = 登録番号 % 100
      {"v": 1, "racers": {"<登録番号>": [[ymd, sid, rno, boat, course, st, place, tech, out, grade], ...]}}
        ymd    レースの日付 (20261125)
        sid    場番号 / rno レース番号 / boat 枠番
        course 進入コース（分からなければ null）
        st     ST を 1/100 秒の整数で（0.21 → 21、F.01 → -1。分からなければ null）
        place  着順 1〜6（着順が付かなかったら 0）
        tech   そのレースの決まり手 1〜6（逃げ / 差し / まくり / まくり差し / 抜き / 恵まれ。分からなければ 0）
        out    着順が付かなかった理由（"F" "L" "失" "転" "落" "沈" "妨" "エ" "不" "欠"。分からなければ "?"。着順があれば ""）
        grade  グレード（番組表の race_grade_number。分からなければ 0）
      新しい順。1 選手 MAX_PER_RACER 件まで。
  data/db/racer_log/index.json  {"v": 1, "updated_at", "from", "to", "detail_from", "racers", "entries"}

方針:
  * 今日 (JST) より前の日付だけ。今日の分はアプリが実況の結果から出す。
  * 日付は各レースの race_date で決める（日付付きファイルは、日付が変わった直後に前日のレースを含むことがある）。
  * 直近 REBUILD_DAYS 日は毎回アーカイブから作り直す（結果の取り直し・後追いで内容が変わりうる）。
    それより古い日付は既存のログをそのまま引き継ぐ。アーカイブの保存期間（結果 180 日 / 番組表 45 日）を過ぎても
    ログは残る。初回（index.json が無い）と --full はアーカイブにある全日付を作る。
    古い日付でも、ログにまだ 1 行も無い日付は作る（しばらく止まっていた後でも取りこぼさない）。
  * 作り直す日付でも、アーカイブに確定レースが 1 つも無い日は既存の行を消さない。
  * 内容が変わったファイルだけ書く（毎 run の commit を増やさない）。

    python3 scripts/build_racer_log.py [--data-dir data] [--full]
"""

from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402

JST = datetime.timezone(datetime.timedelta(hours=9))
SHARDS = 100
MAX_PER_RACER = 60
REBUILD_DAYS = 7
MAX_AGE_DAYS = 400  # これより古い行は捨てる（走らなくなった選手の行が残り続けないように）
OUT_DIR = os.path.join("db", "racer_log")
ENTRY_LEN = 10


def _load(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _ymd(race_date) -> int | None:
    """"2026-11-25" / "20261125" → 20261125。読めなければ None。"""
    t = str(race_date or "").replace("-", "")
    return int(t) if len(t) == 8 and t.isdigit() else None


def _int(v) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v == int(v):
        return int(v)
    return None


def _finished(r: dict) -> bool:
    boats = r.get("boats")
    return (
        isinstance(boats, list)
        and not r.get("race_cancelled")
        and bool(r.get("race_technique_number"))
        and sum(1 for b in boats if isinstance(b, dict) and _int(b.get("racer_place_number"))) >= 3
    )


def _rank(r: dict) -> tuple:
    """同じレースが複数のファイルにあるとき、どれを使うか（大きいほうを採用）。"""
    return (
        1 if r.get("_parse_v") == 2 else 0,
        len(r.get("boats") or []),
        1 if r.get("out_boats") else 0,
    )


def load_results(data_dir: str, before: int) -> dict[tuple[int, int, int], dict]:
    """確定レースを (ymd, sid, rno) で引けるようにして返す（ymd < before だけ）。"""
    out: dict[tuple[int, int, int], dict] = {}
    for path in sorted(glob.glob(os.path.join(data_dir, "results", "[0-9]" * 8 + ".json"))):
        d = _load(path)
        rows = d.get("results") if isinstance(d, dict) else None
        if not isinstance(rows, list):
            continue
        for r in rows:
            if not isinstance(r, dict) or not _finished(r):
                continue
            ymd = _ymd(r.get("race_date"))
            sid, rno = _int(r.get("race_stadium_number")), _int(r.get("race_number"))
            if ymd is None or ymd >= before or not sid or not rno:
                continue
            key = (ymd, sid, rno)
            if key not in out or _rank(r) > _rank(out[key]):
                out[key] = r
    return out


def load_programs(data_dir: str, before: int) -> dict[tuple[int, int, int], dict]:
    """番組表を (ymd, sid, rno) → {"boats": {艇番: 登録番号}, "grade": N} で返す。"""
    out: dict[tuple[int, int, int], dict] = {}
    for path in sorted(glob.glob(os.path.join(data_dir, "programs", "[0-9]" * 8 + ".json"))):
        d = _load(path)
        rows = d.get("programs") if isinstance(d, dict) else None
        if not isinstance(rows, list):
            continue
        for p in rows:
            if not isinstance(p, dict):
                continue
            ymd = _ymd(p.get("race_date"))
            sid, rno = _int(p.get("race_stadium_number")), _int(p.get("race_number"))
            if ymd is None or ymd >= before or not sid or not rno:
                continue
            boats = {}
            for b in p.get("boats") or []:
                if not isinstance(b, dict):
                    continue
                bn, rid = _int(b.get("racer_boat_number")), _int(b.get("racer_number"))
                if bn and rid and 1 <= bn <= 6:
                    boats[bn] = rid
            if boats:
                out[(ymd, sid, rno)] = {"boats": boats, "grade": _int(p.get("race_grade_number")) or 0}
    return out


def _st100(v) -> int | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if v != v or abs(v) > 9:  # NaN / 異常値
        return None
    return int(round(v * 100))


def race_entries(key: tuple[int, int, int], r: dict, prog: dict | None) -> list[tuple[int, list]]:
    """1 レースから [(登録番号, 行), ...] を作る。選手が分からない艇は入れない。"""
    ymd, sid, rno = key
    v2 = r.get("_parse_v") == 2
    pboats = (prog or {}).get("boats") or {}
    grade = (prog or {}).get("grade") or 0
    tech = _int(r.get("race_technique_number")) or 0
    if not v2 or r.get("technique_unknown") or not 1 <= tech <= 6:
        tech = 0  # 解析版 1 の決まり手は常に「逃げ」が入っているので使わない
    course_ok = v2 and bool(r.get("_course_from_start"))
    out: list[tuple[int, list]] = []
    seen: set[int] = set()

    def add(b: dict, place: int, label: str) -> None:
        bn = _int(b.get("racer_boat_number"))
        if not bn or not 1 <= bn <= 6 or bn in seen:
            return
        rid = (_int(b.get("racer_number")) if v2 else None) or pboats.get(bn)
        if not rid:
            return
        seen.add(bn)
        course = _int(b.get("racer_course_number")) if course_ok else None
        if course is not None and not 1 <= course <= 6:
            course = None
        st = _st100(b.get("racer_start_timing")) if v2 else None
        kind = b.get("racer_start_kind")
        if place and kind in ("F", "L"):
            label = kind  # 着順があっても F / L の印は残す
        out.append((rid, [ymd, sid, rno, bn, course, st, place, tech, label, grade]))

    for b in r.get("boats") or []:
        if isinstance(b, dict):
            place = _int(b.get("racer_place_number")) or 0
            if 1 <= place <= 6:
                add(b, place, "")
    for b in r.get("out_boats") or []:
        if isinstance(b, dict):
            add(b, 0, str(b.get("racer_out") or "?")[:2])
    # 番組表にいるのに結果に出てこない艇 = 着順が付かなかった（理由は分からない）
    for bn, rid in sorted(pboats.items()):
        if bn not in seen:
            seen.add(bn)
            out.append((rid, [ymd, sid, rno, bn, None, None, 0, tech, "?", grade]))
    return out


def _valid_entry(e) -> bool:
    return (
        isinstance(e, list)
        and len(e) == ENTRY_LEN
        and isinstance(e[0], int)
        and not isinstance(e[0], bool)
        and all(isinstance(e[i], int) and not isinstance(e[i], bool) for i in (1, 2, 3, 6))
    )


def load_existing(out_dir: str) -> dict[int, list[list]]:
    """既存の shard を {登録番号: [行, ...]} で読む。壊れた行は捨てる。"""
    cur: dict[int, list[list]] = {}
    for n in range(SHARDS):
        d = _load(os.path.join(out_dir, f"{n:02d}.json"))
        racers = d.get("racers") if isinstance(d, dict) else None
        if not isinstance(racers, dict):
            continue
        for k, rows in racers.items():
            if not str(k).isdigit() or not isinstance(rows, list):
                continue
            good = [e for e in rows if _valid_entry(e)]
            if good:
                cur[int(k)] = good
    return cur


def _sort_key(e: list) -> tuple:
    return (-e[0], -e[2], e[1])  # 新しい日付 → 後のレース → 場番号


def build(data_dir: str = "data", today: datetime.date | None = None, full: bool = False,
          rebuild_days: int = REBUILD_DAYS) -> dict:
    today = today or datetime.datetime.now(JST).date()
    before = int(today.strftime("%Y%m%d"))
    out_dir = os.path.join(data_dir, OUT_DIR)
    index_path = os.path.join(out_dir, "index.json")
    bootstrap = full or not isinstance(_load(index_path), dict)

    results = load_results(data_dir, before)
    programs = load_programs(data_dir, before)
    oldest_rebuild = 0 if bootstrap else int((today - datetime.timedelta(days=rebuild_days)).strftime("%Y%m%d"))
    cutoff = int((today - datetime.timedelta(days=MAX_AGE_DAYS)).strftime("%Y%m%d"))

    existing = {} if full else load_existing(out_dir)
    # まだ 1 行も無い日付は、窓より古くても作る（しばらく止まっていた後でも取りこぼさない）
    known_dates = {e[0] for rows in existing.values() for e in rows}

    fresh: dict[int, list[list]] = {}
    rebuilt_dates: set[int] = set()
    for key in sorted(results):
        if key[0] < oldest_rebuild and key[0] in known_dates:
            continue
        rows = race_entries(key, results[key], programs.get(key))
        if rows:
            rebuilt_dates.add(key[0])
        for rid, e in rows:
            fresh.setdefault(rid, []).append(e)

    merged: dict[int, list[list]] = {}
    for rid in set(existing) | set(fresh):
        kept = [e for e in existing.get(rid, []) if e[0] not in rebuilt_dates and cutoff <= e[0] < before]
        rows = kept + [e for e in fresh.get(rid, []) if e[0] >= cutoff]
        # 同じレースの行が重なったら 1 つに（既存を引き継いだ日付と作り直した日付は重ならないが、念のため）
        uniq: dict[tuple, list] = {}
        for e in rows:
            uniq[(e[0], e[1], e[2])] = e
        rows = sorted(uniq.values(), key=_sort_key)[:MAX_PER_RACER]
        if rows:
            merged[rid] = rows

    written = 0
    for n in range(SHARDS):
        racers = {str(rid): merged[rid] for rid in sorted(merged) if rid % SHARDS == n}
        path = os.path.join(out_dir, f"{n:02d}.json")
        old = _load(path)
        if isinstance(old, dict) and old.get("v") == 1 and old.get("racers") == racers:
            continue
        if not racers and old is None:
            continue
        atomic_write_json(path, {"v": 1, "racers": racers})
        written += 1

    entries = sum(len(v) for v in merged.values())
    dates = [e[0] for v in merged.values() for e in v]
    detail = [e[0] for v in merged.values() for e in v if e[5] is not None]
    summary = {
        "v": 1,
        "from": str(min(dates)) if dates else "",
        "to": str(max(dates)) if dates else "",
        "detail_from": str(min(detail)) if detail else "",
        "racers": len(merged),
        "entries": entries,
    }
    old_index = _load(index_path)
    if written or not isinstance(old_index, dict) or any(old_index.get(k) != v for k, v in summary.items()):
        atomic_write_json(index_path, {**summary, "updated_at": utc_iso_seconds()})
    return {**summary, "written": written, "rebuilt_dates": len(rebuilt_dates), "bootstrap": bootstrap}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--full", action="store_true", help="アーカイブにある全日付から作り直す（既存のログは捨てる）")
    a = ap.parse_args(argv)
    s = build(data_dir=a.data_dir, full=a.full)
    print("racer_log: " + json.dumps(s, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
