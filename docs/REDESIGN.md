# docs/REDESIGN.md — BoatRace Oracle 構造再設計

最終更新: 2026-05-11
ステータス: Proposal (Phase 0 着手前、Round 2 critique 待ち)
著者: Senior Architect Review (Round 1: 4 専門家並列分析、Round 2: 統合設計)

---

## 1. 障害の meta-pattern 分析 — なぜ毎日違う場所で同じ事故が起きるか

過去 1 週間に発生した 5 件の障害は、症状はバラバラだが **構造的には同一の不変条件違反**である。

| 共通因子 | 具体例 |
|---|---|
| **silent failure を通すパス**が常に存在 | `git diff --staged --quiet && exit 0` (workflow 5 本)、`gather()` without `return_exceptions`、`updated_at` の上書き、`console.error` のみの dispatch ログ |
| **「成功」の定義が"プロセスが exit 0"で終わっている** | scrape プロセスが green でも data が古いケースを誰も検知しない |
| **データの鮮度が一級市民でない** | `oddsData.updated_at` を Date.now() で握り潰し、レース単位の鮮度を持たない |
| **修正がコピペで横展開されない** | 5 workflow に同じ `git diff` チェック、5 scraper に同じ `gather` パターン、各々が独立に同じ罠を持つ |

つまり「**毎日違うファイルが同じ罠を踏んでいる**」のが本質。罠は workflow / scraper / frontend / SW の 4 層に**均等に**埋まっており、パッチで 1 つ潰しても他の 3 つは健在。Round 1 の各専門家が独立に「silent failure / 鮮度不在」を最重要に挙げたのはこの構造の反映である。

**meta-pattern: "局所的 try/except + プロセス exit 0 = 成功" という暗黙の契約**が、データパイプライン全体で成り立っていない。

---

## 2. 根本原因 — 現設計が "fail-quietly" を生む構造

1. **End-to-end の鮮度契約がない**: data/odds/today.json の `updated_at` が「いつ書かれたか」しか示さず、「中身が何時時点のオッズか」「全レース揃っているか」を表現できない。PWA 側は `Date.now()` で上書きしてさらに情報を破壊する。
2. **責務が水平分散している**: scrape ジョブ × 5、データ種別 × 4 (programs/previews/odds/results) の各セルが独立に "fetch → write → commit" を行い、横断的な健全性を保証する単一の場所が存在しない。
3. **配信層 (GitHub Pages) と生成層 (Actions) の間に検証層がない**: Actions が緑なら Pages に反映されるが、`updated_at` が更新されていなくても commit 0 行で緑。データ層 SLO がない。
4. **観測経路がデータと同居している**: cron_monitor.sh は RPi5 cron 時代の遺物で、現在の主経路 (GitHub Actions + Cloudflare Worker dispatch) を見ていない。failure 通知はメールか手動で Actions タブを見るしかない → iPhone PWA 利用者にリアルタイム通知不可。
5. **PWA 側 cache が真偽不明状態を許容**: SW data/ network-first は "速いが古いかもしれない" と "新しいが遅い" を区別せず、UI に渡してしまう。

**要するに「データの新鮮さを誰も保証していない」という抽象が、5 層に分散した実装の隙間に消えている。**

---

## 3. 設計原則 (今後の判断軸 7 つ)

1. **鮮度はデータ自身が持つ** — `updated_at` は生成側のみが書き、消費側は read-only。レース単位 (`odds[i].updated_at`) を持たせ、全体集約 `min(...)` で SLO 評価する。
2. **silent success を構造的に禁止** — 「commit 0 行 = 成功」を許さない。各 workflow は「最後に成功した write からの経過分数」を出力し、閾値超過で `exit 1`。
3. **観測はデータ層に置く、ジョブ層に置かない** — workflow の成否ではなく `data/*/today.json.updated_at` を真実源として watchdog を回す。
4. **書込みは 1 経路に集約** — 同じファイルを書く経路を 2 つ以上持たない (Worker と Actions の二重書きを禁止)。
5. **fallback は "古いと明示する" を伴う** — 古いデータを返してよいが、必ず鮮度を UI に出す。鮮度を隠すなら fallback してはいけない。
6. **incremental に変更し、各 Phase 単独でロールバック可能に** — 旧経路を残したまま新経路を追加し、PWA は feature flag で切替。
7. **iPhone に通知が届くまでが障害対応の完了** — メールや Actions タブは観測点として失格。GitHub Issue (iPhone GitHub アプリ push) を一級経路とする。

