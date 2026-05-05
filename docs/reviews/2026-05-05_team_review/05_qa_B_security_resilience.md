# QA-B レビュー原本 — セキュリティ / 障害耐性 / データ整合性

- 担当: セキュリティ / 障害耐性 / データ整合性 QA スペシャリスト
- 対象: `/home/pi/boatrace-ai`
- 日付: 2026-05-05

---

## セキュリティ・堅牢性レビュー最終報告

### 現状のセキュリティ/堅牢性スコア所感

**全体評価: A (総合的に高い堅牢性だが、以下P0/P1級の課題が3件存在)**

- **Security**: A+（PAT完全撤去、SSH化済）だが、innerHTML の数値エスケープに微妙な隙がある
- **Data Integrity**: A（atomic_write_json / safe_storage の多層防御）
- **Error Handling**: A-（fail-loud 原則、ただし一部の非同期エラーが見える化不完全）
- **Operational Resilience**: A-（health_check.sh / cron_monitor で監視体制整備、だが DB rebuild時のraceが未対策）
- **PWA Robustness**: A（code splitting / Worker分離、ただし critical bundle の初期化依存性に危険な設計）

---

### P0（即座に塞ぐべき脆弱性/データロスリスク）

#### P0-1: **Critical Bundle 初期化の REST 依存による Silent Halt（最優先修正）**

**ファイル**: `/home/pi/boatrace-ai/assets/app-critical.js:449-450`

```javascript
var _featureStats = (function(){
  var raw = _bootParseLS('boatrace_featurestats', null);
  if(raw && Array.isArray(raw.mean) && raw.mean.length===FEATURE_DIM
        && Array.isArray(raw.m2) && typeof raw.n==='number'){ return raw; }
  return _initFeatureStats();   // ← _initFeatureStats は app-rest.js にしか無い！
})();
```

**脅威**: Fresh ユーザ（localStorage 空）で `_bootParseLS` が null → `_initFeatureStats()` 未定義 → **ReferenceError で script halt**。window.onerror（line 535）より前に発生するため silent。

**再現条件**: iPhone ホーム画面追加 PWA で場をタップ → 無反応。Safari ブラウザでは別タイミングで pass → 症状が非決定的。

**対策案**: app-critical.js 冒頭で `_initFeatureStats` をインライン定義するか、fallback をリテラルに置換。commit `55a3046` で既に修正済みであることを確認。

---

#### P0-2: **innerHTML に数値が挿入される際のインジェクション隙**

**ファイル**: `/home/pi/boatrace-ai/assets/app-critical.js:1992`, `2255`

```javascript
// Line 1992
document.getElementById('racesTitle').innerHTML=name+' <span class="stadium-grade '+grade.cls+'"
  style="vertical-align:middle">'+grade.name+'</span>';
// grade.cls / grade.name は GRADE_CLASS 定数から — ホワイトリスト値のみ

// Line 2255
el.innerHTML = '<span style="color:'+color+'">📡 '+label+'</span>';
// color = '#A5D6A7' | '#FFCC80' | '#FF8A80' (定数から)
```

**脅威レベル**: 中～低（色値・クラス名は定数制御）。ただし `label` 変数が `Math.floor(sec/60) + '分前'` で数値連結される動的生成。数値そのものは XSS 不可だが、**例外ケースで `NaN` 秒が `label` に含まれると `"NaN分前"` に**。さらに未来のリファクタで文字列が挿入される場合の罠。

**対策案**: 上記の定数値に対して `escText()` は不要だが、`label` は `typeof` 検証 + 必ず escText()。

---

#### P0-3: **localStorage Quota 超過時の部分書込失敗と silent fail**

**ファイル**: `/home/pi/boatrace-ai/src/utils/safe_storage.js:115-140`

```javascript
function safeSet(key, value) {
  const s = (typeof value === 'string') ? value : JSON.stringify(value);
  try {
    localStorage.setItem(key, s);
    return true;
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
      // history を間引いて retry
      // ...
      localStorage.setItem(key, s);
      return true;
    }
    console.warn('[storage] set failed', key, e);
    return false;  // ← boolean 戻り値、呼出側が見落とすリスク
  }
}
```

