#!/usr/bin/env python3
"""残り(ajax_yosou 非対応)各場のサイト形式を分類する診断プローブ。

形式ファースト方針: 各場トップHTMLを採取し、構造シグネチャ(どのデータ取得方式か)を
判定・一覧化する。これを基に形式グループごとの専用パーサを設計する。確認後に撤去。

判定マーカー:
  - getYosou(           : 鳴門型 ajax_yosou (ただし本群は ajax_yosou.php が404だった=別亜種の可能性)
  - ajax_yosou.php       : 同上エンドポイント言及
  - index.php?page=      : PHP ページ型
  - motor / recomend     : 蒲郡型(静的HTML+JSデータ)
  - .js?var= / kyogihtml : 蒲郡系 JS データ配信
  - ajax / .json / getJSON: 何らかの非同期取得
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

OUTDIR = "data/_debug"

# ajax_yosou 非対応だった場 + 蒲郡。トップ(sp)候補を採取。
VENUES = {
    1: "https://www.kiryu-kyotei.com/sp/",
    2: "https://www.boatrace-toda.jp/sp/",
    3: "https://www.boatrace-edogawa.com/sp/",
    4: "https://www.heiwajima.gr.jp/sp/",
    7: "https://www.gamagori-kyotei.com/",
    11: "https://www.boatrace-biwako.jp/sp/",
    12: "https://www.boatrace-suminoe.jp/sp/",
    15: "https://www.marugameboat.jp/sp/",
    16: "https://www.kojimaboat.jp/",
    17: "https://www.boatrace-miyajima.com/",
    22: "https://www.boatrace-fukuoka.com/sp/",
    23: "https://www.boatrace-karatsu.jp/sp/",
    24: "https://omurakyotei.jp/",
}

MARKERS = [
    "getYosou(", "ajax_yosou", "index.php?page=", "recomend", "motor",
    "kyogihtml", ".js?var=", "ajax", ".json", "getJSON", "syussou", "cyokuzen",
]


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    for jcd, url in VENUES.items():
        try:
            raw = fetch_bytes(url, timeout=20, retries=1)
            html = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"jcd={jcd:2d} FETCH FAIL {url}: {str(e)[:80]}")
            continue
        path = os.path.join(OUTDIR, f"venuetop_jcd{jcd:02d}.html")
        with open(path, "wb") as f:
            f.write(raw)
        sig = [m for m in MARKERS if m in html]
        # script src のうち kyogi/yosou/ajax 系を数件
        srcs = re.findall(r'<script[^>]+src=[\"\']([^\"\']+)[\"\']', html)
        hot = [s for s in srcs if re.search(r"yosou|ajax|kyogi|motor|recomend|getYosou", s, re.I)][:4]
        print(f"jcd={jcd:2d} ({len(raw)}B) sig={sig}")
        for s in hot:
            print(f"        src: {s[:110]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
