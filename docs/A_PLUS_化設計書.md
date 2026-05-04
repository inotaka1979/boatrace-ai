# BoatRace Oracle A+ 化 統合設計書 v1.0

**作成日**: 2026-05-04
**対象**: `/home/pi/boatrace-ai/` 全構成
**根拠**: 4 専門家レビュー（Security / ML / Code Quality / PWA-UX）の総合所見
**前提**: 不具合修正設計書 v1.0 の Phase 0–5（86 件）は適用済み

---

## 0. ゴールと原則

### 0.1 ゴール（現状 → A+）

| 領域 | 現状 | A+ 達成基準 |
|------|------|-------------|
| Security | D | npm audit / pip-audit / semgrep / Lighthouse Best Practices いずれもクリーン、PAT・XSS・CSP 完全閉塞、history rewrite 完了 |
| Prediction | C- | log loss / Brier / ECE が単純ベースライン（コース勝率）を有意上回り、ROI が calibrated EV と整合、leakage ゼロ |
| Code Quality | B | 関数 200 行超ゼロ、HTTP/IO 重複ゼロ、グローバル変数ゼロ、テスト 100 件超、型ヒント 90% 以上、SAST/lint クリーン |
| PWA/UX | B- | Lighthouse PWA=100 / Performance≥95 / A11y=100 / Best Practices=100、INP<200ms、LCP<2.5s、オフライン全画面動作 |

### 0.2 設計原則
- **段階的・後方互換**: localStorage / API スキーマは破壊変更しない（migration 関数で吸収）
- **計測駆動**: 各 Phase 完了は数値（Lighthouse / log loss / coverage 等）で判定
- **単一情報源**: 設定値・しきい値・係数は `config/` 配下の JSON または定数モジュールに集約
- **fail-loud**: silent fail 完全禁止、全例外は構造化ログ + クライアント reporter
- **CI ゲート**: 全テスト緑 + Lighthouse 閾値 + SAST クリーンが merge 必須条件

### 0.3 非対象
- 新画面・新機能（プッシュ通知 / OAuth / 課金 / SNS 連携）
- バックエンド化（Cloudflare Workers / Functions 等の常駐サーバ移行）
- 単一 HTML 配信モデルの撤廃（ビルドステップは導入するが**配信物は単一 HTML 維持**）

---

## 1. 全体ロードマップ（5 Phase）

| Phase | 目的 | 件数 | 想定工数 | リリース判定 |
|-------|------|----|----------|-------------|
| **PA** | Security A+ 化 | 9 | 6h | semgrep + Lighthouse-BP / npm-audit / pip-audit クリーン |
| **PB** | Prediction A+ 化 | 11 | 18h | calibrated ECE<3%、forward-chain backtest ROI 報告 |
| **PC** | Code Quality A+ 化 | 12 | 14h | 関数 200 行ゼロ、global ゼロ、テスト 100+、型 90%+ |
| **PD** | PWA/UX A+ 化 | 13 | 10h | Lighthouse 全カテ ≥95、INP<200ms |
| **PE** | 統合検証 + リグレッション | — | 4h | 全 KPI 同時達成、72h 観測アラート 0 |
| 合計 | | **45** | **52h** | |

> 並行可能: PA / PC は早期着手、PB は PA-5 (storage バリデーション) 後、PD は PC-2 (関数分割) 後が望ましい。

---

## 2. Phase A — Security A+ 化（最優先 6h）

### 2.1 対象