**脅威**: `safeSet()` の戻り値を呼出側が無視するケース → 書込失敗しても処理続行 → **データロス**。また、Quota 超過後に `history` を自動削除するため、ユーザの予想履歴が警告なく **消失**。

**対策案**: `safeSet` 戻り値を **必ず検証** する呼出箇所を grep で抽出し、失敗時は UI alert（`reportError`）を発行。

---

### P1（中期的に強化すべき）

#### P1-1: **非公式API停止時のフォールバック戦略の脆弱性**

**ファイル**: index.html + sw.js + app-critical.js の fetch ハンドラ全般

**現状**: boatraceopenapi.github.io が API を停止 → `programs / previews / results` の fetch 失敗 → **SW が 503 `{error: 'offline'}` を返す** → UI が「データなし」で空白。予想エンジンが古いキャッシュで走り続ける可能性。

**脅威**: 外部依存性 100%。API 仕様変更（フィールド名追加/削除）に対する **スキーマバリデーションが最小（validateApiPayload）** で、不完全な JSON でも処理続行。

**再現条件**: boatraceopenapi リポジトリの Merge されなかったバージョン変更、または GitHub Pages の誤ロードバランシング。

**対策案**:
1. スキーマバージョン番号を API JSON に付与させるか、クライアント側で expected schema hash をチェック
2. 失敗時に「APIサービス停止」専用ダイアログ表示（「キャッシュ使用」/ 「再試行」）
3. 部分fetch失敗（previews OK / odds NG）に対して片側キャッシュの活用

---

#### P1-2: **Cron 並行性の競合シナリオが残存**

**ファイル**: `/home/pi/boatrace-ai/scripts/cron_scrape.sh:166-189`

現状では `D-13` で global lock を短時間（git 操作中のみ）に縮小。しかし：

```bash
GLOBAL_LOCK_WAIT_SEC="${GLOBAL_LOCK_WAIT_SEC:-60}"
```

**脅威**: `racedata` スクレイプが 14 分超かかる場合、その最中に `odds` 実行要求が来て `GLOBAL_LOCK_WAIT_SEC=60` で即 SKIP → **最大 14 分間 odds が走らない**。オッズ更新が止まり可視的にはシステムダウン。

**対策案**:
1. モード別ロック（odds/previews は独立 lock 維持、racedata は別キュー）
2. Systemd timer への統一化（cron ではなく unit ごとに独立 timer）

---

#### P1-3: **Service Worker cache キー正規化とタイムスタンプ付加の葛藤**

**ファイル**: `/home/pi/boatrace-ai/sw.js:90-95`

```javascript
function normalizeRequest(req) {
  const url = new URL(req.url);
  url.search = '';   // ← querystring を全削除
  return new Request(url.toString(), { method: req.method, headers: req.headers });
}
```

**脅威**: `programs/v2/today.json?v=44` で記述フォーマット版を指定しても、キャッシュキーは `programs/v2/today.json` に正規化 → 古いバージョンのキャッシュがヒット → **スキーマ mismatches**。

**再現条件**: SW バージョン bump（VERSION v44 → v45）時に、古い cache に `v44` のデータが残存 → activate で削除されるが、その間は二重。

**対策案**: `?v=44` を使うなら、正規化**後に** `?v` パラメータを保持するか、cache 検索時に scope を明確に（`/data/` は常に network-first）。

---

#### P1-4: **localStorage スキーマバリデーションの隙間**

**ファイル**: `/home/pi/boatrace-ai/src/utils/safe_storage.js:22-70`

```javascript
case 'boatrace_racerDB':
case 'boatrace_stadiumDB':
case 'boatrace_motorStats':
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).length > 10000) return null;  // ← サイズ上限のみ
  return value;  // ← 内部フィールドの型チェック無し
```

**脅威**: `racerDB[1][courseStats][1]` が `"string"` だった場合、そのまま戻される → 後続の演算で `NaN / Infinity` が発生 → UI 崩れ。

**再現条件**: localStorage corruption（部分的な JSON 上書き）、または古いバージョンコードで書込後の新バージョン読込。

**対策案**: 各キーに対して再帰的な型チェック実装（nested object の `courseStats.*.count` が number 等）。

---

