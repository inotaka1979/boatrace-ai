#!/usr/bin/env python3
"""racedata/today.json の全開催場に「◯日目」(day_label) を軽量付与する。

scrape_racedata の通常フローは再開ロジックで取得済みレースをスキップし、かつ partial 終了で
一部の場が racedata に入らないことがある。その結果トップで日目が「出る場と出ない場」が混在する。

本スクリプトは本日の programs（openapi）から開催全場を取り、各場について:
  - racedata に entry があり day_label 未設定なら、出走表(racelist)を 1 回引いて全 entry に付与。
  - racedata に entry が無い場は、出走表から day_label を取り最小 entry を追加（boats=[]）。
写真DLや全レース再取得は行わない（高速）。push(マージ)トリガーで自動実行する想定。
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402
from http_utils import fetch_json  # noqa: E402
import scrape_racedata as S  # noqa: E402

RACEDATA = "data/racedata/today.json"
PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"


def main() -> int:
    # 既存 racedata（無ければ空で開始）
    d = {"updated_at": utc_iso_seconds(), "race_date": "", "racedata": []}
    if os.path.exists(RACEDATA):
        try:
            with open(RACEDATA, encoding="utf-8") as f:
                d = json.load(f)
        except Exception as ex:
            print(f"racedata load failed ({ex}) — start fresh")
    rd = d.get("racedata") or []

    # 本日の開催全場 + 各場の最小レース番号 + 日付（必ず programs=本日基準。
    #   rt-fix3 (2026-06-28): 旧版は racedata.race_date を date_str に使っていたが、
    #   日付ロールオーバー直後は racedata が前日のままで、前日の出走表を引いて day_label が
    #   1 日古くなる不具合があった。date_str は必ず本日の programs から決める。）
    try:
        prog = fetch_json(PROGRAMS_URL)
    except Exception as ex:
        print(f"programs fetch failed: {ex}")
        prog = {"programs": []}
    programs = prog.get("programs") or []
    date_str = ""
    venues: dict = {}
    for p in programs:
        sid = p.get("race_stadium_number")
        rno = p.get("race_number")
        if sid is None or rno is None:
            continue
        if not date_str:
            date_str = str(p.get("race_date") or "").replace("-", "")
        venues[sid] = min(venues.get(sid, rno), rno)
    # programs が取れない場合のみ racedata の race_date を使う
    if not date_str:
        date_str = str(d.get("race_date") or "").replace("-", "")

    # racedata が前日のもの（race_date != 本日）なら、day_label 用に作り直す。
    #   前日の entry が残っていると古い day_label を表示してしまうため。
    rd_date = str(d.get("race_date") or "").replace("-", "")
    if date_str and rd_date and rd_date != date_str:
        print(f"racedata is stale (race_date={rd_date} != today={date_str}) — rebuild for day_label")
        rd = []
        d["racedata"] = rd
        d["race_date"] = date_str

    by_sid: dict = {}
    for e in rd:
        by_sid.setdefault(e.get("stadium"), []).append(e)

    # programs に出た全場を対象（racedata のみの場も一応含める）
    target_sids = set(venues.keys()) | set(by_sid.keys())
    changed = 0
    for sid in sorted(s for s in target_sids if s is not None):
        entries = by_sid.get(sid, [])
        if entries and all(e.get("day_label") for e in entries):
            continue
        jcd = f"{int(sid):02d}"
        rno0 = venues.get(sid) or (entries[0].get("race", 1) if entries else 1)
        try:
            _, label = S.scrape_racelist(jcd, rno0, date_str)
        except Exception as ex:
            print(f"  stadium {sid} racelist fail: {ex}")
            label = None
        if not label:
            continue
        if entries:
            for e in entries:
                e["day_label"] = label
            changed += len(entries)
        else:
            # racedata に無い場 → 最小 entry を追加（boats 空。日目表示専用）
            rd.append({"stadium": sid, "race": rno0, "boats": [], "day_label": label})
            changed += 1
        print(f"  stadium {sid}: day_label = {label}")
        time.sleep(0.3)

    if changed:
        d["racedata"] = rd
        d["updated_at"] = utc_iso_seconds()
        atomic_write_json(RACEDATA, d)
    print(f"day_label set/updated on {changed} entries across {len(target_sids)} venues")
    return 0


if __name__ == "__main__":
    sys.exit(main())
