#!/usr/bin/env python3
"""結果反映遅延 第2弾: 場5(多摩川)の払戻パース失敗の構造差を特定。

第1弾の実測: 49 レース中 46 は着順+払戻まで ~10 分で反映。場5 の 1R/2R だけ
「worker=着順のみ・openapi=無」が 51/21 分継続、公式には払戻掲載済み。
→ worker parseRaceresultHTML の払戻抽出が場5 のページでだけ失敗している。
場5 1R と健全な場2 1R の払戻金テーブル HTML を比較 + worker の regex を
Python に移植して各段の抽出結果を出力する。確認後撤去。
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


def strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", s)).strip()


def analyze(label: str, jcd: int, rno: int) -> None:
    url = f"https://www.boatrace.jp/owpc/pc/race/raceresult?rno={rno}&jcd={jcd:02d}&hd={HD}"
    print(f"\n===== {label}: {url}")
    html = get(url)
    print(f"len={len(html)} 払戻金出現={html.count('払戻金')} tbody数={len(re.findall(r'<tbody', html))}")

    # worker と同じ tbody 抽出
    tbodies = re.findall(r"<tbody[^>]*>([\s\S]*?)</tbody>", html)
    kw_hits = 0
    for ti, tb in enumerate(tbodies):
        if ("払戻" not in tb and "配当" not in tb and "連単" not in tb and "単勝" not in tb):
            continue
        kw_hits += 1
        # worker と同じ tr/th/td 抽出
        rows = re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", tb)
        parsed = []
        for tr in rows:
            thm = re.search(r"<th[^>]*>([\s\S]*?)</th>", tr)
            if not thm:
                parsed.append(("(th無)", None, None))
                continue
            lab = strip_tags(thm.group(1))
            tds = [strip_tags(x) for x in re.findall(r"<td[^>]*>([\s\S]*?)</td>", tr)]
            parsed.append((lab, tds[:3], len(tds)))
        print(f"-- tbody#{ti} (キーワード一致, tr={len(rows)}) 抽出結果:")
        for lab, tds, n in parsed[:14]:
            print(f"   th='{lab}' tds={tds} (n={n})")
    print(f"キーワード一致 tbody: {kw_hits}")

    # 払戻金 周辺の生 HTML (構造の目視用)
    idx = html.find("払戻金")
    if idx >= 0:
        seg = html[idx - 100: idx + 2600]
        seg = re.sub(r"\s+", " ", seg)
        print(f"-- 払戻金 周辺 raw (2.7KB):\n{seg}")


def main() -> int:
    analyze("場5(多摩川)1R = 払戻欠落", 5, 1)
    time.sleep(2)
    analyze("場2(戸田)1R = 健全", 2, 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
