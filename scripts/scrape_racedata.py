#!/usr/bin/env python3
"""
BoatRace Oracle - 今節成績・部品交換・選手写真 取得スクリプト
GitHub Actionsから1日2回実行される

処理:
1. Open API programs/today.json → 本日の開催場を特定
2. 各場の出走表ページ(racelist) → 今節成績を取得
3. 各場の直前情報ページ(beforeinfo) → 部品交換情報を取得
4. 出走選手の写真をダウンロード（未取得分のみ）
"""

import json, os, sys, time, datetime, re
from urllib.request import urlopen, Request
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # P2 D-01
from time_utils import utc_iso_seconds, jst_now  # P2 D-02 / FIX: date_str fallback
from http_utils import fetch_text, fetch_json, DEFAULT_HEADERS  # PC-1

PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json"
BASE_URL = "https://www.boatrace.jp/owpc/pc/race"
PHOTO_URL = "https://www.boatrace.jp/racerphoto/{}.jpg"
HEADERS = DEFAULT_HEADERS  # PC-1: 共通 UA を再エクスポート（写真 DL の urlopen 用）
INTERVAL = 3
OUTPUT_RACEDATA = "data/racedata/today.json"
PHOTO_DIR = "data/photos"


def fetch_html(url: str) -> str:
    """URL から HTML を取得（http_utils.fetch_text の alias）。"""
    return fetch_text(url)

_ZEN2HAN_DAY = str.maketrans("０１２３４５６７８９", "0123456789")


def _extract_day_label(soup) -> str | None:
    """出走表ページのタブから「本日が今節の何日目か」のラベルを取得する。

    boatrace.jp racelist のタブ構造:
      <li class="is-active2"><span class="tab2_inner">6月27日<span>３日目</span></span></li>
    アクティブ(is-active2)タブの内側 span が当日のラベル（初日 / N日目 / 最終日）。
    全角数字は半角化して返す。取得できなければ None。
    """
    try:
        active = soup.select_one("li.is-active2 .tab2_inner span")
        if active is None:
            # フォールバック: is-active2 直下テキストから「初日/N日目/最終日」を拾う
            active = soup.select_one("li.is-active2")
        if active is None:
            return None
        txt = active.get_text(" ", strip=True).translate(_ZEN2HAN_DAY)
        import re as _re
        m = _re.search(r"(初日|最終日|\d+日目)", txt)
        return m.group(1) if m else None
    except Exception:
        return None


