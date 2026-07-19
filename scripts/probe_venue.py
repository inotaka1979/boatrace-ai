#!/usr/bin/env python3
"""場別調査用の使い捨てプローブ雛形。

調査対象が発生したらここに fetch+dump コードを書き、push→GHA probe-venue.yml
のログで確認する。結論が出たら本体 scraper に反映し、このファイルは雛形に戻す。
(workflow_dispatch は integration token では 403 のため、CI で走らせたい場合は
draft PR + run_all.sh への一時ステップ追加でも代替できる。test.yml 環境には
bs4 が無い点に注意。)

調査メモ (確定済みの結論):
- 江戸川(3): オリジナル展示タイムは非公開 (公式/場サイトとも配信なし)。
- 平和島(4): kyogi 配信 (/asp/kyogi/04/sp/yoso05{RR}.htm) の heiwajima 変種。
- 児島(16): kyogi 配信の kojima 変種。**PC トップだけ見て「非公開」と誤判定した
  過去あり — プローブは PC/SP 両方 (iframe 先含む) を必ず見ること。**
- 唐津(23): yosou-cyokuzen ページ (kiryu 系フォーマット)。
- 月間日程パーサ (2026-07-12 修正済み): ヘッダ先頭日アンカー + 未知
  is-gradeColor* フォールバック (test_schedule_axis.py)。
- 上流 openapi previews 破損 (2026-07-17 対処済み): Worker が合成 previews に
  置換、クライアントは空正規化。
- raceresult markup 変更 (2026-07-19 対処済み): 払戻ラベル th→td rowspan。
  worker.js / scrape_results.py とも新旧両対応 (test_raceresult_parse.{js,py})。
- 常滑 詳細展示消失 (2026-07-19 対処済み): サーバ/パーサ/プロキシは全て健全
  (tbl_oriten は現行パーサ期待通り)。真因はクライアントの bulk 全置換
  (_origExhibIndex=idx) がライブ取得済み後半レースを「更新」のたびに消し、
  _oeLiveTried ガードで再取得もされない消失バグ → 存在キー温存マージに修正 +
  展示情報セクションの preview 必須も撤廃 ((preview&&boats)||_hasOe)。
- 残り未調査: 丸亀(15) のオリジナル展示 (開催日に実データで確認予定)。
"""
import sys


def main() -> int:
    print("probe: no active investigation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
