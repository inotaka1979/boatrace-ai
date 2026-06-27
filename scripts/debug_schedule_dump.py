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

    struct_path = os.path.join(OUT_DIR, "_debug_structure.txt")
    with open(struct_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"wrote {struct_path} ({len(lines)} lines)")
    print("\n".join(lines[:60]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
