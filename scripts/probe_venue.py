#!/usr/bin/env python3
"""戸田(2) のオリジナル展示が表示されない原因を切り分けるプローブ。

戸田は XML 形式(race_table_original_{RR}.xml)。クライアント/Worker は配線済み・
fixture もパース可だが本番で出ない。本日の実 XML を直叩き + Worker プロキシ経由の
両方で採取し、404/空(展示前)/別パス/パース不一致 のどれかを切り分ける。確認後撤去。
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
WORKER = "https://boatrace-scrape-trigger.inotaka1979.workers.dev"


def _summ(txt):
    recs = txt.count("<record>")
    teiban = re.findall(r"<teiban>(.*?)</teiban>", txt)
    ttime = re.findall(r"<ttime>(.*?)</ttime>", txt)
    rnd = re.findall(r"<rnd>(.*?)</rnd>", txt)
    cnr = re.findall(r"<cnr>(.*?)</cnr>", txt)
    strs = re.findall(r"<str>(.*?)</str>", txt)
    return (f"records={recs} teiban={teiban[:6]} ttime={ttime[:3]} "
            f"rnd={rnd[:3]} cnr={cnr[:3]} str={strs[:3]}")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    print(f"== Toda direct XML (hd={hd}) ==")
    saved = False
    headers = {"Referer": BASE + "/"}
    for rno in range(1, 13):
        rr = f"{rno:02d}"
        url = f"{BASE}/race/xml/kaisai/{hd}/race_table_original_{rr}.xml"
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=headers)
            txt = raw.decode("utf-8", errors="replace")
            print(f"R{rr} ({len(raw)}B) {_summ(txt)}")
            if not saved and "<record>" in txt:
                p = os.path.join(OUTDIR, f"toda_original_R{rr}.xml")
                with open(p, "wb") as f:
                    f.write(raw)
                print(f"      saved {p}")
                saved = True
        except Exception as e:
            print(f"R{rr} FAIL: {str(e)[:80]}")

    # 別パス候補(日付なし / 拡張子違い)も確認
    print("== alt path candidates ==")
    alts = [
        f"{BASE}/race/xml/race_table_original_01.xml",
        f"{BASE}/race/xml/kaisai/{hd}/race_table_original_1.xml",
        f"{BASE}/race/xml/kaisai/{hd}/race_table_01.xml",
    ]
    for u in alts:
        try:
            raw = fetch_bytes(u, timeout=10, retries=1, headers=headers)
            print(f"ALT {u[len(BASE):]} ({len(raw)}B) "
                  f"rec={raw.decode('utf-8','replace').count('<record>')}")
        except Exception as e:
            print(f"ALT {u[len(BASE):]} FAIL: {str(e)[:50]}")

    # Worker プロキシ経由(クライアントが実際に叩く経路)
    print("== via Worker /orig-exhibition-proxy ==")
    for rno in (1, 2, 3, 6, 9, 12):
        u = f"{WORKER}/orig-exhibition-proxy?jcd=2&race={rno}&hd={hd}"
        try:
            raw = fetch_bytes(u, timeout=15, retries=1)
            txt = raw.decode("utf-8", errors="replace")
            print(f"R{rno} ({len(raw)}B) {_summ(txt)}")
        except Exception as e:
            print(f"R{rno} FAIL: {str(e)[:90]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
