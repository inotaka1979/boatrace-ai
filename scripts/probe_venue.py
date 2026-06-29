#!/usr/bin/env python3
"""住之江(12) の ASP 静的ページから オリジナル展示(一周/まわり足/直線)を探すプローブ。

住之江は ASP 静的サイト。top の有望リンク:
  /asp/kyogi/12/pc/today_tenbo_detail.htm (展望詳細)
  /asp/suminoe/kyogi/kyogihtml/index.htm
を起点に、周回/オリジナル展示データと per-race htm の URL 規則を突き止める。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-suminoe.jp"
KW = ("オリジナル展示", "一周", "半周", "まわり足", "直線", "周回", "展示タイム",
      "展示", "周回展示", "ﾏﾜﾘ", "ﾁﾙﾄ")


def _marks(t):
    return " ".join(f"{m}={t.count(m)}" for m in KW)


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    h = {"Referer": BASE + "/"}

    pages = [
        ("tenbo_detail", f"{BASE}/asp/kyogi/12/pc/today_tenbo_detail.htm"),
        ("kyogi_index", f"{BASE}/asp/suminoe/kyogi/kyogihtml/index.htm"),
        ("tenbo_jumper", f"{BASE}/asp/htmlmade/Race/Tenbo/12/PC/jumper.htm"),
        # 蒲郡型 per-race recomend 類推
        ("recomend_r1", f"{BASE}/asp/suminoe/kyogi/kyogihtml/recomend/recomend{hd}12 01.htm".replace(" ", "")),
        # per-race 展望 類推
        ("tenbo_r1", f"{BASE}/asp/kyogi/12/pc/{hd}12 01_tenbo.htm".replace(" ", "")),
    ]
    for name, url in pages:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1, headers=h)
            txt = raw.decode("utf-8", errors="replace")
            print(f"[{name}] {url[len(BASE):]} ({len(raw)}B) {_marks(txt)}")
            # per-race htm リンク / iframe / data ファイル参照
            refs = sorted(set(re.findall(
                r'(?:href|src)=[\"\']([^\"\']*(?:recomend|tenbo|syuukai|'
                r'shukai|cyokuzen|周回|orig|kyogihtml)[^\"\']*\.(?:htm|html|php))'
                r'[\"\']', txt, re.I)))
            for r in refs[:25]:
                print(f"    ref: {r}")
            if len(raw) > 300:
                fn = re.sub(r"[^a-z0-9]+", "_", name)
                with open(os.path.join(OUTDIR, f"suminoe_{fn}.html"), "wb") as f:
                    f.write(raw)
        except Exception as e:
            print(f"[{name}] {url[len(BASE):]} FAIL: {str(e)[:55]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
