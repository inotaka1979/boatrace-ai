#!/usr/bin/env python3
"""boatrace.jp 公式の出走表(racelist)から openapi 互換の programs JSON を生成する。

非公式ミラー(boatraceopenapi.github.io)依存をやめ、番組表(出走表)も公式から取得するための
スクレイパー。出走表ページ 1 枚に予測エンジンが使う全項目が含まれる:
  td[0]=枠, td[2]=登録番号/級別/氏名/支部/出身/年齢/体重, td[3]=F/L/平均ST,
  td[4]=全国 勝率/2連/3連, td[5]=当地 勝率/2連/3連, td[6]=モーター番号/2連/3連,
  td[7]=ボート番号/2連/3連。締切は「締切予定時刻」行から rno 番目。

出力スキーマは openapi programs/v2/today.json に互換（client/predictor を無改修で動かす）。

当面、本日の開催レース一覧(どの場/レース)は openapi programs を「一覧取得のみ」流用する
（Phase 3 で公式一覧へ切替）。racer の値そのものは全て公式 boatrace.jp 由来。
"""
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402
from http_utils import fetch_text, fetch_json  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

JST = timezone(timedelta(hours=9))
BASE_URL = "https://www.boatrace.jp/owpc/pc/race/racelist?rno={rno}&jcd={jcd:02d}&hd={hd}"
# 一覧（本日どの場が開催か）は公式由来の data/schedule/current.json を主系に。
#   取得できない場合のみ openapi にフォールバック（Phase 3 で撤去）。
SCHEDULE_FILE = "data/schedule/current.json"
PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"  # 一覧フォールバックのみ
RACES_PER_DAY = 12  # 競艇は 1 場 1 日 12 レース固定
PARALLEL_WORKERS = 4  # scrape_results と同値。boatrace.jp への同時接続を抑えつつ wall-time 短縮
OUTPUT = "data/programs/today.json"

CLASS_MAP = {"A1": 1, "A2": 2, "B1": 3, "B2": 4}
_ZEN2HAN = str.maketrans("０１２３４５６７８９", "0123456789")


def _f(s, default=0.0):
    try:
        return float(str(s).strip())
    except (TypeError, ValueError):
        return default


def _i(s, default=0):
    try:
        return int(str(s).translate(_ZEN2HAN).strip())
    except (TypeError, ValueError):
        return default


def _nums(text):
    """空白区切りの数値トークン配列。"""
    return [t for t in str(text).replace("\xa0", " ").split() if t]


def _closed_times(soup):
    """「締切予定時刻」行から各レースの締切 HH:MM 配列（index0=1R）。"""
    for tr in soup.select("tr"):
        th_td = tr.find(["th", "td"])
        if th_td and "締切予定時刻" in th_td.get_text():
            tds = tr.find_all("td")
            times = []
            for td in tds:
                t = td.get_text(strip=True)
                if ":" in t and len(t) <= 6:
                    times.append(t)
            return times
    return []


