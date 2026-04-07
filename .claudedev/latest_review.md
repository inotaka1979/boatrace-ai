# 検討結果

日時: 2026-04-07 13:26:12

調査が完了しました。以下、専門家パネルによる設計レビューを行います。

---

# 専門家パネルレビュー：オッズ・展示リアルタイム取得の改善

## 評価サマリー

現行システムはcron(3分間隔) → Pythonスクレイプ → git push → GitHub Pages → PWA fetchという長いパイプラインで構成されており、**各段階に障害ポイントが散在**している。特にgit競合処理の`--theirs`誤用（ローカルデータ喪失）、DNS例外の未捕捉、heartbeatによるエラー隠蔽が致命的。

---

## 参加専門家

| 専門家 | 担当領域 |
|--------|----------|
| **A. インフラ/DevOps** | cron・git・デプロイパイプライン |
| **B. バックエンド/Python** | スクレイプロジック・asyncio・エラー処理 |
| **C. フロントエンド/PWA** | データ取得・キャッシュ・UX |
| **D. アーキテクト** | 全体設計・代替アプローチ |

---

## 良い点

- **デュアルソース戦略**（Open API + 公式スクレイプ）で冗長性を確保
- **締切時刻ベースの優先度制御**（scrape_previews.py）は効率的で良設計
- **fetchWithFallback** の3段階障害対応（タイムアウト→localStorage→null）は堅牢
- **flock排他制御**でモード内の二重実行は防止済み
- **キャッシュバスター**（`?t=Date.now()`）でSW/CDNキャッシュを確実に回避

---

## 問題分析と改善提案

### 【CRITICAL-1】git rebase の `--theirs` 誤用（データ喪失）

**専門家A（DevOps）:**

`cron_scrape.sh` 117-122行で、git push conflict時に `git checkout --theirs data/` を実行している。しかし rebase 文脈では `--theirs` はリモート側ではなく**ローカル側**の変更を意味するため、意図と逆の動作になるケースがある。

**改善案:**
```bash
# 現状（誤り）
git checkout --theirs data/

# 修正案: rebase中はours/theirsが逆転するため、
# ローカルのスクレイプ結果を優先する場合:
git checkout --ours data/
git add data/
git rebase --continue
```

ただし根本的には、**rebaseではなくmergeを使う**か、**force pushに切り替える**（data/のみのリポジトリなので安全）方がシンプル。

**優先度: 最高** — 現在進行形でデータ喪失している可能性あり

---

### 【CRITICAL-2】odds/previews の同時git push → 競合多発

**専門家A（DevOps）:**

crontabで `*/3` の同一タイミングにoddsとpreviewsが起動。独立lockファイルのため同時実行され、git pushが衝突する。ログにも `push failed (attempt 1/3)` が頻出。

**改善案（3択）:**

| 案 | 方法 | メリット | デメリット |
|----|------|----------|------------|
| **A1** | cron時差分散（odds: */3の0秒、previews: */3の90秒） | 最小変更 | 根本解決ではない |
| **A2** | 共通lockファイルで排他化 | 確実な競合防止 | スクレイプ間隔が実質6分に |
| **A3** | **1つのcronジョブで both を順次実行** | git操作を1回に集約 | スクリプト改修必要 |

**推奨: A3** — `cron_scrape.sh all` モードを改善し、previews→odds→**1回のcommit+push**にする

---

### 【CRITICAL-3】DNS失敗の例外未捕捉

**専門家B（Python）:**

`scrape_odds_fast.py` で `aiohttp.ClientError` と `asyncio.TimeoutError` のみcatch。DNS解決失敗（`OSError: Temporary failure in name resolution`）は `OSError` サブクラスのため**捕捉されない**。

ログに実証あり:
```
ERROR Failed to fetch programs: Cannot connect to host boatraceopenapi.github.io:443
```

**改善案:**
```python
# 現状
except (aiohttp.ClientError, asyncio.TimeoutError) as e:

# 修正: OSErrorも捕捉（DNS失敗、接続拒否等）
except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
```

加えて、**プログラムAPI取得失敗時は即座にexit**すべき（レース一覧なしでスクレイプしても無意味）:

```python
if not programs:
    log.error("プログラム取得失敗 - スクレイプ中止")
    sys.exit(1)
```

---

### 【HIGH-1】heartbeatがエラーを隠蔽

**専門家A（DevOps）:**

`cron_scrape.sh` 156行: push成否に関係なくheartbeat更新。監視スクリプトがアラートを上げられない。

**改善案:**
```bash
# push成功時のみheartbeat更新
if git_push_with_retry; then
    date '+%Y-%m-%d %H:%M:%S' > "$HEARTBEAT_FILE"
else
    log "ERROR: push failed - heartbeat NOT updated"
fi
```

---

### 【HIGH-2】リトライに指数バックオフがない

**専門家B（Python）:**

現在のリトライは固定間隔（0.5秒）。boatrace.jp がレート制限をかけた場合や一時的負荷時に効果がない。

**改善案:**
```python
async def fetch(session, url, retries=3):
    for attempt in range(retries):
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status == 429:  # Rate Limited
                    wait = 2 ** attempt * 5  # 5, 10, 20秒
                    log.warning("Rate limited, waiting %ds", wait)
                    await asyncio.sleep(wait)
                    continue
                r.raise_for_status()
                return await r.text()
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
            wait = 2 ** attempt * 0.5  # 0.5, 1, 2秒
            if attempt < retries - 1:
                await asyncio.sleep(wait)
            else:
                log.warning("Failed %s after %d retries: %s", url, retries, e)
    return None
```

