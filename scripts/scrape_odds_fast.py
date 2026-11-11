#!/usr/bin/env python3
"""scrape_odds_fast.py — asyncio版 高速オッズ取得

2026-05-10: 堅牢化
  - asyncio.gather(return_exceptions=True) で 1 task 失敗が全体を巻き込むのを防止
  - HTTP 429/5xx を指数バックオフで retry (boatrace.jp の rate limit 対応)
  - 成功/失敗カウントをログに明示、reliability_score を出力 JSON に記録
  - 全レース失敗時のみ exit 1 (workflow を red に)、部分成功は exit 0
"""

import asyncio, json, os, sys, time, logging, random, datetime
import aiohttp
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # P2 D-01
from time_utils import utc_iso_seconds, JST  # P2 D-02 / D-10
from programs_source import load_local_official_programs  # 公式移行 Phase 2

PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
ODDS_BASE = "https://www.boatrace.jp/owpc/pc/race"
# B-07 (2026-07-26): ブラウザ偽装のローテーションを撤去し、正直な bot UA に統一。
#   ⚠ 旧 rotation (2026-05-10) は boatrace.jp の単純な UA ブロック回避策だった。
#   本変更でブロックが再発する可能性があるため、odds workflow の失敗を要監視。
#   再発時は http_utils.USER_AGENT の見直し or rotation 復活で対応 (git revert 容易)。
from http_utils import USER_AGENT  # noqa: E402
USER_AGENTS = [USER_AGENT]
OUTPUT = "data/odds/today.json"
PREVIEWS = "data/previews/today.json"
RESULTS = "data/results/today.json"
CONCURRENCY = 5
# 2026-11-11 (scrape-all 軽量化): 対象を「締切 ODDS_WINDOW_MIN 分以内の未確定レース」に絞る。
#   実測: 全 active (111-144 レース × 3 ページ) を 2 req/s で回すと 300 秒の timeout に
#   毎回かかり、kill されるため **何も書かれない** (今日の odds は 11:57 の 1 回だけ、
#   144 中 24 レース)。買い目計算で価値があるのは直近レースのオッズだけで、
#   ライブ経路は Worker の /odds-proxy が担うので、バルクは直近に限定して確実に完走させる。
ODDS_WINDOW_MIN = 60        # 締切までこの分数以内のレースを対象
ODDS_GRACE_MIN = 5          # 締切直後の数分も対象（締切オッズの確定値を拾う）
ODDS_MAX_RACES = 36         # 1 run の上限 (× 3 ページ = 108 req ≒ 60 秒)
# 内部期限。scrape_all の subprocess timeout (300s) より手前で必ず書き出す。
#   kill されると atomic write に到達せず、その run のオッズが丸ごと消えるため。
ODDS_BUDGET_SEC = int(os.environ.get("ODDS_BUDGET_SEC", "240"))
# B-07: 3.3 req/s は公営競技サイトへのアクセスとしてやや強い → 2 req/s に緩和
INTERVAL = 0.5
# 2026-05-10: 指数バックオフ retry でレート制限への耐性を向上
MAX_RETRIES = 4   # 旧 2 → 4 (合計 5 attempts)
RETRY_STATUSES = {429, 500, 502, 503, 504}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("odds")

class RateLimiter:
    def __init__(self, iv):
        self._iv = iv; self._last = 0.0; self._lock = asyncio.Lock()
    async def acquire(self):
        async with self._lock:
            w = self._iv - (time.monotonic() - self._last)
            if w > 0: await asyncio.sleep(w)
            self._last = time.monotonic()

