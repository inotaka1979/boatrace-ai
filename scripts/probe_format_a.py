#!/usr/bin/env python3
"""形式A(桐生・福岡)の実データエンドポイント ajax_cyokuzen.php を採取する診断。

判明: 桐生/福岡(同一ベンダ, yosou.js)は cyokuzen ページ内インラインで
  GET ./ajax/ajax_cyokuzen.php (data: prmD&prmR&prmJ) を叩き、
  レスポンスHTMLを '<!--sep-->' で split、pageArr[0] が「直前情報」
  (一周/まわり足/直線 を含む実測展示) ページ。

本プローブは:
  1) yosou.js を採取(prmD/prmR/prmJ の組み立て=レース指定方法を確定)
  2) /sp/ajax/ajax_cyokuzen.php を複数パラメータ候補で叩きレスポンス保存
     一周/まわり足/直線 の有無を確認
これで形式A専用パーサ(ajax_cyokuzen.php 直叩き→pageArr[0]解析)を設計する。確認後撤去。
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
VENUES = {
    1: "https://www.kiryu-kyotei.com",
    22: "https://www.boatrace-fukuoka.com",
}


def _save(name: str, raw: bytes) -> None:
    path = os.path.join(OUTDIR, name)
    with open(path, "wb") as f:
        f.write(raw)
    print(f"        saved {path} ({len(raw)}B)")


def _counts(html: str) -> str:
    return (f"一周={html.count('一周')} まわり足={html.count('まわり足')} "
            f"直線={html.count('直線')} 展示={html.count('展示')} "
            f"sep={html.count('<!--sep-->')}")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    for jcd, base in VENUES.items():
        print(f"===== jcd={jcd} {base} =====")
        ref = base + "/sp/index.php?page=yosou-cyokuzen"
        # 1) yosou.js を採取
        for jsurl in (base + "/sp/page/yosou/js/yosou.js?ver=2.0.5",
                      base + "/sp/page/yosou/js/yosou.js"):
            try:
                raw = fetch_bytes(jsurl, timeout=20, retries=1,
                                  headers={"Referer": ref})
                _save(f"fmtA_yosou_jcd{jcd:02d}.js", raw)
                break
            except Exception as e:
                print(f"  yosou.js FAIL {jsurl}: {str(e)[:60]}")
        # 2) ajax_cyokuzen.php をパラメータ候補で
        ajax = base + "/sp/ajax/ajax_cyokuzen.php"
        param_candidates = [
            "",
            "race=3",
            "rno=3",
            f"hd={hd}&race=3",
            f"prmD={hd}&prmR=3&prmJ={jcd:02d}",
            f"date={hd}&race=3&jcd={jcd:02d}",
        ]
        best_saved = False
        for i, q in enumerate(param_candidates):
            url = ajax + ("?" + q if q else "")
            try:
                raw = fetch_bytes(
                    url, timeout=20, retries=1,
                    headers={"Referer": ref,
                             "X-Requested-With": "XMLHttpRequest"})
                html = raw.decode("utf-8", errors="replace")
            except Exception as e:
                print(f"  ajax p{i} FAIL ({q!r}): {str(e)[:60]}")
                continue
            print(f"  ajax p{i} ({len(raw)}B) [{q or '(empty)'}] {_counts(html)}")
            # 一周を含む有用レスポンスを1つ保存
            if not best_saved and html.count("一周") > 0:
                _save(f"fmtA_ajaxcyokuzen_jcd{jcd:02d}.html", raw)
                best_saved = True
        # 一周が取れなくても素のレスポンスを1枚は残す(空 param)
        if not best_saved:
            try:
                raw = fetch_bytes(ajax, timeout=20, retries=1,
                                  headers={"Referer": ref,
                                           "X-Requested-With": "XMLHttpRequest"})
                _save(f"fmtA_ajaxcyokuzen_jcd{jcd:02d}_raw.html", raw)
            except Exception as e:
                print(f"  ajax raw FAIL: {str(e)[:60]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