def parse_racelist_program(html, sid, rno, date_str):
    """出走表 HTML → openapi 互換 program dict（1 レース分）。失敗時 None。

    Args:
        html: racelist ページ HTML
        sid: 場番号 int
        rno: レース番号 int
        date_str: "YYYYMMDD"
    """
    soup = BeautifulSoup(html, "html.parser")
    boats = []
    for tb in soup.select("tbody.is-fs12"):
        tds = tb.find_all("td")
        if len(tds) < 8:
            continue
        waku = _i(tds[0].get_text())
        if not (1 <= waku <= 6):
            continue
        info = tds[2]
        divs = info.find_all("div")
        # div0: "3947 / B1"  div1: 氏名  div2: "支部/出身 <br> 年齢歳/体重kg"
        racer_number = 0
        cls = ""
        if len(divs) >= 1:
            d0 = divs[0].get_text(" ", strip=True)
            mnum = "".join(ch for ch in d0.split("/")[0] if ch.isdigit())
            racer_number = _i(mnum)
            sp = divs[0].find("span")
            cls = sp.get_text(strip=True) if sp else ""
        name = ""
        if len(divs) >= 2:
            name = " ".join(divs[1].get_text(" ", strip=True).split())
        branch = birthplace = ""
        age = 0
        weight = 0.0
        if len(divs) >= 3:
            d2 = divs[2].get_text("\n", strip=True)
            lines = [x for x in d2.replace("\xa0", " ").split("\n") if x.strip()]
            if lines:
                bp = lines[0].split("/")
                branch = bp[0].strip() if bp else ""
                birthplace = bp[1].strip() if len(bp) > 1 else ""
            if len(lines) > 1:
                # "50歳/50.0kg" → age=50, weight=50.0（正規表現で確実に）
                ma = re.search(r"(\d+)\s*歳", lines[1])
                mw = re.search(r"([\d.]+)\s*kg", lines[1])
                age = _i(ma.group(1)) if ma else 0
                weight = _f(mw.group(1)) if mw else 0.0

        fl = _nums(tds[3].get_text(" "))  # ["F0","L0","0.17"]
        flying = _i(fl[0].replace("F", "")) if len(fl) > 0 else 0
        late = _i(fl[1].replace("L", "")) if len(fl) > 1 else 0
        avg_st = _f(fl[2]) if len(fl) > 2 else 0.0

        natl = _nums(tds[4].get_text(" "))  # 全国 勝率/2連/3連
        local = _nums(tds[5].get_text(" "))  # 当地
        motor = _nums(tds[6].get_text(" "))  # モーター番号/2連/3連
        boat = _nums(tds[7].get_text(" "))   # ボート番号/2連/3連

        boats.append({
            "racer_boat_number": waku,
            "racer_number": racer_number,
            "racer_name": name,
            "racer_class_number": CLASS_MAP.get(cls, 0),
            "racer_branch_name": branch,
            "racer_birthplace": birthplace,
            "racer_age": age,
            "racer_weight": weight,
            "racer_flying_count": flying,
            "racer_late_count": late,
            "racer_average_start_timing": avg_st,
            "racer_national_top_1_percent": _f(natl[0]) if len(natl) > 0 else 0.0,
            "racer_national_top_2_percent": _f(natl[1]) if len(natl) > 1 else 0.0,
            "racer_national_top_3_percent": _f(natl[2]) if len(natl) > 2 else 0.0,
            "racer_local_top_1_percent": _f(local[0]) if len(local) > 0 else 0.0,
            "racer_local_top_2_percent": _f(local[1]) if len(local) > 1 else 0.0,
            "racer_local_top_3_percent": _f(local[2]) if len(local) > 2 else 0.0,
            "racer_assigned_motor_number": _i(motor[0]) if len(motor) > 0 else 0,
            "racer_assigned_motor_top_2_percent": _f(motor[1]) if len(motor) > 1 else 0.0,
            "racer_assigned_motor_top_3_percent": _f(motor[2]) if len(motor) > 2 else 0.0,
            "racer_assigned_boat_number": _i(boat[0]) if len(boat) > 0 else 0,
            "racer_assigned_boat_top_2_percent": _f(boat[1]) if len(boat) > 1 else 0.0,
            "racer_assigned_boat_top_3_percent": _f(boat[2]) if len(boat) > 2 else 0.0,
        })

    if len(boats) < 1:
        return None

    # 締切時刻
    times = _closed_times(soup)
    closed_at = ""
    if 1 <= rno <= len(times):
        hh = times[rno - 1]
        d = date_str
        iso = f"{d[0:4]}-{d[4:6]}-{d[6:8]}"
        closed_at = f"{iso} {hh}:00"

    title_el = soup.select_one(".heading2_titleName")
    title = title_el.get_text(" ", strip=True) if title_el else ""

    return {
        "race_stadium_number": int(sid),
        "race_number": int(rno),
        "race_date": f"{date_str[0:4]}-{date_str[4:6]}-{date_str[6:8]}",
        "race_closed_at": closed_at,
        "race_title": title,
        "race_grade_number": _grade_number(soup),
        "boats": boats,
    }


# openapi race_grade_number: 1=SG, 2=G1, 3=G2, 4=G3, 5=一般
_GRADE_MAP = {"SG": 1, "G1": 2, "G2": 3, "G3": 4}


def _grade_number(soup):
    """出走表ヘッダの class (例 'heading2_title is-G3b') からグレードを判定。"""
    el = soup.select_one(".heading2_title")
    if el:
        for c in el.get("class", []):
            m = re.match(r"is-(SG|G1|G2|G3)", c)
            if m and m.group(1) in _GRADE_MAP:
                return _GRADE_MAP[m.group(1)]
    return 5


def _validate(prog):
    """壊れた値を出さないための妥当性チェック。"""
    if not prog or len(prog.get("boats", [])) < 1:
        return False
    for b in prog["boats"]:
        if not (1 <= b["racer_boat_number"] <= 6):
            return False
        if b["racer_number"] and not (1000 <= b["racer_number"] <= 9999):
            return False
        if not (0 <= b["racer_national_top_1_percent"] <= 12):
            return False
        if not (0 <= b["racer_national_top_2_percent"] <= 100):
            return False
    return True


