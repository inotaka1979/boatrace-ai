#!/usr/bin/env python3
"""各場「オリジナル展示」ページの HTML をキャプチャして解析用に保存する PoC プローブ。

各レース場の公式サイトは boatrace.jp(全国版)に無い詳細展示(まわり足/一周/直線/出足 等)を
「オリジナル展示」として公開している。本スクリプトはサンプル HTML を data/_debug/ に raw 保存し、
パーサ設計のために構造（項目ラベル・テーブル構成・文字コード）を確認する用途
（Phase 1 の _debug_racelist.html と同じ進め方）。値が未掲載の時間帯でもテンプレート構造
（まわり足/一周等のラベル）は確認できる。

蒲郡(jcd=07)の URL パターン（ユーザー提供）:
  https://www.gamagori-kyotei.com/asp/gamagori/sp/kyogi/kyogihtml/recomend/recomend{YYYYMMDD}{jcd:02d}{rno:02d}.htm

文字コードが不明（Shift_JIS/EUC-JP 等の可能性）なので bytes のまま保存し、解析時に判定する。
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_bytes  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTDIR = "data/_debug"

# 場ごとに独自ドメイン。PoC は蒲郡のみ。構造確認後に横展開する。
GAMAGORI = (
    "https://www.gamagori-kyotei.com/asp/gamagori/sp/kyogi/kyogihtml/"
    "recomend/recomend{d}{jcd:02d}{rno:02d}.htm"
)
BASE = "https://www.gamagori-kyotei.com"
# recomend HTML の <div id> は空で、これらの per-day-per-venue JS データファイルを
# sp_recomend.js が読んで埋める。出足/伸び/回り足は motor*.js に入っている。
DATA_JS = {
    "motor": "/asp/gamagori/kyogi/kyogihtml/js/motor{d}{jcd:02d}.js",
    "comment": "/asp/gamagori/kyogi/kyogihtml/js/comment{d}{jcd:02d}.js",
    "focus": "/asp/gamagori/kyogi/kyogihtml/js/focus{d}{jcd:02d}.js",
    "weather": "/asp/gamagori/kyogi/kyogihtml/js/weather{d}{jcd:02d}.js",
    # 展示タイム(一周/まわり足)を埋める制御スクリプト。データファイル名を特定するため取得。
    "sp_recomend": "/js/sp_recomend.js",
    "funcLiveTime": "/asp/gamagori/sp/kyogi/kyogihtml/js/funcLiveTime.js",
}


def _save(url, name):
    try:
        raw = fetch_bytes(url, timeout=20, retries=1)
        path = os.path.join(OUTDIR, name)
        with open(path, "wb") as f:
            f.write(raw)
        print(f"saved {path} ({len(raw)} bytes) from {url}")
        return True
    except Exception as e:
        print(f"  fetch fail {url}: {e}")
        return False


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    d = datetime.now(JST).strftime("%Y%m%d")
    jcd = 7
    saved = 0
    # 1) recomend HTML（展示後に「オリジナル展示タイム(一周/まわり足/直線)」が埋まる）。
    #    早いレースほど展示航走が先に終わるので 1〜3R を採取。展示後の時間帯に実行すること。
    for rno in (1, 2, 3):
        if _save(GAMAGORI.format(d=d, jcd=jcd, rno=rno),
                 f"orig_exhibition_gamagori_{rno:02d}.html"):
            saved += 1
    # 2) JS データファイル（出足/伸び/回り足 等）+ ライブ展示タイム制御
    for key, tmpl in DATA_JS.items():
        url = BASE + tmpl.format(d=d, jcd=jcd)
        if _save(url, f"orig_data_gamagori_{key}.js"):
            saved += 1
    print(f"done: {saved} files saved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
