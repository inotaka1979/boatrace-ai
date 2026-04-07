# 検討結果

日時: 2026-04-07 14:18:19

現状の全体像を把握しました。以下がレビュー結果です。

---

## 設計レビュー: レースごとのオッズ・展示タイム個別更新

### 1. 評価サマリー

現状の`refreshThisRace()`は「このレースを更新」と表記しているが、実際は**全レース分のJSON（programs/previews/results/odds）を丸ごと再取得**しており、1回の更新に数秒〜10秒かかる。レースごとの個別取得API（boatrace.jp直接スクレイピング）はサーバーサイド（Python）にしかなく、フロントエンド（ブラウザ）からはCORSで直接アクセスできないため、**アーキテクチャの変更が必要**。

### 2. 良い点

- `scrape_previews.py` が締切時刻ベースの優先度スクレイピングを実装済み（WINDOW_BEFORE_CLOSE=35分）で、必要なレースだけ効率的に取得している
- `scrape_odds_fast.py` が asyncio + aiohttp で5並列化済み、確定済みレースをスキップしている
- `serve_data.py` がCORS対応ローカルHTTPサーバーとして存在し、ハイブリッド構成の基盤がある
- cron 3分間隔で odds/previews を自動更新しており、GitHub Pagesへのpushパイプラインも安定

### 3. 改善提案

#### 【P0: 最優先】RPi5ローカルAPIにレース単位エンドポイント追加

**現状の問題**: ブラウザ → GitHub Pages JSON は全レース一括。更新ボタンを押しても結局全データを再取得。

**提案**: `serve_data.py` を拡張して、レース単位のオンデマンドスクレイピングAPIを追加する。

```
GET /api/race?stadium=4&race=8
→ RPi5がその場でboatrace.jpから展示+オッズを取得して返す（2-3秒）
```

| 方式 | 更新時間 | 実装コスト | データ鮮度 |
|------|----------|------------|------------|
| A. 現状（全JSON再取得） | 5-10秒 | なし | cron間隔依存（3分） |
| B. RPiローカルAPI | 2-3秒 | 中 | リアルタイム |
| C. GitHub Actions dispatch | 30秒+ | 低 | 30秒遅延 |
| D. Cloudflare Worker経由 | 1-2秒 | 高 | リアルタイム |

**推奨: 方式B** — RPi5にすでに`serve_data.py`があるため、これを拡張するのが最も実用的。

**具体的な実装計画**:

```python
# serve_data.py に追加するエンドポイント

GET /api/race?stadium={sid}&race={rno}
レスポンス:
{
  "stadium": 4, "race": 8,
  "preview": {  // 展示情報
    "boats": { "1": { "exhibition_time": 6.78, "start_timing": 0.12, ... }, ... }
  },
  "odds": {  // オッズ
    "win": {"1": 2.3, ...},
    "exacta": {"1-2": 12.5, ...},
    "trifecta": {"1-2-3": 45.0, ...}  // ※3連単は120通りで取得に1-2秒
  },
  "scraped_at": "2026-04-07T14:30:00+09:00"
}
```

#### 【P1: 高優先】フロントエンド（index.html）の更新ボタンUI改善

現在の「🔄 このレースを更新」ボタンを以下のように分割:

```
[🔄 展示更新]  [💰 オッズ更新]  [⟳ 全更新]
```

- **展示更新**: 展示タイム・ST・チルト・進入コースのみ取得（1リクエスト、1秒）
- **オッズ更新**: 単勝+2連単のみ取得（2リクエスト、1-2秒）。3連単はオプション
- **全更新**: 従来どおり（フォールバック用）

```javascript
// index.html に追加
async function refreshRacePreview(sid, rno) {
  // RPiローカルAPI or cron更新済みJSONから該当レースだけ取得
  const resp = await fetch(`${LOCAL_API}/api/race?stadium=${sid}&race=${rno}&type=preview`);
  const data = await resp.json();
  // previewData[sid][rno] にマージ
  mergePreviewData(sid, rno, data.preview);
  openRace(sid, rno); // 再描画
}

async function refreshRaceOdds(sid, rno) {
  const resp = await fetch(`${LOCAL_API}/api/race?stadium=${sid}&race=${rno}&type=odds`);
  const data = await resp.json();
  mergeOddsData(sid, rno, data.odds);
  openRace(sid, rno);
}
```

#### 【P2: 中優先】差分取得の最適化

現在のcron更新（3分間隔）で取得したJSONをフロントエンドが利用する際、**レース単位のタイムスタンプ**を追加することで、変更があったレースだけUI更新できる:

```json
// data/odds/today.json に各レースの更新時刻を追加
{
  "odds": [
    { "stadium": 4, "race": 8, "_updated": "14:28:00", "win": {...}, ... },
    { "stadium": 4, "race": 9, "_updated": "14:25:00", "win": {...}, ... }
  ]
}
```

フロントエンド側で前回取得時のタイムスタンプと比較し、変わっていなければパースをスキップ。

#### 【P3: 低優先】3連単オッズの遅延取得

3連単オッズは120通りのHTMLテーブルをパースするため最も重い。現状`scrape_odds_fast.py`では3連単を**取得していない**（`scrape_race`が`win`と`exacta`のみ）。旧版`scrape_odds.py`では取得している。

提案: 3連単は「ユーザーがレース詳細を開いた時にオンデマンド取得」に変更する。

```
レース一覧表示時: 単勝+2連単のみ（cron自動取得で十分）
レース詳細を開いた時: 3連単をオンデマンド取得（RPi APIで1-2秒）
```

### 4. リスク・注意事項

| リスク | 影響 | 対策 |
|--------|------|------|
| boatrace.jp への過剰アクセス | IP制限・遮断 | RateLimiter維持（0.3秒間隔）、同一レースの連続更新に5秒クールダウン |
| RPi5のメモリ/CPU負荷 | aiohttp + BeautifulSoup がARM64で重い | 同時リクエスト数を3に制限、メモリ監視 |
| `serve_data.py` の安全性 | 外部公開時のセキュリティ | LAN内限定 or Basic認証、stadium/race パラメータのバリデーション（1-24, 1-12） |
| GitHub Pages vs ローカルAPI の二重構成 | データ不整合 | ローカルAPIで取得したデータも`data/`に書き込み、次回cron pushで同期 |
| PWA（iPhone）からローカルAPIへのアクセス | 外出先では使えない | フォールバック: ローカルAPI不達時は従来のGitHub Pages JSONを使用 |

### 実装の優先順序

```
1. serve_data.py にレース単位APIを追加（P0）      ← まずここ
2. index.html の更新ボタンをレース単位に変更（P1） ← 同時に
3. フォールバック（ローカルAPI不達→従来方式）      ← 必須
4. 差分取得・3連単遅延取得はその後              ← 余裕があれば
```

**ローカルAPIのURL設定** は、index.html の設定画面に「RPi5 APIアドレス」入力欄を追加し、`localStorage`に保存する形が良いでしょう。デフォルトは空（従来方式）、設定時のみローカルAPI経由に切り替わるようにすれば、iPhone持ち出し時にも動作します。