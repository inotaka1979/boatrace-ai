#!/usr/bin/env python3
"""平和島(4) 検証: kyogi yoso05RR.htm を実パーサで解析検証(実装 PR に同梱)。

平和島はトップ iframe /asp/kyogi/04/sp/top_syusso01.htm から kyogi 配信と確認。
直前情報 = yoso05{RR}.htm と推定して実装済み(scrape_suminoe_yoso が
住之江型→児島型の順にパーサを試す)。本プローブはマージ直後に実データで
解析可否をログに出す。第三の変種だった場合はサンプルを見て追実装する。確認後撤去。

調査済みの結論:
  - 江戸川(3): 非公開 / 児島(16): kyogi yoso05RR(児島型) — 対応済
  - 唐津(23): yosou-cyokuzen フルページ — 対応済 / 残り未調査: 丸亀(15)
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_orig_exhibition as S  # noqa: E402
from http_utils import fetch_text  # noqa: E402

OUTDIR = "data/_debug"
BASE = "https://www.heiwajima.gr.jp"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    for rno in (1, 2, 3):
        url = f"{BASE}/asp/kyogi/04/sp/yoso05{rno:02d}.htm"
        print(f"\n===== yoso05{rno:02d}: {url} =====")
        try:
            html = fetch_text(url, timeout=15, retries=1,
                              headers={"Referer": BASE + "/"})
        except Exception as e:
            print(f"  FETCH FAIL: {str(e)[:100]}")
            continue
        print(f"  len={len(html)}")
        print(f"  markers: {[m for m in ('オリジナル展示', '一周', 'まわり足', '直線', '展示', 'waku') if m in html]}")
        sm = S.parse_suminoe_yoso(html, 4, rno)
        kj = S.parse_kojima_yoso(html, 4, rno)
        print("  parse_suminoe: " +
              (f"{len(sm['boats'])} boats has_times={S._has_times(sm)}" if sm else "None"))
        print("  parse_kojima:  " +
              (f"{len(kj['boats'])} boats has_times={S._has_times(kj)} "
               f"boat1={kj['boats'][0]}" if kj else "None"))
        print("  => 採用: " + ("suminoe型" if sm else
                               ("kojima型" if kj else "解析不能(第三の変種、サンプル要確認)")))
        if rno == 1:
            with open(os.path.join(OUTDIR, "heiwajima_yoso0501.html"), "w",
                      encoding="utf-8", errors="replace") as f:
                f.write(html)
        tm = re.search(r'<t(?:head|body)[^>]*>\s*<tr[^>]*>\s*<th([\s\S]{0,500})', html)
        if tm:
            print("  header: " + re.sub(r"\s+", " ", tm.group(1))[:300])
    return 0


if __name__ == "__main__":
    sys.exit(main())
