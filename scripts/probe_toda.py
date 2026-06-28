#!/usr/bin/env python3
"""戸田(jcd=2)オリジナル展示XMLを採取するプローブ(URL確定版)。

race_table_original.js より判明:
  download('./xml/kaisai/'+DATE+'/race_table_original_'+zero2(RACE_NO)+'.xml','xml')
  XML record 項目: ttime(展示) tiltc(チルト) taiju(体重) ctaiju(調整)
                   rnd cnr str (+ *_rank) ← rank強調される3つ=オリジナル展示
相対パスの base が未確定のため複数 base 候補を試し、実XMLを採取。
値域で rnd/cnr/str → 一周/まわり足/直線 の対応を確認する。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-toda.jp"
# 相対 './xml/...' の解決先 base 候補
PREFIXES = ["/race", "", "/sp", "/assets", "/owpc/pc/race"]


def _vals(xml: str, tag: str):
    return re.findall(rf"<{tag}>([^<]*)</{tag}>", xml)


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    base_ok = None
    saved = False
    for rno in range(1, 13):
        rr = f"{rno:02d}"
        prefixes = [base_ok] if base_ok else PREFIXES
        for pre in prefixes:
            url = f"{BASE}{pre}/xml/kaisai/{hd}/race_table_original_{rr}.xml"
            try:
                raw = fetch_bytes(url, timeout=12, retries=1,
                                  headers={"Referer": BASE + "/"})
                xml = raw.decode("utf-8", errors="replace")
            except Exception:
                continue
            recs = xml.count("<record")
            tt = _vals(xml, "ttime")
            rnd = _vals(xml, "rnd")
            cnr = _vals(xml, "cnr")
            st = _vals(xml, "str")
            print(f"R{rno:2d} base='{pre}' ({len(raw)}B) records={recs} "
                  f"ttime={tt[:3]} rnd={rnd[:3]} cnr={cnr[:3]} str={st[:3]}")
            base_ok = pre  # この base で取れた
            if not saved and (any(rnd) or any(st)):
                p = os.path.join(OUTDIR,
                                 f"toda_original_xml_R{rr}.xml")
                with open(p, "wb") as f:
                    f.write(raw)
                print(f"      saved {p}")
                saved = True
            break
    if base_ok is None:
        print("no XML found (戸田 非開催 or 展示前 or base 不一致)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
