#!/usr/bin/env python3
"""江戸川(3)・びわこ(11) のオリジナル展示の有無/データ経路を発見するプローブ。

両者は platform C(桐生/福岡型)で登録されていたが、江戸川は独自CMS
(/modules/yosou/cyokuzen.php?day=&race=)と判明。びわこも別構造の可能性が高い。
- 江戸川: cyokuzen / cyokuzen_info モジュールにオリジナル展示(一周/まわり足/直線)が
  あるか確認。
- びわこ: top ページから直前モジュールの参照とパラメータ構造を抽出し、候補を叩く。
確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
KW = ("オリジナル展示", "一周", "半周", "まわり足", "直線", "周回", "展示タイム",
      "展示", "<table", "<th")


def _marks(txt):
    return " ".join(f"{m}={txt.count(m)}" for m in KW)


def _ths(txt):
    ths = [re.sub(r"<[^>]+>", "", t).strip()
           for t in re.findall(r"<th[^>]*>.*?</th>", txt, re.S)]
    return [t for t in ths if t][:16]


def probe_modules(tag, base, hd):
    """edogawa 系 CMS の /modules/yosou/{cyokuzen,cyokuzen_info}.php を叩く。"""
    print(f"== {tag} /modules/yosou/*.php ==")
    saved = set()
    for mod in ("cyokuzen", "cyokuzen_info"):
        for race in (1, 2, 3):
            url = f"{base}/modules/yosou/{mod}.php?day={hd}&race={race}"
            try:
                raw = fetch_bytes(url, timeout=12, retries=1,
                                  headers={"Referer": base + "/"})
                txt = raw.decode("utf-8", errors="replace")
                print(f"[{tag} {mod} R{race}] ({len(raw)}B) {_marks(txt)}")
                print(f"    th={_ths(txt)}")
                if mod not in saved and len(raw) > 300:
                    p = os.path.join(OUTDIR, f"{tag}_{mod}_R{race:02d}.html")
                    with open(p, "wb") as f:
                        f.write(raw)
                    print(f"    saved {p}")
                    saved.add(mod)
            except Exception as e:
                print(f"[{tag} {mod} R{race}] FAIL: {str(e)[:70]}")


def discover_top(tag, base):
    """top を取得し、直前/オリジナル展示への参照(モジュール/ajax/php)を抽出。"""
    print(f"== {tag} top discovery ==")
    try:
        raw = fetch_bytes(base + "/", timeout=12, retries=1,
                          headers={"Referer": base + "/"})
        txt = raw.decode("utf-8", errors="replace")
        print(f"[{tag} top] ({len(raw)}B) {_marks(txt)}")
        refs = re.findall(
            r'''['"]([^'"<> ]*(?:modules|cyokuzen|tenji|yosou|ajax|周回)'''
            r'''[^'"<> ]*)['"]''', txt)
        for r in sorted(set(refs))[:40]:
            print(f"    ref: {r}")
        # iframe/ajax の param 構造(day=/race= 等)
        for m in re.findall(r'["\'][^"\']*\.php["\']\s*\+\s*\n?[^;]{0,60}', txt):
            print(f"    param: {re.sub(chr(9),'',m)[:90]}")
        p = os.path.join(OUTDIR, f"{tag}_top.html")
        with open(p, "wb") as f:
            f.write(raw)
        print(f"    saved {p}")
    except Exception as e:
        print(f"[{tag} top] FAIL: {str(e)[:70]}")


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    # 江戸川: モジュール確認
    probe_modules("edogawa", "https://www.boatrace-edogawa.com", hd)
    # びわこ: まず構造発見 → edogawa 系なら同じモジュールも試す
    discover_top("biwako", "https://www.boatrace-biwako.jp")
    probe_modules("biwako", "https://www.boatrace-biwako.jp", hd)
    return 0


if __name__ == "__main__":
    sys.exit(main())
