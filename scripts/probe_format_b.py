#!/usr/bin/env python3
"""形式B(蒲郡型)の recomend(予想紙) + 日付きデータJS を採取するプローブ。

蒲郡の recomend(予想紙)ページは周回展示(一周/まわり足/直線)を含む(ユーザ確認)が、
データは日付きJS(comment/focus/motor/weather{YYYYMMDD}{jcd}.js)で注入される。
choku(直前)には無かったため、recomend 本体 + 日付きデータJS を採取して
周回タイムの所在(HTML静的 or JSデータ)と構造を特定する。確認後撤去。
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.gamagori-kyotei.com"
JCD = 7
ORIG_RE = ("一周", "まわり足", "まわり", "直線", "周回")


def _counts(h: str) -> str:
    return " ".join(f"{m}={h.count(m)}" for m in
                    ("一周", "まわり足", "直線", "周回", "展示", "ST"))


def _save(name, raw, note=""):
    p = os.path.join(OUTDIR, name)
    with open(p, "wb") as f:
        f.write(raw)
    print(f"      saved {p} ({len(raw)}B){note}")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    saved_html = False
    saved_data = False
    for rno in range(1, 13):
        rid = f"{hd}{JCD:02d}{rno:02d}"
        url = f"{BASE}/asp/gamagori/sp/kyogi/kyogihtml/recomend/recomend{rid}.htm"
        try:
            raw = fetch_bytes(url, timeout=15, retries=1,
                              headers={"Referer": BASE + "/"})
            html = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"R{rno:2d} recomend FAIL: {str(e)[:60]}")
            continue
        has = any(m in html for m in ORIG_RE)
        print(f"R{rno:2d} recomend ({len(raw)}B) {_counts(html)} hasOrig={has}")
        if not saved_html:
            _save(f"fmtB_recomend_jcd{JCD:02d}_R{rno:02d}_first.htm", raw)
            saved_html = True
        if has and not saved_data:
            _save(f"fmtB_recomend_jcd{JCD:02d}_R{rno:02d}.htm", raw,
                  " (has orig labels)")
            saved_data = True
    # 日付きデータJS(予想紙の中身)を採取。motor が周回タイムを含む可能性。
    for kind in ("motor", "comment", "focus", "weather"):
        url = (f"{BASE}/asp/gamagori/kyogi/kyogihtml/js/"
               f"{kind}{hd}{JCD:02d}.js")
        try:
            raw = fetch_bytes(url, timeout=15, retries=1,
                              headers={"Referer": BASE + "/"})
            html = raw.decode("utf-8", errors="replace")
            print(f"JS {kind} ({len(raw)}B) {_counts(html)}")
            _save(f"fmtB_datajs_{kind}_jcd{JCD:02d}.js", raw)
        except Exception as e:
            print(f"JS {kind} FAIL: {str(e)[:60]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