---

## 4. 推奨アーキテクチャ

### 4.1 データフロー (現状 → 目標)

```
[現状]
GitHub Actions (5 workflows) ──┐
                               ├──> data/*/today.json (git commit) ──> GH Pages ──> PWA
RPi5 cron_scrape.sh (legacy)  ─┘                                                     │
                                                                                     ▼
                                                                              Date.now() で上書き

[目標]
                  ┌────────────────────────────────────────────┐
                  │  Cloudflare Worker  (BFF + write gateway)   │
                  │  - /odds  (KV cached, 60s TTL)              │
                  │  - /freshness  (現在の updated_at)            │
                  │  - dispatch-log → KV writes (1k/day 内)     │
                  └────────▲────────────────────────────┬───────┘
                           │ scheduled (cron)            │ read
GitHub Actions (4) ────────┤                             │
  programs / previews /    │                             ▼
  results / racedata       │                          PWA (primary: Worker)
       │                   │                              │
       └─> data/*/today    │                              └─> fallback: GH Pages
           .json (git)     │
                           │
                  ┌────────┴───────────────────┐
                  │ scripts/check_freshness.py │  各 workflow 末尾で実行
                  │ exit 1 if updated_at >Nmin │
                  └────────────────────────────┘
                           │
                           ▼ on failure
                  GitHub Issue (label: stale-data)
                  → iPhone push 通知
```

### 4.2 Component 別責務とファイル変更点

| Component | ファイル | 変更内容 |
|---|---|---|
| **鮮度スキーマ** | `data/odds/today.json` | `{ generated_at, race_count, races: [{stadium, race_no, updated_at, odds:{...}}] }` に schema 拡張。`updated_at` は ISO8601 UTC 秒。 |
| **freshness checker** | `scripts/check_freshness.py` (新設) | 引数 `<file> --max-age-min N --field updated_at`。`now - max(updated_at)` > N で `exit 2` (stale)、ファイル不在で `exit 3`、JSON 壊れで `exit 4`。stdout に「最古/最新/件数」を表示。 |
| **workflow 末尾チェック** | `.github/workflows/scrape-odds.yml` 他 4 本 | 末尾に `- run: python scripts/check_freshness.py data/odds/today.json --max-age-min 10` を追加。`continue-on-error: false`。これだけで silent success を絶滅できる。 |
| **silent success 撲滅** | 同 workflow | `git diff --staged --quiet && exit 0` を削除、commit empty を許可した上で freshness check で判定する方式に統一。 |
| **watchdog (observability)** | `.github/workflows/watchdog.yml` (新設) | 5 分間隔で `curl https://<user>.github.io/data/odds/today.json` → freshness 評価。stale なら `gh issue create --label stale-data --title "odds stale Xmin"`。同 label の open issue があれば skip (重複抑止)。 |
| **Cloudflare Worker /odds** | `worker/src/odds.ts` (新規 or 既存に追加) | KV (`ODDS_KV`) に key=`odds:today` で 60s TTL。cache miss 時は GH Pages を origin に fetch、`updated_at` 検証して保存。`/freshness` で `{updated_at, age_sec}` を返す。 |
| **PWA primary path** | `assets/app-critical.js` の `loadAllData` | odds fetch を `https://<worker>.workers.dev/odds` に変更。失敗時は GH Pages にフォールバック、UI に「fallback mode」バッジ。 |
| **PWA 鮮度 UI** | `assets/app-rest.js` の `renderRaceList` | 各レースカードに `updated_at` バッジ。10 分超は黄、30 分超は赤。集約バッジを header に。 |
| **PWA 上書き禁止** | `assets/app-critical.js` 内 odds 受信処理 | `oddsData.updated_at = Date.now()` の代入を削除。read-only として扱う。 |
| **SW 戦略** | `sw.js` | data/ を network-first → **stale-while-revalidate + age 表示**。cache hit でも `updated_at` を window に postMessage、古ければ UI が「キャッシュ表示中」を出す。 |
| **legacy 撤去** | `scripts/cron_monitor.sh`, `scripts/health_check.sh` | GitHub Actions を見るように書き換え or 撤去。RPi5 経路は Phase 4 で完全停止。 |

