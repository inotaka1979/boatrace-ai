#!/usr/bin/env python3
"""
BoatRace Oracle - スマート展示情報スクレイパー v2

締切時刻ベースの優先度スクレイピング:
  - 締切30分前〜締切: 展示データが出ているはず → 優先取得
  - 締切後〜+10分: 結果が出ているはず → 結果取得
  - それ以外: スキップ

RPi5 cronから2-3分間隔で実行。1回あたり6-12レースのみ取得。
asyncio/aiohttpで5並列フェッチ。
"""

import asyncio
import json
import os
import sys
import time
import logging
from datetime import datetime, timedelta, timezone

import aiohttp
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # P2 D-01
from time_utils import utc_iso_seconds  # P2 D-02 / D-10

# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------
PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
BEFOREINFO_URL = "https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno={rno}&jcd={jcd:02d}&hd={date}"
RESULTS_URL = "https://www.boatrace.jp/owpc/pc/race/raceresult?rno={rno}&jcd={jcd:02d}&hd={date}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

OUTPUT = "data/previews/today.json"
SCRAPE_STATE = "data/previews/.scrape_state.json"  # スクレイプ状態追跡 (gitignore推奨)
PROGRAMS_CACHE = "data/previews/.programs_cache.json"  # OpenAPI 障害時のフォールバック
CONCURRENCY = 5          # 同時リクエスト数
INTERVAL = 0.3           # リクエスト間最小間隔(秒)
REQUEST_TIMEOUT = 15     # 個別リクエストタイムアウト(秒)
MAX_RETRIES = 2          # リトライ回数

# スクレイプ対象の時間窓 (分)
WINDOW_BEFORE_CLOSE = 35   # 締切N分前から展示取得対象
WINDOW_AFTER_CLOSE = 15    # 締切後N分まで結果取得対象
STALE_THRESHOLD = 300      # 展示データがN秒以上古ければ再取得 (5分)

JST = timezone(timedelta(hours=9))

# ---------------------------------------------------------------------------
# ログ設定
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("smart_scraper")


# ---------------------------------------------------------------------------
# Phase 1: プログラムAPI → 締切時刻マップ
# ---------------------------------------------------------------------------
async def fetch_programs(session: aiohttp.ClientSession):
    """Open APIから本日の番組データ (締切時刻含む) を取得し、成功時はキャッシュも更新"""
    async with session.get(PROGRAMS_URL, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=15)) as resp:
        data = await resp.json()
    # 成功時はキャッシュを更新（DNS 障害等で次回 fetch が失敗した時のフォールバック）
    try:
        atomic_write_json(PROGRAMS_CACHE, data)
    except Exception as e:
        log.warning("programs cache write failed: %s", e)
    return data


def _preserve_with_timestamp(reason: str) -> None:
    """2026-05-28: programs 取得完全失敗時、既存 OUTPUT を保持しつつ updated_at
    だけ refresh する。freshness monitor の連続 stale alert を防ぐ + 何が
    起きたかを _meta.fetch_error に記録。
    """
    existing = {}
    try:
        if os.path.exists(OUTPUT):
            with open(OUTPUT, "r", encoding="utf-8") as f:
                existing = json.load(f) or {}
    except Exception:
        existing = {}
    existing["updated_at"] = utc_iso_seconds()
    existing.setdefault("previews", [])
    existing.setdefault("_meta", {})["fetch_error"] = reason[:200]
    atomic_write_json(OUTPUT, existing)
    log.info("preserved existing %s with refreshed updated_at (reason=%s)", OUTPUT, reason[:80])