def scrape_racelist(jcd: str, rno: int, date_str: str) -> tuple[list[dict], str | None]:
    """出走表ページから今節成績（直近 6 艇分）と「◯日目」ラベルを取得する。

    boatrace.jp の HTML 構造（2026 時点）:
      - tbody.is-fs12 = 1 名分の 4 行 group
      - tr[0]: 枠/写真/名前/F.L/勝率等 + レースNo (今節各日)
      - tr[1]: 進入コース (今節各日)
      - tr[2]: スタートタイミング (今節各日)
      - tr[3]: 着順 (全角数字、今節各日)  ← これを取りたい

    着順が全角数字 (２, ５ 等) で入っているので半角に変換。
    特殊コード (転覆/失格 等) は記号文字なので位置 0 にマップ（無効扱い）。

    Args:
        jcd: 場番号 2 桁文字列 (例 "01")
        rno: レース番号 (1..12)
        date_str: 日付 YYYYMMDD 文字列

    Returns:
        艇番順の dict 配列。各 dict は current_series_results / summary を含む。
        失敗時は空リスト。
    """
    url = f"{BASE_URL}/racelist?rno={rno}&jcd={jcd}&hd={date_str}"
    try:
        html = fetch_html(url)
        soup = BeautifulSoup(html, "html.parser")
        boats = []

        # 全角→半角 変換テーブル
        zen2han = str.maketrans("０１２３４５６７８９", "0123456789")

        for i, tbody in enumerate(soup.select("tbody.is-fs12"), 1):
            if i > 6: break
            trs = tbody.find_all("tr", recursive=False)
            # tr[0] td[9..]: レース番号 + 枠番(class is-boatColor{N})
            # tr[1]: 進入コース、tr[2]: ST、tr[3]: 着順（td index で tr[0] と対応）
            tr0 = trs[0].find_all("td", recursive=False) if len(trs) >= 1 else []
            tr1 = trs[1].find_all("td", recursive=False) if len(trs) >= 2 else []
            tr2 = trs[2].find_all("td", recursive=False) if len(trs) >= 3 else []
            tr3 = trs[3].find_all("td", recursive=False) if len(trs) >= 4 else []
            # tr[0] には先頭に枠番/写真/名前/勝率等の 9 cells があり、
            # td[9..] が今節成績の cell。tr[1-3] は td[0..] が今節成績 cell。
            # tr[0] td[9+j] と tr[1-3] td[j] が対応。
            n = max(len(tr1), len(tr2), len(tr3))
            results: list = []
            for j in range(n):
                ct = tr1[j].get_text(strip=True).translate(zen2han) if j < len(tr1) else ""
                st = tr2[j].get_text(strip=True) if j < len(tr2) else ""
                pt = tr3[j].get_text(strip=True).translate(zen2han) if j < len(tr3) else ""
                if (not ct or ct == "\xa0") and (not st or st == "\xa0") and (not pt or pt == "\xa0"):
                    results.append(None)
                    continue
                place = None
                try:
                    pv = int(pt)
                    if 1 <= pv <= 6: place = pv
                except ValueError:
                    pass
                course = None
                try:
                    cv = int(ct)
                    if 1 <= cv <= 6: course = cv
                except ValueError:
                    pass
                # 枠番 = tr[0] td[9+j] の is-boatColor{N} class から抽出
                waku = None
                tr0_idx = 9 + j
                if tr0_idx < len(tr0):
                    cls_list = tr0[tr0_idx].get("class", []) or []
                    for cls in cls_list:
                        if cls.startswith("is-boatColor"):
                            try:
                                wv = int(cls.replace("is-boatColor", ""))
                                if 1 <= wv <= 6: waku = wv
                            except ValueError:
                                pass
                            break
                results.append({"waku": waku, "course": course, "place": place, "st": st or None})

            places = [r["place"] for r in results if r and r.get("place")]
            avg = sum(places) / len(places) if places else 0
            wins = places.count(1)
            top2 = sum(1 for p in places if p <= 2)
            top3 = sum(1 for p in places if p <= 3)

            boats.append({
                "boat_number": i,
                "current_series_results": results,   # [{waku,course,place,st} | null, ...]
                "current_series_summary": {
                    "races": len(places),
                    "avg_place": round(avg, 2),
                    "win": wins,
                    "top2": top2,
                    "top3": top3
                }
            })

        return boats, _extract_day_label(soup)
    except Exception as e:
        print(f"  Error scraping racelist: {e}")
        return [], None

def scrape_beforeinfo(jcd: str, rno: int, date_str: str) -> dict[int, list[str]]:
    """直前情報ページから艇番→部品交換タグ配列のマップを取得する。"""
    url = f"{BASE_URL}/beforeinfo?rno={rno}&jcd={jcd}&hd={date_str}"
    try:
        html = fetch_html(url)
        soup = BeautifulSoup(html, "html.parser")
        parts = {}

        for note in soup.select(".table1_noteBody"):
            text = note.get_text(strip=True)
            if text and text != "\xa0":
                parent_row = note.find_parent("tr")
                if parent_row:
                    boat_td = parent_row.select_one(".table1_boatImage1Number")
                    if boat_td:
                        bn = boat_td.get_text(strip=True)
                        try:
                            parts[int(bn)] = text.split()
                        except ValueError:
                            pass

        return parts
    except Exception as e:
        print(f"  Error scraping beforeinfo: {e}")
        return {}

def _is_cached(racer_number: int | str) -> bool:
    """選手写真が既にローカルにある（>500B）か。"""
    path = f"{PHOTO_DIR}/{racer_number}.jpg"
    return os.path.exists(path) and os.path.getsize(path) > 500


def _download_one_photo(racer_number: int | str, timeout: int = 10) -> tuple[int | str, bool, str | None]:
    """1 選手分の写真を fetch。重複 cache check 含む。リトライ無し（高速失敗）。"""
    path = f"{PHOTO_DIR}/{racer_number}.jpg"
    if _is_cached(racer_number):
        return racer_number, True, None
    url = PHOTO_URL.format(racer_number)
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=timeout) as r:
            if r.status != 200:
                return racer_number, False, f"status {r.status}"
            data = r.read()
            if len(data) <= 500:
                return racer_number, False, f"too small ({len(data)}b)"
            os.makedirs(PHOTO_DIR, exist_ok=True)
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            return racer_number, True, None
    except Exception as e:
        return racer_number, False, str(e)[:60]


def download_photo(racer_number: int | str, attempts: int = 2) -> bool:
    """逐次版 (互換用)。新規コードからは download_photos_parallel を使用。"""
    if _is_cached(racer_number):
        return True
    for _ in range(attempts):
        _, ok, _ = _download_one_photo(racer_number, timeout=20)
        if ok:
            return True
        time.sleep(0.5)
    return False