---

## 5. 移行計画 (合計 18h、各 Phase 単独で価値とロールバック可能)

### Phase 0 — Freshness の真実源を作る (2h)
- **目的**: 現状の鮮度を可視化し、SLO 違反の頻度を把握。
- **成果物**: `scripts/check_freshness.py`、`.github/workflows/watchdog.yml`。
- **Acceptance**:
  - `python scripts/check_freshness.py data/odds/today.json --max-age-min 10` がローカルで exit code 0/2/3/4 を正しく返す。
  - watchdog.yml が 5 分間隔で動き、手動で `data/odds/today.json` を 11 分前にすると 5 分以内に GitHub Issue が立つ。
- **依存**: なし。**ロールバック**: workflow を disable するのみ。

### Phase 1 — silent success を撲滅 (3h)
- **目的**: 5 workflow の `git diff --staged --quiet && exit 0` 撤去 + freshness check 末尾追加。
- **成果物**: workflow 5 本の patch。
- **Acceptance**:
  - 各 workflow を手動 trigger し、scrape が古いデータを返した場合に exit 1 で赤くなることを実証。
  - 1 週間 watchdog で stale-data label の issue が立たないこと。
- **依存**: Phase 0。**ロールバック**: 末尾 step を削除。

### Phase 2 — レース単位 updated_at + PWA 鮮度 UI (4h)
- **目的**: `data/odds/today.json` の schema 拡張、PWA で鮮度を隠さない。
- **成果物**: `scripts/scrape_odds_fast.py` の出力 schema 変更、`assets/app-*.js` のバッジ実装、`Date.now()` 上書き削除。
- **Acceptance**:
  - 1 レースだけ手で古くした JSON を配置 → PWA 上で該当レースのみ赤バッジ、他は緑。
  - 既存テスト 21/21 PASS。
- **依存**: Phase 1。**ロールバック**: 旧 schema を併記する transition フィールドを残す。

### Phase 3 — Cloudflare Worker /odds gateway (5h)
- **目的**: PWA primary を Worker に切替、GH Pages を fallback に降格。
- **成果物**: `worker/src/odds.ts`、KV namespace `ODDS_KV`、PWA に feature flag `USE_WORKER_ODDS`。
- **Acceptance**:
  - `/odds` が 60s 以内の cache を返す、cache miss でも 500ms 以内。
  - Worker を意図的に 503 にしても PWA が GH Pages にフォールバックし、UI に「fallback」バッジ。
  - Worker req/day < 30k (実測)。KV write < 200/day。
- **依存**: Phase 2。**ロールバック**: feature flag を false に。

### Phase 4 — 観測の iPhone 化 + legacy 撤去 (4h)
- **目的**: stale-data の通知を iPhone に届ける、RPi5 経路を停止。
- **成果物**: GitHub Issue label `stale-data` の autoclose workflow (鮮度復旧で自動クローズ)、iPhone GitHub app subscribe 設定手順を `docs/RUNBOOK.md` に追記、`scripts/cron_monitor.sh` 撤去 or rewrite。
- **Acceptance**:
  - 意図的に scrape を 15 分止めた時に iPhone に通知が届くまで 10 分以内。
  - 復旧で issue が auto close されること。
  - RPi5 cron を停止しても データ更新が継続。