def _load_programs_cache():
    """fetch_programs 失敗時のフォールバック: ディスクキャッシュから programs を読込。
    キャッシュが今日 (JST) のデータでなければ None を返す。
    """
    if not os.path.exists(PROGRAMS_CACHE):
        return None
    try:
        with open(PROGRAMS_CACHE, "r") as f:
            data = json.load(f)
    except Exception as e:
        log.warning("programs cache read failed: %s", e)
        return None
    today_jst = datetime.now(JST).strftime("%Y-%m-%d")
    programs = data.get("programs", [])
    if not programs:
        return None
    cached_date = (programs[0].get("race_date") or "")
    if cached_date != today_jst:
        log.info("programs cache is stale (%s != %s)", cached_date, today_jst)
        return None
    return data


def parse_closing_times(programs_json):
    """
    programs APIから (stadium, race) -> closing_datetime のマップを構築。
    race_closed_at: "2026-04-06 15:18:00" (JST)
    """
    closing = {}
    programs = programs_json.get("programs", [])
    date_str = ""
    for p in programs:
        sid = p["race_stadium_number"]
        rno = p["race_number"]
        closed_at = p.get("race_closed_at", "")
        if not date_str and p.get("race_date"):
            date_str = p["race_date"].replace("-", "")
        if closed_at:
            try:
                dt = datetime.strptime(closed_at, "%Y-%m-%d %H:%M:%S").replace(tzinfo=JST)
                closing[(sid, rno)] = dt
            except ValueError:
                pass
    return closing, date_str, programs


# ---------------------------------------------------------------------------
# Phase 2: 対象レース選定
# ---------------------------------------------------------------------------
class RaceAction:
    """各レースに対するアクション"""
    SKIP = "skip"
    FETCH_EXHIBITION = "exhibition"
    FETCH_RESULT = "result"
    FETCH_BOTH = "both"         # 展示+結果 (締切直後)


def select_target_races(closing_map, existing_data, now=None):
    """
    現在時刻と締切時刻から、スクレイプ対象レースを選定。

    Returns:
        list of (stadium, race, action, priority)
        priority: 小さいほど優先 (締切が近いほど高優先)
    """
    if now is None:
        now = datetime.now(JST)

    targets = []
    for (sid, rno), close_dt in closing_map.items():
        key = (sid, rno)
        existing = existing_data.get(key, {})
        is_finished = existing.get("finished", False)
        has_exhibition = bool(existing.get("boats"))
        last_scraped = existing.get("_scraped_at", 0)
        is_stale = (time.time() - last_scraped) > STALE_THRESHOLD if last_scraped else True

        minutes_to_close = (close_dt - now).total_seconds() / 60

        # 既に結果確定済み → スキップ
        if is_finished:
            continue

        # 締切35分前〜締切: 展示データ取得対象
        if -WINDOW_AFTER_CLOSE <= minutes_to_close <= WINDOW_BEFORE_CLOSE:
            if minutes_to_close > 0:
                # 締切前: 展示取得
                if has_exhibition and not is_stale:
                    continue  # 新鮮な展示データあり → スキップ
                action = RaceAction.FETCH_EXHIBITION
                priority = minutes_to_close  # 締切が近いほど優先
            else:
                # 締切後: 結果取得 (展示もまだなければ両方)
                if not has_exhibition:
                    action = RaceAction.FETCH_BOTH
                else:
                    action = RaceAction.FETCH_RESULT
                priority = -minutes_to_close  # 締切直後が最優先
            targets.append((sid, rno, action, priority))

        # 締切35分以上前で展示データなし → 低優先で取得試行 (早期レース)
        elif minutes_to_close > WINDOW_BEFORE_CLOSE and minutes_to_close <= 60:
            if not has_exhibition:
                targets.append((sid, rno, RaceAction.FETCH_EXHIBITION, 100 + minutes_to_close))

        # F-CATCHUP: 締切から15分以上経過したが is_finished が False のレースを救済
        # ダウンタイム後の back-fill 用。最大 25 時間前まで（当日全レース + 余裕）。
        # 旧値 -360 (6h) は半日 DNS 障害から回復した際に午前のレース結果を取りこぼしていた。
        elif minutes_to_close < -WINDOW_AFTER_CLOSE:
            if not is_finished and minutes_to_close >= -1500:
                targets.append((sid, rno, RaceAction.FETCH_RESULT, 200 + (-minutes_to_close)))

    # 優先度順にソート
    targets.sort(key=lambda x: x[3])
    return targets