def download_photos_parallel(racer_numbers, max_workers: int = 8, max_per_run: int = 400, budget_sec: int = 600) -> None:
    """選手写真を未取得分のみ並列ダウンロード。

    30 分 timeout に確実に収まるよう以下のガードを実装:
      1. cache hit (>500B) は即 skip — 通常ほとんどの選手は既に取得済
      2. 未取得選手のみを max_per_run 件まで並列ダウンロード
      3. 全体で budget_sec 秒経過したら中断 (次回 run で続き取得)
      4. workers=8 並列、timeout=10s/req で失敗は即諦め
    """
    if not racer_numbers:
        return
    missing = [rn for rn in sorted(racer_numbers) if not _is_cached(rn)]
    cached = len(racer_numbers) - len(missing)
    if not missing:
        print(f"  Photos: {cached}/{len(racer_numbers)} cached, no downloads needed")
        return
    to_download = missing[:max_per_run]
    deferred = len(missing) - len(to_download)
    print(
        f"  Photos: {cached} cached / {len(missing)} missing -> downloading "
        f"{len(to_download)} (parallel x{max_workers}, budget {budget_sec}s)"
        + (f", deferring {deferred} to next run" if deferred else "")
    )
    started = time.monotonic()
    ok_count = 0
    fail_count = 0
    timeouts = 0
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(_download_one_photo, rn): rn for rn in to_download}
        for fut in as_completed(futures):
            if time.monotonic() - started > budget_sec:
                # 残タスクは cancel(完了済以外)、次回 run に持ち越し
                for f in futures:
                    if not f.done():
                        f.cancel()
                timeouts = sum(1 for f in futures if not f.done())
                print(f"  Photos: budget {budget_sec}s exceeded, cancelling {timeouts} remaining")
                break
            try:
                _, ok, err = fut.result()
                if ok:
                    ok_count += 1
                else:
                    fail_count += 1
                    if fail_count <= 5:  # 最初の数件だけログ
                        print(f"  Photo fail rn={futures[fut]}: {err}")
            except Exception as e:
                fail_count += 1
                if fail_count <= 5:
                    print(f"  Photo exception rn={futures[fut]}: {e}")
    elapsed = time.monotonic() - started
    print(f"  Photos done: ok={ok_count} fail={fail_count} cancelled={timeouts} in {elapsed:.1f}s")

