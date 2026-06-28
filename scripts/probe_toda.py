#!/usr/bin/env python3
"""戸田(jcd=2)のオリジナル展示データ源(XML)を特定するプローブ。

戸田は別ベンダーで、ページが race_table_original.js + xml_read.js で XML から
オリジナル展示(一周/まわり足/直線 等)を読み込む。これらJSは静的配信で展示時間に
依存せず常時取得可能なため、XMLのURLパターンと項目構造をここで確定する。確認後撤去。
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-toda.jp"


def _save(name, raw, note=""):
    p = os.path.join(OUTDIR, name)
    with open(p, "wb") as f:
        f.write(raw)
    print(f"      saved {p} ({len(raw)}B){note}")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    # 1) XMLを読むJS群を採取(URL構築とXMLパースのロジック)
    for js in ("race_table_original.js", "xml_read.js", "race_table.js",
               "race_table_before.js"):
        url = f"{BASE}/assets/js/{js}"
        try:
            raw = fetch_bytes(url, timeout=15, retries=1,
                              headers={"Referer": BASE + "/"})
            _save(f"toda_{js}", raw)
            txt = raw.decode("utf-8", errors="replace")
            # XML/データURLの手がかりを表示
            import re
            hints = set(re.findall(r"[\"'][^\"']*\.(?:xml|cgi|php|json)[^\"']*[\"']", txt))
            hints |= set(re.findall(r"(?:loadXml|readXml|getXml|ajax|\.get\()\w*", txt, re.I))
            hints |= set(re.findall(r"(?:original|tenji|cyokuzen)\w*", txt, re.I))
            for h in sorted(hints)[:25]:
                print(f"        hint: {h[:110]}")
        except Exception as e:
            print(f"  {js} FAIL: {str(e)[:60]}")
    # 2) よくある XML パスを試す(date/race 指定方法の当たりをつける)
    candidates = [
        f"/race/xml/original{hd}.xml",
        f"/assets/xml/original{hd}.xml",
        f"/cyokuzen/xml/{hd}.xml",
        f"/race/original/{hd}.xml",
    ]
    for p in candidates:
        url = BASE + p
        try:
            raw = fetch_bytes(url, timeout=12, retries=1,
                              headers={"Referer": BASE + "/"})
            txt = raw.decode("utf-8", errors="replace")
            print(f"  XML? {p} ({len(raw)}B) 一周={txt.count('一周')} "
                  f"まわり={txt.count('まわり')} 直線={txt.count('直線')}")
            _save(f"toda_xmltry_{p.strip('/').replace('/','_')}", raw)
        except Exception as e:
            print(f"  XML? {p} FAIL: {str(e)[:50]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