# ---------------------------------------------------------------------------
# Phase 3: HTMLパーサー (バグ修正版)
# ---------------------------------------------------------------------------
def parse_beforeinfo(html):
    """
    公式サイトの直前情報ページから展示データを取得。
    修正: 1艇=4行 (メイン/進入/ST/着順) を正しく処理。
    修正: スタート展示テーブルの艇番を .table1_boatImage1Number から取得。
    """
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.select("table")
    if len(tables) < 3:
        return None

    boats = {}

    # テーブル[1] (is-w748): 出走表+展示タイム
    # 1艇 = 4行: [メイン(10cells), 進入(2cells), ST行(3cells), 着順(2cells)]
    # メイン行: [枠 rs4, 写真 rs4, 選手名 rs4, 体重 rs2, 展示タイム rs4, チルト rs4,
    #            プロペラ rs4, 部品交換 rs4, 前走"R", 前走着順]
    # ST 行 (メイン+2): [調整重量 rs2, "ST", ST値]
    t1 = tables[1]
    all_rows = t1.select("tr")
    main_indices = []   # メイン行のインデックス
    for ri, row in enumerate(all_rows):
        tds = row.select("td")
        if len(tds) < 5:
            continue
        text0 = tds[0].get_text(strip=True)
        if text0 in ("1", "2", "3", "4", "5", "6"):
            main_indices.append((ri, int(text0)))

    for main_idx, bn in main_indices:
        row = all_rows[main_idx]
        tds = row.select("td")
        et = 0.0
        tilt = 0.0
        propeller = ""        # 持ちペラ "K" 等のマーク（無印=新ペラ）
        parts_replaced = ""   # "ペラ", "電気" 等の整備内容
        adj_weight = 0.0      # 調整重量 (kg)
        try:
            t_et = tds[4].get_text(strip=True) if len(tds) > 4 else ""
            if t_et:
                et = float(t_et)
        except (ValueError, IndexError):
            pass
        try:
            t_tilt = tds[5].get_text(strip=True) if len(tds) > 5 else ""
            if t_tilt:
                tilt = float(t_tilt)
        except (ValueError, IndexError):
            pass
        try:
            propeller = tds[6].get_text(strip=True) if len(tds) > 6 else ""
        except IndexError:
            pass
        try:
            parts_replaced = tds[7].get_text(strip=True) if len(tds) > 7 else ""
        except IndexError:
            pass
        # 調整重量: メイン行 +2 行目の td[0]（rowspan=2）
        if main_idx + 2 < len(all_rows):
            st_row = all_rows[main_idx + 2]
            st_tds = st_row.select("td")
            if st_tds:
                try:
                    aw_text = st_tds[0].get_text(strip=True).replace("kg", "")
                    if aw_text:
                        adj_weight = float(aw_text)
                except (ValueError, IndexError):
                    pass

        boats[bn] = {
            "exhibition_time": et,
            "tilt": tilt,
            "propeller": propeller,
            "parts_replaced": parts_replaced,
            "adjust_weight": adj_weight,
            "start_timing": None,
            "course": bn,  # デフォルトは枠番=コース
        }

    if not boats:
        return None

    # テーブル[2] (is-w238): スタート展示
    # Row 0: "スタート展示" (ヘッダ)
    # Row 1: "コース","並び","ST" (ヘッダ)
    # Row 2-7: 各コース (上から1コース〜6コース)
    #   - テキスト: "1.11" (コース1=艇1, ST 0.11) / "5F.02" (コース5=艇5, フライング, ST -0.02)
    #   - .table1_boatImage1Number: 艇番
    t2 = tables[2]
    st_rows = t2.select("tr")[2:]  # ヘッダ2行をスキップ

    # course_order[i] = (boat_number, st_value) for course i+1
    for course_idx, row in enumerate(st_rows[:6]):
        course_num = course_idx + 1

        # 艇番を取得: span.table1_boatImage1Number
        bn_span = row.select_one(".table1_boatImage1Number")
        text = row.get_text(strip=True)

        if not text or "." not in text:
            continue

        # テキストからST値をパース: "3.08" or "5F.02"
        is_f = "F" in text
        clean = text.replace("F", "")
        parts = clean.split(".")
        if len(parts) != 2:
            continue

        try:
            # 先頭数字は艇番 (bn_spanのフォールバック)
            boat_from_text = int(parts[0])
            st_val = float("0." + parts[1])
            if is_f:
                st_val = -st_val
        except (ValueError, IndexError):
            continue

        # 艇番: span要素優先、なければテキストから
        if bn_span:
            try:
                boat_num = int(bn_span.get_text(strip=True))
            except ValueError:
                boat_num = boat_from_text
        else:
            boat_num = boat_from_text

        # 対応する艇にコースとSTを設定
        if boat_num in boats:
            boats[boat_num]["course"] = course_num
            boats[boat_num]["start_timing"] = st_val

    # 有効性チェック: 少なくとも1艇に展示タイムがある
    has_data = any(b["exhibition_time"] > 0 for b in boats.values())
    if not has_data:
        return None

    return boats