- **依存**: Phase 0,1。**ロールバック**: RPi5 cron を再起動。

合計: **2 + 3 + 4 + 5 + 4 = 18h** (< 20h の制約内)。

---

## 6. 想定する将来の障害と containment

| 想定障害 | これで contain される理由 |
|---|---|
| 新しい scraper を追加した時に freshness check を付け忘れる | watchdog が data ファイル側で監視するので、scraper の有無に依存しない。新ファイルは watchdog config に追加する 1 行 PR で網羅。 |
| Cloudflare Worker 障害 | PWA が GH Pages に自動 fallback、UI に fallback バッジ。鮮度は引き続き GH Pages の `updated_at` で判定。 |
| GH Pages 配信遅延 (Pages CDN cache) | watchdog は Pages 経由で取得しているため遅延も検知できる。Worker は KV で別経路。 |
| boatraceopenapi.github.io 側が落ちる | 全 scraper が古いまま → freshness check で 5 workflow 全部赤 → 1 つの集約 issue に。Issue 本文に「外部 API 起因の可能性」テンプレ表示。 |
| watchdog 自身が落ちる | Phase 0 で watchdog の `last_success_at` も `data/_watchdog.json` に書く。Worker `/freshness` で watchdog 自身の鮮度も返す → "監視の監視"。 |
| schema 変更時に旧 PWA ユーザが壊れる | Phase 2 で transition フィールド (`updated_at` を top-level にも残す) を 2 週間維持、SW v bump で全強制更新後に削除。 |
| Cloudflare 無料枠超過 | KV write を /odds 60s TTL で抑制 (理論上 1440/day だが scrape は 30min 間隔なので 48/day)。Class A ops も同様。watchdog で req/day を週次集計。 |

---

## 7. トレードオフと却下した代替案

### 却下案 A: Worker を全面 BFF 化 (programs/previews/results も)
- **却下理由**: Phase 3 の倍以上の工数 (12h+)、KV write quota を圧迫、failure blast radius が拡大。odds 以外は鮮度要求が緩く (programs は 1 日 1 回更新)、ROI が低い。
- **採用案 (D ハイブリッド)**: odds のみ Worker、他は GH Pages 維持。

### 却下案 B: RPi5 cron を主経路に戻す
- **却下理由**: 単一物理点 SPOF、自宅電源/ネットワーク依存、観測経路が更に閉じる。「iPhone から見える」の原則違反。

### 却下案 C: Sentry / Datadog 等 SaaS 監視導入
- **却下理由**: 個人運用 / 休日プロジェクト / 通知先 iPhone 1 台のために有償 SaaS は過剰。GitHub Issue + iPhone GitHub app push で同等以上の体験 (無料、認証済、deeplink 可)。

### 却下案 D: data/ を git ではなく R2 に置く
- **却下理由**: git history による rollback と diff 可観測性を失う。R2 class A ops の管理コストも増す。今回の障害群は git 起因ではないので解決にならない。

### 却下案 E: 全 scraper を 1 本のスクリプトに統合
- **却下理由**: blast radius 拡大 (1 種類失敗で全停止)、並列度低下、PR レビュー単位が肥大。silent failure の横展開を防ぐのは「共通ヘルパ + 末尾 freshness check」で十分。

### 採用案 D (Round 1 推奨) を採る決定理由
- 18h の予算内、incremental、各 Phase で単独価値、Cloudflare 無料枠内、SPOF を 5→2 に削減、iPhone 通知に直結。**「毎日違う場所で同じ事故」の構造的根因 (silent success + 鮮度不在 + 観測不在) を 3 軸同時に潰せる唯一の案**。

---

## 付録: この設計が「毎日同じ事」を終わらせる理由

過去の 5 障害を本設計に当てはめると:

| 障害 | 検知時刻 (旧) | 検知時刻 (新) | 検知経路 |
|---|---|---|---|
| 5/10 朝 NameError 10h | ユーザ報告 (10h 後) | 10 分以内 | watchdog → Issue → iPhone |
| 5/10 昼 silent gather | 40min 後にユーザ気付き | 10 分以内 | 同上 |
| 5/10 夕 banner 残置 | ユーザ報告 | フロント鮮度バッジで自明 | PWA UI |
| 5/10 夜 42 vs 44 | ユーザ集計時 | レース単位 updated_at で乖離可視 | PWA UI |
| 5/9 オッズ古い | ユーザ報告 | 10 分以内 | watchdog |

**「ユーザが iPhone を開いて気付く」より早く、iPhone に通知が来る**。これが本設計の合格ラインであり、Phase 0+1 (5h) のみで既に達成できる。残り Phase 2-4 はそれを構造的に固める。

---

## 8. Round 3: Devil's Advocate 監査結果

### 8.1 致命的な見落とし (3 件)

**(1) Watchdog 自身の死を誰も看取らない**
Phase 0 watchdog は GitHub Actions cron で動くが、**今回の事故の主役が GH Actions cron 自身**。watchdog を同じ基盤に載せるのは構造的自己矛盾。CLAUDE.md 修正履歴 §M-01〜M-09 にも cron_monitor の苦闘記録あり。**最低 2 経路 (GH Actions + 外部 UptimeRobot) で二重化必須**、本来は **deadman switch** (一定時間正常 ping が無ければ別経路で alert) もあるべき。

**(2) iPhone GitHub アプリの通知到達を誰も検証していない**
集中モード / 通知音 OFF / iOS バッテリー最適化で配信遅延 30 分超は実例多数。**通知が届いたことを検知する acceptance test が無い**。月 1 回の擬似障害 drill (`gh issue create --title TEST_DRILL`) で実機到達時刻を記録する Phase が必須。

**(3) Worker → Pages origin fetch が CDN cache に hit して古い値を 60s 固定化**
GH Pages は Fastly CDN 経由で `cache-control` 制御不能。Worker が origin fetch した瞬間に CDN の古い copy を引き、KV に 60s TTL で焼き付けると **stale 永続化の worst case** が成立する。`Cache-Control: no-cache` 送出 + ETag 検証でも Fastly TTL は完全 bypass 不可。Worker 側で `cf-cache-status` ヘッダを見て hit なら KV write をスキップする必要。

### 8.2 楽観的見積り

| Phase | 当初 | 修正 | 内訳 |
|---|---|---|---|
| Phase 1 | 3h | **6h** | `git diff --staged --quiet` 撤去で empty commit 失敗が再発、`--allow-empty` への置換 + check_freshness exit code 整合確認で各 workflow 1h 必要 |
| Phase 2 | 4h | **10-12h** | critical/rest split 考慮で schema 拡張 6h、PJ-fix と同種の standalone halt risk verification +4h |
| Phase 3 | 5h | **12-15h** | KV namespace 作成、wrangler.toml env 分離、CSP 全項目再検証、staging 24h soak、PWA 段階 rollout (10→50→100%)、Worker 失敗時自動フォールバック検証 |

### 8.3 移行中に新規発生し得る障害

1. **Phase 3 切替直後 Worker 5xx → 旧 SW cache が serve → 鮮度 OK 表示で stale データ**
   - Contain: PWA に「データ取得経路」を画面表示 (Worker / Pages / SW cache の 3 値)、SW cache fallback 時は必ず鮮度バッジを「キャッシュ X 分前」と明示。

2. **`scripts/check_freshness.py` 自身のバグで全 5 workflow 永続赤 → iPhone 通知 dilute → 本物の障害スルー**
   - Contain: check_freshness は default warning exit (exit 0 + annotation)、`--strict` flag を別 workflow からのみ。`scripts/tests/test_check_freshness.py` を CI 必須化。