| ID | 領域 | 箇所 | 現状 | 目標 |
|----|------|------|------|------|
| A-1 | Git | `.git/config:9`, history | PAT 平文残存・履歴汚染 | 失効・SSH 化・history scrub |
| A-2 | CSP | `index.html:13-21` | `unsafe-inline` 許可 | nonce 化、`unsafe-inline` 撤去 |
| A-3 | SRI | `index.html` Chart.js / Fonts | hash なし | SRI 全外部 ` integrity` 必須化 |
| A-4 | CI/CD | `.github/workflows/*.yml` | `permissions:` 広域、credentials 残留 | 最小化 + `persist-credentials:false` |
| A-5 | Storage | `index.html` localStorage 読込 | 型検証なし | JSON Schema validator |
| A-6 | Deps | `requirements.txt` / Chart.js | 未 pin | 完全 pin + Dependabot + `pip-audit` |
| A-7 | SW | `sw.js:78-97` | origin 検証緩い | `url.origin === self.location.origin` 強制 |
| A-8 | Repo | `CLAUDE.md.bak`, `.icon_backup/` | 残骸 | 整理・gitignore |
| A-9 | Headers | GitHub Pages | セキュリティヘッダ未設定 | meta 等価で `Referrer-Policy` 等を補完 |

### 2.2 設計

#### A-1: PAT 完全撤去 + 履歴 scrub
```bash
# 1) PAT 失効（GitHub 上）
# 2) SSH 化
git remote set-url origin git@github.com:inotaka1979/boatrace-ai.git
chmod 600 .git/config

# 3) 履歴 scrub（PAT が古いコミットに含まれる場合）
git clone --mirror git@github.com:inotaka1979/boatrace-ai.git scrub.git
cd scrub.git
git filter-repo --replace-text <(echo 'ghp_*==>REDACTED')
git push --force --mirror
# Deploy Key (write) を作成し以後は CI 含め PAT 不使用
```
**受入基準**: `git log --all -p | grep -E 'ghp_|PAT' ` が空。GitHub Secret Scanning アラート 0。

#### A-2: CSP nonce 化
- ビルド時に乱数 nonce を生成し `<script nonce="...">` と `<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-XXX' 'strict-dynamic' https:; ...">` を埋込
- `unsafe-inline` / `unsafe-eval` 撤去
- 追加: `object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`
- ビルドステップ（PC-7）で `index.html` 出力時に nonce を差し込む

#### A-3: SRI 必須化
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"
        integrity="sha384-<hash>"
        crossorigin="anonymous"
        referrerpolicy="no-referrer"></script>
```
- Google Fonts CSS は `link rel=preload` + `integrity`（CSS は subresource）
- 検証: `cspvalidator.org` / `securityheaders.com` ともに A+ 評価

#### A-4: workflow hardening
```yaml
# 全 workflow 共通
permissions:
  contents: read   # 必要 job のみ write を局所付与
jobs:
  scrape:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      # 必要時のみ deploy key 経由 push
