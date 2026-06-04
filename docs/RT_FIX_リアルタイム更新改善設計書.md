# リアルタイム更新改善設計書 (rt-fix, 2026-06-04)

## 背景 — 「リアルタイム更新が全然できていない」

専門家 3 名（インフラ / Cloudflare Worker / クライアント PWA）による多角的診断の結果、
ユーザー体感の「全然更新されない」は **単一原因ではなく 3 層が同時に効いている**ことが判明した。

```
[配信側] パイプライン約30%が push 競合で配信失敗 ──┐
[配信側] Worker KV 書込み枠枯渇で silent halt      ─┼─→ データが古い／届かない
[表示側] 鮮度表示が「データ世代」で常に古く見える  ┘   （届いていても古く誤認）
```

### 確定した根本原因と証拠

| 層 | 原因 | 証拠 |
|----|------|------|
| ① パイプライン | `index.html` prerender が唯一の非マージ衝突源（毎回タイムスタンプ差分→2 run が同一行衝突→rebase 自動解決不能） | `scrape-all.yml:106`, `prerender_top.py:159` |
| ① パイプライン | push retry の `git pull --rebase \|\| exit 1` が衝突中断時にコミット破棄＝**データ消失** | run 26937031340 ログ "CONFLICT... could not apply" |
| ① パイプライン | `git pull --rebase` を `git add` 前に実行→"unstaged changes"→`\|\|true`握り潰し→古い base で commit | `scrape-all.yml:104` |
| ① パイプライン | scrape-all / auto-rollback / refresh-next-open が `:00`/`:30` 同時刻に main 直 push | cron 突合 |
| ① パイプライン | auto-rollback が stale 時に古いデータへ巻き戻し＋第4 writer で競合増幅 | `auto-rollback.yml:120` |
| ② Worker | KV 書込み無料枠 948/1000/日に貼付き→超過で put throw→catch 握り潰し→`/api/*` が古い KV を 200 で返し続ける | `wrangler.toml:16`, `worker.js` refreshAll |
| ② Worker | クライアントの「主系 Worker → FB openapi」が**両方 openapi 依存**で偽の冗長化。自前 `data/*.json` を見ていない | `app-critical.js` fetchWithFallback |
| ② Worker | Worker KV / `/api/*` が完全無監視（freshness-monitor は `data/*.json` のみ） | `data-freshness-monitor.yml` |
| ③ クライアント | 「📡 X分前」が `updated_at`（データ世代, 約30分間隔）を表示→正常でも常に「10〜30分前」と古く見える | `status_banner.js _renderFreshness` |
| ③ クライアント | 90秒ポーリングが直列で Worker 8s×3=最悪24s+ブロック | `app.js` polling loop |

## 実装した改善 (9 手 / P0〜P2)

### 層① パイプライン

- **P0-2**: `scrape-all.yml` の `git add` から `index.html` を除外。`scrape_all.py` の
  prerender タスクを全箇所撤去（force_all / racedata stale / next_open refresh）。
  → 唯一の非マージ衝突源を排除。index.html は skeleton + JS `renderStadiums()` で表示するため実害なし。
  テスト `test_scrape_all_decide.py` を新挙動（prerender 非スケジュール）に更新。
- **P0-3**: 全 push ブロックを **commit-first + `git fetch` + `git rebase` + 失敗時 `rebase --abort`
  + jitter retry(5回)** に書き換え。`rebase.autoStash true` で "unstaged changes" を根絶。
  対象: `scrape-all.yml` / `refresh-next-open.yml` / `build-db.yml` / `auto-rollback.yml`。
  → rebase 衝突時に commit を喪失する致命欠陥を解消。
- **P2-7**: cron 同時刻を解消。`refresh-next-open` の `:00` 発火を `:20` へ、
  `auto-rollback` を `:15/:45` へ退避（scrape-all の `:00/:30` と非同時刻化）。

### 層② Cloudflare Worker

