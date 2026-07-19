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


def simulate_parser(html: str) -> None:
    """_parseOrigExhibitionHtml のロジックを bs4 で忠実に再現して失敗点を特定する。"""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    print(f"  tables={len(tables)}")
    target = None
    for i, tb in enumerate(tables):
        tx = tb.get_text()
        if "一周" in tx and "まわり足" in tx:
            print(f"  → target = table#{i} class='{' '.join(tb.get('class') or [])}'")
            target = tb
            break
    if target is None:
        print("  → 一周&まわり足を含む table 無し (parse 失敗)")
        return
    labels = {"展示": "ex_time", "展示タイム": "ex_time", "一周": "lap_time",
              "まわり足": "turn_time", "直線": "straight_time"}
    colmap = {}
    for tr in target.find_all("tr"):
        for th in tr.find_all("th"):
            lab = re.sub(r"\s+", "", th.get_text())
            f = labels.get(lab)
            if not f or f in colmap:
                continue
            cols = [c for c in (th.get("class") or []) if re.fullmatch(r"col\d+", c)]
            if cols:
                colmap[f] = cols[0]
    print(f"  colmap={colmap}")
    if not (colmap.get("lap_time") and colmap.get("turn_time")):
        print("  → colmap 不足 (parse 失敗)")
        return
    bymap = {}
    for tr in target.find_all("tr"):
        wtd = tr.find("td", class_="waku")
        if not wtd:
            continue
        try:
            waku = int(wtd.get_text(strip=True))
        except ValueError:
            continue
        if not 1 <= waku <= 6:
            continue
        rec = {}
        for f, cls in colmap.items():
            td = tr.find("td", class_=cls)
            try:
                v = float(td.get_text(strip=True)) if td else 0
            except ValueError:
                v = 0
            rec[f] = v if v > 0 else 0
        if waku not in bymap:
            bymap[waku] = rec
    print(f"  bymap({len(bymap)}艇): {bymap}")


def main() -> int:
    hd = datetime.now(JST).strftime("%Y%m%d")
    print(f"hd={hd}")
    # 第4弾: Worker/直取得とも健全のため、クライアントパーサのロジックを再現して失敗点を特定。
    url = f"{BASE}/sp/ajax/ajax_yosou.php?targetday={hd}&race=7&req=cyokuzen&run=0"
    st, html = get(url, referer=BASE + "/sp/", xhr=True)
    print(f"== 常滑 race=7: HTTP {st} len={len(html)}")
    if not html:
        return 0
    # 一周 の全出現位置の前後 (どの要素に属すか)
    for m in re.finditer("一周", html):
        seg = re.sub(r"\s+", " ", html[max(0, m.start() - 150): m.start() + 60])
        print(f"  一周@{m.start()}: …{seg}…")
    simulate_parser(html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
