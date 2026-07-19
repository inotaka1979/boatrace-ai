#!/usr/bin/env python3
"""結果反映遅延 第3弾: raceresult 払戻テーブルの現行 markup を生ダンプ。

第2弾の発見: 場5 だけでなく場2 (openapi にある「健全」レース) でも、
worker パーサ前提の <tbody>内<th>ラベル構造が 1 件も見つからない。
→ boatrace.jp が markup を変更し (th→td 等)、worker 自前スクレイプの払戻
  抽出は全場で壊れている疑い。openapi ミラーに載る場は base で隠れ、
  ミラー欠落場 (今日の場5) だけ症状が露呈していた。
本プローブで '連単' を含む tbody の生 HTML と table class 一覧を出力し、
新パーサの正確な仕様を得る。確認後撤去。
"""
import re
import sys
import time
import urllib.request

UA = "Mozilla/5.0 (probe; boatrace-ai diag)"
HD = "20260719"


def get(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def dump(label: str, jcd: int, rno: int) -> None:
    url = f"https://www.boatrace.jp/owpc/pc/race/raceresult?rno={rno}&jcd={jcd:02d}&hd={HD}"
    print(f"\n===== {label}: {url}")
    html = get(url)
    print(f"len={len(html)}")

    # table 開始タグと class の一覧 (何番目の table が結果/払戻か把握)
    for i, m in enumerate(re.finditer(r"<table[^>]*>", html)):
        print(f"  table#{i}: {m.group(0)[:110]}")

    # '連単' を含む tbody の生 HTML (nav には無いので本体のみ拾える)
    tbodies = list(re.finditer(r"<tbody[^>]*>([\s\S]*?)</tbody>", html))
    hit = 0
    for ti, m in enumerate(tbodies):
        tb = m.group(1)
        if "連単" not in tb and "単勝" not in tb:
            continue
        hit += 1
        raw = re.sub(r"\s+", " ", tb).strip()
        print(f"-- tbody#{ti} raw ({len(raw)}B):")
        print("   " + raw[:1400])
        if hit >= 4:
            break
    if hit == 0:
        # tbody に無ければ '3連単' 出現位置の周辺をそのまま出す (nav 以外の最後の出現)
        for mm in list(re.finditer("3連単", html))[-2:]:
            seg = re.sub(r"\s+", " ", html[mm.start() - 400: mm.start() + 1200])
            print(f"-- '3連単' 周辺 raw:\n   {seg}")


def main() -> int:
    dump("場5(多摩川)1R = 払戻欠落", 5, 1)
    time.sleep(2)
    dump("場2(戸田)1R = openapiにはある", 2, 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
