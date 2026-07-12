#!/usr/bin/env python3
"""月間日程パーサの欠落診断: 欠落5場の行セルと全グレード class を採取。

07-12 の実障害: 公式は 16 場開催なのに schedule/programs は 11 場。
欠落 = 江戸川(3)/平和島(4)/多摩川(5)/三国(10)/びわこ(11)。
scrape_schedule.py は セル class (GRADE_MAP の 6 種) で開催日を拾うため、
未対応グレード(ルーキー/ヴィーナス/マスターズ等)の class だと節ごと脱落する仮説。
月間日程ページから (a) ページ内の全 is-gradeColor* class 一覧、
(b) 欠落5場の行セル(class/colspan/text) を出力する。確認後撤去。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_text  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

TARGETS = {3: "江戸川", 4: "平和島", 5: "多摩川", 10: "三国", 11: "びわこ"}


def main() -> int:
    url = "https://www.boatrace.jp/owpc/pc/race/monthlyschedule?ym=202607"
    print(f"fetch: {url}")
    html = fetch_text(url, timeout=25, retries=1)
    print(f"len={len(html)}")

    # (a) ページ内の全グレード系 class を列挙(GRADE_MAP に無いものを特定)
    all_cls = sorted(set(re.findall(r"is-gradeColor\w+", html)))
    print(f"全グレード class: {all_cls}")

    soup = BeautifulSoup(html, "html.parser")
    tables = soup.select("table.is-spritedNone1")
    print(f"tables(is-spritedNone1): {len(tables)}")
    # 別セレクタの表も確認
    print(f"全 table 数: {len(soup.find_all('table'))}")

    for ti, table in enumerate(tables):
        rows = table.select("tr")
        if not rows:
            continue
        header = rows[0].select("th, td")
        print(f"\n== table {ti}: header cells={len(header)} "
              f"first3={[c.get_text(strip=True)[:6] for c in header[:3]]}")
        for row in rows[1:]:
            first = row.select_one("th, td")
            a = first.select_one("a[href*='jcd=']") if first else None
            if not a:
                continue
            try:
                sid = int(a.get("href", "").split("jcd=")[1].split("&")[0])
            except (ValueError, IndexError):
                continue
            if sid not in TARGETS:
                continue
            print(f"-- {sid}:{TARGETS[sid]} row --")
            for cell in row.select("td"):
                cls = " ".join(cell.get("class") or [])
                span = cell.get("colspan") or 1
                txt = cell.get_text(" ", strip=True)[:24]
                print(f"   td class='{cls}' colspan={span} text='{txt}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