3. **GH Issue 重複作成バグで 5 分毎に Issue 作成 → 1h で 12 件 → 通知疲労で全スワイプ → 本物見逃し**
   - Contain: watchdog は `gh issue list --label stale-data --state open` で先に検索、無ければ作成。`gh issue list` 自体失敗時は作成スキップ (fail-closed)。

### 8.4 設計原則 追加

**原則 8: 監視層自身が監視されること (deadman switch 必須)**

### 8.5 Phase 計画 修正版 (合計 24h)

| # | Phase | 旧 | 新 | 主な追加 |
|---|---|---|---|---|
| **-1** | **通知到達 drill (新設)** | — | **1h** | 月次 `gh issue create TEST_DRILL` + 24h 残存確認 |
| 0 | Freshness 真実源 + watchdog 三重化 | 2h | **4h** | GH Actions + UptimeRobot 5 分監視 + RPi5 cron deadman ping |
| 1 | silent success 撲滅 | 3h | **6h** | --allow-empty 置換、各 workflow 個別検証 |
| 2 | レース単位 updated_at + PWA 鮮度 UI | 4h | **6h** | critical bundle isolation linter (`scripts/check_critical_isolation.py` 新設) 込み |
| 3 | Cloudflare Worker /odds gateway | 5h | **6h** | `cf-cache-status` 検証 + 段階 rollout |
| 4 | iPhone 通知化 + legacy 撤去 | 4h | **1h** | Phase -1 に通知部分を分離したため軽量化 |
| **計** | | **18h** | **24h** | |

### 8.6 各 Phase 共通の必須 Acceptance Criteria 追加

すべての Phase 完了条件に追加:
- **「擬似障害注入で iPhone 着信 < 10 分」** を必須項目化
- 各種ヘルパー (`check_freshness.py`, `check_critical_isolation.py`) は単体テスト必須

### 8.7 総合評価

**現状文書のまま着手は NG**。+6h で 5 項目追加すれば構造的に「毎日同じ事」を止められる。

**条件付き OK の必須追加 (上記 8.5 の差分):**
- Phase -1 通知 drill (+1h)
- Phase 0 三重化 +UptimeRobot (+2h)
- Phase 3 cf-cache-status 検証 (+1h)
- check_freshness.py 単体テスト (+1h)
- critical bundle isolation linter (+1h)

合計 **+6h、本来 18h → 24h**。これでようやく「毎日同じ事故」が構造的に止まる確率が高い。

---

## 9. 最終決定

### 採用: 修正版 Phase 計画 (24h、5 Phase + drill)

| Phase | 工数 | 累積 | 単独価値 |
|---|---|---|---|
| -1 通知到達 drill | 1h | 1h | 通知届くか実機検証、これだけで安心感大 |
| 0 Freshness 真実源 + 三重 watchdog | 4h | 5h | **5h で「毎日同じ」の主因 silent fail を実検知** |
| 1 silent success 撲滅 | 6h | 11h | 全 5 workflow が exit 1 で赤くなる、過去事故再現せず |
| 2 レース単位 updated_at + 鮮度 UI | 6h | 17h | 偽の「最新」表示が不可能に、ユーザ誤認消滅 |
| 3 Worker /odds gateway | 6h | 23h | cron 完全停止でも実時間オッズ |
| 4 RPi5 legacy 撤去 | 1h | 24h | 観測経路一本化 |

### Phase 0+1 の早期効果 (5+6=11h、約 2 週末)
- 過去 5 件の障害 100% を「ユーザが気付くより早く iPhone 通知」で捕捉可能
- silent failure 構造排除
- これだけで「毎日同じ」は実質終わる、Phase 2-4 は構造補強

### Decision Point
ユーザに進め方を再確認:
- (A) Phase -1 + 0 + 1 (11h、2-3 PR、2-3 日) で **痛みを止める** ことに集中
- (B) 24h 全 Phase 一気
- (C) docs/REDESIGN.md を read-only で熟考、別日着手