```
- `repository_dispatch` を `workflow_dispatch` 限定へ縮退、または HMAC 署名検証

#### A-5: localStorage スキーマバリデータ
```javascript
const RACER_DB_SCHEMA = {
  type: 'object',
  patternProperties: {
    '^[0-9]{4}$': {
      type: 'object',
      required: ['courseStats', 'recentResults'],
      properties: {
        courseStats: { type: 'array', maxItems: 6 },
        recentResults: { type: 'array', maxItems: 50 },
      }
    }
  },
  maxProperties: 5000
};
function safeLoadDB(key, schema, fallback) {
  const raw = safeParse(localStorage.getItem(key));
  if (!raw || !validateSchema(raw, schema)) {
    log.warn(`storage corrupt: ${key}, restoring from snapshot`);
    return fallback;
  }
  return raw;
}
```
- 軽量 validator（Ajv 6KB or 自前 50 行）を内包
- 破損検知時は自動バックアップ → 初期化

#### A-6: 依存 pin + 自動監査
```
requests==2.32.3
aiohttp==3.10.10
lxml==5.3.0
beautifulsoup4==4.12.3
lhafile==0.3.0
```
- `.github/dependabot.yml` で pip / actions / npm 週次 PR
- CI ステップに `pip-audit -r requirements.txt --strict` 追加
- Chart.js は SRI 固定版を `index.html` 中で pin、更新は手動 PR

#### A-7: SW origin 強制
```javascript
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isOwnOrigin = url.origin === self.location.origin;
  const isAllowedAPI = ALLOWED_ORIGINS.has(url.origin);
  if (!isOwnOrigin && !isAllowedAPI) return; // bypass
  ...
});
```

#### A-8: 残骸整理
- `CLAUDE.md.bak` 削除、`.icon_backup/` を `.gitignore` に追加し将来コミット禁止
- `scripts/__pycache__` も同様

#### A-9: セキュリティ meta 補完
```html
<meta http-equiv="Referrer-Policy" content="no-referrer">
<meta http-equiv="X-Content-Type-Options" content="nosniff">
<meta http-equiv="Permissions-Policy" content="geolocation=(), camera=(), microphone=(), payment=()">
```

### 2.3 受入基準（A+）
- semgrep `--config=p/owasp-top-ten` 警告 0
- `pip-audit` / `npm audit` HIGH+ 0
- securityheaders.com スコア A 以上
- CSP Evaluator で「strict CSP」判定
- GitHub Secret Scanning アラート 0

---

## 3. Phase B — Prediction A+ 化（18h）

### 3.1 対象

| ID | 観点 | 現状 | 目標 |
|----|------|------|------|
| B-1 | 学習ガード | results 全件を毎ロード反復学習 → 重み暴走 | `learnedRaceKeys` で 1レース1回 |
| B-2 | 正則化・LR | 素 SGD LR=0.01 固定 | L2 正則化 λ + LR decay `LR/(1+t/τ)` |
| B-3 | バックテスト | 過去予想を再評価 → leakage | forward chaining、日付D未満のresultsのみで学習 |
| B-4 | 三連単確率 | `p1·p2·p3·6` で系統バイアス | Plackett–Luce モデル |
| B-5 | L1/L2 融合 | 二重カウント | L2 = L1残差 stacking |
| B-6 | 確率 calibration | softmax 温度 15 無根拠 | Platt scaling + reliability diagram |
| B-7 | 特徴量スケール | 35倍/2.5倍混在 | z-score 正規化、係数を勾配 fit |
| B-8 | 融合比 | しきい値 200 でステップ | Bayesian shrinkage `α=n0/(n0+n)` |
| B-9 | Kelly | 1ベット独立 | 排他事象制約 ∑f≤1 + 相関考慮 |
| B-10 | 評価指標 | 的中率のみ | log loss / Brier / ECE / ROI / Sharpe を可視化 |
| B-11 | クラス不均衡 | 未対策 | base rate (≈1/6) で bias 初期化、focal loss 検討 |

### 3.2 設計

#### B-1 + B-2: 学習則の刷新
```javascript
// l2weights = { w: Float32Array(13), b: 0, t: 0, learnedKeys: Set }
function learnFromResults(results) {
  const LR0 = 0.05, TAU = 5000, LAMBDA = 1e-4;
  for (const race of results) {
    const key = `${race.date}_${race.stadium}_${race.rno}`;
    if (l2weights.learnedKeys.has(key)) continue;          // B-1
    const winner = race.winner;                             // 0..5
    for (let i = 0; i < 6; i++) {
      const x = featureVec(race, i);                        // length 13 (incl. bias)
      const z = dot(l2weights.w, x);
      const p = sigmoid(z);
      const y = (i === winner) ? 1 : 0;
      const lr = LR0 / (1 + l2weights.t / TAU);             // B-2
      for (let k = 0; k < x.length; k++) {
        l2weights.w[k] -= lr * ((p - y) * x[k] + LAMBDA * l2weights.w[k]);
      }
      l2weights.t++;
    }
    l2weights.learnedKeys.add(key);
  }
  saveWeights();
}
```
- `learnedKeys` は最新 90 日分のみ保持しサイズ抑制
- bias 初期値は `logit(COURSE_WIN_RATE[i])` で **B-11** を兼ねる

#### B-3: Forward-chaining backtest
```javascript
function backtest(history, options) {
  const days = uniqDays(history).sort();
  const w = initWeights();
  const records = [];
  for (const d of days) {
    const todays = history.filter(h => h.date === d);
    for (const race of todays) {
      const pred = predictRaceWithWeights(race.input, w); // 学習前の重みで予想
      records.push({ date: d, pred, actual: race.actual });
    }
    learnBatch(w, todays); // 当日の全レースで学習 → 翌日へ
  }
  return computeMetrics(records); // logloss / brier / ECE / ROI
}
```
- backtest 専用 worker で UI ブロッキング回避
- 結果は「成績トラッカー」画面に新タブとして表示

#### B-4: Plackett–Luce 三連単確率
```javascript
function trifectaPL(p) { // p = 1着確率 [p0..p5]
  const out = {};
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) if (j !== i)
      for (let k = 0; k < 6; k++) if (k !== i && k !== j) {
        const denom_j = 1 - p[i];
        const denom_k = 1 - p[i] - p[j];
        if (denom_j <= 0 || denom_k <= 0) continue;
        const prob = p[i] * (p[j] / denom_j) * (p[k] / denom_k);
        out[`${i+1}-${j+1}-${k+1}`] = prob;
      }
  return out;
}
```
- 二連単・複勝も同様の周辺化に統一
- 既存 `buildTrifectaProbDist` を置換、テスト fixture に既知 6 着確率 → 期待 PL 値の照合追加

#### B-5: Stacking 構造
- L1 出力 `p_L1[i]` を logit 変換 → L2 の特徴量に追加
- L2 重みは `[logit(p_L1), Δ_class, Δ_etRank, Δ_form, ...]` の **残差説明変数**のみ
- 融合は `p_final = sigmoid(logit(p_L1) + α·z_L2_residual)` の形に
- L1 単独 vs Stacked vs L2 単独で log loss 比較を強制（CI で退化検知）

#### B-6: Calibration
- データ蓄積後（>500 レース）、Platt scaling `p' = sigmoid(a·logit(p) + b)` の (a,b) を grid search で fit
- Reliability diagram を「成績トラッカー」に Chart.js で描画（10 bin）
- ECE (Expected Calibration Error) を 3% 未満を目標
- 不足時は `temperature scaling` のみで暫定対応

