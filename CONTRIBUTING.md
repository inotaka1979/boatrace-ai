# Contributing to BoatRace Oracle

このリポジトリは Clearwing パターン（capabilities 集約 / 責務別 4 層分割 /
ローカル CI ゲート / スコープ限定 strict 型 / スナップショット退行検知）で
継続リファクタ中です。**新規 PR は本ドキュメントの規範に従ってください。**

---

## クイックスタート

```bash
git clone git@github-boatrace:inotaka1979/boatrace-ai.git
cd boatrace-ai
make install   # npm ci (root + build/)
make gate      # lint + type + test + build:check  (push 前必須)
```

`make gate` が `✅ gate passed — safe to push` を出すまで push しない。

---

## ディレクトリ / 4 層責務

```
src/
├── capabilities.js          ← Phase 1 (main thread feature detection / polyfill)
├── capabilities-worker.js   ← Phase 2a (worker thread)
├── context/                 ← 状態・設定保持（副作用なし）
├── discovery/               ← read-only データ取得 (Open API / Worker / cache)
├── analysis/                ← 副作用ありの計算・予測
├── reporting/               ← 出力・記録（DOM 更新 / persistence）
├── utils/                   ← 汎用ヘルパ (safe_storage / math / i18n / ...)
└── types/globals.d.ts       ← BoatRaceGlobalAPI ambient 型
```

新規モジュールを書くときは「**何の責務か**」を最初に決め、対応する層に配置する。
複数層にまたがるロジックは設計を見直す（よくある間違い: discovery が DOM を触る、
analysis が fetch を直接呼ぶ）。

---

## コア 5 モジュールへの新規依存追加レビュー基準

以下のファイルは **JSDoc strict (`tsc --noEmit -p jsconfig.json`)** の対象であり、
退行リスクが大きいため変更時に追加レビューを必須とします:

1. `src/capabilities.js`
2. `src/capabilities-worker.js`
3. `src/discovery/openapi_client.js`
4. `src/analysis/backtest.js`
5. `src/reporting/status_banner.js`

### レビュー観点

| # | 観点 | NG 例 |
|---|------|-------|
| 1 | **新規 globalThis 依存**を増やすときは `src/types/globals.d.ts` に必ず型追記 | type 未追加で `_g.foo` を使う |
| 2 | `AbortSignal.timeout()` / `new AbortController()` を直接呼ばない (capabilities 経由のみ) | `fetch(url, { signal: AbortSignal.timeout(5000) })` |
| 3 | discovery 層から DOM API (`document.*` / `window.*`) を呼ばない | discovery で `document.getElementById(...)` |
| 4 | analysis 層から fetch を呼ばない (discovery 経由のみ) | analysis 関数から直接 `fetch(...)` |
| 5 | reporting 層から書込み副作用のある計算をしない | reporting で `localStorage.setItem(...)` を学習結果ごと書き換える |
| 6 | context 層は immutable (`Object.freeze`) | mutable な lookup table を export |
| 7 | 新規 try/catch を「feature detection」目的で書かない (capabilities.has 経由) | `try { new ResizeObserver(()=>{}); ok=true } catch { ok=false }` |
| 8 | snapshot test を更新するときは **理由を必ず PR description に書く** | `UPDATE_SNAPSHOTS=1` の差分を理由なしマージ |

### ESLint カスタムルール (Phase 6)

自動検出されるパターン:

```
no-restricted-syntax: AbortSignal.timeout(...) を直接呼出 → error
no-restricted-syntax: new AbortController() を capabilities 以外で生成 → error
```

回避が必要な特殊ケースは `// eslint-disable-next-line no-restricted-syntax` を
**必ず理由コメント付き**で書くこと。

---

## ローカルゲート (`make gate`)

```
make gate
├── make lint         → eslint + prettier --check
├── make type         → tsc --noEmit -p jsconfig.json (JSDoc strict)
├── make test         → bash scripts/tests/run_all.sh (33 step)
└── make build-check  → cd build && node build.mjs --check
                        ├── esbuild bundle reproducibility
                        ├── critical/rest cross-layer lint (Epic 27 / PJ 致命バグ防止)
                        ├── bundle size budget (critical < 90KB / worker < 65KB)
                        └── inline onclick / style="" baseline
```

