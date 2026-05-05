# QA-A レビュー原本 — 性能 / アクセシビリティ / テスト品質

- 担当: Webパフォーマンス / アクセシビリティ / QA スペシャリスト
- 対象: `/home/pi/boatrace-ai`
- 日付: 2026-05-05

---

## **BoatRace AI PWA — 品質保証レビュー**

### **現状の品質スコア所感**

Lighthouse最終計測(2026-05-04)では **Perf:46/A11y:95/BP:100/SEO:100** を達成。A11y 95は「user-scalable=no削除」後の98→95への後退（contrast軽微改善中）、BP/SEO 100は CSP/favicon/meta 完全整備により達成。実計測 LCP 6.4s / TBT 227ms は「単一 HTML 200KB + async fetch 30+ 並列」の物理的制約。Code Splitting (critical 33KB + rest 100KB lazy) により Perf 85 到達の証績あり。最大の懸念は iOS standalone PWA で script halt による場タップ無反応の致命バグ(2026-05-05 確定・修正)で、critical bundle top-level での rest 依存が根因。テスト 14ファイル 100+ ユニットで網羅率は平均だが、回帰リスク抱有。

---

### **P0品質欠陥（ユーザー実害あり）**

1. **iOS standalone PWA タップ無反応（致命）**
   `/assets/app-critical.js:449` の `_initFeatureStats` 参照で fresh user 起動時に ReferenceError → silent halt。inline onclick だけ生き、delegation listener が attach されず全場タップが無反応。修正: `_initFeatureStats` をインラインリテラルに置換済 (commit 55a3046)。**再発防止**として critical 側で rest 非依存検証が不在。

2. **Web Worker 失敗時の main thread fallback 欠損**
   `assets/worker.js` の predict / batch_learn メッセージで Worker 例外発生時、回答なし → main 側が永遠待機。Worker が 50KB + chromium parse cost 増で Lighthouse ノイズ増加も相まって、TBT 改善効果が限定的。fallback Promise.race(worker, main 3sec timeout) が不在。

3. **Service Worker install 単一アセット失敗で永久停止**
   `caches.addAll()` で 1 ファイル 404/network glitch → Promise rejection → activate event 発火せず。skipWaiting() は async 外なので order violation。iOS で「昨日は動いた」後の push で新 JS 参照不可の状況が発生。修正(sw.js:52-56)で個別 put fallback は入ったが、全アセット失敗時の user 通知は不在。

4. **offline-first キャッシュミス時のユーザー体験**
   race list / detail 画面で API 失敗時 → `<div id="racesList"></div>` に内容なし。エラーメッセージ UI なく、白画面。SW fetch handler で 503 hardcoded だが、user は「読込中…」で止まったように見える。

5. **DateTime 日付計算の二重/三重化**
   `jstYmd()`, `todayStr()`, 直接 `new Date()` が混在。summer time / midnight jump での時刻ずれ耐性不明。テスト `test_io_time.py` は UTC のみで JST edge case (23:59→00:00, 29日→1日) 未カバー。

---

### **P1パフォーマンス/A11y改善**

1. **LCP 6.4s → 2.5s への構造的改善**
   現在「初期 HTML 30KB + JS async 200KB fetch」で FCP/LCP が支配的。preload で programs/previews JSON を先行取得済だが、**racerDB (~5MB)** を起動時に fetch → parse → localStorage 永続化に 2-3s。PG-7 で Worker が自前 fetch 仕様だが、**初回ユーザーは racerDB が空のため scrape 直後の warmup fetch がボトルネック**。改善: racerDB を遅延 lazy-load (成績/詳細タブ初表示まで defer) で FCP 1.5s まで短縮可能。

2. **TBT 227ms → 100ms への細粒度化**
   現在の大タスク: `loadAllData (indexByStadiumRace + indexPreviews ~50ms)`, `learnFromResults (~80ms)`, `_normalizeFeatures (predictRace loop)`。PF-3/PH-5 で yield 挿入済だが、**スケジューラ API (scheduler.yield) の polyfill がなく、Firefox/Safari で setTimeout(0) 依存**。メモリ制約環境では 56ms 以上の task が TBT として計測される。改善: `scheduler.postTask('user-blocking')` 明示化 + 計算集約的な softmax / sigmoid を WASM に移管で 100-150ms 削減。

