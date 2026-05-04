#!/usr/bin/env python3
"""PE-11: トップページ stadium grid を事前レンダリング (LCP 即時化)

処理フロー:
1. https://boatraceopenapi.github.io/programs/v2/today.json を取得
2. 24 場の stadium-card HTML を生成（active / inactive 判定込み）
3. index.html の <!-- PRERENDER:STADIUMS:START/END --> 領域に注入

利点:
- ブラウザは HTML 解析だけで stadium grid を表示できる → LCP が即時に発火
- JS の loadAllData が完了したら同じ場所を innerHTML 置換するため、
  鮮度は維持される（古い pre-render は一時的な fallback）

実行:
    python3 scripts/prerender_top.py
    # GitHub Actions の build-db ワークフロー終了後に呼び出すのが理想

使い方 (build/ から):
    npm --prefix build run prerender   # （後で package.json に追加）
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_json  # PC-1

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"

STADIUMS = {
    1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川",
    6: "浜名湖", 7: "蒲郡", 8: "常滑", 9: "津", 10: "三国",
    11: "びわこ", 12: "住之江", 13: "尼崎", 14: "鳴門", 15: "丸亀",
    16: "児島", 17: "宮島", 18: "徳山", 19: "下関", 20: "若松",
    21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村",
}
GRADE_CLASS = {
    1: ("SG", "grade-sg"),
    2: ("G1", "grade-g1"),
    3: ("G2", "grade-g2"),
    4: ("G3", "grade-g3"),
    5: ("一般", "grade-general"),
}

MARKER_START = "<!-- PRERENDER:STADIUMS:START -->"
MARKER_END = "<!-- PRERENDER:STADIUMS:END -->"


def load_programs() -> list[dict]:
    """Open API から本日の programs を取得（local data/ にあれば優先）。"""
    local = ROOT / "data" / "programs" / "today.json"
    if local.exists():
        with open(local) as f:
            data = json.load(f)
    else:
        try:
            data = fetch_json(PROGRAMS_URL)
        except Exception as e:
            print(f"  WARN: fetch failed, fallback to empty: {e}")
            return []
    return data.get("programs", [])


def render_grid(programs: list[dict]) -> str:
    """stadium-card 24 個の HTML を生成。"""
    by_sid: dict[int, list[dict]] = {}
    for p in programs:
        sid = p.get("race_stadium_number")
        if sid:
            by_sid.setdefault(sid, []).append(p)

    # PG-6 + CLS 対策: onclick → data-sid (event delegation) のみ最適化
    #   要素構成は JS render と一致させて CLS 抑制
    cards: list[str] = []
    for sid in range(1, 25):
        name = STADIUMS.get(sid, f"場{sid}")
        if sid in by_sid:
            races = by_sid[sid]
            total = len(races)
            grade_num = races[0].get("race_grade_number", 5)
            grade_name, grade_cls = GRADE_CLASS.get(grade_num, GRADE_CLASS[5])
            first_rno = min((r.get("race_number", 99) for r in races), default=1)
            cards.append(
                f'<div class="stadium-card active-stadium" data-sid="{sid}">'
                f'<span class="stadium-grade {grade_cls}">{grade_name}</span>'
                f'<span class="stadium-name">{name}</span>'
                f'<span class="stadium-status">0/{total}R</span>'
                f'<span class="stadium-day">{first_rno}R</span>'
                f"</div>"
            )
        else:
            cards.append(
                f'<div class="stadium-card inactive-stadium">'
                f'<span class="stadium-name">{name}</span>'
                f'<span class="stadium-status">次節</span>'
                f"</div>"
            )

    now_jst = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
    return (
        f"\n  <!-- prerendered at {now_jst} ({len(by_sid)}/24 active stadiums) -->\n"
        + "".join(cards)
        + "\n  "
    )


def inject_into_index(html: str, snippet: str) -> str:
    """index.html の marker 間を snippet で置換。"""
    pattern = re.compile(
        re.escape(MARKER_START) + r"[\s\S]*?" + re.escape(MARKER_END)
    )
    if not pattern.search(html):
        raise RuntimeError(
            f"markers not found in {INDEX}. "
            f"Add {MARKER_START} ... {MARKER_END} to <div id=\"stadiumList\">."
        )
    return pattern.sub(MARKER_START + snippet + MARKER_END, html)


def main() -> None:
    print(f"=== prerender_top (PE-11) ===")
    programs = load_programs()
    print(f"  fetched {len(programs)} programs")

    snippet = render_grid(programs)
    with open(INDEX, encoding="utf-8") as f:
        before = f.read()
    after = inject_into_index(before, snippet)

    if before == after:
        print("  no-op (already up-to-date)")
        return
    with open(INDEX, "w", encoding="utf-8") as f:
        f.write(after)
    print(f"  index.html updated ({len(snippet)} chars injected)")


if __name__ == "__main__":
    main()
