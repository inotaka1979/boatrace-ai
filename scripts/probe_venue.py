#!/usr/bin/env python3
"""津(9) のレース詳細ページ(page=yosou-yosou)から オリジナル展示 の読込方法を採取。

津の SP トップにはタブが無く、レース詳細は page=yosou-yosou&race=N。この中の
展示情報→オリジナル展示 サブタブがどの ajax/req/URL でテーブルを取るかを、
JS と DOM から突き止める。確認後撤去。
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"
BASE = "https://www.boatrace-tsu.com"


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    hd = datetime.now(JST).strftime("%Y%m%d")
    for name, url in [
        ("yosou_yosou", f"{BASE}/sp/index.php?page=yosou-yosou&race=1"),
        ("yosou_yosou_hd", f"{BASE}/sp/index.php?page=yosou-yosou&race=1&hd={hd}"),
    ]:
        try:
            raw = fetch_bytes(url, timeout=12, retries=1,
                              headers={"Referer": BASE + "/sp/"})
            txt = raw.decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[{name}] FAIL: {str(e)[:70]}")
            continue
        kw = {k: txt.count(k) for k in
              ("オリジナル展示", "一周", "まわり足", "直線", "展示タイム",
               "スタート展示", "ajax_yosou", "ajax_")}
        print(f"[{name}] ({len(raw)}B) {kw}")
        print("  req= :", sorted(set(re.findall(r'req=([A-Za-z0-9_]+)', txt))))
        print("  ajax php:", sorted(set(re.findall(r'/ajax/([a-z_]+\.php)', txt))))
        print("  .php?...req:", sorted(set(
            re.findall(r'([a-z_]+\.php\?[^"\'\s]{0,60})', txt)))[:12])
        # 「オリジナル展示」近傍(タブ onclick/data-*)
        for m in re.finditer("オリジナル展示", txt):
            seg = re.sub(r'\s+', ' ', txt[m.start()-260:m.start()+30])
            print(f"  near: ...{seg}")
        # JS 内の関数で cyokuzen/original/tenji を含む行
        for ln in txt.splitlines():
            if re.search(r'(cyokuzen|original|tenji)', ln, re.I) and \
               ('ajax' in ln.lower() or 'req' in ln.lower() or '.php' in ln):
                print(f"  js: {ln.strip()[:140]}")
        with open(os.path.join(OUTDIR, f"tsu_{name}.html"), "wb") as f:
            f.write(raw)
        break
    return 0


if __name__ == "__main__":
    sys.exit(main())
