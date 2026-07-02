#!/usr/bin/env python3
"""場別診断プローブ(未使用スタブ)。

各場のオリジナル展示データ源を調べる際に、このファイルを書き換えて main に
push すると probe-venue.yml が自動実行され、ログ出力 + data/_debug への
サンプル保存ができる。調査完了後は本スタブに戻す。

調査済みの結論:
  - 江戸川(3): 非公開(オリジナル展示タブ自体が無い)
  - 児島(16): 非公開(静的ASP配信で直前情報ページが無く、レース中データは
    公式へ委譲。kyogi ライブ系も気象のみ) — probe 2026-07-02
  - 唐津(23): /sp/index.php?page=yosou-cyokuzen&race=N (ajax は 404) — 対応済
"""


import sys


def main() -> int:
    print("probe_venue: stub (調査時に書き換えて使う)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
