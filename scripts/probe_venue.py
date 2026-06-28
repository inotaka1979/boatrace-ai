#!/usr/bin/env python3
"""住之江(12)が蒲郡型(ASP静的htm)か確認するプローブ。

住之江は /asp/suminoe/sp/kyogi/kyogihtml/... の蒲郡型 ASP 構造だが、ファイル名規則が
不明(蒲郡=recomend{date}{jcd}{race}, 住之江 zenken は zenken1205 = 日付無しの可能性)。
recomend/zenken/choku を複数パターンで叩き、URL規則と周回(ta_recomend/一周/まわり足/直線)
構造を確定する。確認後撤去。
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-suminoe.jp"
JCD = 12


def _counts(h):
    return " ".join(f"{m}={h.count(m)}" for m in
                    ("一周", "まわり足", "直線", "周回", "展示", "ta_recomend", "ori_time"))


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    saved = 0
    # type と filename パターンの直積を試す
    for typ in ("recomend", "zenken", "choku"):
        for label, fn in [
            ("date+jcd+rr", f"{typ}{hd}{JCD:02d}01.htm"),
            ("jcd+rr", f"{typ}{JCD:02d}01.htm"),
            ("jcd+rr3", f"{typ}{JCD:02d}1.htm"),
        ]:
            url = f"{BASE}/asp/suminoe/sp/kyogi/kyogihtml/{typ}/{fn}"
            try:
                raw = fetch_bytes(url, timeout=12, retries=1,
                                  headers={"Referer": BASE + "/"})
                txt = raw.decode("utf-8", errors="replace")
            except Exception as e:
                print(f"{typ:9s} {label:12s} FAIL: {str(e)[:45]}")
                continue
            print(f"{typ:9s} {label:12s} ({len(raw)}B) {_counts(txt)}  {fn}")
            if saved < 3:
                p = os.path.join(OUTDIR, f"sumi_{typ}_{label}.htm")
                with open(p, "wb") as f:
                    f.write(raw)
                saved += 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
