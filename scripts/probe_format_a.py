#!/usr/bin/env python3
"""形式A(桐生・福岡・戸田)の cyokuzen ページ「データ取得機構」発見プローブ。

これらの場は ?page=yosou-cyokuzen がサーバー描画では 一周/まわり足/直線 を含まない
(=JS で別エンドポイントから読み込む) ことが判明。本プローブはページ HTML を
"一周の有無に関わらず必ず保存" し、インラインの ajax/fetch/.php/.js/.json 参照や
レース選択(select/option, rno/race/tno)の手がかりを抽出してログ化する。

得られた手がかりから実データエンドポイント(鳴門の ajax_yosou.php 相当)を特定し、
形式A専用パーサを設計する。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
VENUES = {
    1: "https://www.kiryu-kyotei.com",       # 桐生
    22: "https://www.boatrace-fukuoka.com",   # 福岡
    2: "https://www.boatrace-toda.jp",        # 戸田(前回採取失敗)
}

# cyokuzen ページの候補パス(各場でルートが異なるため複数試行、最初に取れた1枚を保存)
PATH_CANDIDATES = [
    "/sp/index.php?page=yosou-cyokuzen",
    "/index.php?page=yosou-cyokuzen",
    "/?page=yosou-cyokuzen",
    "/sp/?page=yosou-cyokuzen",
]

# データ取得機構の手がかり(インラインJS/HTML内に現れる)
HINT_RE = re.compile(
    r"""(?P<url>[^\s'"()]+\.(?:php|js|json)(?:\?[^\s'"()]*)?)"""
    r"""|(?P<ajax>\$\.(?:ajax|getJSON|get|post)\s*\()"""
    r"""|(?P<fetch>fetch\s*\()"""
    r"""|(?P<func>(?:getYosou|loadCyokuzen|getCyokuzen|getTenji)\s*\()""",
    re.I,
)


def _probe_one(jcd: int, base: str) -> None:
    saved = False
    for p in PATH_CANDIDATES:
        url = base + p
        try:
            raw = fetch_bytes(url, timeout=20, retries=1,
                              headers={"Referer": base + "/sp/",
                                       "X-Requested-With": "XMLHttpRequest"})
            html = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"jcd={jcd:2d} FAIL {p}: {str(e)[:70]}")
            continue
        isu = html.count("一周")
        mw = html.count("まわり足")
        ten = html.count("展示")
        print(f"jcd={jcd:2d} ({len(raw)}B) 一周={isu} まわり足={mw} 展示={ten}  {p}")
        # 最初に取れたページを必ず1枚保存(一周の有無に関わらず)
        if not saved:
            path = os.path.join(OUTDIR, f"fmtA_jcd{jcd:02d}.html")
            with open(path, "wb") as f:
                f.write(raw)
            print(f"        saved {path}")
            saved = True
            # データ取得機構の手がかりを抽出
            hints = set()
            races = set()
            for m in HINT_RE.finditer(html):
                if m.group("url"):
                    hints.add(m.group("url")[:120])
                elif m.group("ajax"):
                    hints.add("$.ajax/getJSON")
                elif m.group("fetch"):
                    hints.add("fetch()")
                elif m.group("func"):
                    hints.add(m.group("func"))
            for m in re.finditer(r"(rno|race|tno|hd|targetday)=[\w%]+", html):
                races.add(m.group(0)[:40])
            for s in re.findall(r"<script[^>]+src=['\"]([^'\"]+)['\"]", html):
                if re.search(r"yosou|cyokuzen|tenji|ajax|kyogi|getYosou", s, re.I):
                    hints.add("SRC:" + s[:110])
            if hints:
                print("        HINTS:")
                for h in sorted(hints):
                    print(f"          - {h}")
            if races:
                print(f"        RACE-PARAMS: {sorted(races)}")
        if isu > 0:
            break


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    _ = datetime.now(JST).strftime("%Y%m%d")
    for jcd, base in VENUES.items():
        _probe_one(jcd, base)
    return 0


if __name__ == "__main__":
    sys.exit(main())
