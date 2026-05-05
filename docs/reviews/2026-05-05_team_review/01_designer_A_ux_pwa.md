# 設計者A レビュー原本 — UX / UI / 情報設計 / PWA

- 担当: シニアフロントエンド設計者（PWA / モバイルUX 専門）
- 対象: `/home/pi/boatrace-ai`（Lighthouse Perf 85 / A11y 100 達成済み）
- 日付: 2026-05-05

---

## BoatRace Oracle PWA — UX/UI/情報設計 徹底レビュー

### 現状の強み 3点

1. **Lighthouse A11y/BP/SEO 100達成、iOS standalone PWA 動作確認済み**（CLAUDE.md L366-422）
   - safe-area 全方向対応、viewport-fit=cover、100dvh による画面フルスクリーン対応が実装済
   - code splitting（critical 34KB / rest 100KB）による LCP 1.5s 実現で、初期表示の快適性を確保
   - Service Worker v9 + prerender で GPU-accelerated stadium card 表示、CLS 0.026 達成

2. **5画面階層の導線が整理、戻り動線が完全**
   - pageTop (開催場4列グリッド) → openStadium (該当場1R～12R) → openRace (詳細6艇+予想+オッズ) → pageStats・pageSettings が完全オルソゴナル設計
   - 「場選択に戻る」「レース一覧に戻る」ボタンが明示的に配置、iOS独特の NavigationBar 不在環境での戻り導線が完全
   - nav-btn 48x48pt のタッチターゲット確保、bottom safe-area で iPhone ホームインジケータ領域を回避

3. **Storage validation + エラー reporter による堅牢性**（CLAUDE.md PA-5, PC-6）
   - localStorage 破損時の自動隔離（boatrace_*__corrupt_タイムスタンプ）と fallback 復帰で、ユーザ操作中の silent fail ゼロ
   - window.onerror + unhandledrejection をバッファ（最大100件）に記録、設定画面で「エラーログ表示・コピー」可能

---

### 改善すべき論点 6件（優先度付き）

#### **P0: iOS standalone PWA 自動更新時の状態復元に課題**
- **現象**: SW skipWaiting + controllerchange で自動リロード後、ユーザが開いていた詳細画面がトップにリセット（CLAUDE.md L343-345）
- **原因**: `location.reload()` はクエリ文字列を保持するが、`?tab=detail&sid=1&rn=3` といった SPA ルート情報がないため、showPage('top') のデフォルト表示に戻る
- **提案実装方針**:
  - globalThis に `_lastPage`, `_lastStadium`, `_lastRace` を常時保持
  - beforeunload で sessionStorage に保存（`session_restore_page` キー）
  - 起動時 showPage 前に sessionStorage を読み取り復元
  - PWA 自動更新レジェンダ: 「設定」画面に「更新後の表示復元」トグル追加
- **影響範囲**: index.html (showPage call site), app-critical.js (boot sequence)

#### **P1: レース詳細画面の情報密度が過度（A～H 8カテゴリ表示が折返し多発）**
- **現象**: openRace (app-rest.js L2500+) で出走表（6艇×10行）+ 予想カテゴリ（A～H + confirm%）+ 三連単オッズ（30+件）が縦スクロール 10画面超
- **原因**: Macour 競艇予想サイト風の横長 detail-table-wrap がスマホで auto-width 100% 超過、テーブルセル min-width:56-72px による折返し。予想根拠（L1ルールベース 8項目）が「何が主流を決めたか」をユーザが読み取り困難
- **提案実装方針**:
  - **Tabs pattern へ再構成**: 「出走表」「AI根拠」「オッズ＋買い目」の 3 タブ化
    - Tab 1: 出走表は現状維持（フルサイズ horizontal scroll）
    - Tab 2: AI根拠を「カテゴリ別アコーディオン」（A=コース, B=選手…)、デフォルト全閉じ→ top 3 影響度のみ展開
    - Tab 3: オッズ行を「圧縮表示＋6点拡張ボタン」パターンに（Exact odds matrix は option)
  - 「重要度スコア」をカテゴリごと % ゲージで可視化（A=40%, B=25%, C=15%…で総和100%）
- **影響範囲**: index.html (detailPrediction div 構造変更), app-rest.js (openRace L2500-3100, renderPredictionHtml logic refactor)

#### **P1: レース詳細のプログレスバー（確率）が小さすぎ + ラベル配置がスクロール時に消失**
- **現象**: `.prob-bar { height:6px }` では iPhone SE (320px width) で視認困難。「1着 40%」「2着内 60%」ラベルが bar の上に配置されるため、スクロール時に出走表に隠れる
- **原因**: detail-table-wrap overflow-x + sticky positioning による z-index 戦争、予測信度の段階的表示（ランク1～6）が `.prob-rank-item { font-size:13px }` 固定
- **提案実装方針**:
  - `.prob-bar` を min-height:14px に上げ、内部に percentage text を埋め込み（font-size:10px, color:inherit or --accent）
  - ラベル「1着」「2着内」を bar 左側に fixed (position: sticky, left: 0) で固定
  - mobile では確率バーのみ表示、% 数値 tooltip に defer（タップで表示）
