# コーダー レビュー原本 — コード品質 / 実装パターン / テスタビリティ / ビルド

- 担当: シニア実装エンジニア（JavaScript / Python）
- 対象: `/home/pi/boatrace-ai`
- 日付: 2026-05-05

---

## コード品質レビュー — `/home/pi/boatrace-ai`

### 全体所感

BoatRace Oracle は Lighthouse A+ 達成（a11y/BP/SEO 100/100/100、Performance 70 ピーク）の高品質 PWA ですが、内部コードの保守性に課題があります。特に `index.html` 内の 5500 行の monolithic JS、Python スクレイパの重複パターン、Service Worker のキャッシュ戦略の複雑性が目立ちます。設計书（CLAUDE.md）は完備され、テストも 100+ ユニット整備されていますが、実装は **「できてしまっている」段階** で、拡張時の認知負荷が高い状態です。

---

### 即修正すべき実装上の問題（P0）

#### 1. **app.js:449 — 死アセット参照による iOS PWA 致命バグ（既修正）**
```javascript
var _featureStats = (function(){
  var raw = _bootParseLS('boatrace_featurestats', null);
  if(raw && ...) return raw;
  return _initFeatureStats();   // ← rest bundle にのみ存在、critical では ReferenceError
})();
```
- **影響**: fresh ユーザで iOS standalone PWA が無応答に（場のタップ不可、DB 初期化失敗）
- **対策**: `_initFeatureStats` をインラインリテラルに置換（`{ mean: new Array(FEATURE_DIM).fill(0), ... }`）
- **参照**: commit 55a3046 で既修正

#### 2. **build/build.mjs:174-178 — split_app.py の実行チェック不足**
```javascript
const criticalSrc = resolve(ROOT, 'assets/app-critical.js');
if (await readFile(criticalSrc, 'utf8').then(()=>true).catch(()=>false)){
  await minifyFile(criticalSrc, ...);
}
```
- **問題**: split_app.py の実行漏れがあっても silent にスキップ、エラーログもない
- **対策**: 初回ビルドで split_app.py を明示的に呼び出す、失敗時は exit 1
- **ファイル**: `/home/pi/boatrace-ai/build/build.mjs`

#### 3. **scripts/scrape_results.py:215 — atomic 書き込み未適用**
```python
with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False)
```
- **問題**: 途中で kill/disk full が起きると corrupt JSON が残る（他スクレイパは atomic_write_json 使用）
- **対策**: `atomic_write_json(OUTPUT, output)` に統一
- **ファイル**: `/home/pi/boatrace-ai/scripts/scrape_results.py:215`

#### 4. **assets/app.js — 5500 行 monolithic、200+ グローバル関数**
```javascript
// 統計:
//   関数 = 150+ (window.open* / window.render* / window.score* / window.predict* 等)
//   グローバル定数 = 30+ (RACE_TYPE / KELLY / L2_* / COURSE_* 等)
//   イベントリスナ = 20+ (showPage / openStadium / onclick handler 等)
```
- **問題**: 責務分離なし、関数呼び出し順序に暗黙的依存、テスト困難
- **対策**: PI-3 で critical 70KB / rest 144KB に分割済だが、関数内部の責務分離なし
- **参考**: openRace (line 2041, 548 行) / scoreBoatV2 (287 行) / _applyLiveDataMerge (227 行) は分割候補

#### 5. **sw.js:103-104 — race condition に脆弱な skipWaiting**
```javascript
self.addEventListener('activate', (e) => {
  // activate は複数の古い SW で発火した場合、race が起きる
  // PD-3: 既存クライアントに通知 → UI でトースト表示
  // ただし、その直後に controller が切り替わるまでの間、
  // 古い controller の fetch が残存する（→ CLS 増加の可能性）
```
- **問題**: SW controller の atomic な切り替え保証がない（複数 tab で old fetch が残存）
- **対策**: `clients.matchAll()` 後に `clients.claim()` を明示的に呼び出し、その直後に controllerchange イベントで page reload（実装済）
- **評価**: 実装上は許容範囲（prerender により CLS は 0.058 に抑止）

---

### リファクタ推奨（P1）