def parse_result(html):
    """
    公式サイトのレース結果ページから着順・払戻を取得。
    修正: .is-payout ではなく Table[3] (is-w495の3番目) を使用。
    修正: rowspan対応 — 勝式セルが2行分跨ぐ場合の処理。
    """
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.select("table")
    if len(tables) < 4:
        return None

    result = {"places": [], "technique": None, "payouts": {}}

    # テーブル[1] (is-w495 1番目): 着順テーブル
    # Row 0: ヘッダ (着, 枠, ボートレーサー, レースタイム)
    # Row 1-6: 着順
    t_places = tables[1]
    for row in t_places.select("tr")[1:]:  # ヘッダスキップ
        tds = row.select("td")
        if len(tds) < 2:
            continue
        try:
            place_text = tds[0].get_text(strip=True)
            # "１" → 1 (全角数字対応)
            place = int(place_text.translate(str.maketrans("１２３４５６", "123456")))
            boat_text = tds[1].get_text(strip=True)
            boat = int(boat_text)
            result["places"].append({"place": place, "boat": boat})
        except (ValueError, IndexError):
            continue

    # テーブル[3] (is-w495 3番目): 払戻テーブル
    # Row構造: 勝式(rowspan=2) | 組番 | 払戻金 | 人気
    #          (空行)
    # 拡連複は rowspan=5
    if len(tables) >= 4:
        t_payout = tables[3]
        current_bet_type = None
        for row in t_payout.select("tr")[1:]:  # ヘッダスキップ
            tds = row.select("td,th")
            texts = [td.get_text(strip=True) for td in tds]

            if not any(texts):
                continue  # 空行スキップ

            # 勝式セルがある行 (4 cells) vs 継続行 (3 cells)
            if len(tds) >= 4 and texts[0]:
                current_bet_type = texts[0]
                combo = texts[1]
                payout_text = texts[2]
            elif len(tds) >= 3 and current_bet_type:
                combo = texts[0]
                payout_text = texts[1]
            else:
                continue

            if not combo or not payout_text:
                continue

            # 払戻金パース: "¥3,590" → 3590
            try:
                payout = int(payout_text.replace(",", "").replace("¥", "").replace("円", "").strip())
            except ValueError:
                continue

            type_key = None
            if "3連単" in current_bet_type:
                type_key = "trifecta"
            elif "3連複" in current_bet_type:
                type_key = "trio"
            elif "2連単" in current_bet_type:
                type_key = "exacta"
            elif "2連複" in current_bet_type:
                type_key = "quinella"
            elif "拡連複" in current_bet_type:
                type_key = "wide"
            elif "単勝" in current_bet_type:
                type_key = "win"
            elif "複勝" in current_bet_type:
                type_key = "place"

            if type_key:
                if type_key not in result["payouts"]:
                    result["payouts"][type_key] = []
                result["payouts"][type_key].append({"combination": combo, "payout": payout})

    # テーブル[5] (is-w243): 決まり手
    if len(tables) >= 6:
        t_tech = tables[5]
        tech_rows = t_tech.select("tr")
        if len(tech_rows) >= 2:
            result["technique"] = tech_rows[1].get_text(strip=True)

    if not result["places"]:
        return None
    return result


