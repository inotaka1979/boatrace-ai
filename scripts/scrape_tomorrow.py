#!/usr/bin/env python3
"""翌日の出走（どの選手が、どの場の何レースの何号艇か）を取る (2026-11-26、選手機能 第 3 段階 B)

公式の場別レース一覧 (raceindex?jcd=XX&hd=YYYYMMDD) は、1 ページに 12 レース分の締切予定時刻と
出場レーサー（登録番号・名前・級）が載っている。翌日に開催する場（data/schedule/current.json）を
1 場 1 ページずつ取り、data/schedule/tomorrow.json に書く（番組表 data/programs/ とは形が違うので置き場を分ける）。お気に入り選手の「明日の出走」に使う。

  * 翌日分は前日の午後〜夜に公開される。公開前のページは「データがありません」になるので、その場は
    pending に残して次の run で取り直す。
  * 1 件ずつ、間隔 0.5 秒（ほかの scraper と同じ）。403 が続いたら止める。応答が遅くても同時には送らない
    （docs/RUNBOOK.md §11.2）。内部期限 BUDGET_SEC で必ず書き出す。
  * 取り直しに失敗した場・公開前に戻ったように見える場は、同じ日付で既に取れている内容を消さない。
  * 取得状況は data/_status.json の tasks.tomorrow に記録する。
      attempted = 取りに行ったページ数
      updated   = 読めたページ数（出走が取れた場 + 「まだ公開されていない」と分かった場）
      published = 出走が取れた場の数
    公開済みなのに 1 レースも読めないページ（ページの形が変わった）は updated に数えないので、
    全場でそうなると scrape-all の「Source health alert」が検知する。

出力:
  {"date": "20261127", "updated_at": "...", "pending": [1, 2],
   "stadiums": {"8": {"label": "４日目", "races": [{"r": 1, "t": "10:27", "b": [[枠, 登録番号, "名前", 級], ...]}, ...]}}}
  級は 1=A1 / 2=A2 / 3=B1 / 4=B2（分からなければ 0）。

    python3 scripts/scrape_tomorrow.py [--data-dir data]
"""

from __future__ import annotations

import argparse
import datetime
import json
import logging
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import SourceBlockDetector, fetch_once, timed_call, write_source_status  # noqa: E402
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402
from scrape_day_labels import parse_tabs  # noqa: E402

URL = "https://www.boatrace.jp/owpc/pc/race/raceindex?jcd={jcd:02d}&hd={hd}"
INTERVAL = 0.5
BUDGET_SEC = int(os.environ.get("TOMORROW_BUDGET_SEC", "240"))
JST = datetime.timezone(datetime.timedelta(hours=9))
OUT_REL = os.path.join("schedule", "tomorrow.json")
NOT_PUBLISHED = "データがありません"
CLASS_NUM = {"A1": 1, "A2": 2, "B1": 3, "B2": 4}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("tomorrow")

_RNO = re.compile(r"racelist\?[^\"']*\brno=(\d{1,2})\b")
_TOBAN = re.compile(r"toban=(\d{4,5})\b")
_HM = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*$")
_CLS = re.compile(r"\b(A1|A2|B1|B2)\b")


