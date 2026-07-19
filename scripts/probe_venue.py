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
    print(f"  len={len(html)} 一周={html.count('一周')} まわり足={html.count('まわり足')} "
          f"周り足={html.count('周り足')} 直線={html.count('直線')} waku={len(re.findall(r'class=\"[^\"]*waku', html))}")
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
    print(f"  td.waku 内容: {[re.sub(r'<[^>]*>|\\s+', '', x)[:6] for x in wm]}")


def main() -> int:
    hd = datetime.now(JST).strftime("%Y%m%d")
    print(f"hd={hd}")
    for race in (1, 7, 9):
        for req in ("cyokuzen", "sttenji"):
            url = f"{BASE}/sp/ajax/ajax_yosou.php?targetday={hd}&race={race}&req={req}&run=0"
            st, html = get(url, referer=BASE + "/sp/", xhr=True)
            print(f"\n== race={race} req={req}: HTTP {st}")
            if html:
                dump_tables(html)
            time.sleep(1)
    # 導線確認 (ajax が空/404 のときの調査材料)
    for label, url, ref in (
        ("SP top", BASE + "/sp/", ""),
        ("PC 直前情報", BASE + "/modules/yosou/cyokuzen.php?race=7", BASE + "/"),
    ):
        st, html = get(url, referer=ref)
        print(f"\n== {label}: HTTP {st} len={len(html)}")
        if html:
            for kw in ("ajax_yosou", "cyokuzen", "一周", "まわり足", "オリジナル展示"):
                print(f"   '{kw}': {html.count(kw)}")
            for m in re.findall(r'(?:src|href)="([^"]*(?:yosou|cyokuzen|tenji)[^"]*)"', html)[:10]:
                print(f"   link: {m[:100]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