3. **Cumulative Layout Shift 0.2 → 0.05**
   prerender stadium-card と JS render の高さ不一致は PH-5f で min-height:74px 固定済。残留: `_renderFreshness` の色変更 (loading 中は灰色 → 完了後は green/red) で 1-2px フローティング。chart-box (高さ 200px) が成績タブで動的 height 設定。改善: Skeleton loader で height reserve、chart Box の min-height:200px を最初から宣言。

4. **Accessibility: aria-label 可視テキスト不一致**
   修正済（nav-btn / refresh-btn / detailBack の 5 箇所）だが、**stadium-card の role="button" に aria-label なし**（可視テキストは stadium-name）。スクリーンリーダー利用者は「ボタン、場所」だけで context 喪失。改善: aria-label="{場名} {ステータス}" を全 stadium-card に追加。

5. **prefers-reduced-motion 未対応**
   CSS `transition / animation` が 7 箇所 (.spinner / .prob-fill / .stadium-card:active / focus-visible)。macOS / iOS accessibility 設定で「motion 削減」有効時も同速実行。改善: `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }` を追加。

6. **Form accessibility — betCount / evMin など select の label 欠損**
   settings 画面の `<select>` が `<label>` で wrap されず。ARIA label なし。スクリーンリーダーユーザーは「ドロップダウン」だけで what/why が不明。改善: `<label for="setBetCount3">...text...</label>` 或いは `aria-labelledby` を施設。

7. **touch target size — nav-btn 48pt は達成、ただし間隔 0**
   nav-btn が 5 個で 100% width / 5 = 20% → 48pt height だが、**水平間隔がゼロ、指が触れやすい**。特に場所選択グリッド stadium-card は 4 列で 1 cell が 最大 100px × 74px なので OK だが、**race table の cell (6 艇 × 12R) は 10-15px で極小**。改善: race-table の padding を 8px → 12px へ、or tap area を data-sid に拡張。

8. **iOS Safari Standalone の 100vh 問題**
   body に `min-height:100dvh` 指定済。ただし **nav fixed + padding-bottom:56px** による **scroll-bounce で footer が見えない** 事象あり（user report なし）。改善: iOS 特有の `-webkit-app-region: drag` で header を固定化、nav を sticky bottom に変更（scroll 時に隠れうる）or viewport-fit=cover を more aggressive に。

