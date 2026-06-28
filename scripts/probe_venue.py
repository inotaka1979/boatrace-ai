#!/usr/bin/env python3
"""残り場のオリジナル展示データ源を特定する汎用プローブ(対象は TARGETS で指定)。

各場のJS(SPAのデータ注入元)や候補エンドポイントを採取し、一周/まわり足/直線の
所在(json/xml/ajax/htm)を特定する。確認後撤去。対象を変えて使い回す。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"

# (tag, url) を採取。JSはendpoint手がかり抽出、データURLは中身確認。
def _targets(hd):
    return [
        # 宮島(17): SPA の race.js がデータ注入。endpoint を探す。
        ("miyajima_racejs", "https://www.boatrace-miyajima.com/race_common/js/race20231019.js?1234"),
    ]


ORIG = ("一周", "まわり足", "直線", "周回")


def _save(name, raw, note=""):
    p = os.path.join(OUTDIR, name)
    with open(p, "wb") as f:
        f.write(raw)
    print(f"      saved {p} ({len(raw)}B){note}")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    for tag, url in _targets(hd):
        try:
            raw = fetch_bytes(url, timeout=15, retries=1,
                              headers={"Referer": url.split("/race")[0] + "/"})
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"{tag} FAIL: {str(e)[:70]}")
            continue
        cnt = " ".join(f"{m}={txt.count(m)}" for m in ORIG)
        print(f"{tag} ({len(raw)}B) {cnt}")
        _save(f"probe_{tag}.txt", raw)
        # endpoint 手がかり
        hints = set()
        hints |= set(re.findall(r"[\"'][^\"']*\.(?:json|xml|php)[^\"']*[\"']", txt))
        hints |= set(re.findall(r"/[a-zA-Z0-9_./]*(?:original|tenji|cyokuzen|orig|syuhkai)[a-zA-Z0-9_./]*", txt, re.I))
        hints |= set(re.findall(r"(?:ajax|getJSON|fetch|load)\s*\([^)]{0,60}", txt, re.I))
        for h in sorted(hints)[:30]:
            print(f"     hint: {h[:120]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
