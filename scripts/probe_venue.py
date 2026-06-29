#!/usr/bin/env python3
"""会場データ構造の一時診断プローブ（現在は休止中の空スタブ）。

過去に徳山/戸田/江戸川/びわこ/津/住之江/宮島の原因切り分けに使用。診断完了のため本体は撤去。
次に会場を調べる際は、その会場用の取得・抽出ロジックをここに書いて push すると
probe-venue ワークフローが実行する。
"""
import sys


def main() -> int:
    print("probe_venue: no active probe (stub).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