def _venues_from_schedule(date_iso):
    """公式由来 data/schedule/current.json から date_iso 開催の場番号一覧を返す。

    取得できない/当日開催が無ければ空 list（呼び出し側が openapi にフォールバック）。
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", SCHEDULE_FILE)
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"schedule read failed ({e.__class__.__name__}) — openapi へフォールバック")
        return []
    sd = d.get("stadium_dates") or {}
    venues = []
    for sid_str, dates in sd.items():
        if date_iso in (dates or []):
            try:
                venues.append(int(sid_str))
            except (TypeError, ValueError):
                continue
    return sorted(venues)


def _fetch_openapi_today():
    """openapi programs を取得し (date_str, {(sid,rno): program}) を返す。失敗で (None, {})。

    openapi は「本日どの場の何レースが実際に開催か」の権威（=本日の出走表カードそのもの）。
    一覧の網羅と、自前パース失敗レースのバックフィルの両方に使う。
    """
    try:
        prog = fetch_json(PROGRAMS_URL)
    except Exception as e:
        print(f"openapi fetch failed: {e}")
        return None, {}
    listed = prog.get("programs") or []
    if not listed:
        return None, {}
    date_str = str((listed[0].get("race_date") or "")).replace("-", "")
    by_key = {}
    for p in listed:
        try:
            by_key[(int(p["race_stadium_number"]), int(p["race_number"]))] = p
        except (KeyError, TypeError, ValueError):
            continue
    return date_str, by_key


def _scrape_one(sid, rno, date_str):
    """1 レース分を fetch+parse。(sid, rno, program|None, err|None) を返す（スレッド実行用）。"""
    url = BASE_URL.format(rno=rno, jcd=sid, hd=date_str)
    try:
        html = fetch_text(url, timeout=12, retries=1)
        prg = parse_racelist_program(html, sid, rno, date_str)
        if prg and not _validate(prg):
            return (sid, rno, None, "validate failed")
        if not prg:
            return (sid, rno, None, "no race table (parse None)")
        return (sid, rno, prg, None)
    except Exception as e:
        return (sid, rno, None, f"exception: {e}")


def main() -> int:
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    today_iso = datetime.now(JST).date().isoformat()

    # openapi（本日カードの権威 + バックフィル源）を 1 回取得
    op_date, openapi_by_key = _fetch_openapi_today()
    # openapi が本日でなければバックフィルに使わない（別日混入防止）
    if op_date and op_date != today_iso.replace("-", ""):
        print(f"openapi is not today ({op_date} != {today_iso}) — backfill 無効化")
        openapi_by_key = {}
        op_date = None

    date_str = op_date or today_iso.replace("-", "")

    # レース一覧 = 公式 schedule の開催場×12R ∪ openapi の本日カード（網羅性最大化）。
    #   どちらか一方にしか無い場も漏らさない。非開催の場は official パース失敗かつ
    #   openapi にも無いため自然に除外される。
    pairs = set()
    venues = _venues_from_schedule(today_iso)
    for sid in venues:
        for rno in range(1, RACES_PER_DAY + 1):
            pairs.add((sid, rno))
    for k in openapi_by_key:
        pairs.add(k)
    if not pairs:
        print("no races today")
        atomic_write_json(OUTPUT, {"updated_at": utc_iso_seconds(),
                                   "race_date": f"{today_iso}", "programs": []})
        return 0
    print(f"race list: schedule venues={len(venues)} ∪ openapi races={len(openapi_by_key)}"
          f" → {len(pairs)} races")

    # boatrace.jp は 1 ページ ~9s と遅く、156 レースを直列で引くと 24 分超で job timeout に
    #   迫る。scrape_results.py と同じく ThreadPoolExecutor で並列化して wall-time を短縮。
    results = {}
    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as ex:
        futs = {ex.submit(_scrape_one, sid, rno, date_str): (sid, rno) for sid, rno in pairs}
        for fut in as_completed(futs):
            sid, rno, prg, err = fut.result()
            results[(sid, rno)] = (prg, err)

    out = []
    official = backfilled = dropped = 0
    for key in sorted(pairs):
        prg, err = results.get(key, (None, "no result"))
        if prg:
            out.append(prg)
            official += 1
        elif key in openapi_by_key:
            # 自前パース失敗 → openapi の本日カードでバックフィル（開催場を grey にしない）
            out.append(openapi_by_key[key])
            backfilled += 1
            print(f"  {key[0]}-{key[1]} official miss ({err}) → openapi backfill")
        else:
            # schedule にあるが official も openapi も無い = 実際は非開催 → 正しく除外
            dropped += 1
            print(f"  {key[0]}-{key[1]} dropped ({err}, not in openapi)")

    atomic_write_json(OUTPUT, {
        "updated_at": utc_iso_seconds(),
        "race_date": f"{date_str[0:4]}-{date_str[4:6]}-{date_str[6:8]}",
        "programs": out,
    })
    print(f"wrote {OUTPUT}: {len(out)} races "
          f"(official={official}, openapi_backfill={backfilled}, dropped_nonracing={dropped})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
