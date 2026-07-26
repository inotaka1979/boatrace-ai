# オフライン履歴バックテスト (PR-11 / A-02)

`scripts/backtest_offline.mjs` は過去の番組表・展示・結果・オッズを流し込み、
`predictRace` を **forward-chain**（当日より前の結果だけで DB を構築）で回して、
現行 AI をベースライン 3 種と ROI・確率品質で比較する CLI。

現行の `runBacktestEngine` は localStorage の自己予測ログ（新規端末では 0 件）を
入力にするため「1 号艇ベタ買いより強いのか」に答えられなかった。本 CLI がその
基準を提供する。

## 使い方

```bash
make backtest FROM=20260401 TO=20260630
# または
node scripts/backtest_offline.mjs --from 20260401 --to 20260630 \
     --archive data/archive --out build/backtest.json
```

`--leak` を付けると当日結果を予測前に DB へ畳み込み、未来情報リークで ROI が
跳ねることを実証できる（forward-chain の健全性チェック用）。

## 入力アーカイブ

1 日 1 ディレクトリ `<archive>/<YYYYMMDD>/` に 4 ファイル:

| ファイル | スキーマ |
|---|---|
| `programs.json` | `{programs:[{race_stadium_number, race_number, race_grade_number, boats:[…]}]}` |
| `previews.json` | `{previews:[{race_stadium_number, race_number, weather, boats:[…]}]}`（省略可） |
| `odds.json` | `{odds:[{stadium, race, trifecta:{combo:odds}, win:{boat:odds}}]}` |
| `results.json` | `{results:[{race_stadium_number, race_number, boats:[{racer_boat_number, racer_place_number, racer_course_number}], payouts:{trifecta:[{combination,amount}], win:[…]}}]}` |

`scrape_results.py` は PR-7 で `data/results/{YYYYMMDD}.json` の日次アーカイブを
書くようになった。**programs / previews / odds の日次アーカイブ化は未実装**（今は
`today.json` のみ）なので、フル入力を得るにはそれらのアーカイブ経路を足す必要が
ある（TODO）。それまでは合成 fixture（`scripts/tests/test_backtest_offline.mjs`）
で機構を検証する。

## 出力と読み方

戦略ごとに `races / bets / stake / payout / roi / hitRate / roiCI(bootstrap 95%)`、
モデルには `logLoss / brier / ece` を出す。

- `model_prob` — 現行 AI（確率順 top-N 三連単）
- `model_ev` — 現行 AI（EV モード、evMin=1.15）
- `baseline_inner` — 1 号艇 単勝ベタ買い
- `baseline_fav` — 単勝 1 番人気ベタ買い
- `baseline_pop3` — 三連単 人気順 上位 10 点

**判定基準**: `model_ev` の ROI 95% 信頼区間の下限 > `baseline_fav` の ROI を
満たさない限り「edge がある」と主張しない。競艇の払戻率は約 75% なので、素の
ROI 75% 前後は「モデルが何もしていない」ことを意味する。

## 既知の限界（出力の `leakageNote` / `oddsNote` にも明記）

- **L2 未再現**: 本 CLI は L2 オンライン学習を forward-chain していない
  （`l2trainStep=0` のまま = α≈1 = L1 単独）。L2 を含む評価は別途。
- **オッズの楽観バイアス**: 締切直前の最終オッズを使うため、実際にはこの価格で
  買えない。ROI は楽観側に出る。
- **過去アーカイブのバックフィル**は本 PR の範囲外。programs/previews/odds の
  日次保存を足すのが次段階。