#### B-7: 特徴量正規化
- 全特徴量を `(x - μ) / σ` で z-score 化、μ/σ は時系列ローリングで更新
- L1 各カテゴリ係数は最終的に **gradient-fit** で再学習可能に（コーチング期間: 過去 1000 レース）
- Layer 1 の `Math.max(0, score)` クリップを撤去（B-CRIT の指摘）

#### B-8: Bayesian 融合比
```javascript
const N0 = 300; // L1 を信用する仮想サンプル数
const alpha_L1 = N0 / (N0 + dbSize);
const p_final = alpha_L1 * p_L1 + (1 - alpha_L1) * p_stacked;
```
- 段階関数を撤廃、CLAUDE.md の数値矛盾も解消

#### B-9: 排他事象 Kelly
```javascript
// 同時購入する K 点に対し、各点 i の当たり確率 p_i は排他
// 利得行列 R は対角的 → fractional Kelly の制約最適化
function kellyExclusive(picks, bankroll, frac=0.25) {
  // picks: [{combo, p, odds}]
  // 期待対数効用最大化を制約 ∑f_i <= frac で QP
  ...
}
```
- 半 Kelly のさらに 1/4 (frac=0.25) を default、UI で 0.05〜0.5 スライダ

#### B-10: 評価ダッシュボード
- 「成績トラッカー」拡張: log loss / Brier / ECE / ROI / Sharpe / 平均オッズ / 採用率
- 期間: 7d / 30d / 全期間 切替
- ベースライン（コース勝率のみ）との並列比較を強制表示

### 3.3 受入基準（A+）
- forward-chain backtest で **calibrated ECE < 3%**
- log loss が baseline (`-Σp_baseline log p_baseline`) を 5% 以上改善
- ROI（控除率込み）の 95% CI が 0.95 以上を含む期間が backtest にあること
- look-ahead leakage テスト（同一データ 2 回学習で重みが変わらない）緑

---

## 4. Phase C — Code Quality A+ 化（14h）

### 4.1 対象