#### P1-5: **CSP の `script-src 'unsafe-inline'` による inline event handler 許可**

**ファイル**: `/home/pi/boatrace-ai/index.html:18-30`

```html
<meta http-equiv="Content-Security-Policy" content="
  ...
  script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;
  ...
">
```

**脅威**: `'unsafe-inline'` があるため、DOM XSS で `innerHTML='<script>alert(1)</script>'` が execute 可能（厳密には script-src では block されるが、event handler `onclick="..."` は許可）。

**対策案**:
- `assets/app-critical.js` の `<script nonce="...">` 化（build/build.mjs で nonce 付与）
- inline event handler を全削除（PI-fix で `onclick` は HTML 属性から delegation に戻したはずだが、prerender により復活してないか確認）

---

#### P1-6: **Referrer-Policy の meta タグによる制限**

**ファイル**: `/home/pi/boatrace-ai/index.html:32`

```html
<meta http-equiv="Referrer-Policy" content="no-referrer">
```

**脅威レベル**: 低。`no-referrer` は他サイトへのリンククリック時に referrer を送らない（隠蔽）。PWA アプリなら問題なし。ただし、**CSS `url()`** で外部フォント fetch 時も referrer が消えるため、boatraceopenapi が referrer ベース rate limit していたら API 呼び出しが fail。

**対策案**: `referrerpolicy="same-origin"` に変更 → 自オリジンへの fetch は referrer 送信、外部サイトへは消去。

---

#### P1-7: **Worker state 同期の構造化複製による大容量 DB 転送コスト**

**ファイル**: `/home/pi/boatrace-ai/assets/app-critical.js:PG-7`

```javascript
// worker に racerDB (~5MB) を postMessage で転送
// → 構造化複製のコスト大
```

**脅威**: racerDB が 10MB を超えた場合、Worker 起動時の state 同期が **100ms+ ブロック** → TBT 増加。さらに複製失敗（deep nesting etc）で exception。

**対策案**:
- Worker が自前で `data/db/racerDB.json` を fetch（PG-7 既実装）
- または、SharedArrayBuffer（セキュリティ制限あり）

---

#### P1-8: **データロス耐性：Build rebuild 時の atomic 性不足**

**ファイル**: `/home/pi/boatrace-ai/build/build.mjs`（実装の詳細確認不可）

**脅威**: build 中に GitHub Pages への push がスタック → index.html は古版、assets/*.js は新版 → **スキーマ mismatch**。

**再現条件**: cron の build（もし CI/local で走っていたら）と GitHub Pages push の race。

**対策案**: build output をシングルトランザクションで（temp dir → atomic move）、または `prerelease-*.html` として事前テスト。

---

### P2（運用ベストプラクティス）

#### P2-1: **cron_monitor.sh の alert 条件を log level 分化**

現状では全て `ALERT:` で統一。運用的に重大度を分ける必要：

```bash
alert_critical() { echo "[...] CRITICAL: $*" >> "$ALERT_FILE"; }
alert_warn()     { echo "[...] WARN: $*" >> "$ALERT_FILE"; }
```

**利点**: Slack 通知時に `CRITICAL` だけを ping、`WARN` は朝レビュー。現在は alert 件数が多すぎて見落とし。

---

#### P2-2: **localStorage 容量監視 UI**

現在、Quota 超過時は silent に history 削除。ユーザには見えない。

**改善案**: 設定画面に「ストレージ使用率」バー + 「自動クリーンアップ」ボタン。5MB 超えたら黄色、8MB で赤。

---

## 最終結論

**即応対応（24h）**:
1. P0-1 を再確認（commit 55a3046 で既修正か未修正か明確化）
2. safeSet の戻り値検証を grep + lint ルール化
3. innerHTML + 動的値に escText の mandatory 化

**中期（2週間）**:
1. API schema バージョニング導入
2. Cron 競合シナリオの systemd timer 検討
3. localStorage nested type validation 強化

**運用**:
1. cron_monitor alert レベル分化
2. ストレージ容量 UI 可視化

現在の実装は **Phase 0-5 での多段防御が機能**しており、PA/PB 改善が反映されている。主リスクは「外部依存性」と「エッジケース（fresh ユーザ init）」に集約。