async def fetch(session, limiter, url, retries=MAX_RETRIES):
    """boatrace.jp HTML を取得。429/5xx は指数バックオフで retry、最終失敗時は None。"""
    last_status = None
    for attempt in range(retries + 1):
        try:
            await limiter.acquire()
            ua = USER_AGENTS[attempt % len(USER_AGENTS)]
            headers = {"User-Agent": ua}
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as r:
                last_status = r.status
                if r.status == 200:
                    return await r.text()
                if r.status not in RETRY_STATUSES:
                    # 4xx (404 等) は retry しても無駄なので即座に諦める
                    log.debug("non-retryable %s for %s", r.status, url)
                    return None
                # 429/5xx は retry 対象
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            last_status = f"exc:{type(e).__name__}"
            if attempt == retries:
                log.warning("fetch failed %s: %s", url, e)
        # 指数バックオフ + jitter (0,1,2,4,8s + ±20%)
        if attempt < retries:
            delay = (2 ** attempt) * (0.8 + 0.4 * random.random())
            await asyncio.sleep(delay)
    log.warning("fetch exhausted retries (last_status=%s): %s", last_status, url)
    return None

def parse_win(html):
    soup = BeautifulSoup(html, "html.parser"); odds = {}
    for tbl in soup.select("table.is-w495")[:1]:
        for row in tbl.select("tbody tr"):
            tds = row.select("td")
            if len(tds) >= 3:
                boat = tds[0].get_text(strip=True); val = tds[2].get_text(strip=True)
                if "-" in val and "." in val: val = val.split("-")[0]
                try:
                    v = float(val)
                    if v > 0: odds[boat] = v
                except ValueError:
                    log.debug("win odds parse skip (boat=%s val=%r)", boat, val)  # PC-9
    return odds