- **P1-6**: `worker.js kvWrite` を「内容が変化した時のみ put」に変更。
  前回 KV 値の `data` 部分と比較し同一なら write をスキップ。
  → 無料枠 1000 writes/日の枯渇（silent halt 主因）を構造的に解消。
- **P2-8**: `data-freshness-monitor.yml` に Worker `/api/previews` `/api/programs` を監視
  target 追加。Worker は `{updated_at, data}` を返すため `check_freshness.py` がそのまま使える。
  stale 検知で issue 自動起票 / 回復で自動 close（既存 lifecycle に乗る）。

### 層③ クライアント

- **P0-1**: 鮮度バッジの意味論を「データ世代」→「最終 fetch 成功時刻(`_lastFetchOkAt`)」に変更。
  `fetchWithFallback` の全成功パスで `_markFetchOk()` を呼び、`_renderFreshness` がこれを表示。
  加えてデータ世代が 40 分以上停止していたら「・データ更新待ち(N分)」を併記（honest staleness）。
  → 正常稼働で「30分前」と誤って古く見せていた最大の体感要因を解消。
- **P1-4**: 90秒ポーリングの programs/previews/results/odds/local-previews を
  `Promise.allSettled` で並列化。→ 最悪 24s+ → 約 8s に短縮。
- **P1-5**: `fetchWithFallback` の timeout を短縮（Worker **8s→4s**、openapi **15s→8s**）。
  → Worker 沈黙時に毎回長く待つ体感劣化を解消。
  - 当初は自前 `data/*.json` を独立フォールバックに挟む設計だったが、検証の結果
    自前 data は openapi と**別スキーマ**（previews は `races` キー、programs は未配信、
    results のみ一致だがスタブ）でドロップイン代替にできないため不採用。
    Worker は内部で boatrace.jp を直スクレイプするため openapi 障害時の独立系を既に持つ。
    真の冗長化は P2-9（data ブランチ分離 + openapi 互換ミラー）で恒久対応する。

## P2-9（恒久対策・未実装）: data 専用ブランチ分離

push 競合の**原理的**解消には、コードとデータの物理分離が最も効く。

### 設計
- `main` はコード（index.html / assets / src / scripts / workflows）専用にする。
- `data/*.json` は orphan ブランチ `gh-pages-data`（履歴を持たない）へ
  `git push --force-with-lease` で上書き。衝突という概念自体が消滅する。
- GitHub Pages の publish source を切替、もしくは Pages は `main`、データ配信は
  別ホスト（Worker KV / R2）に寄せ、`main` の `data/` を履歴アーカイブ専用に割り切る。

### 未実装の理由（手動作業が必要）
- GitHub Pages の **publish source 変更はリポジトリ設定の手動操作**で、コードからは安全に行えない。
- 全 scraper / build-db / refresh-next-open の push 先ブランチ切替と、
  クライアントの `data/*.json` 取得 URL（`API_BASE` 系）の整合が必要。
- 段階移行（まず odds/previews のみ別ブランチ→検証→全面）を推奨。

### 着手手順（user 承認後）
1. `gh-pages-data` orphan ブランチを作成し現 `data/` を投入。
2. 各 workflow の push 先を `HEAD:gh-pages-data` に変更（`--force-with-lease`）。
3. クライアントの自前 data fetch URL を `raw.githubusercontent.com/.../gh-pages-data/data/...`
   もしくは Pages 配信パスに切替。
4. 1 週間並走で配信失敗率を観測し、問題なければ `main` から `data/` を削除。

## 検証

- ユニットテスト: **34/34 ステップ全 PASS**（`scripts/tests/run_all.sh`）。
- ビルド再現性: `cd build && node build.mjs --check` 緑（正規 cwt=build/ で生成）。
- lint: 0 errors（警告は既存ファイルのみ）。編集した src 2 ファイルは prettier クリーン。
- Worker: `node --check cloudflare-worker/worker.js` OK。

## ロールバック手順
本変更は機能フラグを持たない。問題時は本コミット群を `git revert` すれば
旧 push ロジック / 旧 fetch 順序 / 旧鮮度表示に戻る。データ消失は伴わない。