#### 1. **assets/app.js — グローバル定数をオブジェクト集約**
```javascript
// 現状（分散）:
const RACE_TYPE = { ... };
const KELLY = { ... };
const L2_LR0 = 0.05;

// 推奨:
const CONFIG = Object.freeze({
  RACE_TYPES: { ... },
  KELLY: { ... },
  L2: { LR0: 0.05, LR_TAU: 5000, LAMBDA: 1e-4 },
  COURSE: { ... },
  FEATURE_DIM: 12,
  ERROR_BUF_MAX: 100,
});
```
- **効果**: グローバル污染削減、依存関係の明示化、デバッグ時の state 確認が楽
- **実装**: PC-3 で既に TUNING オブジェクト存在、さらに集約
- **ファイル**: `/home/pi/boatrace-ai/assets/app.js:50-200` (定数領域)

#### 2. **Python スクレイパ — 共通エラーハンドリング・ロギングパターン**
```python
# 現状 (scrape_results.py:199, scrape_racedata.py:84 等)
try:
    html = fetch(url)
except Exception as e:
    print(f"  Stadium {sid} Race {rn}: {e}")  # print のみ

# 推奨:
import logging
log = logging.getLogger(__name__)

try:
    html = fetch(url)
except Exception as e:
    log.warning("fetch failed %s: %s", url, e)
    continue  # 呼出側で判定
```
- **効果**: cron log の統一化、error level の一元管理、Sentry 等への統合が容易
- **ファイル**: `scripts/scrape_results.py:199-209`, `scrape_racedata.py:84-95` 等 5 箇所

#### 3. **build/build.mjs — 段階導入計画の実装**
```javascript
// 現状: Step 2 (SAFE_STORAGE / MATH bundle) のみ
// Step 3: src/predictor/* をモジュール化 → bundle
// Step 4: src/ui/* (renderStadiums / renderRaces 等) → bundle
// Step 5: CSP nonce 自動付与
```
- **参考**: `/home/pi/boatrace-ai/build/README.md` に詳細あり
- **優先度**: 中（現状 esbuild scaffold は完備）

#### 4. **sw.js — キャッシュ戦略ドキュメント不足**
```javascript
// PD-2: CDN cache-first + SWR は実装済だが、なぜこの戦略か説明がない
const CDN_ORIGINS = new Set([...]);

// 推奨: 理由を inline comment に
const CDN_ORIGINS = new Set([
  'https://cdnjs.cloudflare.com',
  'https://fonts.gstatic.com',
  // 理由: 外部 CDN のコンテンツは immutable（SRI ハッシュで固定）
  //      ローカル fetch より fast revalidate が利便性大（font rendering 遅延軽減）
]);
```
- **ファイル**: `/home/pi/boatrace-ai/sw.js:27-32`

#### 5. **scripts/time_utils.py — 日付計算の副作用隠蔽**
```python
# 現状 (build_db.py 等で繰り返し):
date_str = datetime.datetime.now().strftime("%Y%m%d")

# 推奨:
from time_utils import today_jst
date_str = today_jst("%Y%m%d")  # 既存関数を活用
```
- **参考**: time_utils.py に utc_iso_seconds() / jst_now() 等あるが、build_db.py では直接 datetime 呼び出し
- **ファイル**: `/home/pi/boatrace-ai/scripts/build_db.py:13-15` 等 2-3 箇所

