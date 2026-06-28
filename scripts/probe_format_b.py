#!/usr/bin/env python3
"""形式B(蒲郡)オリジナル展示の所在特定プローブ(展示データ投入後・網羅版)。

蒲郡に展示データが出ている状態で、recomend(予想紙)本体 + 各種日付きデータJS +
追加候補ファイルを採取し、一周/まわり足/直線/周回 がどこに入るかを網羅検出する。
データのある recomend / 周回ラベルを含むファイルを保存。確認後撤去。
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
ORIG = ("一周", "まわり足", "まわり", "直線", "周回", "ターン")


def _counts(h):
    return " ".join(f"{m}={h.count(m)}" for m in
                    ("一周", "まわり足", "直線", "周回", "ターン", "展示"))


def _save(name, raw, note=""):
    p = os.path.join(OUTDIR, name)
    with open(p, "wb") as f:
        f.write(raw)
    print(f"      saved {p} ({len(raw)}B){note}")


def _get(url):
    raw = fetch_bytes(url, timeout=15, retries=1, headers={"Referer": BASE + "/"})
    return raw, raw.decode("utf-8", errors="replace")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    # 1) recomend 全12R: 展示値が入った回 + 周回ラベルを含む回を保存
    saved_pop = False
    saved_orig = False
    for rno in range(1, 13):
        rid = f"{hd}{JCD:02d}{rno:02d}"
        url = f"{BASE}/asp/gamagori/sp/kyogi/kyogihtml/recomend/recomend{rid}.htm"
        try:
            raw, html = _get(url)
        except Exception as e:
            print(f"R{rno:2d} recomend FAIL: {str(e)[:50]}")
            continue
        has_orig = any(m in html for m in ORIG)
        populated = ("---" not in html.split("ta_tenji", 1)[-1][:400]) if "ta_tenji" in html else False
        print(f"R{rno:2d} recomend ({len(raw)}B) {_counts(html)} orig={has_orig} pop={populated}")
        if has_orig and not saved_orig:
            _save(f"fmtB_recomend_orig_R{rno:02d}.htm", raw, " [orig labels]")
            saved_orig = True
        if populated and not saved_pop:
            _save(f"fmtB_recomend_pop_R{rno:02d}.htm", raw, " [populated]")
            saved_pop = True
    # 2) 日付きデータJS(既知4種 + 周回候補)
    js_dirs = [
        "/asp/gamagori/kyogi/kyogihtml/js",
        "/asp/gamagori/sp/kyogi/kyogihtml/js",
    ]
    kinds = ["motor", "comment", "focus", "weather", "tenji", "syuhkai",
             "syukai", "around", "time", "original", "choku", "lap"]
    for d in js_dirs:
        for k in kinds:
            url = f"{BASE}{d}/{k}{hd}{JCD:02d}.js"
            try:
                raw, txt = _get(url)
            except Exception:
                continue
            has = any(m in txt for m in ORIG)
            print(f"JS {d.split('/')[-2]}/{k} ({len(raw)}B) {_counts(txt)} orig={has}")
            if has:
                _save(f"fmtB_js_{k}.js", raw, " [orig labels]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
