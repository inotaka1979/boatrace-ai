#!/usr/bin/env python3
"""形式B(蒲郡型: 静的htm)の直前情報ページ採取プローブ。

蒲郡(jcd=7)のサイトは静的htm配信:
  /asp/gamagori/sp/kyogi/kyogihtml/choku/choku{YYYYMMDD}{jcd2}{race2}.htm
  ("choku"=直前)。recomend(予想紙)には一周/まわり足/直線が無かったため、
  choku ページにオリジナル展示(周回タイム)があるかを確認する。

全12レースの choku を採取し、一周/まわり足/直線 の有無を確認。データが
出ている回の HTML を保存して形式B専用パーサの設計材料にする。確認後撤去。
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


def _counts(h: str) -> str:
    return (f"一周={h.count('一周')} まわり足={h.count('まわり足')} "
            f"まわり={h.count('まわり')} 直線={h.count('直線')} "
            f"周回={h.count('周回')} 展示={h.count('展示')}")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    saved_data = False
    saved_any = False
    for rno in range(1, 13):
        name = f"choku{hd}{JCD:02d}{rno:02d}.htm"
        url = f"{BASE}/asp/gamagori/sp/kyogi/kyogihtml/choku/{name}"
        try:
            raw = fetch_bytes(url, timeout=15, retries=1,
                              headers={"Referer": BASE + "/"})
            html = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"R{rno:2d} FAIL: {str(e)[:70]}")
            continue
        has = ("まわり足" in html) or ("一周" in html) or ("周回" in html)
        print(f"R{rno:2d} ({len(raw)}B) {_counts(html)} hasOrig={has}")
        # 最初の1枚は構造確認用に必ず保存、データ有りも別途保存
        if not saved_any:
            p = os.path.join(OUTDIR, f"fmtB_choku_jcd{JCD:02d}_R{rno:02d}_first.htm")
            with open(p, "wb") as f:
                f.write(raw)
            print(f"      saved {p}")
            saved_any = True
        if has and not saved_data:
            p = os.path.join(OUTDIR, f"fmtB_choku_jcd{JCD:02d}_R{rno:02d}.htm")
            with open(p, "wb") as f:
                f.write(raw)
            print(f"      saved {p} (has orig exhibition)")
            saved_data = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