| ID | 観点 | 現状 | 目標 |
|----|------|------|------|
| C-1 | HTTP 共通化 | scraper 7 本に retry/UA 重複 | `scripts/http_utils.py` に集約 |
| C-2 | 長関数 | 548 / 287 / 227 行 | 全関数 ≤ 100 行 |
| C-3 | マジックナンバー | 1019 個ハードコード | `index.html` 内 `CONST` モジュールに集約 |
| C-4 | 型ヒント | 5/100 関数のみ | 公開 90% に `dict\|None` 等付与、`mypy --strict` |
| C-5 | グローバル | 21 個 | `'use strict'` IIFE / module 化、global 0 |
| C-6 | エラー観測 | console.warn 22 / empty catch 23 | client reporter → `data/errors/` へ集約 |
| C-7 | ビルド | なし | esbuild で `src/*.js` → `index.html` 埋込（単一 HTML 維持） |
| C-8 | テスト | 39 件 | 100 件超、coverage 80%+ |
| C-9 | except pass | 5 箇所残存 | log.warning 化 |
| C-10 | datetime API | utcnow 3 箇所残 | utc_iso_seconds 統一 |
| C-11 | requirements pin | 未 pin | A-6 で対応 |
| C-12 | docstring | 多数欠落 | 公開関数全てに 1 行以上 |

### 4.2 設計

#### C-1: HTTP 共通化
```python
# scripts/http_utils.py
HEADERS = {"User-Agent": "boatrace-ai/1.0 (+RPi5)"}
def fetch_json(url: str, retries: int = 2, timeout: int = 15) -> dict | None:
    for i in range(retries + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            log.warning("fetch_json fail (%d/%d): %s", i+1, retries+1, e)
            time.sleep(2 ** i)
    return None
```
全 scraper を切替、テスト `test_http_utils.py` 追加（モック with `responses`）。

#### C-2: 長関数分割
- `openRace` 548 行 → `_renderHeader` / `_renderRunners` / `_renderPrediction` / `_renderOdds` / `_renderTickets` / `_renderResult`
- `scoreBoatV2` 287 行 → `_scoreCourse` / `_scoreRacer` / `_scoreMotor` / `_scoreExhibit` / `_scoreEnv` / `_scorePenalty` / `_scoreForm` / `_aggregate`
- `_applyLiveDataMerge` 227 行 → 入力ソース別 merge 関数 4 つに分解

#### C-3: 定数集約
```javascript
const SCORING = Object.freeze({
  COURSE_WEIGHT: 35,
  CLASS_DECAY: { A1: 1.0, A2: 0.85, B1: 0.7, B2: 0.55 },
  THREAT_SASHI: 0.5, THREAT_MAKURI: 0.3,
  PENALTY_F2: -25, PENALTY_F1: -15, PENALTY_L1: -5,
  // 根拠コメントを各キーに付与
});
```
- 全マジックナンバーを `SCORING` / `CALIBRATION` / `RACE_TYPE` / `KELLY` 等に分類
- CLAUDE.md の修正履歴と DOI（決定の根拠）をコメントで紐付け

#### C-4: 型ヒント網羅
```python
def parse_fan_handbook(blob: bytes) -> dict[str, dict]: ...
def merge_previews(existing: dict | None, fresh: dict) -> dict: ...
```
- `mypy --strict scripts/` を CI に追加、型エラー 0 必須

#### C-5: モジュール化（IIFE/ESM 風）
```javascript
(() => {
  'use strict';
  const App = {};
  App.predictor = (() => { /* ... */ return { predictRace, learnFromResults }; })();
  App.ui = (() => { /* ... */ return { openRace, render }; })();
  window.BoatraceApp = Object.freeze(App); // デバッグ用に最小公開
})();
```
- ビルド時に `src/predictor.js` `src/ui.js` 等を esbuild bundle → `<script>` 埋込

