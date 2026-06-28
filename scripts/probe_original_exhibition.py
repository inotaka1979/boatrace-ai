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


def main() -> int:
    os.makedirs(OUTDIR, exist_ok=True)
    d = datetime.now(JST).strftime("%Y%m%d")
    jcd = 7
    saved = 0
    for rno in (1, 6, 12):
        url = GAMAGORI.format(d=d, jcd=jcd, rno=rno)
        try:
            raw = fetch_bytes(url, timeout=20, retries=1)
            path = os.path.join(OUTDIR, f"orig_exhibition_gamagori_{rno:02d}.html")
            with open(path, "wb") as f:
                f.write(raw)
            print(f"saved {path} ({len(raw)} bytes) from {url}")
            saved += 1
        except Exception as e:
            print(f"  jcd={jcd} rno={rno} fetch fail: {e}")
    print(f"done: {saved} pages saved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
