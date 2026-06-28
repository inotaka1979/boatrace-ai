#!/usr/bin/env python3
"""江戸川(3)が桐生/福岡と同ベンダー(ajax_cyokuzen)か確認するプローブ。

江戸川トップの script 構成(/sp/common/js/jquery-2.1.4 / common.js / main_setting.js,
index.php?page=yosou)が桐生/福岡と一致。cyokuzen ページ + ajax_cyokuzen.php +
cyokuzen.css を採取し、列ラベル(一周/半周/まわり足/直線)と構造を確定する。確認後撤去。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.boatrace-edogawa.com"


def _save(name, raw, note=""):
    p = os.path.join(OUTDIR, name)
    with open(p, "wb") as f:
        f.write(raw)
    print(f"      saved {p} ({len(raw)}B){note}")


def _counts(h):
    return " ".join(f"{m}={h.count(m)}" for m in
                    ("一周", "半周", "まわり足", "直線", "周回", "展示", "オリジナル展示データ"))


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    targets = [
        ("page", BASE + "/sp/index.php?page=yosou-cyokuzen"),
        ("ajax", BASE + "/sp/ajax/ajax_cyokuzen.php"),
        ("css", BASE + "/sp/page/yosou/css/cyokuzen.css"),
    ]
    for tag, url in targets:
        try:
            raw = fetch_bytes(url, timeout=15, retries=1,
                              headers={"Referer": BASE + "/sp/",
                                       "X-Requested-With": "XMLHttpRequest"})
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"{tag} FAIL: {str(e)[:70]}")
            continue
        print(f"{tag} ({len(raw)}B) {_counts(txt)}")
        _save(f"edo_{tag}.txt", raw)
        if tag in ("page", "ajax"):
            # thead ラベル行の手がかり
            import re
            for m in re.findall(r"<th[^>]*>([^<]{1,8})</th>", txt):
                s = m.strip()
                if s in ("一周", "半周", "まわり足", "直線", "展示", "展示タイム", "チルト"):
                    print(f"     th: {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
