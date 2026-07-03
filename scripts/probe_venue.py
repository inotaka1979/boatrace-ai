#!/usr/bin/env python3
"""場別診断プローブ(未使用スタブ)。

各場のオリジナル展示データ源を調べる際に、このファイルを書き換えて main に
push すると probe-venue.yml が自動実行され、ログ出力 + data/_debug への
サンプル保存ができる。調査完了後は本スタブに戻す。

調査済みの結論:
  - 江戸川(3): 非公開(オリジナル展示タブ自体が無い)
  - 平和島(4): kyogi yoso05RR(第三の変種: ヘッダ「1周/周り足」表記、
    末尾3セル位置ベース → parse_heiwajima_yoso) — 対応済
  - 児島(16): kyogi yoso05RR(児島型: 2行ヘッダ+7セル位置 → parse_kojima_yoso) — 対応済
    ※当初 PC トップだけ見て非公開と誤判定。プローブは PC/SP 両方を見ること。
  - 唐津(23): /sp/index.php?page=yosou-cyokuzen&race=N (ajax は 404) — 対応済
  - 残り未調査: 丸亀(15)
"""
import sys


def main() -> int:
    print("probe_venue: stub (調査時に書き換えて使う)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