---

### 【HIGH-3】asyncio.gatherの例外処理欠如

**専門家B（Python）:**

`scrape_previews.py` の `asyncio.gather()` に `return_exceptions=True` がない。1タスクの例外で全タスクが中断する。

```python
# 現状
results = await asyncio.gather(*tasks)

# 修正
results = await asyncio.gather(*tasks, return_exceptions=True)
for r in results:
    if isinstance(r, Exception):
        log.warning("タスク失敗: %s", r)
```

---

### 【HIGH-4】展示データの「鮮度」問題

**専門家C（フロントエンド）:**

PWA側の5分ポーリングは展示情報のリアルタイム性に不十分。レース締切前30分が最も重要な時間帯だが、最悪5分+GitHub Pages反映遅延(数分)= **7-10分遅れ**のデータを表示。

**改善案（段階的）:**

| フェーズ | 方法 | 遅延 |
|----------|------|------|
| 現状 | cron 3分 → git push → Pages → PWA 5分 | 3-10分 |
| **Phase 1** | PWAポーリングを2分に短縮 + 締切30分前は1分 | 2-6分 |
| **Phase 2** | RPi上のserve_data.py（既存）を活用し、ローカルネットワーク内で直接配信 | 即時 |
| **Phase 3** | WebSocket/SSE でプッシュ配信 | <1秒 |

**推奨: Phase 1を即座に、Phase 2を中期で実装**

Phase 1のPWA側コード案:
```javascript
// 締切時刻に応じたポーリング間隔の動的調整
function getRefreshInterval() {
    if (!currentRace || !currentStadium) return 300000; // 5分
    var prog = getProgramForRace(currentStadium, currentRace);
    if (!prog || !prog.race_closed_at) return 300000;
    var closedAt = new Date(prog.race_closed_at + '+09:00').getTime();
    var diff = closedAt - Date.now();
    if (diff > 0 && diff < 1800000) return 60000;  // 締切30分前: 1分
    if (diff > 0 && diff < 3600000) return 120000;  // 締切60分前: 2分
    return 300000; // それ以外: 5分
}
```

---

### 【MEDIUM-1】オッズスクレイプ対象の最適化

**専門家D（アーキテクト）:**

現在は全24場×全レースをスクレイプしているが、**締切前のレースのみ**に絞るべき。既に結果確定済みレースのオッズ取得は無駄。

```python
# scrape_odds_fast.py に締切チェック追加
now = datetime.now(JST)
target_races = []
for p in programs:
    closed_at = datetime.strptime(p["race_closed_at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=JST)
    if closed_at > now - timedelta(minutes=5):  # 締切5分前以降のみ
        target_races.append((p["race_stadium_number"], p["race_number"]))
```

これにより：
- 朝の段階: ほぼ全レース取得（大差なし）
- 昼以降: 対象レース激減 → スクレイプ時間短縮 → git push頻度低下 → 競合減少

---

### 【MEDIUM-2】datetime.utcnow() の非推奨対応

**専門家B（Python）:**

`scrape_odds.py` line 115 で使用。Python 3.12+ で DeprecationWarning。

```python
# 現状
datetime.datetime.utcnow().isoformat() + "Z"

# 修正
datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
```

---

### 【MEDIUM-3】空データの保存防止

**専門家B（Python）:**

プログラムAPI取得失敗時に空のオッズJSONが保存される（空リストでも処理継続するため）。

```python
# scrape_odds_fast.py に保存前チェック追加
if not merged_odds:
    log.error("オッズデータなし - ファイル更新スキップ")
    sys.exit(1)
```

---

## リスク・注意事項

| リスク | 影響 | 対策 |
|--------|------|------|
| boatrace.jp のIP制限 | スクレイプ完全停止 | リクエスト間隔を1秒以上に、User-Agentローテーション |
| GitHub Pages の反映遅延 | データ遅延が固定で数分発生 | serve_data.py によるローカル直接配信（Phase 2） |
| RPi5のネットワーク不安定 | DNS失敗でスクレイプ停止 | DNSキャッシュ（systemd-resolved）の導入 |
| cronジョブの蓄積 | メモリ圧迫 | timeout指定（`timeout 120 python3 ...`）を追加 |
| Service Workerのキャッシュ | 古いindex.htmlが残る | sw.jsのバージョン更新戦略を改善 |

---

## 実装優先順位

```
即座に対応（1日以内）:
  1. CRITICAL-1: git checkout --theirs → --ours 修正（1行変更）
  2. CRITICAL-3: DNS例外の捕捉追加（1行変更）
  3. HIGH-1: heartbeat条件付き更新（5行変更）

今週中:
  4. CRITICAL-2: cron統合（odds+previewsを1ジョブ化）
  5. HIGH-3: asyncio.gather例外処理
  6. HIGH-4 Phase 1: PWA動的ポーリング
  7. MEDIUM-1: オッズスクレイプ対象最適化
  8. MEDIUM-3: 空データ保存防止

中期（1-2週間）:
  9. HIGH-2: 指数バックオフ
  10. HIGH-4 Phase 2: serve_data.pyローカル配信
  11. MEDIUM-2: datetime非推奨対応
```

実装に移りましょうか？