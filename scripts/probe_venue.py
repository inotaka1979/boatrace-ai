#!/usr/bin/env python3
"""常滑(8) 詳細展示が表示されない (2026-07-19 報告) の診断プローブ。

現行実装: Worker /orig-exhibition-proxy →
  https://www.boatrace-tokoname.jp/sp/ajax/ajax_yosou.php?targetday={hd}&race={N}&req=cyokuzen&run=0
  (Referer=/sp/, XHR) → クライアント _parseOrigExhibitionHtml が
  「一周&まわり足を含む table + th.colN ヘッダ + td.waku 行」を期待。
本日開催中の常滑で ajax 応答を採取し、(a) HTTP/長さ (b) キーワード
(c) th ラベルと class (d) td.waku 行の有無 を出力。ajax が死んでいれば
/sp/ トップと PC 直前情報ページの導線も採取する。確認後撤去。
"""
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
BASE = "https://www.boatrace-tokoname.jp"
UA = "Mozilla/5.0 (probe; boatrace-ai diag)"


def get(url: str, referer: str = "", xhr: bool = False, timeout: int = 20) -> tuple[int, str]:
    h = {"User-Agent": UA}
    if referer:
        h["Referer"] = referer
    if xhr:
        h["X-Requested-With"] = "XMLHttpRequest"
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        print(f"  FETCH FAIL {type(e).__name__}: {str(e)[:100]}")
        return -1, ""


def dump_tables(html: str) -> None:
    waku_cls_re = r'class="[^"]*waku'
    n_waku = len(re.findall(waku_cls_re, html))
    print(f"  len={len(html)} 一周={html.count('一周')} まわり足={html.count('まわり足')} "
          f"周り足={html.count('周り足')} 直線={html.count('直線')} waku={n_waku}")
    # th ラベル + class の一覧 (colmap 判定の材料)
    ths = re.findall(r"<th([^>]*)>([\s\S]*?)</th>", html)
    labs = []
    for attr, body in ths[:40]:
        txt = re.sub(r"\s+", "", re.sub(r"<[^>]*>", "", body))
        cm = re.search(r'class="([^"]*)"', attr)
        if txt:
            labs.append(f"{txt}[{cm.group(1) if cm else '-'}]")
    print(f"  th: {' '.join(labs[:24])}")
    # td.waku サンプル
    wm = re.findall(r'<td[^>]*class="[^"]*waku[^"]*"[^>]*>([\s\S]*?)</td>', html)[:8]
    strip_re = re.compile(r"<[^>]*>|\s+")
    samples = [strip_re.sub("", x)[:6] for x in wm]
    print(f"  td.waku 内容: {samples}")


def main() -> int:
    hd = datetime.now(JST).strftime("%Y%m%d")
    print(f"hd={hd}")
    # 第2弾: 「一周」を含む table の生 HTML を丸ごとダンプ (パーサ期待との突合用)
    url = f"{BASE}/sp/ajax/ajax_yosou.php?targetday={hd}&race=7&req=cyokuzen&run=0"
    st, html = get(url, referer=BASE + "/sp/", xhr=True)
    print(f"== race=7 cyokuzen: HTTP {st} len={len(html)}")
    if not html:
        return 0
    # table 境界を列挙し、一周 を含む table を raw 出力
    for m in re.finditer(r"<table[^>]*>[\s\S]*?</table>", html):
        tb = m.group(0)
        if "一周" not in tb:
            continue
        raw = re.sub(r"\s+", " ", tb)
        print(f"-- 一周入り table ({len(raw)}B):")
        for i in range(0, min(len(raw), 4200), 1400):
            print("   " + raw[i:i + 1400])
        break
    else:
        # table 外にある場合: 出現位置の周辺をダンプ
        idx = html.find("一周")
        seg = re.sub(r"\s+", " ", html[max(0, idx - 1500): idx + 2500])
        print(f"-- '一周' は table 内に無い。周辺 raw:\n   {seg}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