def parse_exacta(html):
    """2連単パーサー (30 通り)
    boatrace.jp odds2tf の HTML 構造:
      tbody tr × 5 行
      各 tr に 12 td: 6 列 × (2着_td, oddsPoint_td)
      1着 は列位置で決まる
    """
    soup = BeautifulSoup(html, "html.parser")
    odds = {}
    target_table = None
    for tbl in soup.find_all("table"):
        if tbl.select("td.oddsPoint"):
            target_table = tbl
            break
    if not target_table:
        return odds
    for row in target_table.select("tbody tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) != 12:
            continue
        for col in range(6):
            base = col * 2
            try:
                ni = int(cells[base].get_text(strip=True))
                cv = cells[base + 1]
                if "oddsPoint" not in (cv.get("class") or []):
                    continue
                v = float(cv.get_text(strip=True))
                ichi = col + 1
                if 1 <= ichi <= 6 and 1 <= ni <= 6 and ichi != ni and v > 0:
                    odds["{}-{}".format(ichi, ni)] = v
            except (ValueError, TypeError):
                pass
    return odds

# F7: 3連単パーサー（120 通り）— td 構造を正確に読む
# boatrace.jp odds3t HTML 構造:
#   tbody tr × 20 行（5 つの 2着 × 4 行）
#   行は 4 行 1 グループ。先頭行のみ各列 (2着, 3着, odds) の 18 td、
#   続く 3 行は各列 (3着, odds) の 12 td（2着は先頭行から継承）
#   1着 は列位置で決まる（col 0 → 1着=1, col 1 → 1着=2, ...）
def parse_trifecta(html):
    soup = BeautifulSoup(html, "html.parser")
    odds = {}
    target_table = None
    for tbl in soup.find_all("table"):
        if tbl.select("td.oddsPoint"):
            target_table = tbl
            break
    if not target_table:
        return odds
    current_seconds = [None] * 6   # 各列の現在の 2着
    for row in target_table.select("tbody tr"):
        cells = row.find_all("td", recursive=False)
        n = len(cells)
        if n == 18:
            # グループ先頭行: 各列 (2着, 3着, odds)
            stride = 3
            offset_san = 1
            offset_odds = 2
            update_second = True
        elif n == 12:
            # グループ続行行: 各列 (3着, odds)
            stride = 2
            offset_san = 0
            offset_odds = 1
            update_second = False
        else:
            continue
        for col in range(6):
            base = col * stride
            if base + offset_odds >= n:
                break
            if update_second:
                try:
                    current_seconds[col] = int(cells[base].get_text(strip=True))
                except (ValueError, TypeError):
                    current_seconds[col] = None
            try:
                san = int(cells[base + offset_san].get_text(strip=True))
                cv = cells[base + offset_odds]
                if "oddsPoint" not in (cv.get("class") or []):
                    continue
                v = float(cv.get_text(strip=True))
                ichi = col + 1
                ni = current_seconds[col]
                if ni is None:
                    continue
                if 1 <= ichi <= 6 and 1 <= ni <= 6 and 1 <= san <= 6 \
                        and ichi != ni and ichi != san and ni != san and v > 0:
                    odds["{}-{}-{}".format(ichi, ni, san)] = v
            except (ValueError, TypeError):
                pass
    return odds

async def scrape_race(session, limiter, sid, rn, date_str):
    jcd = f"{sid:02d}"; result = {"stadium": sid, "race": rn}
    html = await fetch(session, limiter, f"{ODDS_BASE}/oddstf?rno={rn}&jcd={jcd}&hd={date_str}")
    if html:
        w = parse_win(html)
        if w: result["win"] = w
    html = await fetch(session, limiter, f"{ODDS_BASE}/odds2tf?rno={rn}&jcd={jcd}&hd={date_str}")
    if html:
        e = parse_exacta(html)
        if e: result["exacta"] = e
    # F7: 3連単
    html = await fetch(session, limiter, f"{ODDS_BASE}/odds3t?rno={rn}&jcd={jcd}&hd={date_str}")
    if html:
        t = parse_trifecta(html)
        if t: result["trifecta"] = t
    return result

def get_finished():
    """確定レース集合を取得。読み込み失敗は warn にとどめ、既存スクレイプ範囲は維持 (D-04)。"""
    finished = set()
    if not os.path.exists(PREVIEWS):
        return finished
    try:
        with open(PREVIEWS, encoding="utf-8") as f:
            for r in json.load(f).get("races", []):
                if r.get("finished"):
                    finished.add((r["stadium"], r["race"]))
    except (json.JSONDecodeError, OSError) as e:
        log.warning("get_finished: load failed (%s) — fallback to empty set", e)
    return finished

def get_finished_from_results(path: str = RESULTS, date_str: str = "") -> set:
    """data/results/today.json の確定レース集合。previews より先に results が走る
    前提で、previews 側の finished が遅れていても確定済みを対象から外せる。"""
    finished = set()
    if not os.path.exists(path):
        return finished
    try:
        with open(path, encoding="utf-8") as f:
            for r in json.load(f).get("results", []) or []:
                rdate = str(r.get("race_date") or "").replace("-", "")
                if date_str and rdate and rdate != date_str:
                    continue
                if r.get("race_technique_number"):
                    finished.add((r.get("race_stadium_number"), r.get("race_number")))
    except (json.JSONDecodeError, OSError) as e:
        log.warning("get_finished_from_results: load failed (%s) — ignored", e)
    return finished


def parse_closing_map(programs: list[dict]) -> dict:
    """programs → {(stadium, race): 締切 datetime(JST)}。race_closed_at 欠落は含めない。"""
    closing = {}
    for p in programs or []:
        s, r = p.get("race_stadium_number"), p.get("race_number")
        c = p.get("race_closed_at") or ""
        if not (s and r and c):
            continue
        try:
            closing[(s, r)] = datetime.datetime.strptime(c, "%Y-%m-%d %H:%M:%S").replace(tzinfo=JST)
        except ValueError:
            continue
    return closing


def select_odds_targets(active, closing_map, now, window_min=ODDS_WINDOW_MIN,
                        grace_min=ODDS_GRACE_MIN, max_races=ODDS_MAX_RACES):
    """未確定レースから「締切が近い順に、締切 window_min 分以内（締切後 grace_min 分まで）」
    を最大 max_races 件選ぶ。

    締切時刻が分からないレース (closing_map に無い) は、全レースに締切が無い場合のみ
    旧挙動 (全 active、締切不明は末尾) にフォールバックする。それ以外は除外する。

    Returns:
        list[(stadium, race)] 締切の近い順。
    """
    active = sorted(set(active))
    if not active:
        return []
    known = [k for k in active if k in closing_map]
    if not known:
        # 締切情報が全く無い (openapi 仕様変更等) → 旧挙動で上限だけ掛ける
        return active[:max_races]
    picked = []
    for k in known:
        mins = (closing_map[k] - now).total_seconds() / 60.0
        if -grace_min <= mins <= window_min:
            picked.append((mins, k))
    picked.sort()
    return [k for _, k in picked[:max_races]]


def _preserve_with_timestamp(reason: str) -> None:
    """2026-05-28: programs 取得失敗 / no-programs 時、既存 OUTPUT を保持しつつ
    updated_at だけ refresh する。freshness monitor 連続 stale alert 防止 +
    _meta.fetch_error にエラー記録。
    """
    existing = {}
    try:
        if os.path.exists(OUTPUT):
            with open(OUTPUT, "r", encoding="utf-8") as f:
                existing = json.load(f) or {}
    except Exception:
        existing = {}
    existing["updated_at"] = utc_iso_seconds()
    existing.setdefault("odds", [])
    existing.setdefault("_meta", {})["fetch_error"] = reason[:200]
    atomic_write_json(OUTPUT, existing)
    log.info("preserved existing %s with refreshed updated_at (reason=%s)", OUTPUT, reason[:80])


async def async_main():
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    t_run = time.monotonic()
    log.info("Fetching programs...")
    # 公式移行 Phase 2 と同じ優先順: ローカル公式 programs (JST 当日・非空) → openapi。
    #   race_closed_at で締切窓を切るため、previews / results と同じ番組表を使う。
    prog = load_local_official_programs()
    if prog:
        log.info("using official local programs (boatrace.jp 由来, %d races)",
                 len(prog.get("programs", [])))
    else:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(PROGRAMS_URL, headers={"User-Agent": USER_AGENTS[0]}, timeout=aiohttp.ClientTimeout(total=15)) as r:
                    prog = await r.json()
        except Exception as e:
            log.error("Programs fetch failed: %s", e)
            _preserve_with_timestamp("programs fetch failed: " + str(e)[:200])
            return
    programs = prog.get("programs", [])
    if not programs:
        log.info("No programs")
        _preserve_with_timestamp("no programs today")
        return
    races = set(); date_str = ""
    for p in programs:
        s, r = p.get("race_stadium_number"), p.get("race_number")
        if s and r: races.add((s, r))
        if not date_str: date_str = p.get("race_date", "").replace("-", "")
    finished = get_finished() | get_finished_from_results(RESULTS, date_str)
    active = sorted(races - finished)
    now = datetime.datetime.now(JST)
    closing_map = parse_closing_map(programs)
    targets = select_odds_targets(active, closing_map, now)
    log.info("%d total, %d finished, %d active, %d targets (close within %d min, max %d)",
             len(races), len(finished), len(active), len(targets), ODDS_WINDOW_MIN, ODDS_MAX_RACES)
    for s, r in targets[:12]:
        c = closing_map.get((s, r))
        log.info("  %02d-%02dR close=%s", s, r, c.strftime("%H:%M") if c else "?")
    existing = {}
    if os.path.exists(OUTPUT):
        try:
            with open(OUTPUT, encoding="utf-8") as f:
                prev = json.load(f)
            # FIX (2026-08-11): 日跨ぎガード。previews は old_date != date_str で
            #   既存を破棄しているが odds だけ無かったため、前日のオッズを今日のものと
            #   して保持し続けていた（実測: 本日非開催の 10 場 120 レース分が残存し、
            #   直近スクレイプが updated:0 / reliability:0.0 でも updated_at だけ新鮮）。
            #   EV / Kelly / 買い目がその古い価格で計算されるため実害が大きい。
            prev_date = str(prev.get("race_date") or "").replace("-", "")
            if prev_date and date_str and prev_date != date_str:
                log.warning("existing odds are from %s (today=%s) — discarding", prev_date, date_str)
            else:
                for r in prev.get("odds", []):
                    existing[(r["stadium"], r["race"])] = r
        except (json.JSONDecodeError, OSError) as e:
            log.warning("existing odds load failed (%s) — start from empty", e)
    # 当日のレース一覧に無いキーは持ち越さない（前日の残骸 / 別日の混入を排除）
    if races:
        stale = [k for k in existing if k not in races]
        for k in stale:
            del existing[k]
        if stale:
            log.warning("Dropped %d odds entries not in today's race list", len(stale))
    sem = asyncio.Semaphore(CONCURRENCY); limiter = RateLimiter(INTERVAL); results = {}
    deadline = t_run + ODDS_BUDGET_SEC
    skipped = 0
    # 2026-05-10: 1 task 失敗が gather を中断して全体を巻き込むのを防ぐ
    async with aiohttp.ClientSession() as session:
        async def task(s, r):
            nonlocal skipped
            try:
                async with sem:
                    # 内部期限: 期限を過ぎたら新しいレースに着手しない（締切の近い順に
                    #   並んでいるので、切られるのは最も遠いレースから）。
                    if time.monotonic() >= deadline:
                        skipped += 1
                        return
                    results[(s, r)] = await scrape_race(session, limiter, s, r, date_str)
            except Exception as e:   # noqa: BLE001
                # 単一レースの予期せぬ例外で gather 全体を死なせない
                log.warning("scrape_race(%s, %s) crashed: %s: %s", s, r, type(e).__name__, e)
                results[(s, r)] = {"stadium": s, "race": r, "_error": str(e)}
        t0 = time.monotonic()
        # return_exceptions=True で 1 タスクの未捕捉例外が gather を破壊しない
        #   list 順 = 締切の近い順で起動されるため、semaphore 待ちも近い順に解ける。
        await asyncio.gather(*[task(s, r) for s, r in targets], return_exceptions=True)
        elapsed = time.monotonic() - t0
    # D-03: スクレイプ失敗（win も exacta も無し）の場合は既存値を保持し、
    #        プレースホルダ {stadium,race} で上書きしない
    updated = 0
    failed = 0
    for key, data in results.items():
        # F7: trifecta も判定対象に追加
        if data.get("win") or data.get("exacta") or data.get("trifecta"):
            existing[key] = data
            updated += 1
        else:
            failed += 1
    for s, r in sorted(races):
        if (s, r) not in existing:
            existing[(s, r)] = {"stadium": s, "race": r}
    # 2026-05-10: reliability_score を出力 JSON に記録（PWA 側で stale 判定に活用可能）
    attempted = len(targets) - skipped
    reliability = (updated / attempted) if attempted else 0.0
    # D-01: atomic write — 失敗 race も含めて updated_at を更新（PWA に "scrape は走った" を伝える）
    atomic_write_json(OUTPUT, {
        "updated_at": utc_iso_seconds(),
        # FIX (2026-08-11): 出力に対象日を持たせる。これが無かったため次回起動時に
        #   日跨ぎ判定ができず、前日のオッズを今日のものとして持ち越していた。
        "race_date": date_str,
        "scrape_stats": {
            "total": attempted,
            "active": len(active),
            "targets": len(targets),
            "skipped": skipped,
            "window_min": ODDS_WINDOW_MIN,
            "updated": updated,
            "failed": failed,
            "reliability": round(reliability, 3),
            "elapsed_sec": round(elapsed, 1),
        },
        "odds": [existing[k] for k in sorted(existing.keys())],
    })
    log.info("Done! %d/%d scraped (%d failed, %d skipped by budget, reliability=%.1f%%) in %.1fs",
             updated, attempted, failed, skipped, reliability * 100, elapsed)
    # 2026-05-10: 全レース失敗のときだけ workflow を red に (Actions 監視で気付ける)
    if attempted and updated == 0:
        log.error("ALL races failed — likely rate limited / boatrace.jp issue")
        sys.exit(1)

def main(): asyncio.run(async_main())
if __name__ == "__main__": main()
