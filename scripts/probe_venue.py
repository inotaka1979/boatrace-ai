#!/usr/bin/env python3
"""会場データ構造の一時診断プローブ（現在は休止中の空スタブ）。

過去に徳山(直線列なし)・戸田(XMLパス変更)・江戸川(非公開)・びわこ(独自CMS kind=2)・
津(req=sttenji=展示情報タブ)の原因切り分けに使用。診断完了のため本体は撤去。
次に会場を調べる際は、その会場用の取得・抽出ロジックをここに書いて push すると
probe-venue ワークフローが実行する。
"""
import sys


def main() -> int:
    print("probe_venue: no active probe (stub). 調査時にロジックを追加して使用。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