def _load(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _name(text: str) -> str:
    """「海野　ゆかり」「米丸　　乃絵」→ 姓と名の間を半角空白 1 つに。"""
    return re.sub(r"[\s\u3000]+", " ", str(text or "")).strip()


def parse_raceindex(html: str) -> list[dict]:
    """場別レース一覧の HTML → [{"r": レース番号, "t": "HH:MM", "b": [[枠, 登録番号, 名前, 級], ...]}]。

    読めないレースは入れない。1 レースも無ければ []（公開前か、ページの形が変わった）。
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html or "", "html.parser")
    races: dict[int, dict] = {}
    for tbody in soup.find_all("tbody"):
        tr = tbody.find("tr")
        if tr is None:
            continue
        link = tr.find("a", href=_RNO)
        m = _RNO.search(link.get("href", "")) if link else None
        if not m:
            continue
        rno = int(m.group(1))
        if not 1 <= rno <= 12 or rno in races:
            continue
        tds = tr.find_all("td", recursive=False)
        hm = ""
        for td in tds[:3]:
            t = _HM.match(td.get_text(" ", strip=True))
            if t and int(t.group(1)) < 24 and int(t.group(2)) < 60:
                hm = "%02d:%s" % (int(t.group(1)), t.group(2))
                break
        racer_tds = [td for td in tds if td.find("a", href=_TOBAN)]
        if not racer_tds:
            continue
        # 6 艇そろっていれば並び順 = 枠番。欠けているときは、最初の選手のセルからの位置で枠番を決める
        #   （bs4 の == は中身の比較なので、位置は id で引く）
        pos = {id(td): i for i, td in enumerate(tds)}
        first = pos[id(racer_tds[0])]
        boats = []
        for n, td in enumerate(racer_tds):
            bn = pos[id(td)] - first + 1 if len(racer_tds) < 6 else n + 1
            a = td.find("a", href=_TOBAN)
            tb = _TOBAN.search(a.get("href", ""))
            name = _name(a.get_text(" ", strip=True))
            if not tb or not name or not 1 <= bn <= 6:
                continue
            rest = td.get_text(" ", strip=True).replace(a.get_text(" ", strip=True), " ", 1)
            cm = _CLS.search(rest)
            boats.append([bn, int(tb.group(1)), name, CLASS_NUM.get(cm.group(1), 0) if cm else 0])
        if boats:
            races[rno] = {"r": rno, "t": hm, "b": boats}
    return [races[k] for k in sorted(races)]


def stadiums_on(schedule: dict | None, day: datetime.date) -> list[int]:
    """その日に開催する場（data/schedule/current.json の stadium_dates から）。"""
    sd = schedule.get("stadium_dates") if isinstance(schedule, dict) else None
    if not isinstance(sd, dict):
        return []
    iso = day.isoformat()
    out = []
    for k, dates in sd.items():
        if str(k).isdigit() and 1 <= int(k) <= 24 and isinstance(dates, list) and iso in dates:
            out.append(int(k))
    return sorted(out)


def _label_for(html: str, day: datetime.date, now: datetime.datetime) -> str:
    """開催日タブから、その日のラベル（初日 / ２日目 / 最終日 …）。読めなければ ""。"""
    try:
        for t in parse_tabs(html, now.year, (now.month, now.day)):
            if t.get("date") == day.strftime("%Y%m%d"):
                return str(t.get("label") or "")[:8]
    except Exception:  # noqa: BLE001
        pass
    return ""


def run(data_dir: str = "data", now: datetime.datetime | None = None, budget_sec: int = BUDGET_SEC) -> dict:
    now = now or datetime.datetime.now(JST)
    day = (now + datetime.timedelta(days=1)).date()
    hd = day.strftime("%Y%m%d")
    out_path = os.path.join(data_dir, OUT_REL)
    sids = stadiums_on(_load(os.path.join(data_dir, "schedule", "current.json")), day)
    summary = {"date": hd, "expected": len(sids), "attempted": 0, "published": 0, "pending": 0, "unreadable": 0}
    if not sids:
        log.info("tomorrow: %s に開催する場が日程に無い → 何もしない", hd)
        return summary

    old = _load(out_path)
    kept = old.get("stadiums") if isinstance(old, dict) and old.get("date") == hd else None
    kept = kept if isinstance(kept, dict) else {}

    block = SourceBlockDetector()
    deadline = time.monotonic() + budget_sec
    last = 0.0
    stadiums: dict[str, dict] = {}
    pending: list[int] = []
    readable = 0
    for sid in sids:
        key = str(sid)
        if block.blocked or time.monotonic() >= deadline:
            # 取りに行けなかった場: 取れていた内容があれば残し、無ければ未取得
            if key in kept:
                stadiums[key] = kept[key]
            else:
                pending.append(sid)
            continue
        wait = INTERVAL - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        last = time.monotonic()
        (status, html), sec = timed_call(fetch_once, URL.format(jcd=sid, hd=hd), timeout=15)
        summary["attempted"] += 1
        block.record(status, sec)
        races = parse_raceindex(html) if status == 200 and html else []
        if races:
            readable += 1
            stadiums[key] = {"label": _label_for(html, day, now), "races": races}
            continue
        if status == 200 and html and NOT_PUBLISHED in html:
            readable += 1  # まだ公開されていない（正常）
        elif status == 200:
            summary["unreadable"] += 1
            log.warning("tomorrow: 場 %d のページを読めない（公開済みに見えるが 1 レースも取れない）", sid)
        else:
            log.warning("tomorrow: 場 %d HTTP %s", sid, status)
        if key in kept:
            stadiums[key] = kept[key]  # 前に取れた内容を消さない
        else:
            pending.append(sid)

    summary["published"] = len(stadiums)
    summary["pending"] = len(pending)
    body = {"date": hd, "pending": pending, "stadiums": stadiums}
    same = isinstance(old, dict) and all(old.get(k) == v for k, v in body.items())
    if not same:
        atomic_write_json(out_path, {"date": hd, "updated_at": utc_iso_seconds(), "pending": pending, "stadiums": stadiums})
    summary["written"] = not same
    summary.update(block.stats())
    write_source_status("tomorrow", {"attempted": summary["attempted"], "updated": readable,
                                     "published": summary["published"], **block.stats()},
                        path=os.path.join(data_dir, "_status.json"))
    log.info("tomorrow %s: %d/%d 場の出走を取得、未公開・未取得 %d 場、読めない %d 場",
             hd, len(stadiums), len(sids), len(pending), summary["unreadable"])
    return summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--budget-sec", type=int, default=BUDGET_SEC)
    a = ap.parse_args(argv)
    s = run(data_dir=a.data_dir, budget_sec=a.budget_sec)
    print("tomorrow: " + json.dumps(s, ensure_ascii=False))
    return 3 if s.get("blocked") else 0


if __name__ == "__main__":
    sys.exit(main())