#### 6. **index.html — manifest.json への 'id' プロパティ欠落**
```javascript
// manifest.json
{
  "id": "/boatrace-ai/",  // ← 推奨（PWA identity を安定化）
  "scope": "/boatrace-ai/",
  "start_url": "/boatrace-ai/?utm_source=pwa"
}
```
- **効果**: PWA の scope を明示化、複数インストール時に identity conflict を回避
- **ファイル**: `/home/pi/boatrace-ai/manifest.json:3` (追加)
- **W3C**: [Web App Manifest ID Field](https://www.w3.org/TR/appmanifest/#id-member)

#### 7. **assets/app.js — LocalStorage キー命名の統一性欠落**
```javascript
// 現状:
localStorage.setItem('boatrace_weights', ...);
localStorage.setItem('bc_seen', ...);  // ← 接頭辞が統一されていない
localStorage.setItem('boatrace_learned', ...);
```
- **対策**: `STORAGE_KEYS` オブジェクトで一元管理
- **ファイル**: `/home/pi/boatrace-ai/assets/app.js:100-150`

#### 8. **scripts/split_app.py — 正規表現の複雑性と脆弱性**
- 現状: brace 深度をベース parser で計算（堅牢）だが、マルチライン関数の開き括弧判定が regex に依存している可能性
- 対策: AST 風の top-level 関数境界を明示的に定義、テスト追加
- **ファイル**: `/home/pi/boatrace-ai/scripts/split_app.py:1-100` (要検証)

---

### テストを追加すべき箇所

#### 1. **scripts/build_db.py — 固定長レコード parse ロジック**
- 現状: BeautifulSoup + regex の多重 fallback で parse、テストなし
- 対策:
  ```python
  # test_fan_handbook_parse.py
  def test_parse_fan_handbook():
      # ファン手帳フォーマットの固定長レコード parse をテスト
      # 特に: Shift-JIS、2byte 文字境界、padding 処理
  ```
- **優先度**: 高（データ破損時の責任が大きい）

#### 2. **assets/app.js — l2Predict() の numerical stability**
- 現状: softmax / safeDiv は math.js に実装済だが、l2Predict の内部で大きな logit 値が渡された場合の安全性テストなし
- 対策:
  ```javascript
  // scripts/tests/test_l2_numerical_stability.js
  it('handles extreme logits without overflow', () => {
    const logits = [1000, -1000, 500];
    const result = l2Predict(features, logits);
    assert(Number.isFinite(result) && result >= 0 && result <= 1);
  });
  ```

#### 3. **sw.js — cache.put() の race condition**
- 現状: `await cache.put()` で実装済（W-01）だが、同時に 2 つの fetch が同じ URL に来た場合の挙動テストなし
- 対策: Web Worker で 2 つの fetch を並列シミュレート、cache 最終状態が正常か確認

#### 4. **scripts/http_utils.py — 404 即時 raise の挙動**
- 現状: `_NON_RETRY_STATUS = {400, 401, 403, 404, 410}`
- テスト追加:
  ```python
  def test_404_raises_immediately(self):
      mock_open.side_effect = HTTPError(..., code=404, ...)
      with self.assertRaises(RuntimeError):
          fetch_text("http://x")
      self.assertEqual(mock_open.call_count, 1)
  ```

#### 5. **index.html — CSP meta tag の フォールバック挙動**
- 現状: `<meta http-equiv="Content-Security-Policy" ...>` は frame-ancestors に非対応
- テスト: HTTP ヘッダ実装で X-Frame-Options が反映されるか確認
  ```bash
  curl -I https://inotaka1979.github.io/boatrace-ai/ | grep -i frame
  ```

---

### ビルド/CI 改善

#### 1. **build/build.mjs — split_app.py 実行の明示化**
```bash
# build/package.json の script に追加
"prebuild": "python3 ../scripts/split_app.py",
"build": "node build.mjs",
"build:check": "node build.mjs --check"
```
- **効果**: split_app.py の実行漏れが無くなる

#### 2. **CI — Python type check (mypy) の導入**
```yaml
# .github/workflows/test.yml に追加
- name: Type check Python
  run: |
    pip install mypy types-requests
    mypy scripts/ --ignore-missing-imports --no-error-summary
```
- **対象**: PC-4 で型ヒント追加済だが、CI で検証されていない

#### 3. **CI — Performance Lighthouse を定期実測**
```yaml
- name: Run Lighthouse
  run: npm install -g @lhci/cli && lhci autorun
```
- **設定**: `.lighthouserc.json` で threshold 設定（Perf 65+）

---

## 要約

| 領域 | 深刻度 | 件数 | 主要改善項目 |
|------|--------|------|------------|
| Security | — | — | PA-1 完了、継続監視 ✅ |
| Prediction | — | — | PB-1/2 バグ修正済、PB-5/6/7 は実データ後 |
| **Code Quality** | **P0** | **5** | **monolithic 分割 / atomic 写込 / global 集約 / logging 統一 / 型ヒント** |
| **Test** | **P1** | **5** | **numerical stability / cache race / 404 retry / fan handbook parse / CSP** |
| Build/CI | P2 | 3 | split_app 明示化 / mypy / Lighthouse CI |

**最優先**: scrape_results.py:215 の atomic_write_json 化（1 行修正）+ assets/app.js:449 の app-critical.js 分割完全化（既実装の検証）。
