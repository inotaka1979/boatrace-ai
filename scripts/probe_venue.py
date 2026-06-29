#!/usr/bin/env python3
"""桐生(1): cookie session で ajax_cyokuzen.php(race指定)の実応答を採取するプローブ。

データは /sp/ajax/ajax_cyokuzen.php に col1=艇番/col4=展示/col5=半周/col6=まわり足/
col7=直線 で返る(ラベルは画像)。既存 parse_kiryu_cyokuzen は col5-1/2/3 想定で
現行 col4-7 に非対応。実応答を保存し、現行構造を確定する。確認後撤去。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_orig_exhibition as S  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.kiryu-kyotei.com"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    import http.cookiejar
    import urllib.request
    from bs4 import BeautifulSoup
    for rno in (8, 1):
        page = BASE + f"/sp/index.php?page=yosou-cyokuzen&race={rno}"
        ajax = BASE + "/sp/ajax/ajax_cyokuzen.php"
        try:
            cj = http.cookiejar.CookieJar()
            op = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(cj))
            S._cookie_get(op, page, BASE + "/sp/")
            html = S._cookie_get(op, ajax, page)
        except Exception as e:
            print(f"R{rno} FAIL: {str(e)[:60]}")
            continue
        segs = html.split("<!--sep-->")
        print(f"R{rno}: ajax {len(html)}B segs={len(segs)}")
        # 既存パーサの結果
        race = S.parse_kiryu_cyokuzen(html, 1, rno)
        print(f"   parse_kiryu_cyokuzen -> "
              f"{'None' if not race else [b['lap_time'] for b in race['boats']]}")
        # 現行構造ダンプ(col1..col7 を持つ表)
        soup = BeautifulSoup(html, "html.parser")
        for ti, tbl in enumerate(soup.find_all("table")):
            if tbl.find("td", class_="col5") and tbl.find("td", class_="col7"):
                print(f"   table{ti}:")
                for ri, row in enumerate(tbl.find_all("tr")[:9]):
                    cells = [("/".join(c.get("class") or [])) + ":" +
                             c.get_text(" ", strip=True)
                             for c in row.find_all(["td", "th"])]
                    if cells:
                        print(f"     row{ri}: {cells[:9]}")
                break
        if rno == 8:
            with open(os.path.join(OUTDIR, "kiryu_ajax_R08.html"), "w",
                      encoding="utf-8") as f:
                f.write(html)
            print("   saved kiryu_ajax_R08.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
