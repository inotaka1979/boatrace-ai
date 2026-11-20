#!/usr/bin/env python3
"""開催場ごとの「何日目」を公式の開催日タブから取る (2026-11-20)

boatrace.jp の出走表ページ上部の開催日タブ（例: 11月19日 中止 / 11月20日 初日 / … / 11月24日 最終日）を
場ごとに 1 ページだけ読み、data/schedule/day_labels.json に書く。中止で順延した日も公式の表記どおりになる。
TOP の場カードに「3日目」「最終日」「中止」を出すのに使う（racedata は 1 日 1 回・取得が遅れるため）。

出力:
  {"date": "YYYYMMDD", "updated_at": ..., "stadiums": {
      "<sid>": {"label": "最終日", "final": true, "cancelled": false,
                "tabs": [{"date": "YYYYMMDD", "label": "初日"}, ...]}}}

    python3 scripts/scrape_day_labels.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import SourceBlockDetector, fetch_once  # noqa: E402
from io_utils import atomic_write_json  # noqa: E402
from time_utils import jst_now, utc_iso_seconds  # noqa: E402

OUTPUT = "data/schedule/day_labels.json"
URL = "https://www.boatrace.jp/owpc/pc/race/racelist?rno=1&jcd={jcd:02d}&hd={hd}"
INTERVAL = 0.5

_TAB_UL = re.compile(r'<ul class="tab2_tabs">(.*?)</ul>', re.S)
_TAB_LI = re.compile(r'<li[^>]*>(.*?)</li>', re.S)
_MD = re.compile(r"(\d{1,2})月(\d{1,2})日")
_ZEN = str.maketrans("０１２３４５６７８９", "0123456789")


def parse_tabs(html: str, year: int, today_md: tuple[int, int]) -> list[dict]:
    """開催日タブを [{date, label}] にする。年は今日の月から推定（12 月→1 月の年またぎ）。"""
    m = _TAB_UL.search(html or "")
    if not m:
        return []
    out = []
    for li in _TAB_LI.findall(m.group(1)):
        text = re.sub(r"<[^>]+>", " ", li)
        md = _MD.search(text)
        if not md:
            continue
        mon, day = int(md.group(1)), int(md.group(2))
        label = text[md.end():].strip().split()
        label = label[0].translate(_ZEN) if label else ""
        y = year + (1 if today_md[0] == 12 and mon == 1 else -1 if today_md[0] == 1 and mon == 12 else 0)
        out.append({"date": "%04d%02d%02d" % (y, mon, day), "label": label})
    return out


def summarize(tabs: list[dict], today: str) -> dict | None:
    """今日のタブからラベル・最終日・中止を決める。今日が無ければ None（開催していない）。"""
    for i, t in enumerate(tabs):
        if t["date"] == today:
            label = t["label"]
            return {"label": label, "final": "最終" in label or (i == len(tabs) - 1 and "中止" not in label),
                    "cancelled": "中止" in label, "tabs": tabs}
    return None


def active_stadiums(today_iso: str) -> list[int]:
    """今日開催の場: 月間日程 + 今日の番組表（どちらかにあれば対象）。"""
    sids: set[int] = set()
    try:
        with open("data/schedule/current.json", encoding="utf-8") as f:
            sd = json.load(f).get("stadium_dates") or {}
        sids |= {int(k) for k, v in sd.items() if today_iso in (v or [])}
    except (OSError, ValueError):
        pass
    try:
        with open("data/programs/today.json", encoding="utf-8") as f:
            p = json.load(f)
        if str(p.get("race_date") or "") == today_iso:
            sids |= {x.get("race_stadium_number") for x in p.get("programs") or [] if x.get("race_stadium_number")}
    except (OSError, ValueError):
        pass
    return sorted(sids)


def main() -> int:
    now = jst_now()
    today = now.strftime("%Y%m%d")
    sids = active_stadiums(now.strftime("%Y-%m-%d"))
    if not sids:
        print("day_labels: 今日開催の場が見つからない → skip")
        return 0
    block = SourceBlockDetector()
    stadiums: dict[str, dict] = {}
    for i, sid in enumerate(sids):
        if block.blocked:
            break
        if i:
            time.sleep(INTERVAL)
        status, html = fetch_once(URL.format(jcd=sid, hd=today), timeout=15)
        block.record(status)
        if status != 200 or not html:
            continue
        s = summarize(parse_tabs(html, now.year, (now.month, now.day)), today)
        if s:
            stadiums[str(sid)] = s
    if not stadiums:
        print("day_labels: 1 場も取れなかった → 既存ファイルを残す")
        return 3 if block.blocked else 0
    atomic_write_json(OUTPUT, {"date": today, "updated_at": utc_iso_seconds(), "stadiums": stadiums})
    print("day_labels: " + ", ".join(f"{k}:{v['label']}" for k, v in sorted(stadiums.items(), key=lambda x: int(x[0]))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