# ---------------------------------------------------------------------------
# Phase 4: 非同期フェッチ
# ---------------------------------------------------------------------------
class RateLimiter:
    """最小間隔を保証するレートリミッター"""
    def __init__(self, min_interval: float):
        self._min_interval = min_interval
        self._last_request = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self):
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_request
            if elapsed < self._min_interval:
                await asyncio.sleep(self._min_interval - elapsed)
            self._last_request = time.monotonic()


async def fetch_with_retry(session, url, limiter, retries=MAX_RETRIES):
    """リトライ付きHTTPフェッチ"""
    for attempt in range(retries + 1):
        try:
            await limiter.acquire()
            timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)
            async with session.get(url, headers=HEADERS, timeout=timeout) as resp:
                if resp.status == 200:
                    return await resp.text()
                elif resp.status == 404:
                    return None  # ページ未公開
                else:
                    log.warning("HTTP %d for %s (attempt %d)", resp.status, url, attempt + 1)
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            log.warning("Fetch error %s (attempt %d): %s", url, attempt + 1, e)
        if attempt < retries:
            await asyncio.sleep(1.0 * (attempt + 1))
    return None


async def scrape_race(session, limiter, sid, rno, date_str, action):
    """1レースの展示/結果を取得"""
    result_data = {
        "stadium": sid,
        "race": rno,
        "boats": {},
        "finished": False,
        "result": None,
        "_scraped_at": time.time(),
    }

    # 展示情報取得
    if action in (RaceAction.FETCH_EXHIBITION, RaceAction.FETCH_BOTH):
        url = BEFOREINFO_URL.format(rno=rno, jcd=sid, date=date_str)
        html = await fetch_with_retry(session, url, limiter)
        if html:
            boats = parse_beforeinfo(html)
            if boats:
                for bn, data in boats.items():
                    result_data["boats"][str(bn)] = {
                        "racer_exhibition_time": data["exhibition_time"],
                        "racer_start_timing": data["start_timing"],
                        "racer_tilt_adjustment": data["tilt"],
                        "racer_course_number": data["course"],
                        # F12: 追加フィールド（公式 beforeinfo の取れる項目）
                        "racer_propeller": data.get("propeller", ""),
                        "racer_parts_replaced": data.get("parts_replaced", ""),
                        "racer_adjust_weight": data.get("adjust_weight", 0.0),
                    }

    # 結果取得
    if action in (RaceAction.FETCH_RESULT, RaceAction.FETCH_BOTH):
        url = RESULTS_URL.format(rno=rno, jcd=sid, date=date_str)
        html = await fetch_with_retry(session, url, limiter)
        if html:
            res = parse_result(html)
            if res and res["places"]:
                result_data["finished"] = True
                result_data["result"] = res

    return result_data


