#!/usr/bin/env python3
"""一時デバッグ: boatrace.jp の月間スケジュール HTML を取得し、解析に必要な構造を repo へ保存。

scrape_schedule.py の月間カレンダー解析が現行 HTML と噛み合わず current.json の日付が
壊れているため、実 HTML 構造を確認するための採取スクリプト。GitHub Actions（boatrace.jp に
到達可能）で実行し、結果を data/schedule/_debug_* にコミットする。Claude がそれを読んで
パーサを修正したら本スクリプトと workflow は撤去する。

出力:
  data/schedule/_debug_raw.html      … 当月ページの生 HTML（全文）
  data/schedule/_debug_structure.txt … テーブル/行/セルの構造サマリ（人間可読）
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_text  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

JST = timezone(timedelta(hours=9))
SCHEDULE_URL = "https://www.boatrace.jp/owpc/pc/race/monthlyschedule?ym={ym}"
OUT_DIR = "data/schedule"


def main() -> int:
    ym = datetime.now(JST).strftime("%Y%m")
    if len(sys.argv) > 1:
        ym = sys.argv[1]
    url = SCHEDULE_URL.format(ym=ym)
    print(f"fetch {url}")
    html = fetch_text(url)
    os.makedirs(OUT_DIR, exist_ok=True)

    raw_path = os.path.join(OUT_DIR, "_debug_raw.html")
    with open(raw_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {raw_path} ({len(html)} bytes)")

    soup = BeautifulSoup(html, "html.parser")
    lines = []
    lines.append(f"URL: {url}")
    lines.append(f"ym: {ym}")
    lines.append(f"html_len: {len(html)}")

    # 全 table の class を列挙
    all_tables = soup.find_all("table")
    lines.append(f"\n=== all tables: {len(all_tables)} ===")
    for i, t in enumerate(all_tables):
        cls = " ".join(t.get("class") or [])
        rows = t.find_all("tr")
        lines.append(f"table[{i}] class='{cls}' rows={len(rows)}")

    # 各 table の最初の数行のセル構造を出力（先頭 4 テーブルまで）
    for ti, t in enumerate(all_tables[:6]):
        cls = " ".join(t.get("class") or [])
        lines.append(f"\n=== table[{ti}] class='{cls}' detail ===")
        rows = t.find_all("tr")
        for ri, row in enumerate(rows[:4]):
            cells = row.find_all(["th", "td"])
            lines.append(f" row[{ri}] cells={len(cells)}")
            for ci, c in enumerate(cells[:45]):
                tag = c.name
                ccls = " ".join(c.get("class") or [])
                span = c.get("colspan") or ""
                txt = c.get_text(" ", strip=True)[:18]
                a = c.find("a", href=True)
                href = ""
                if a and "jcd=" in a.get("href", ""):
                    href = "jcd=" + a["href"].split("jcd=")[1].split("&")[0]
                lines.append(
                    f"   cell[{ci}] <{tag}> cls='{ccls}' colspan='{span}' "
                    f"href='{href}' text='{txt}'"
                )

    # --- racelist(出走表)ページからも「◯日目」表記の在り処を採取 ---
    #   節間成績はこのページから取れている（scrape_racedata.py）。日目も同ページ header にある想定。
    try:
        prog = __import__("http_utils").fetch_json(
            "https://boatraceopenapi.github.io/programs/v2/today.json"
        )
        progs = prog.get("programs") or []
        pick = progs[0] if progs else None
        if pick:
            jcd = str(pick.get("race_stadium_number")).zfill(2)
            rno = pick.get("race_number") or 1
            hd = str(pick.get("race_date") or "").replace("-", "")
            rl_url = f"https://www.boatrace.jp/owpc/pc/race/racelist?rno={rno}&jcd={jcd}&hd={hd}"
            print(f"fetch racelist {rl_url}")
            rl_html = fetch_text(rl_url)
            with open(os.path.join(OUT_DIR, "_debug_racelist.html"), "w", encoding="utf-8") as f:
                f.write(rl_html)
            lines.append(f"\n=== racelist {rl_url} (len={len(rl_html)}) ===")
            # 「日目」「初日」「最終日」周辺の文脈を抽出
            for kw in ["日目", "初日", "最終日", "節"]:
                pos = 0
                hits = 0
                while hits < 4:
                    i = rl_html.find(kw, pos)
                    if i < 0:
                        break
                    ctx = rl_html[max(0, i - 80) : i + 20].replace("\n", " ")
                    lines.append(f" [{kw}] ...{ctx}...")
                    pos = i + 1
                    hits += 1
            rlsoup = BeautifulSoup(rl_html, "html.parser")
            # 日付/節情報がありそうな要素の class を列挙
            for sel in [".heading2_title", ".title16_titleDetail", ".tab3", ".contentsTitle"]:
                for el in rlsoup.select(sel)[:3]:
                    lines.append(f" sel {sel}: '{el.get_text(' ', strip=True)[:60]}'")
    except Exception as e:
        lines.append(f"\nracelist dump failed: {e}")

    struct_path = os.path.join(OUT_DIR, "_debug_structure.txt")
    with open(struct_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"wrote {struct_path} ({len(lines)} lines)")
    print("\n".join(lines[:80]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