pre-commit hook (`.husky/pre-commit`) では軽量 3 step (lint / type / build-check) のみ。
完全ゲートは push 後の CI (`.github/workflows/gate.yml`) で再走。

### スナップショットテストの更新

`tests/snapshots/` の JSON が変わるべき変更を入れたとき:

```bash
make snapshots-update    # = UPDATE_SNAPSHOTS=1 node scripts/tests/test_snapshots.js
git diff tests/snapshots/   # 期待通りの差分か必ず確認
git add tests/snapshots/
```

差分を見ずにそのまま commit するのは禁止 (PR で reviewer が確認できるよう、
**差分の意図を PR 本文に必ず書く**)。

---

## Build パイプライン

```
assets/app.js (canonical, 8800+ 行)
    ├── 編集対象: 関数追加 / バグ修正は本ファイルへ直接
    ├── BUILD: マーカー領域は build.mjs が src/ から自動注入 (編集禁止)
    └── 編集後は cd build && node build.mjs を実行
            ├── src/{utils,context,discovery,analysis,reporting}/*.js を IIFE bundle
            ├── BUILD:XXX:START/END マーカー領域に注入
            ├── python3 scripts/split_app.py で critical / rest 分割
            ├── esbuild で .min.js 生成 (40% 圧縮)
            └── sw.js VERSION と index.html ?v= を content hash 同期
```

**重要**:
- 配信は `app-critical.min.js` (起動時 defer) + `app-rest.min.js` (window.load 後 lazy)
- canonical app.js は単一 source of truth、変更時は必ず build を回す
- `build.mjs --check` で再現性ガード (PR / CI で自動検証)

---

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) 形式:

```
<type>: <subject>            (50 字以内)

<body>                       (72 字折返し、空行区切り)
```

`<type>` の主な候補:
- `feat` 新機能 (capability / 層 / モジュールの新規追加)
- `refactor` 既存挙動を変えずに構造改善
- `fix` バグ修正
- `chore` ビルド / lint / 依存関係更新
- `test` テスト追加・整備
- `docs` ドキュメント更新

---

## ブランチと PR

- `main` 直 push 禁止。必ず feature ブランチを切る (`feat/...` / `refactor/...` / `fix/...`)
- PR description に**変更の目的 (Why)・主な変更点 (What)・テスト方法 (How verified)** を最低 1 行ずつ
- スクリーンショット差分が想定される UI 変更は Lighthouse / VRT 結果を貼る
- snapshot diff があれば該当 .json を 1 個サンプルとして PR に貼る

---

## 緊急バイパス

CI が壊れていて hotfix を当てる必要があるとき:

```bash
HUSKY=0 git commit -m 'fix: <subject>'         # pre-commit skip
git push --no-verify origin <branch>            # push hook skip (該当 hook がある場合)
```

**事後対応 (必須)**: 24 時間以内に CI 失敗の根本原因を直す PR を別途出す。
バイパスを常用するなら hook を見直す。

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| `make gate` で type check が落ちる | `npx tsc --noEmit -p jsconfig.json` で詳細エラーを確認、`src/types/globals.d.ts` に型を追加 |
| build.mjs `--check` 失敗 | `cd build && node build.mjs` で実ビルドし、生成された diff を確認 |
| critical bundle > 90KB | 重い関数を rest 行きに。`scripts/split_app.py` の `REST_ANCHORS` or `REST_ONLY_BUILD_MARKERS` 検討 |
| snapshot test FAIL | 意図通りなら `make snapshots-update` + PR description に理由記載。意図外なら退行検出 |
| iOS standalone PWA で「真っ白 / タップ無反応」 | URL に `?reset=1` で SW 再登録 / `?reset=full` で localStorage 全消去 (Path B kill switch) |

---

## さらに学ぶ

- 完全な refactor 経緯: `.refactor/BASELINE.md` (Phase 0) + `.refactor/PHASE2_NOTES.md`
- 設計書類: `docs/A_PLUS_化設計書.md` / `docs/STABILITY_PLAN.md` / `docs/RUNBOOK.md`
- 過去の致命バグ事例: `CLAUDE.md` § PJ Phase (iOS standalone PWA silent halt)