async def scrape_batch(targets, date_str):
    """対象レースを並列スクレイプ。

    2026-05-10: scrape_odds_fast.py と同じ silent failure を撲滅。
    asyncio.gather(*, return_exceptions=True) と per-task try/except で、
    1 レースの未捕捉例外が batch 全体を死亡させないようにする。
    """
    semaphore = asyncio.Semaphore(CONCURRENCY)
    limiter = RateLimiter(INTERVAL)
    results = {}

    async with aiohttp.ClientSession() as session:

        async def _task(sid, rno, action):
            try:
                async with semaphore:
                    data = await scrape_race(session, limiter, sid, rno, date_str, action)
                    results[(sid, rno)] = data
            except Exception as e:   # noqa: BLE001
                # 単一レースの予期せぬ例外で gather 全体を死なせない
                log.warning("scrape_race(%s, %s, %s) crashed: %s: %s",
                            sid, rno, action, type(e).__name__, e)
                results[(sid, rno)] = None

        tasks = [_task(sid, rno, action) for sid, rno, action, _ in targets]
        await asyncio.gather(*tasks, return_exceptions=True)

    return results


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------
async def async_main():
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    now = datetime.now(JST)
    log.info("Smart scraper start: %s", now.strftime("%H:%M:%S JST"))

    # Phase 1: 番組データ取得 → 締切時刻マップ
    async with aiohttp.ClientSession() as session:
        prog = None
        try:
            prog = await fetch_programs(session)
        except Exception as e:
            log.error("Failed to fetch programs: %s", e)
            # OpenAPI 障害時はディスクキャッシュにフォールバック → DNS が復旧する間も
            # 午前/午後のレースの結果取得を継続できる
            prog = _load_programs_cache()
            if prog:
                log.info("using programs cache from disk (OpenAPI unreachable)")
            else:
                # 2026-05-28: programs 取得完全失敗時も updated_at を refresh する
                #   (旧版は早期 return で何も書かず、ローカル data が 13 時間以上
                #   止まる事故が発生 → freshness monitor 連続 alert)。
                #   既存 file を保持しつつ timestamp だけ更新、_meta.fetch_error
                #   にエラーを記録。
                _preserve_with_timestamp("programs fetch failed: " + str(e)[:200])
                return

    closing_map, date_str, programs = parse_closing_times(prog)
    if not closing_map:
        log.info("No programs today")
        atomic_write_json(OUTPUT, {"updated_at": utc_iso_seconds(), "races": []})  # P2 D-01/D-02
        return

    if not date_str:
        date_str = now.strftime("%Y%m%d")

    log.info("Date: %s, %d stadiums, %d total races",
             date_str, len(set(s for s, _ in closing_map)), len(closing_map))

    # スクレイプ状態読み込み (タイムスタンプ追跡)
    scrape_state = _load_scrape_state(date_str)

    # 既存データ読み込み (差分更新)
    existing = {}
    if os.path.exists(OUTPUT):
        try:
            with open(OUTPUT, "r") as f:
                old = json.load(f)
            old_date = old.get("race_date", "")
            if old_date == date_str:
                for r in old.get("races", []):
                    key = (r["stadium"], r["race"])
                    # スクレイプ状態からタイムスタンプを復元
                    state_key = f"{r['stadium']}-{r['race']}"
                    if state_key in scrape_state:
                        r["_scraped_at"] = scrape_state[state_key]
                    existing[key] = r
            else:
                log.info("Date changed (%s -> %s), discarding old data", old_date, date_str)
                scrape_state = {}
        except Exception as e:
            # PC-9: silent fail を排除し、データ整合性問題を観測可能に
            log.warning("existing previews load failed (continuing with empty state): %s", e)
            existing = {}
            scrape_state = {}

    # Phase 2: 対象レース選定
    targets = select_target_races(closing_map, existing, now)

    if not targets:
        log.info("No races need scraping right now")
        # 既存データのタイムスタンプだけ更新して出力
        _write_output(existing, closing_map, date_str)
        return

    actions_summary = {}
    for _, _, action, _ in targets:
        actions_summary[action] = actions_summary.get(action, 0) + 1
    log.info("Targets: %d races (%s)",
             len(targets),
             ", ".join(f"{k}={v}" for k, v in actions_summary.items()))

    for sid, rno, action, prio in targets[:20]:
        close_dt = closing_map.get((sid, rno))
        close_str = close_dt.strftime("%H:%M") if close_dt else "?"
        log.info("  %02d-%02dR [%s] close=%s prio=%.0f", sid, rno, action, close_str, prio)

    # Phase 3 & 4: 並列スクレイプ
    t0 = time.monotonic()
    scraped = await scrape_batch(targets, date_str)
    elapsed = time.monotonic() - t0

    # 結果マージ
    updated_count = 0
    for (sid, rno), data in scraped.items():
        key = (sid, rno)
        old = existing.get(key, {})

        # 展示データ: 新データがあれば上書き、なければ既存を維持
        if data.get("boats"):
            existing[key] = data
            updated_count += 1
            status = "exhibition"
            if data.get("finished"):
                status = "finished"
            log.info("  %02d-%02dR: %s", sid, rno, status)
        elif data.get("finished"):
            # 結果のみ取得成功 → 既存の展示データを保持
            merged = dict(old)
            merged["finished"] = True
            merged["result"] = data["result"]
            merged["_scraped_at"] = data["_scraped_at"]
            existing[key] = merged
            updated_count += 1
            log.info("  %02d-%02dR: result only", sid, rno)
        else:
            # 取得失敗 → 既存データ維持
            if key not in existing:
                existing[key] = data  # 空データでも登録
            log.debug("  %02d-%02dR: no data", sid, rno)

    log.info("Scraped %d races in %.1fs, updated %d", len(targets), elapsed, updated_count)

    # スクレイプ状態保存
    for key, race in existing.items():
        if race.get("_scraped_at"):
            state_key = f"{key[0]}-{key[1]}"
            scrape_state[state_key] = race["_scraped_at"]
    _save_scrape_state(scrape_state, date_str)

    # 出力
    _write_output(existing, closing_map, date_str)