#### C-6: エラー reporter
```javascript
window.addEventListener('error', (e) => reportError({type:'error', msg:e.message, stack:e.error?.stack}));
window.addEventListener('unhandledrejection', (e) => reportError({type:'reject', reason:String(e.reason)}));
function reportError(payload) {
  const buf = safeParse(localStorage.getItem('boatrace_errors')) || [];
  buf.push({ts: Date.now(), ...payload});
  if (buf.length > 100) buf.shift();
  safeSet('boatrace_errors', buf);
  // RPi 側で日次収集（cron で localStorage を取れないため、設定画面に「ログ送信」UI）
}
```
- 設定画面に「直近 100 件のエラーログを表示・コピー」ボタン
- 全 `catch (e) {}` を `catch (e) { log.warn('xxx', e); reportError(...) }` に置換

#### C-7: ビルドパイプライン
```
src/
  index.template.html
  styles.css
  predictor/*.js
  ui/*.js
  utils/*.js
build.mjs         # esbuild で IIFE bundle → CSP nonce 注入 → index.html 出力
```
- 配信物は依然 **単一 `index.html`**（CLAUDE.md 方針維持）
- `npm run build` で `index.html` 再生成、`npm run dev` で HMR

#### C-8: テスト拡充
- 既存 39 → 目標 100+
- 追加: predictor (PL, calibration, learn idempotent) / scraper (http_utils mock) / storage (schema validate) / SW (cache strategies via Workbox testing)
- coverage tool: `c8` (JS) / `coverage.py` (Python)、しきい値 80%

### 4.3 受入基準（A+）
- `eslint` / `prettier` / `mypy --strict` / `ruff` 全緑
- `wc -l` で 200 行超関数 0
- `c8` JS coverage ≥ 80%、`coverage` Python ≥ 80%
- グローバル変数 `Object.keys(window).filter(k => k.startsWith('boatrace'))` が 1 個（`BoatraceApp` のみ）

---

## 5. Phase D — PWA/UX A+ 化（10h）

### 5.1 対象

| ID | 観点 | 現状 | 目標 |
|----|------|------|------|
| D-1 | manifest | screenshots/shortcuts なし | 追加、リッチ install banner |
| D-2 | SW cache | CDN/Fonts 未キャッシュ | cache-first + SWR、別 cache 名 |
| D-3 | 更新通知 | console のみ | トースト + `SKIP_WAITING` + `controllerchange` |
| D-4 | iOS icon | 192 のみ | 180x180 apple-touch-icon 追加 |
| D-5 | viewport | user-scalable=no | 撤去、pinch zoom 許可 |
| D-6 | safe-area | 上端のみ | `100dvh` + 全方向 `env(safe-area-inset-*)` |
| D-7 | a11y aria | ヒット 0 | nav/main/dialog に role / aria-label / aria-current |
| D-8 | コントラスト | 一部 4.5:1 未満 | WCAG AAA (7:1) 目標 |
| D-9 | タッチ領域 | 9-10px ラベル | ボタン 48x48pt、文字 ≥12px |
| D-10 | 破壊操作 | confirm() | 二段確認（「DELETE と入力」型） |
| D-11 | innerHTML | 30+ 箇所 | `<template>` + `replaceChildren` |
| D-12 | Visibility | 常時 setInterval | 非表示時停止、`requestIdleCallback` |
| D-13 | LCP/INP | LCP 3s+ 想定 | preconnect / Chart.js defer / 動的 import |

### 5.2 設計

#### D-1: manifest 拡充
```json
{
  "screenshots": [
    {"src":"screens/top.png","sizes":"1080x1920","type":"image/png","form_factor":"narrow","label":"開催場一覧"},
    {"src":"screens/detail.png","sizes":"1080x1920","type":"image/png","form_factor":"narrow","label":"レース詳細"}
  ],
  "shortcuts": [
    {"name":"成績","url":"./?tab=stats","icons":[{"src":"icon-192.png","sizes":"192x192"}]},
    {"name":"検証","url":"./?tab=backtest","icons":[{"src":"icon-192.png","sizes":"192x192"}]}
  ],
  "categories":["sports","utilities"],
  "lang":"ja","dir":"ltr"
}
```

