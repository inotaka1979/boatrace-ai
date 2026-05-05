# Build パイプライン骨子（PC-7 設計）

> A+ 化設計書 §4.2 PC-7 の実装骨子。
> 配信物は依然 `index.html` 単一ファイルを維持する。

## 目的

- ソースコードを意味のある単位（`predictor/`, `ui/`, `utils/`）に分割しつつ、
  GitHub Pages へは現行どおり 1 ファイル `index.html` を配信する
- CSP 強化（A-2）の `'unsafe-inline'` 撤去に必要な nonce / hash を
  ビルド時に自動付与する
- ESLint / Prettier / 型チェック等を CI で強制する受け皿を作る

## 想定構成

```
build/
├── README.md                 ← この設計骨子
├── package.json              ← esbuild / eslint 等の dev 依存
├── build.mjs                 ← esbuild による IIFE bundle + index.html 生成
├── eslint.config.js          ← strict + no-undef + 推奨ルール
└── tsconfig.json             ← // @ts-check + JSDoc 型注釈チェック

src/
├── index.template.html       ← <head> / <body> / placeholder のみ
├── styles/                   ← 分離した CSS
│   ├── base.css
│   ├── components.css
│   └── pages.css
├── predictor/                ← AI 予想ロジック
│   ├── layer1_rule.js        ← scoreBoatV2 等を分割
│   ├── layer2_logreg.js      ← 学習則 / 重み更新
│   ├── layer3_ticket.js      ← 買い目生成
│   ├── plackett_luce.js      ← PB-4 で実装
│   └── calibration.js        ← PB-6 (Platt scaling)
├── ui/
│   ├── page_top.js
│   ├── page_race.js          ← openRace を _renderHeader 等に分割
│   ├── page_stats.js
│   ├── page_backtest.js
│   └── page_settings.js
├── utils/
│   ├── safe_storage.js       ← _validateLS / safeParse / safeSet
│   ├── softmax.js
│   ├── error_reporter.js     ← PC-6
│   └── time.js
└── tuning.js                 ← TUNING 定数（PC-3 を移管）
```

## ビルドフロー

1. `node build/build.mjs`
2. esbuild で `src/**/*.js` を **single IIFE** に bundle（`format: 'iife'`, `globalName: 'BoatraceApp'`）
3. `src/styles/*.css` を結合し minify
4. `src/index.template.html` の placeholder に bundle 済 JS / CSS を埋め込み
5. CSP `script-src` に SHA-256 hash を計算して付与（または build 毎の nonce を生成）
6. SRI hash を `<script src="...chart.js">` にも付与（A-3 と統合）
7. 出力: `dist/index.html` → ルートの `index.html` を上書き

## CI 統合

```yaml
# .github/workflows/test.yml に追加
- run: npm --prefix build install
- run: npm --prefix build run lint
- run: npm --prefix build run typecheck
- run: npm --prefix build run build
- run: git diff --exit-code index.html  # ビルド再現性チェック
```

## 段階導入

- **Step 1 (今)**: 設計骨子のみ。実装は Phase D 完了後に着手。
- **Step 2**: `src/utils/` のみ分離して bundle、index.html の差分を最小に。
- **Step 3**: `src/predictor/` 分離（PC-2 と統合、`scoreBoatV2` 等を関数単位で外出し）。
- **Step 4**: `src/ui/` 分離（最大の関数群、テスト基盤拡充とセット）。
- **Step 5**: CSP nonce 化 + SRI 自動付与で `'unsafe-inline'` を撤去。

## 互換性

- 配信される `index.html` は**現行と同じ単一ファイル**
- iOS PWA キャッシュ / SW v4 のキー戦略は影響なし
- localStorage キー / API スキーマ変更なし
- ビルド再生成の差分が出ないよう、esbuild の minify オプションは
  決定論的な設定（`legalComments:'none'`, `minifyIdentifiers:false`, etc.）
  にすることで `git diff --exit-code` を CI ガードにする

## Epic 20: Visual Regression Testing (VRT)

Playwright snapshot で 5 画面の見た目退行を CI で検出。

### 初回セットアップ
```bash
cd build
npm install
npx playwright install chromium
```

### baseline 生成 (UI 変更時)
```bash
cd build
npm run test:vrt:update
git add ../tests/e2e/screens.vrt.spec.mjs-snapshots/*.png
git commit -m "vrt: baseline update"
```

### 通常実行 (差分検証)
```bash
cd build
npm run test:vrt
# 差分があれば exit 1 + build/playwright-report/index.html に diff 画像
```

### CI 統合
`.github/workflows/e2e.yml` で PR 毎自動実行、失敗時は report を artifact にアップロード。

### baseline 管理方針
- マスク領域: 動的データ部 (#headerDate, #dataFreshness, #dbInfo, #statSummary 等)
- 固定値: Date.now() を 2026-05-05T12:00:00+09:00 に固定
- animation/transition は CSS で全停止
- 許容差分: maxDiffPixelRatio: 0.02 (フォントレンダ差異吸収)