def _load_scrape_state(date_str):
    """スクレイプタイムスタンプ状態を読み込み"""
    if not os.path.exists(SCRAPE_STATE):
        return {}
    try:
        with open(SCRAPE_STATE, "r") as f:
            state = json.load(f)
        if state.get("date") != date_str:
            return {}
        return state.get("timestamps", {})
    except Exception as e:
        # PC-9: scrape_state 破損を観測可能に
        log.warning("scrape_state load failed (using empty state): %s", e)
        return {}


def _save_scrape_state(timestamps, date_str):
    """スクレイプタイムスタンプ状態を保存 (P2 D-01: atomic)"""
    try:
        atomic_write_json(SCRAPE_STATE, {"date": date_str, "timestamps": timestamps})
    except Exception as e:
        log.warning("Failed to save scrape state: %s", e)


def _write_output(existing, closing_map, date_str):
    """既存データ + 全レースを統合してJSON出力"""
    # closing_mapに含まれる全レースを出力 (データがないレースも空で出力)
    all_races = []
    for (sid, rno) in sorted(closing_map.keys()):
        key = (sid, rno)
        if key in existing:
            race = dict(existing[key])
        else:
            race = {
                "stadium": sid,
                "race": rno,
                "boats": {},
                "finished": False,
                "result": None,
            }

        # 内部用フィールドを除去
        race.pop("_scraped_at", None)

        # stadium/race フィールドを確実に設定
        race["stadium"] = sid
        race["race"] = rno
        all_races.append(race)

    output = {
        "updated_at": utc_iso_seconds(),  # P2 D-02
        "race_date": date_str,
        "races": all_races,
    }

    atomic_write_json(OUTPUT, output)  # P2 D-01

    finished = sum(1 for r in all_races if r.get("finished"))
    previews = sum(1 for r in all_races if r.get("boats"))
    total = len(all_races)
    log.info("Output: %d/%d previews, %d/%d finished -> %s", previews, total, finished, total, OUTPUT)


def main():
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