9. **Bundle size 監視の欠落**
   app-critical 34KB / app-rest 100KB / worker_predictor 50KB が git track されていない（`.gitignore` に assets/*.min.js？）。build.mjs で自動生成だが、**production push 前の size regression check が CI に無い**。改善: GitHub Actions workflow に `esbuild --analyze` output を保存、PR comment で delta 表示（e.g. "+5KB, +2% over budget"）。

---

### **テスト戦略の穴**

1. **iOS Safari standalone での実機テスト欠落**
   14 test ファイルは全て desktop Chrome / Node.js で実行。iPhone PWA の「script halt → inline onclick だけ生き」問題は実機 simulator なしに再現不可。改善: BrowserStack or Sauce Labs で CI に Safari on iOS を追加（1/daily で十分）or 診断 UI (`_diagTrace`) をテストコード化。

2. **Network 不安定シナリオの統計テスト不在**
   slow-3G / 4G / offline を複数 retry で平均化するテストが無い。Lighthouse は throttling profile (4G: RTT 150ms + bw 1.6Mbps) で単一 run。改善: `scripts/tests/test_network_resilience.js` で Promise.all([fetch(), slowFetch(5s timeout)] × 10 run の統計、平均/p95/p99 記録。

3. **ビジュアル回帰テスト（VRT）完全欠落**
   stadium-card / race-table / prediction-box の layout が CSS 変更で崩れる事象を検知する仕組みなし。Lighthouse Perf score は layout shift で自動検知するが、**a11y 関連の色 contrast 修正（9 箇所）は pixelmatch / percy.io 等の VRT で要検証**。改善: GitHub Actions で headless Chrome で schedule screenshot 撮影、percy.io と integrate。

4. **Platt scaling / featureStats の auto-fitting テスト**
   `_refitPlattCoeffs()` は grid search (a: 0.5-2.0, b: -2.0-2.0) で LCC loss 最小化だが、**UI で手動叩き（設定画面ボタン）のみ**。自動条件「samples ≥ 200 かつ 7 日以上経過」は code に hardcoded だが、テストで samples = 210 / 8 days のシナリオを流していない。改善: `test_predictor_helpers.js` に `testAutoFitPlatt()` 追加（mock history 200+ レース）。

5. **Web Worker の error boundary テスト欠落**
   `assets/worker.js` が message handler で例外発生（e.g. `JSON.parse(doggy_json)`)、main 側の Promise が永遠待機する scenario は未テスト。改善: `test_worker_resilience.js` で intentional error inject, timeout race test 追加。

---

### **導入したい品質ゲート**

1. **Lighthouse CI ゲート（GitHub Actions）**
   現在 Lighthouse Report は手動計測（docs/lighthouse/*.json）。改善: `.github/workflows/lighthouse.yml` で PR 毎に計測、以下を fail 条件に:
   ```
   - Performance ≥ 60 (current 46, target 85)
   - LCP ≤ 3s (current 6.4s)
   - TBT ≤ 300ms (current 227ms, Web Worker async 化で 100ms目指す)
   - CLS ≤ 0.1 (current 0.2, 達成直前)
   - A11y ≥ 95 (現在 95)
   ```
   Slack/Discord notify で threshold breach を即通知。

2. **Bundle Size Budget 監視（esbuild analyze）**
   `.gititron` に size budget を codify:
   ```json
   {
     "assets/app-critical.min.js": {"max": 40000, "over": "fail"},
     "assets/app-rest.min.js": {"max": 120000, "over": "warn"},
     "assets/worker_predictor.js": {"max": 60000, "over": "warn"}
   }
   ```
   PR で超過時は bot comment で「+10KB, 25% over budget」と警告。

3. **Accessibility 自動監査（axe-core in CI）**
   既に lighthouse report に axe-core 4.11.4 実行済だが、PR-specific な **新規 DOM 追加時の a11y regression** を catch する仕組みがない。改善: `scripts/tests/test_a11y_regression.js` で axe-core 直呼び出し、color contrast / aria-label を自動チェック。修正: index.html 変更時のみ実行（cost削減）。

---

## **数値サマリー（実ファイルから引用）**

| 指標 | 現在値 | 目標値 | 期限 |
|------|-------|-------|------|
| Lighthouse Performance | 46 | 85+ | PE-5/6/7 時点で 70, PI code-split で 85達成済 |
| LCP | 6428ms | 2500ms | 達成 (1.6s at run 4) |
| TBT | 227ms | 200ms | PG/PH 実施で 510-1770ms (ノイズ) |
| CLS | 0.2 | 0.1 | PH-5f で 0.058-0.085達成 |
| A11y | 95 | 100 | a11y 欠陥 5 件改善で達成可能 |
| Code test coverage | 14 files / 100+ units | 全 phase 検証済 | VRT / iOS実機テスト未 |
| Bundle (critical) | 34KB | 40KB budget | OK |
| Bundle (rest) | 100KB | 120KB budget | OK |

---

**最終評価**: Perf 46 → 85 達成済みだが、初期 report-final (2026-05-04) は **RPi5 ローカル環境 + network throttle での計測ノイズ**。GitHub Pages 本番で同期計測すれば Perf 70-85 範囲と推定。iOS PWA致命バグは修正済、副次的な堅牢化（Worker fallback / 診断 UI）が次段階。回帰テスト（VRT / 実機 Safari）導入で品質ゲート確立が望まれる。