#### D-2: SW で外部リソースキャッシュ
```javascript
const CDN_CACHE = 'cdn-v1';
if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname.endsWith('gstatic.com')) {
  e.respondWith(cacheFirst(req, CDN_CACHE));
  return;
}
async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) { revalidateInBg(req, cache); return hit; }
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
```

#### D-3: 更新トースト
```javascript
reg.addEventListener('updatefound', () => {
  const nw = reg.installing;
  nw.addEventListener('statechange', () => {
    if (nw.state === 'installed' && navigator.serviceWorker.controller) {
      showToast('新しいバージョンがあります', {action:'更新', onAction: () => {
        nw.postMessage({type:'SKIP_WAITING'});
      }});
    }
  });
});
navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
```

#### D-4 + D-5 + D-6: iOS / viewport
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="BoatRace">
<style>
  body { min-height: 100dvh; min-height: 100vh; }
  header { padding-top: env(safe-area-inset-top); }
  nav    { padding-bottom: env(safe-area-inset-bottom); }
  main   { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }
</style>
```

#### D-7: a11y 完全対応
```html
<header role="banner">…</header>
<nav role="navigation" aria-label="メインメニュー">
  <button class="nav-btn" aria-current="page">トップ</button>
  …
</nav>
<main role="main" aria-live="polite">…</main>
<dialog role="dialog" aria-modal="true" aria-labelledby="confirm-title">…</dialog>
```
- 絵文字には `<span aria-hidden="true">⚡</span><span class="sr-only">本命</span>`
- フォーカス可視化 `:focus-visible` で 3px outline
- axe-core を CI で実行、violations 0

#### D-8 + D-9: コントラスト・タッチ
- 全色を WCAG コントラスト計測、AAA 未達は調整
- `.nav-btn { min-height:48px; min-width:48px; font-size:12px; }`
- アイコンサイズ 24px、ラベル 12px、相互間隔 ≥8px

#### D-10: 二段確認モーダル
- `confirm()` 全廃止、自前モーダル（`<dialog>`）+「DELETE」入力検証

#### D-11: innerHTML → DOM API
- `<template id="tpl-runner-card">` を index.html 末尾に集約
- `tpl.content.cloneNode(true)` + `replaceChildren()` でレンダリング
- 既存 30+ 箇所を順次置換、escText 不要化（textContent 経由）

#### D-12: Visibility / 動的 import
```javascript
let pollHandle;
function startPolling() {
  if (document.visibilityState !== 'visible') return;
  pollHandle = setManagedInterval(refreshAll, 90000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') clearInterval(pollHandle);
  else startPolling();
});
// Chart.js は成績タブを開いた時に dynamic import
async function openStatsTab() {
  const { Chart } = await import('./vendor/chart.umd.min.js');
  ...
}
```

#### D-13: LCP/INP 最適化
```html
<link rel="preconnect" href="https://boatraceopenapi.github.io" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="image" href="icon-192.png">
<script defer src="..."></script>  <!-- Chart は dynamic import -->
```
- inline critical CSS (above-the-fold)、それ以外は `<link rel="preload" as="style">`
- `<img loading="lazy" decoding="async">` を全画像に
- INP 計測: web-vitals ライブラリを 0.5KB ビルドで埋込

### 5.3 受入基準（A+）
- Lighthouse PWA = 100 / Performance ≥ 95 / A11y = 100 / Best Practices = 100 / SEO ≥ 95
- web-vitals: LCP < 2.5s / INP < 200ms / CLS < 0.1（4G スロットル）
- axe-core violations 0
- iOS 17 + Android Chrome 双方で「ホームに追加」→ オフライン全画面動作

---

## 6. Phase E — 統合検証 + リグレッション（4h）

### 6.1 検証項目

| 項目 | ツール | 合格基準 |
|------|--------|----------|
| Security | semgrep + gitleaks + pip-audit + npm audit + securityheaders | 全クリーン / A+ |
| Lighthouse | CI で 5 タブ並列 | 全カテ ≥ 95、PWA=100、BP=100、A11y=100 |
| ML | backtest スクリプト（過去 90d） | ECE<3%、log loss baseline<5% 改善、leakage test 緑 |
| Code | mypy / eslint / coverage | 型エラー 0、coverage ≥ 80% |
| 観測 | 72h 稼働後、cron alert / SW error / client reporter | アラート 0、エラー 0 |

### 6.2 CI ゲート（`.github/workflows/test.yml` 拡張）
```yaml
jobs:
  test:
    steps:
      - run: ./scripts/tests/run_all.sh
      - run: pip-audit -r scripts/requirements.txt --strict
      - run: npx semgrep --config p/owasp-top-ten --error
      - run: npx lhci autorun --collect.numberOfRuns=3 --assert.preset=lighthouse:no-pwa
      - run: npx axe ./index.html
      - run: python scripts/backtest.py --check-leakage
