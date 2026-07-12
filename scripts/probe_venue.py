#!/usr/bin/env python3
"""場別調査用の使い捨てプローブ雛形。

調査対象が発生したらここに fetch+dump コードを書き、push→GHA probe-venue.yml
のログで確認する。結論が出たら本体 scraper に反映し、このファイルは雛形に戻す。

調査メモ (確定済みの結論):
- 江戸川(3): オリジナル展示タイムは非公開 (公式/場サイトとも配信なし)。
- 平和島(4): kyogi 配信 (/asp/kyogi/04/sp/yoso05{RR}.htm) の heiwajima 変種。
- 児島(16): kyogi 配信の kojima 変種。**PC トップだけ見て「非公開」と誤判定した
  過去あり — プローブは PC/SP 両方 (iframe 先含む) を必ず見ること。**
- 唐津(23): yosou-cyokuzen ページ (kiryu 系フォーマット)。
- 月間日程パーサ (2026-07-12 修正済み): 日付軸の月曜始まり仮定で +2 日ズレ
  (実ページは '27土' 始まり等) + GRADE_MAP 未対応の Takumi/Venus/Rookie 節が
  丸ごと脱落 → 公式16場開催なのにアプリ11場の実障害。ヘッダ先頭日アンカーと
  未知 is-gradeColor* フォールバックで修正 (test_schedule_axis.py で回帰固定)。
- 残り未調査: 丸亀(15) のオリジナル展示 (開催日に実データで確認予定)。
"""
import sys


def main() -> int:
    print("probe: no active investigation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
