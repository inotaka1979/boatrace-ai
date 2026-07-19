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


WORKER = "https://boatrace-scrape-trigger.inotaka1979.workers.dev"


def main() -> int:
    hd = datetime.now(JST).strftime("%Y%m%d")
    print(f"hd={hd}")
    # 第3弾: 直取得はテーブル健全 (tbl_oriten、パーサ期待通り) だったため、
    # クライアントが実際に通る Worker /orig-exhibition-proxy 経由を検証。
    # 比較対象に多摩川(5)/浜名湖?も。Worker→場サイトの到達性 (CF からのブロック) を切り分ける。
    for jcd, name in ((8, "常滑"), (5, "多摩川"), (18, "徳山")):
        url = f"{WORKER}/orig-exhibition-proxy?jcd={jcd}&race=7&hd={hd}"
        st, html = get(url)
        n_ori = html.count("一周") if html else 0
        n_waku = len(re.findall(r'class="[^"]*waku', html)) if html else 0
        head = re.sub(r"\s+", " ", html[:200]) if html else ""
        print(f"== worker proxy jcd={jcd}({name}): HTTP {st} len={len(html)} "
              f"一周={n_ori} waku={n_waku}")
        if st != 200 or n_ori == 0:
            print(f"   head: {head}")
        time.sleep(1)
    # 直取得 (GHA→常滑) の対照
    url = f"{BASE}/sp/ajax/ajax_yosou.php?targetday={hd}&race=7&req=cyokuzen&run=0"
    st, html = get(url, referer=BASE + "/sp/", xhr=True)
    print(f"== 直取得 常滑 race=7: HTTP {st} len={len(html)} 一周={html.count('一周') if html else 0}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