```
- 全 step 緑が merge 必須

### 6.3 リリース戦略
1. PA / PC を先行 merge（リスク低、即時効果）
2. PB は feature flag `ENABLE_PB_PREDICTOR` 配下で並行運用 → 7d backtest 比較 → 切替
3. PD はバッチ投入（D-1〜13 を 1 PR）
4. PE で 72h 観測 → A+ 認定

---

## 7. 受入基準マトリクス（最終）

| KPI | 現状 | 目標 (A+) | 検証方法 |
|-----|------|-----------|----------|
| GitHub Secret Scan アラート | 1 (PAT) | 0 | dashboard |
| semgrep HIGH+ | 未測 | 0 | CI |
| pip-audit HIGH+ | 未 pin | 0 | CI |
| Lighthouse PWA | 90 | 100 | lhci |
| Lighthouse Performance | 未測 | ≥ 95 | lhci |
| Lighthouse A11y | 未測 | 100 | lhci + axe |
| LCP | ~3s+ | < 2.5s | web-vitals |
| INP | 未測 | < 200ms | web-vitals |
| log loss vs baseline | 未測 | -5% | backtest.py |
| ECE | 未測 | < 3% | backtest.py |
| backtest leakage | あり | なし | unit test |
| 関数 200 行超 | 3 | 0 | grep + wc |
| グローバル変数 | 21 | 1 | static scan |
| テスト件数 | 39 | ≥ 100 | run_all.sh |
| coverage (JS/Py) | 未測 | ≥ 80% | c8 / coverage |
| 観測アラート 72h | — | 0 | cron_monitor |

---

## 8. 工数・優先度サマリ

| Phase | 件数 | 工数 | 影響範囲 | 着手優先度 |
|-------|----|------|---------|-----------|
| PA | 9 | 6h | 全体 | ★★★★★ |
| PC | 12 | 14h | コード基盤 | ★★★★☆ |
| PB | 11 | 18h | 予測精度 | ★★★★★ |
| PD | 13 | 10h | UX | ★★★☆☆ |
| PE | — | 4h | 統合検証 | ★★★★★ |
| **合計** | **45** | **52h** | | |

---

## 9. 既存 CLAUDE.md / 設計書との整合

- 不具合修正設計書 v1.0 (P0–P5, 86件) は完了済み前提
- 予想精度改善設計書（既存）の未着手項目は本書 PB に統合
- 単一 `index.html` 配信モデルは維持、ビルドステップは PC-7 で吸収
- localStorage キーは破壊変更なし、追加のみ（`boatrace_errors`, `boatrace_calibration`）

## 10. 残リスクと対応

| リスク | 影響 | 対応 |
|--------|------|------|
| PB 切替で短期 ROI 悪化 | 中 | feature flag + 7d 並行運用、悪化時即 rollback |
| ビルドステップ導入で配信ミス | 中 | dist 確認自動化、SHA で `index.html` 改ざん検知 |
| iOS PWA の Storage 7d 削除 | 中 | 重要データはスナップショットを GitHub に push、起動時 fetch |
| 予測モデルの drift | 中 | ECE を継続監視、月次 re-calibration を schedule |