- **影響範囲**: index.html CSS (.prob-bar, .prob-fill, .pred-rank-item), app-rest.js rendering logic

#### **P2: 穴/混戦/本命ラベルの色が色覚多様性 (Protanopia/Deuteranopia) で区別困難**
- **現象**: index.html L333-335 で `.type-honmei { background:#E3F2FD; color:#1565C0 }` (青), `.type-ana { background:#FFEBEE; color:#C62828 }` (赤) 表示。赤緑色盲では両方が灰色に見える
- **原因**: 色のみに依存、テキストラベル「本命」「混戦」「穴」は小さく (font-size:9px)
- **提案実装方針**:
  - `.type-badge` に icon + text 併記: `⚡本命` `📊混戦` `🔥穴`（絵文字 + label）を box 内に縦配置
  - 背景を色 + パターン（斜線 / 点線）の二重化（CSS `background-image: repeating-linear-gradient`）
  - 色アクセス検査: WCAG コントラスト指標だけでなく、Coblis simulator で red-blind 表示確認、threshold 0.95 以上確保
- **影響範囲**: index.html CSS (.type-honmei, .type-ana, .type-middle), app-rest.js (racetype icon)

#### **P2: ホーム再起動後、成績ページが一時「DB情報を読込中…」で止まる（UX 不安感）**
- **現象**: pageStats open 時、`renderStats()` が boatrace_history を safeParse 中に API wait。その間「読込中」文字のまま 3～5秒
- **原因**: loadAllData Phase 2 が resultdata fetch を `requestIdleCallback` で defer（CLAUDE.md PG-1）しているため、初回 stats open までに結果データ未 load
- **提案実装方針**:
  - `renderStats()` 冒頭に loading spinner 明示的表示（`statDetail.innerHTML='<div class="loading">…</div>'`）
  - history が load済みならそのまま描画、未 load なら mini skeleton loader（灰色 placeholder 6 行×3列）を表示
  - resultData lazy-load 完了時に自動リフレッシュ（`addEventListener('dataReady')`）
- **影響範囲**: index.html (pageStats layout), app-rest.js (renderStats entry point)

#### **P1: プッシュ通知・ホームショートカット未実装（manifest.json のみ宣言が宙ぶらりん）**
- **現象**: manifest.json (L5, L472-476) に `shortcuts` 「成績」「検証」がありながら、iOS ホームロングプレスで表示されない（Android Chrome のみ対応）
- **原因**: iOS 16.4+ で shortcut action をサポート開始（CLAUDE.md A_PLUS化設計書 D-1）しているが、app.js で URL ルート処理がない。また notification permission request が実装されていない
- **提案実装方針**:
  - **Next Phase で: PWA Notifications API を追加**
    - レース成立時（result API update 検出時）に `showNotification('〇〇場 3R 成立')`
    - 通知は成績トラッカーにログ記録
  - **短期**: manifest shortcut URL に クエリ params を付与 (`/?tab=stats`)、app-critical.js boot で URL params 読み取り showPage 自動切替
- **影響範囲**: manifest.json, app-critical.js (boot routing)

---

### 次フェーズで仕込みたいUX機能 2件

1. **「出走表スナップショット + チェックリスト」機能** — ユーザが「この艇の ST に注目」と記録、レース成立後に「予想根拠と実績の照合」を自動集計
   - 設計: 詳細画面で各艇 row に checkboxes、選択艇を `boatrace_notes` に保存
   - 効果: ユーザが「なぜこの買い目を選んだか」を思い出しやすく、学習サイクル加速

2. **「同じ選手同じコース」の対戦履歴フィルタ（pairwise matchup depth）** — 予想根拠 B「選手コース別実力」が十分か判断する根拠を明示
   - 設計: 詳細画面で「1-2 対戦成績: 3勝 2敗 1引き分け（過去 100R）」を矩形コンボボックスで表示
   - 効果: boatrace_pairwiseDB が既に蓄積されているため、追加の API 呼び出し不要。確率見積もりの信頼度ゲージになる

---

## 結論

Lighthouse 性能指標 (LCP 1.6s, a11y/BP/SEO 100) の実現で、**アプリケーション層での基本動作は十分** だが、UX 観点では **詳細画面の情報過負荷** と **色彩アクセシビリティ** が新規ユーザの定着を阻害する可能性がある。P0/P1 の6件は 8～12時間で実装可能で、次セッションで優先すべき。一方、P2 の 2 つの次フェーズ機能は、ユーザ学習エコシステムの成熟に直結するため、1 ヶ月のデータ蓄積後に投資するリターンが高い。
