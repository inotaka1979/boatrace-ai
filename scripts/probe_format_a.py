#!/usr/bin/env python3
"""形式A(桐生・福岡)レース選択方法の確定プローブ。

判明済み:
  - エンドポイント {base}/sp/ajax/ajax_cyokuzen.php、レスポンスを '<!--sep-->' で
    split、pageArr[0] が直前情報ページ。
  - 桐生のテーブル: thead に 艇番/体重/チルト/展示タイム(col4)/オリジナル展示データ
    (col5: 半周=col5_1, まわり足=col5_2, 直線=col5_3)。
    ※桐生は「一周」でなく「半周」を計測。
  - cyokuzen ページ(race指定なし)の inline では prmD/prmR/prmJ が空 →
    レース選択は (a) ページ ?race=N で session 設定 → ajax は cookie 参照、
    あるいは (b) ?race=N 時に inline prmR が埋まる、のいずれか。

本プローブは cookie jar 付きで:
  1) index.php?page=yosou-cyokuzen&race=N をGET(session cookie 設定)し、
     inline の prmD/prmR/prmJ 値を抽出表示
  2) 同 cookie で ajax/ajax_cyokuzen.php をGET → pageArr[0] に実数データ
     (半周/まわり足/直線) が入るか確認、入っていれば保存
複数レース(3,6,9,12)で実測値が取れる回を採取。確認後撤去。
"""
import http.cookiejar
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 BoatRaceOracle/1.0")
VENUES = {
    1: "https://www.kiryu-kyotei.com",
    22: "https://www.boatrace-fukuoka.com",
}
PRM_RE = re.compile(r'var\s+(prmD|prmR|prmJ)\s*=\s*"([^"]*)"')


def _opener():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def _get(op, url, ref):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Referer": ref,
        "X-Requested-With": "XMLHttpRequest"})
    with op.open(req, timeout=20) as r:
        return r.read()


def _counts(h: str) -> str:
    return (f"半周={h.count('半周')} まわり足={h.count('まわり足')} "
            f"直線={h.count('直線')} 展示={h.count('展示')} "
            f"nodata={h.count('表示するデータがありません')} sep={h.count('<!--sep-->')}")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    _ = datetime.now(JST).strftime("%Y%m%d")
    for jcd, base in VENUES.items():
        print(f"===== jcd={jcd} {base} =====")
        # cyokuzen.css は実データ有無に関わらず col5-1/2/3・rank クラス定義を含む
        # → 描画前でも populated レイアウトを確定できる(夜間場でも採取可)
        for css in (base + "/sp/page/yosou/css/cyokuzen.css?ver=2.1.21",
                    base + "/sp/page/yosou/css/cyokuzen.css"):
            try:
                op = _opener()
                craw = _get(op, css, base + "/sp/index.php?page=yosou-cyokuzen")
                path = os.path.join(OUTDIR, f"fmtA_cyokuzen_jcd{jcd:02d}.css")
                with open(path, "wb") as f:
                    f.write(craw)
                print(f"  css saved {path} ({len(craw)}B)")
                break
            except Exception as e:
                print(f"  css FAIL {css}: {str(e)[:60]}")
        ajax = base + "/sp/ajax/ajax_cyokuzen.php"
        saved = False
        for rno in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12):
            op = _opener()  # レースごとに新規 session
            page = base + f"/sp/index.php?page=yosou-cyokuzen&race={rno}"
            try:
                praw = _get(op, page, base + "/sp/")
                phtml = praw.decode("utf-8", errors="replace")
            except Exception as e:
                print(f"  R{rno} page FAIL: {str(e)[:60]}")
                continue
            prm = dict(PRM_RE.findall(phtml))
            print(f"  R{rno} page({len(praw)}B) prm={prm}")
            try:
                araw = _get(op, ajax, page)
                ahtml = araw.decode("utf-8", errors="replace")
            except Exception as e:
                print(f"  R{rno} ajax FAIL: {str(e)[:60]}")
                continue
            has_data = ("表示するデータがありません" not in ahtml
                        and re.search(r"col5_1[^>]*>\s*\d", ahtml) is not None)
            print(f"  R{rno} ajax({len(araw)}B) {_counts(ahtml)} hasData={has_data}")
            if not saved and has_data:
                path = os.path.join(OUTDIR, f"fmtA_cyokuzen_jcd{jcd:02d}_R{rno:02d}.html")
                with open(path, "wb") as f:
                    f.write(araw)
                print(f"        saved {path}")
                saved = True
        # データ無しでも1枚は残す(構造確認用)
        if not saved:
            op = _opener()
            page = base + "/sp/index.php?page=yosou-cyokuzen&race=3"
            try:
                _get(op, page, base + "/sp/")
                araw = _get(op, ajax, page)
                path = os.path.join(OUTDIR, f"fmtA_cyokuzen_jcd{jcd:02d}_R03_raw.html")
                with open(path, "wb") as f:
                    f.write(araw)
                print(f"        saved {path} (no live data)")
            except Exception as e:
                print(f"  fallback FAIL: {str(e)[:60]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
