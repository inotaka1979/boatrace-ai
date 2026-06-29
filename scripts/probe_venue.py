#!/usr/bin/env python3
"""びわこ(11) のオリジナル展示(一周/まわり足/直線)のデータ経路と表構造を採取するプローブ。

江戸川は非公開と確定(対応対象外)。びわこは存在が確認できたため、実装に必要な
URL とテーブル構造(列順/クラス/値)をログと保存HTMLの両方で採取する。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-biwako.jp"
KW = ("オリジナル展示", "一周", "半周", "まわり足", "直線", "周回", "展示タイム",
      "展示", "<table", "<th")


def _marks(txt):
    return " ".join(f"{m}={txt.count(m)}" for m in KW)


def _dump_table(txt):
    """一周/まわり足/直線 を含むテーブルの thead と先頭数行を吐く(構造把握用)。"""
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return
    soup = BeautifulSoup(txt, "html.parser")
    for tbl in soup.find_all("table"):
        t = tbl.get_text()
        if ("まわり足" in t) and (("一周" in t) or ("半周" in t)):
            ths = [th.get_text(strip=True) for th in tbl.find_all("th")]
            print(f"      THEAD: {ths}")
            for i, row in enumerate(tbl.find_all("tr")[:8]):
                tds = []
                for td in row.find_all("td"):
                    cls = "/".join(td.get("class") or [])
                    tds.append(f"{cls}:{td.get_text(strip=True)}")
                if tds:
                    print(f"      row{i}: {tds[:10]}")
            return True
    return False


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")

    # 1) top から直前/オリジナル展示への参照を発見
    print("== biwako top discovery ==")
    try:
        raw = fetch_bytes(BASE + "/", timeout=12, retries=1,
                          headers={"Referer": BASE + "/"})
        txt = raw.decode("utf-8", errors="replace")
        print(f"[top] ({len(raw)}B) {_marks(txt)}")
        refs = re.findall(
            r'''['"]([^'"<> ]*(?:modules|cyokuzen|tenji|yosou|ajax)'''
            r'''[^'"<> ]*\.php)['"]''', txt)
        for r in sorted(set(refs))[:40]:
            print(f"    ref: {r}")
        for m in re.findall(r'["\'][^"\']*\.php["\']\s*\+\s*[^;]{0,70}', txt):
            print(f"    param: {re.sub(chr(9),'',m)[:100]}")
        with open(os.path.join(OUTDIR, "biwako_top.html"), "wb") as f:
            f.write(raw)
    except Exception as e:
        print(f"[top] FAIL: {str(e)[:70]}")

    # 2) 候補エンドポイントを叩く(edogawa 系 + 一般的な命名)
    print("== biwako endpoint candidates ==")
    cands = [
        "/modules/yosou/cyokuzen.php?day={hd}&race={r}",
        "/modules/yosou/cyokuzen_info.php?day={hd}&race={r}",
        "/sp/ajax/ajax_cyokuzen.php",
        "/race/xml/kaisai/{hd}/race_table_original_{rr}.xml",
        "/xml/kaisai/{hd}/race_table_original_{rr}.xml",
    ]
    saved = set()
    for tmpl in cands:
        for r in (1, 2):
            path = tmpl.format(hd=hd, r=r, rr=f"{r:02d}")
            try:
                raw = fetch_bytes(BASE + path, timeout=10, retries=0,
                                  headers={"Referer": BASE + "/"})
                txt = raw.decode("utf-8", errors="replace")
                print(f"[{path}] ({len(raw)}B) {_marks(txt)}")
                got = _dump_table(txt)
                key = tmpl.split("?")[0]
                if (got or len(raw) > 500) and key not in saved:
                    fn = re.sub(r"[^a-z0-9]+", "_", key.strip("/"))
                    with open(os.path.join(OUTDIR, f"biwako_{fn}.html"),
                              "wb") as fp:
                        fp.write(raw)
                    print(f"      saved biwako_{fn}.html")
                    saved.add(key)
            except Exception as e:
                print(f"[{path}] -- {str(e)[:45]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