def main() -> None:
    """エントリーポイント: 本日の出走表 / 直前情報 / 写真を取得し OUTPUT_RACEDATA に出力。"""
    os.makedirs(os.path.dirname(OUTPUT_RACEDATA), exist_ok=True)

    print("Fetching today's programs...")
    try:
        prog = fetch_json(PROGRAMS_URL)
    except Exception as e:
        print(f"Failed: {e}")
        return

    programs = prog.get("programs", [])
    if not programs:
        print("No programs today")
        atomic_write_json(OUTPUT_RACEDATA, {"updated_at": utc_iso_seconds(), "racedata": []})  # D-01 / D-02
        return

    stadiums = {}
    date_str = ""
    racer_numbers = set()
    for p in programs:
        sid = p["race_stadium_number"]
        rn = p["race_number"]
        if not date_str:
            date_str = p.get("race_date", "").replace("-", "")
        if sid not in stadiums:
            stadiums[sid] = []
        stadiums[sid].append(rn)
        for b in p.get("boats", []):
            if b.get("racer_number"):
                racer_numbers.add(b["racer_number"])

    # FIX: programs に race_date が無いケース (API 仕様変更等) で URL の hd= が空になり
    #   silent に空 racedata を吐くのを防ぐ。JST 当日にフォールバックして警告。
    if not date_str:
        date_str = jst_now().strftime("%Y%m%d")
        print(f"WARN: race_date 抽出失敗 — JST 当日 ({date_str}) にフォールバック")

    print(f"Date: {date_str}, {len(stadiums)} stadiums, {len(racer_numbers)} racers")

    # 2026-05-17 (D7): timeout / network 障害でも進捗が失われないよう、
    #   stadium 完了ごとに atomic write。partial=True フラグで未完了を明示し、
    #   呼出側 (_is_fresh_today + scrape_all) は partial=True を stale と
    #   扱って次の tick で残りを補完できる。今日の date_str (race_date) を
    #   持つ既存ファイルがあれば再開、無ければ新規。
    existing_done_keys = set()
    all_data: list[dict] = []
    try:
        if os.path.exists(OUTPUT_RACEDATA):
            with open(OUTPUT_RACEDATA, encoding="utf-8") as f:
                prev = json.load(f)
            # 同じ race_date なら継続、別日付なら破棄
            if prev.get("race_date") == date_str and isinstance(prev.get("racedata"), list):
                for entry in prev["racedata"]:
                    all_data.append(entry)
                    existing_done_keys.add((entry.get("stadium"), entry.get("race")))
                if existing_done_keys:
                    print(f"  Resume: {len(existing_done_keys)} races already scraped today")
    except Exception as e:
        print(f"  WARN: resume load failed ({e}) — starting fresh")
        all_data = []
        existing_done_keys = set()

    for sid, race_nums in sorted(stadiums.items()):
        jcd = f"{sid:02d}"

        # 既に取得済 race をスキップ
        pending = [rn for rn in sorted(race_nums) if (sid, rn) not in existing_done_keys]
        if not pending:
            print(f"  Stadium {sid}: all {len(race_nums)} races already done, skip")
            continue
        print(f"  Stadium {sid}: scraping {len(pending)}/{len(race_nums)} races")

        for rn in pending:
            boats, day_label = scrape_racelist(jcd, rn, date_str)
            time.sleep(INTERVAL)

            parts = scrape_beforeinfo(jcd, rn, date_str)
            time.sleep(INTERVAL)

            for b in boats:
                b["parts_replaced"] = parts.get(b["boat_number"], [])

            entry = {
                "stadium": sid,
                "race": rn,
                "boats": boats
            }
            # rt-fix3: 出走表タブから取得した「◯日目」ラベル（初日 / N日目 / 最終日）。
            if day_label:
                entry["day_label"] = day_label
            all_data.append(entry)

        # Stadium 完了ごとに partial として保存 (timeout / network 障害耐性)
        atomic_write_json(OUTPUT_RACEDATA, {
            "updated_at": utc_iso_seconds(),
            "race_date": date_str,
            "partial": True,
            "racedata": all_data,
        })

    # rt-fix3 (2026-06-27): day_label backfill。
    #   再開ロジックで「全レース取得済み」の場は再 scrape されないため day_label が付かない。
    #   既存データに day_label が無い場をのみ、出走表を 1 回だけ引いて全 entry に後付けする。
    #   （1 場 1 fetch。当日内の再実行でもトップに「◯日目」が出るようにする）
    by_sid: dict[int, list[dict]] = {}
    for e in all_data:
        by_sid.setdefault(e.get("stadium"), []).append(e)
    for sid, entries in by_sid.items():
        if sid is None or any(e.get("day_label") for e in entries):
            continue
        jcd = f"{sid:02d}"
        rno0 = entries[0].get("race", 1)
        try:
            _, day_label = scrape_racelist(jcd, rno0, date_str)
        except Exception:
            day_label = None
        if day_label:
            for e in entries:
                e["day_label"] = day_label
            print(f"  Stadium {sid}: day_label backfilled = {day_label}")
        time.sleep(INTERVAL)

    # FIX (2026-05-16): 旧版は 1,636 選手 × (0.5s sleep + 0.3s sleep + timeout 20s × 2 attempts)
    # = 約 50 分かかり 30 分 timeout を超過 → racedata が 9 日間更新されない事故。
    # 未取得分のみ並列 8 で取得し、上限 400 件 / budget 600s でハードガード。
    print(f"Downloading photos for {len(racer_numbers)} racers (parallel)...")
    download_photos_parallel(racer_numbers, max_workers=8, max_per_run=400, budget_sec=600)

    # D-08: 写真削除に try/except、削除失敗は warn にとどめて続行
    if os.path.exists(PHOTO_DIR):
        now = time.time()
        for fname in os.listdir(PHOTO_DIR):
            fpath = os.path.join(PHOTO_DIR, fname)
            if fname == ".gitkeep":
                continue
            try:
                if now - os.path.getmtime(fpath) > 60 * 86400:
                    os.remove(fpath)
                    print(f"  Removed old photo: {fname}")
            except OSError as e:
                print(f"  WARN: photo cleanup failed {fname}: {e}")

    # D7: 全 stadium 完了で partial=False を立てて最終確定
    result = {
        "updated_at": utc_iso_seconds(),  # D-02
        "race_date": date_str,
        "partial": False,
        "racedata": all_data,
    }
    atomic_write_json(OUTPUT_RACEDATA, result)  # D-01

    print(f"Done! {len(all_data)} races written")

if __name__ == "__main__":
    main()
