#!/usr/bin/env python3
"""形式A(桐生・福岡: index.php?page=yosou-cyokuzen のサーバー描画型)の cyokuzen ページを採取。

一周/まわり足/直線の表構造と、レース/日付の指定パラメータを特定するための診断。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
VENUES = {
    1: "https://www.kiryu-kyotei.com",   # 桐生
    22: "https://www.boatrace-fukuoka.com",  # 福岡
}


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    # よくある param 候補を順に試す（race/日付の指定方法を探る）
    patterns = [
        "/sp/index.php?page=yosou-cyokuzen",
        "/sp/index.php?page=yosou-cyokuzen&rno=3",
        "/sp/index.php?page=yosou-cyokuzen&race=3",
        "/sp/index.php?page=yosou-cyokuzen&rno=3&hd=" + hd,
        "/sp/index.php?page=yosou-cyokuzen&race=3&hd=" + hd,
    ]
    for jcd, base in VENUES.items():
        for i, p in enumerate(patterns):
            url = base + p
            try:
                raw = fetch_bytes(url, timeout=20, retries=1,
                                  headers={"Referer": base + "/sp/"})
                html = raw.decode("utf-8", errors="replace")
            except Exception as e:
                print(f"jcd={jcd} p{i} FAIL: {str(e)[:70]}")
                continue
            isu = html.count("一周")
            mw = html.count("まわり足") + html.count("まわり")
            ten = html.count("展示")
            print(f"jcd={jcd} p{i} ({len(raw)}B) 一周={isu} まわり={mw} 展示={ten}  {p}")
            if isu > 0:
                path = os.path.join(OUTDIR, f"fmtA_jcd{jcd:02d}.html")
                with open(path, "wb") as f:
                    f.write(raw)
                print(f"        saved {path}")
                break
    # race-select の手がかり(rno/race/select)を桐生 plain から
    return 0


if __name__ == "__main__":
    sys.exit(main())
