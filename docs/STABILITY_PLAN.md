# docs/STABILITY_PLAN.md

> **Status**: 3 ラウンド多角検証 完了 (Round 1: 4 専門家 / Round 2: シニアアーキテクト統合 / Round 3: devil's advocate critic)
> **Date**: 2026-05-11
> **読者**: boatrace-ai オーナー (個人開発者)
> **前提**: REDESIGN.md Phase -1+0+1 (PR #32-37) merge 済 = 「壊れたら 30 min 以内に iPhone 通知」が完成した状態
> **目的**: 「壊さない / 自動回復」の構造的実現 — 「毎日壊れる」を「月 1-2 回」まで圧縮

---

## 0. 結論先出し

- **過去 11 事故 (既知 5 + critic 推定新規 6)** に対する防止確率: **加重平均 ≈ 70%**
- 「毎日壊れる」は **「月 1-2 回壊れる」へ改善**できる、ただし **完全消滅は不可能**
- 必要工数: **15-18h** (Round 2 当初の 9.5h は critic 指摘により 1.6-1.9 倍に修正)
- 採用 step: **S1' / S2' / S3' / S4' / S5 / S6** (S7 は defer)
- **「毎日壊れる完全消滅」を求めるなら NG**、**「月 1-2 回まで」で妥協するなら GO**

---

## 1. 3 ラウンド検証プロセス

### Round 1: 4 専門家並列分析

| 専門家 | 推奨 | 工数 |
|---|---|---|
| **SRE / Release Engineering** | C 主軸 (auto-revert 5 gate) + ruff F821 + PR template、E2E 実 API は不採用 | +8h |
| **Test Strategy / QA** | ruff + smoke + invariants test、Playwright 1 シナリオで 4.85/5 件防止 | +6-8h |
| **Solo Developer / DX** | 「触らない技術」5 仕組み + AI session ルール、B/D 不採用、Performance 80+ 追わない | +8h |
| **System Architect** | D1/D2 が真因 (70%)、5 案は症状側。第 6 案 (gh-pages 分離) + 第 7 案 (data orphan) 提案 | +9.5h |

### Round 2: シニアアーキテクト統合
- D6 (AI セッション暴走、20% 寄与) を Architect の D1-D5 に追加
- 完成宣言 7 条件を定量化
- gh-pages 完全分離は延期、bot/data-* branch の準分離で D1 の 70% 解消
- 合計 +9.5h (S1-S7)

### Round 3: Devil's Advocate Critic
**判定: 条件付き OK** (現状ママは NG)
- 致命 #1: S3 が 182 PR/day 生成で auto-merge queue 詰まり → S3 縮小必須
- 致命 #2: S1 lint だけでは PJ 型を捕捉不可 → eval smoke test 追加必須
- 致命 #3: 完成条件 #2「auto-revert 実発火」と原則 14 が矛盾 → dry-run fire に変更
- 工数 9.5h → 15-18h (1.6-1.9 倍)

---

## 2. 根本原因の最終診断 (D1-D6)

| 因子 | 内容 | 寄与度 |
|---|---|---|
| **D1** | main が source / build artifact / data の 3 役兼任 → PR diff レビュー不能 | **40%** |
| **D2** | critical bundle が rest bundle に暗黙依存 → PJ 事件本体 | **25%** |
| **D6** | **AI セッション暴走** (6h で 6 PR、merge gate なし) | **20%** |
| D3 | 5 scraper × 2 経路の main 並列 push | 8% |
| D5 | window.onerror late-bind → silent halt | 5% |
| D4 | localStorage を schema 付き DB として使用 | 2% |

**D1 + D2 + D6 = 85%** がほぼ全因。これを潰せば「毎日壊れる」は構造的に終わる。

---

## 3. 設計原則 (REDESIGN.md §3 の 1-8 に追加)

| # | 原則 |
|---|---|
| 9 | critical path は単独で valid である (rest 未 load でも ReferenceError なし) |
| 10 | window.onerror は最初の 30 行以内に bind する |
| 11 | **5 scraper bot のみ** bot/data-* branch 経由、dependabot / human / Claude Code は main 直 PR 可 |
| 12 | 1 AI セッション = 1 PR、**全ファイル合計 300 行**を超えたら強制分割 (ファイル跨ぎ回避 block) |
| 13 | 深夜 0:00-7:00 JST は merge 禁止 (judgment 低下時間帯の事故防止) |
| 14 | revert は 5 strict gate 全通過 OR scraper 3 連続 fail 時のみ自動、それ以外は通知のみ |

---

## 4. 採用 step (合計 +15-18h、critic 修正版)

### S1': window.onerror 早期 bind + critical isolation + **eval smoke test** (4-5h)

**ファイル**:
- `assets/app-critical.js` 冒頭 30 行以内に window.onerror bind 移動
- `scripts/lint_critical_isolation.py` 新設 (AST 静的解析)
- `scripts/tests/test_critical_eval_smoke.js` **新設 (critic 致命 #2 対応)**
- `.github/workflows/lint.yml` 新設

**動作**:
1. AST: app-rest.js の top-level 関数名を抽出、app-critical.js が `typeof X === 'function'` ガードなしで呼んでいないか
2. **eval smoke test**: `node -e "require('./assets/app-critical.min.js')"` で ReferenceError 出ない
3. window.onerror が file 先頭 30 行内に bind されているか

**Acceptance**: PJ-fix (commit 55a3046) 直前 commit を再現 → CI fail / smoke test も fail

**critic 引用 #2**: 「真の防御は smoke test を CI に入れること」

---

### S2': ruff CI gate + **2 段階導入** (1.5h)

**critic 指摘 #1 対応**: 既存 main で F821 が眠っている可能性 → warning-only → 違反一括修正 (chore: ruff baseline ラベル例外) → error gate 昇格 の 2 段階。

**ファイル**:
- `pyproject.toml` に ruff 設定 (`select = ["F","ASYNC"]`)
- `scripts/async_utils.py` 新設、`gather_strict(*coros)` 提供
- 既存 `asyncio.gather` 呼出を grep + 置換

**Acceptance**: NameError / silent gather 再現 commit を CI で reject

---

### S3': **odds orphan branch + 残 4 scraper を bot/data-***  (5-6h)

**critic 致命 #1 対応**: 182 PR/day → 30 PR/day 以下に圧縮。

**設計**:
- **`data/odds`** (5 min 間隔、最頻) → orphan branch `data/odds` 直 push
- **`data/previews`, `data/results`, `data/racedata`, `data/db`** (30 min - 数時間間隔) → bot/data-* branch 経由 PR + auto-merge

**ファイル**:
- `.github/workflows/scrape-odds.yml`: push target を `main:` → orphan `data/odds` branch
- `.github/workflows/scrape-{previews,results,racedata,build-db}.yml`: `peter-evans/create-pull-request` で bot/data-* PR
- `.github/workflows/auto-merge-bot.yml` 新設: `bot-data` label を ruff + build pass で auto squash merge
- PWA fetch URL を `https://<user>.github.io/boatrace-ai/data/odds/today.json` (Pages config で複数 source 必要)

**Acceptance**:
- 翌日 cron で main 直 push 0 件 (odds 除く)
- bot PR が 24h 以内に全 auto-merge or auto-close
- 人間 PR diff から `data/**` (odds 除く)、`assets/*.min.js` 消滅

**統合判断**: critic「odds だけ orphan、他は bot/data-*」を全面採用。

---

### S4': **auto-revert with 5 + 1 strict gate** (6-7h)

**critic 致命 #3 対応**: 完成条件 #2 を「dry-run fire 1 回」に変更 (原則 14 と整合)。

**5 + 1 gate (全 AND)**:
1. failure-detect が CRITICAL 発火から 90 min 以内
2. main HEAD commit author が `github-actions[bot]` または `bot-data` label PR 由来
3. 過去 24h 内に auto-revert 未発火 (lock)
4. failure paths と HEAD commit changed paths が intersect
5. HEAD commit に `[no-auto-revert]` tag 無し
6. **(新規) scraper job が直近 6h で 3 連続 fail でない** ← 外部 API schema 変更時の誤判定防止 (critic 障害 #3 対応)

**6 通過 → revert**、**3 連続 fail なら別経路**: external_api_changed ラベル付き issue 自動起票 + CRITICAL alert。

**ファイル**:
- `.github/workflows/auto-revert.yml`
- `scripts/find_revert_candidate.sh`
- `scripts/verify_revert_gate.sh` (revert 後ツリーで run_all.sh 再実行)

**Acceptance**:
- bot 起因 (#4 件数不整合 型) 再現 → 30 min 以内に revert
- 人間 PR は絶対 revert されない
- 外部 API schema 変更時は revert せず issue 起票

**統合判断**: SRE 主推進 + critic gate 6 追加 + completion 条件修正。

---

### S5: PR template + branch protection + FROZEN (1.5h)

**ファイル**:
- `.github/pull_request_template.md`
- `CHANGELOG.md`
- `CLAUDE.md` に FROZEN セクション
- GitHub branch protection rule (Web UI、コード無し)

**PR template 必須項目**:
- AI session id (Claude conversation URL)
- 想定 user impact
- rollback 手順
- `[ ] UI 変更あり (要目視確認)` チェックボックス
- `[ ] data/** または assets/*.min.js を含まない (人間 PR)`
- self-review section

**branch protection**:
- main: PR 必須、24h age 必須、ruff/build/lint required
- **深夜 0:00-7:00 JST merge 禁止**: `.github/workflows/merge-window.yml` 自前 gate (critic E#2 指摘の flaky 対策で 5 min バッファ)
- **iPhone から `gh pr merge` 不可**: GitHub mobile アプリ permissions を read-only

**CLAUDE.md FROZEN セクション**:
> 以下は触らない:
> - `assets/app-critical.js` 先頭 30 行 (window.onerror bind 領域)
> - `sw.js` の VERSION 以外
> - 1 セッション 1 PR、全ファイル合計 300 行超で強制分割
> - Performance 50 以上維持で十分、80+ 追わない

**Acceptance**:
- 「全 Phase 進めて」指示で 300 行で stop
- 深夜 3:00 から merge 試行不可能
- dependabot PR は `dependencies` label 例外で行数 gate 通過

---

### S6: 診断ダッシュボード in 設定画面 (1h)

**ファイル**: `assets/app-critical.js` の settings render 拡張

**表示**:
- 直近 7 日 `boatrace_errors` 一覧 (timestamp / message / stack 先頭)
- 5 scraper の freshness (緑 <30min / 黄 <2h / 赤 >2h)
- copy button

**Acceptance**: iPhone PWA で settings → 診断 → 5 scraper 鮮度と直近 error 一画面

**統合判断**: Playwright 不採用の代替 (QA 妥協点)。

---

### S7 (defer): localStorage schema versioning (1h)

**判断**: D4 寄与 2%、過去事故 0 件 → **+10h 枠を超えるので defer**。完成宣言後の next phase で。

---

## 5. 過去 11 事故への防止確率

### 既知 5 事故
| 事故 | 対応 step | 防止確率 |
|---|---|---|
| #1 NameError | S2' (ruff F821) | 100% |
| #2 silent gather | S2' (gather_strict) | 100% |
| #3 banner 残置 | S6 + 原則 11 で UI PR review 強化 | 60% (Playwright 不採用代償) |
| #4 件数不整合 | S4' (auto-revert) | 80% |
| #5 オッズ古い | REDESIGN Phase 0+1 (既 merge) | 100% |
| #PJ initFeatureStats halt | S1' (eval smoke test) | 100% |

平均 **90%**

### 新規 6 事故 (critic 推定)
| 事故 | 対応 | 防止確率 |
|---|---|---|
| AI セッション暴走 | S5 (1 PR 300 行 gate) | 70% (ファイル分割回避 block で部分対応) |
| dependabot 衝突 | 原則 11 で例外明記 | 80% |
| 外因 API schema 変更 | S4' gate 6 (issue 起票分岐) | 60% (revert はしない、人手対応必要) |
| auto-merge queue 詰まり | S3' (odds orphan で圧縮) | 70% |
| ruff baseline で全 PR block | S2' 2 段階導入 | 90% |
| 行数 gate 回避 | 原則 12 (全ファイル合計) | 60% |

平均 **72%**

### 加重平均
既知 5 (重み 0.6) + 新規 6 (重み 0.4) = **0.6 × 90% + 0.4 × 72% = 82.8%**

> ただし critic 指摘の「規律本質問題は仕組みで解決しない」を加味し、**運用での劣化を ▲15% 見込み = 約 70%**。
> = 「毎日壊れる」が「月 1-2 回壊れる」レベルに低減。

---

## 6. 却下案 + 理由

| 却下案 | 提案元 | 却下理由 |
|---|---|---|
| **E2E 実 API シナリオ (full)** | SRE B 評価、QA 条件付き支持 | rate limit / 平日昼 pollution / 夜間 false negative。SRE / DX / Architect の 3/4 が反対 |
| **canary deploy (staging branch)** | SRE C 評価 | 個人開発で staging 維持コスト、形骸化必至。DX が「自分が守れない」と否定 |
| **Playwright e2e.yml advisory 復活** | QA 単独 | メンテ債務 > 検出価値。S6 ダッシュボードで代替 |
| **gh-pages 完全分離 (Architect 第 6 案 full)** | Architect | SRE「revert 困難」、DX「リファクタ規模が触らない技術と矛盾」。S3' bot branch 分離で D1 の 70% 解消、残りは完成宣言後 |
| **data-main orphan branch 全面 (第 7 案)** | Architect | S3' の bot branch 分離で D3 も 70% 解消、orphan 全面は不要。**odds のみ orphan は採用** |
| **Performance 80+ 追求** | (過去の自分) | DX 「Perf 80 は数値目標、LCP/FCP 1.5s で十分」、完成宣言後も追わない |
| **Web Worker 追加機能移管** | (PG Phase 慣性) | 十分快適、追加複雑度に見合う対価なし |

---

## 7. 「やらない」勇気

### 撤退
- **scrape-tide workflow 廃止**: 予測精度寄与測定不能、workflow 6 → 5 に削減
- **Cloudflare Worker odds primary**: 維持コスト > 価値、Actions 5 min cron 単独で十分
- **Playwright / VRT**: メンテ債務 > 検出価値

### 凍結 (CLAUDE.md FROZEN)
- `assets/app-critical.js` 先頭 30 行
- `sw.js` VERSION 以外
- `manifest.json`
- `index.html` の preload / preconnect / SRI hash 群
- Lighthouse 計測ベース最適化 PR (PE/PF/PG/PH/PI 系列は終了)

### 追加しない宣言
- 新規 ML モデル
- 新規 scraper
- 新規 PWA 画面
- A/B test 機構
- analytics SDK

> **DX 引用**: 「セッション 6h で 6 PR が出ている事実は、機能不足ではなく自制不足。完成は機能ではなく沈黙で証明される。」

---

## 8. 完成宣言条件 (critic 修正版)

以下を **30 日連続全達成** で「Stability A」を宣言:

1. **CI green 連続 14 日以上** (ruff + lint_critical_isolation + build)
2. **~~auto-revert 1 回以上実発火~~ → S4' dry-run fire 判定が 1 回以上記録された** (critic 致命 #3 修正)
3. **iPhone CRITICAL 通知 7 日連続 0 件**
4. **~~CLAUDE.md 30 日追記なし~~ → CLAUDE.md `修正履歴` セクション 30 日追記なし** (critic 新規 #4 修正、dependency 更新は `運用ログ` 別管理)
5. **Lighthouse Performance 50 以上 7 日連続** (peak 85 は追わない、下限維持のみ)
6. **bot/human PR diff 混在 0 件** (S3' 達成確認)
7. **人間 PR 平均 LOC ≤ 300 行 (全ファイル合計)** (S5 達成確認)
8. **(critic 新規) `app-critical.min.js` 単独 eval が CI で 30 日連続 PASS** (PJ 再発検知)

達成後の運用: 月次 1 回の dependency 更新 PR のみ。新機能は **完成宣言を破棄してから** 設計フェーズに戻る。

---

## 9. 実装順序とロールバック計画 (合計 15-18h、独立 PR)

| 順 | PR | 工数 | 単独価値 | rollback |
|---|---|---|---|---|
| 1 | S2': ruff CI gate (2 段階) | 1.5h | 事故 #1 #2 即停止 | `.github/workflows/lint.yml` 削除 |
| 2 | S1': onerror + critical linter + **eval smoke** | 4-5h | PJ 同型 100% 防止 | linter / smoke test 削除 + bind 移動 revert |
| 3 | S5: PR template + branch protection + FROZEN | 1.5h | AI 暴走の構造的阻止 | template 削除、protection rule off |
| 4 | S6: 診断ダッシュボード | 1h | iPhone から鮮度可視 | settings render 旧版 revert |
| 5 | S3': odds orphan + 残 4 bot/data-* | 5-6h | レビュー可能化、PR diff から bot ノイズ消失 | workflow を main 直接 push に戻す |
| 6 | S4': auto-revert with 6 gate | 6-7h | 30 min 以内自動回復 | workflow 削除 1 コマンド |

### 推奨 1 週間スケジュール (週末集中型)
- **土午前 (4h)**: S2' + S5 + S6 (1.5 + 1.5 + 1 = 4h) → AI 暴走 + 鮮度可視 即日効果
- **土午後 (4h)**: S1' (eval smoke 込み) → PJ 防止
- **日午前 (3h)**: S3' Step 1 (odds orphan のみ先行)
- **日午後 (3h)**: S3' Step 2 (残 4 scraper の bot/data-* PR)
- **翌週末 (6h)**: S4' (auto-revert)、1 週間 stability 観察後の最終 step

> **SRE 引用**: 「auto-revert は他 step が安定してから入れないと、自分自身が revert 連鎖の原因になる。」

---

## 10. 結語: 何が達成できるか / できないか

### 達成できる
- **「気付かないまま壊れている」** → 完全消滅 (REDESIGN Phase 0+1 で完成済)
- **「毎日壊れる」** → **月 1-2 回程度に低減** (本 STABILITY_PLAN で達成)
- AI セッションの暴走 → 構造的阻止 (S5)
- PJ 型致命 silent halt → eval smoke test で再発防止 (S1')

### 達成できない
- **完全な無人運用** (外部 API 仕様変更 / 新機能追加時のバグは人手必要)
- **「壊れない」の絶対保証** (個人開発で 99.99% は不可能、月 1-2 回の事故許容)
- 規律の本質的問題 (「もう触らない」を守れない場合、仕組みも回避される)

### 「毎日壊れる」を構造的に終わらせる core 3 つ
1. **D1 + D3** (bot/human 同 branch 共存) → **S3'** (odds orphan + 残 bot/data-*)
2. **D2 + D5** (critical 暗黙依存 + silent halt) → **S1'** (eval smoke test)
3. **D6** (AI セッション暴走) → **S2' + S5** (lint gate + 1 セッション 1 PR + 24h age + 深夜禁止)

これら 3 つを **15-18h で構造的に潰す**。それ以外の D4 / 細部最適化は defer。

**完成は機能の完成ではなく、CLAUDE.md が静かになることで証明される。**

---

## 付録: Round 1-3 各専門家所見の元データ

詳細な 5 案評価、過去事故 × test マトリクス、致命的見落とし 3 件などは本セッションのチャット履歴を参照。本ドキュメントはその統合最終判断のみ記述。

`docs/REDESIGN.md` (Phase -1+0+1 の設計文書、検知層) と本 `docs/STABILITY_PLAN.md` (壊さない / 自動回復層) のセットで boatrace-ai の信頼性設計が完結する。
