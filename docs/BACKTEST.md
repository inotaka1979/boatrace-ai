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

`scripts/archive_daily.py`（`scrape_all.py` 末尾で自動実行）が programs / previews /
odds / results の `today.json` を **`data/<domain>/<YYYYMMDD>.json`** に日次コピーし、
45 日で prune する。したがって本 CLI は `--archive data`（フラットレイアウト）で
実データを直接読める:

```bash
node scripts/backtest_offline.mjs --from 20260701 --to 20260726 --archive data
```

`loadDay` は 2 レイアウトを許容する: `<archive>/<date>/<domain>.json`（subdir）と
`<archive>/<domain>/<date>.json`（flat = `data/`）。previews の today.json は `races`
キーでスキーマも live 形（boats がオブジェクト）なので、現状は番組予想に fallback
しやすい（展示を完全に効かせるには preview スキーマ整合が次段階）。

**repo 肥大について**: 日次アーカイブは main に commit されるため git 履歴が増える。
working tree は 45 日 retention で bound しているが、恒久解はデータ専用 orphan
ブランチ（設計書 P2-9）。

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

## 実行記録

### 2026-11-11: 初回実データ（2026-09-27〜11-10、45 日 6,556 レース）

`node scripts/backtest_offline.mjs --from 20260927 --to 20261110 --archive data`
（生出力: `docs/backtest_20260927-20261110.json`）

| 戦略 | 内容 | レース | 点数 | ROI | 的中率 | ROI 95%CI |
|---|---|---|---|---|---|---|
| model_prob | 現行 AI 確率順 三連単 top-10 | 6,556 | 65,560 | **0.688** | 35.8% | [0.649, 0.729] |
| model_ev | 現行 AI EV モード (evMin 1.15、オッズのある race のみ) | 6,556 | 1,384 | 0.818 | 0.3% | [0.35, 1.42] |
| baseline_inner | 1 号艇 単勝ベタ買い | 6,556 | 6,556 | **0.909** | 54.3% | [0.877, 0.945] |
| baseline_fav | 単勝 1 番人気 | 1,619 | 1,619 | 0.833 | 13.2% | [0.780, 0.892] |
| baseline_pop3 | 三連単 人気順 top-10 | 1,661 | 16,610 | 0.825 | 13.6% | [0.750, 0.926] |

モデル校正: logLoss 1.381（一様 ln6 = 1.792）/ Brier 0.660 / ECE 0.037。
判定: **NO EDGE**（model_ev の CI 下限 0.35 ≤ baseline_fav 0.833）。

**健全性チェック**: `--leak`（当日結果を先に DB へ畳み込む）では model_prob が 0.688 → 0.988、
logLoss 1.381 → 1.261 に跳ねる。forward-chain が効いていることの確認。

**読み方（重要）**

1. **model_prob の ROI 0.688 は控除後の期待値 0.75 を下回る。** 三連単をランダムに 10 点買う
   より回収が悪い、つまり現行の確率順 top-10 は「的中はするが（35.8%）、低配当に集中し、
   高配当のレースを外す」買い方になっている。1 号艇単勝（0.909）との差は 22 ポイント。
2. ただし本結果は **「番組表だけで出した朝の予想」の評価**である。アーカイブの展示被覆は
   15.2%（6,960 レース中 1,061）、三連単オッズは 26.7% に過ぎず、しかも previews の
   today.json は live スキーマ（`races` / boats がオブジェクト）で `loadDay` が番組予想に
   fallback する。締切前に展示・ST・オッズを見て出している実運用の予想は、この数字では
   測れていない。
3. 1 号艇ベタ買いが 0.909 と高いのは、本期間の 1 号艇 1 着率 54.3% が平時（約 50-55%）の
   上側で、かつ単勝の控除率が三連単と同じ 25% のため。基準線として妥当。

**結論と次の一手**

- A-01（市場シュリンク）/ B-01（scenarioDist 買い目）の効果測定には**オッズと展示の被覆が
  足りない**。先にアーカイブを埋める:
  1. **確定レースの展示・オッズを事後バックフィル**する scraper パス。boatrace.jp の
     beforeinfo / odds ページはレース後も参照できるため、1 run あたり N レース（例 60）を
     scrape-all の余った予算で埋めれば数日で 100% に近づく（軽量化後の scrape-all は
     10 分未満で終わるので予算はある）。
  2. `loadDay` に previews live スキーマ（`races[].boats` オブジェクト、
     `racer_exhibition_time` 等）の変換を入れ、展示を予測に効かせる。
- 被覆が揃ったら、同じ harness で「展示あり予想」「市場確率 α 混合（A-01）」「scenarioDist
  買い目（B-01）」を同一区間で比較し、CI 下限で判定する。それまで予測ロジックは変えない。
- 当面のユーザー向け含意: 朝の番組予想の段階で三連単 10 点を機械的に買うのは控除率より
  悪い。アプリ側は既に賭け金推奨を既定 OFF（S-04）にしているので、表示方針はこのまま。
