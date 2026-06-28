#!/usr/bin/env python3
"""各場「オリジナル展示」サイトの形式を判定する検証プローブ。

各場の公式サイトは boatrace.jp(全国版)に無い実測周回展示(一周/まわり足/直線)を公開する。
鳴門(n14.jp)は AJAX `/sp/ajax/ajax_yosou.php?req=cyokuzen`(Referer/XHR 必須)で取得できた。
多くの場が `boatrace-{名}.jp/sp/` 形式=同ベンダーの可能性が高い。

本プローブは候補各場に対し ajax_yosou エンドポイントを叩き、
「各タイム」表(一周/まわり足/直線)が返るかを判定してログに出力する。
同型と判明した場は scrape_orig_exhibition.VENUES に base を足すだけで対応できる。
判定用に、表が取れた場のサンプル HTML を data/_debug/ に保存する(解析後に撤去)。
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"

# 検証対象(ユーザー提供 URL から base ドメインを抽出)。jcd: base。全24場(蒲郡7は静的+JSで別形式)。
CANDIDATES = {
    1: "https://www.kiryu-kyotei.com",     # 桐生
    2: "https://www.boatrace-toda.jp",     # 戸田
    3: "https://www.boatrace-edogawa.com",  # 江戸川
    4: "https://www.heiwajima.gr.jp",      # 平和島
    5: "https://www.boatrace-tamagawa.com",  # 多摩川
    6: "https://www.boatrace-hamanako.jp",  # 浜名湖
    8: "https://www.boatrace-tokoname.jp",  # 常滑
    9: "https://www.boatrace-tsu.com",     # 津
    10: "https://www.boatrace-mikuni.jp",  # 三国
    11: "https://www.boatrace-biwako.jp",  # びわこ
    12: "https://www.boatrace-suminoe.jp",  # 住之江
    13: "https://www.boatrace-amagasaki.jp",  # 尼崎
    15: "https://www.marugameboat.jp",     # 丸亀
    16: "https://www.kojimaboat.jp",       # 児島
    17: "https://www.boatrace-miyajima.com",  # 宮島
    18: "https://www.boatrace-tokuyama.jp",  # 徳山
    19: "https://www.boatrace-shimonoseki.jp",  # 下関
    20: "https://www.wmb.jp",              # 若松
    21: "https://www.boatrace-ashiya.com",  # 芦屋
    22: "https://www.boatrace-fukuoka.com",  # 福岡
    23: "https://www.boatrace-karatsu.jp",  # 唐津
    24: "https://omurakyotei.jp",          # 大村
}


def _probe_ajax_yosou(jcd, base, date_str):
    """ajax_yosou(鳴門型)が使えるか判定。表の有無・値の有無・byte 数を返す。"""
    headers = {"Referer": base + "/sp/", "X-Requested-With": "XMLHttpRequest"}
    best = {"jcd": jcd, "base": base, "ok": False, "has_table": False,
            "has_values": False, "bytes": 0, "sample_rno": None}
    for rno in (1, 2, 3, 4, 5):
        url = (f"{base}/sp/ajax/ajax_yosou.php"
               f"?targetday={date_str}&race={rno}&req=cyokuzen&run=0")
        try:
            raw = fetch_bytes(url, timeout=15, retries=1, headers=headers)
        except Exception as e:
            print(f"  jcd={jcd} {rno}R fetch fail: {str(e)[:80]}")
            continue
        best["ok"] = True
        try:
            html = raw.decode("utf-8", errors="replace")
        except Exception:
            html = ""
        has_table = ("一周" in html) and ("まわり足" in html) and ("直線" in html)
        # 値らしき数値(35.xx 等)が表内にあるか簡易判定
        has_values = has_table and any(s in html for s in ("rank_1", "col5"))
        if len(raw) > best["bytes"]:
            best["bytes"] = len(raw)
        if has_table and not best["has_table"]:
            best["has_table"] = True
            best["sample_rno"] = rno
            # 解析用にサンプル保存
            path = os.path.join(OUTDIR, f"cyokuzen_jcd{jcd:02d}_{rno:02d}.html")
            with open(path, "wb") as f:
                f.write(raw)
            print(f"  saved {path} ({len(raw)} bytes)")
        if has_values:
            best["has_values"] = True
            break
    return best


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    date_str = datetime.now(JST).strftime("%Y%m%d")
    print(f"=== probe ajax_yosou compatibility (date={date_str}) ===")
    results = []
    for jcd, base in CANDIDATES.items():
        r = _probe_ajax_yosou(jcd, base, date_str)
        results.append(r)
        print(f"jcd={jcd:2d} {base:40s} ok={r['ok']} table={r['has_table']} "
              f"values={r['has_values']} bytes={r['bytes']}")
    compat = [r["jcd"] for r in results if r["has_table"]]
    print(f"=== ajax_yosou-compatible venues: {compat} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
