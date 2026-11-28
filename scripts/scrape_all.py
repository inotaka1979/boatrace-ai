#!/usr/bin/env python3
"""統合 scraper エントリポイント — Path B (2026-05-16, ping 2026-05-17T00:58Z)

11 個に分散していた scrape workflow を 1 本に統合するためのオーケストレータ。
JST 現在時刻に応じて実行する scraper を決定し、sequential に呼び出す。
全 scraper 共通の wall-time budget + 鮮度ゲートも本ファイルで担当。

呼出方針:
  - 常時 (毎 cron tick): odds, previews
  - 30 分ごと: results (整数 30 分の境界 ± 2 分)
  - JST 09:30, 12:00: racedata + scrape_schedule.py --quick
  - JST 08:00: tide
  - 毎回末尾: prerender? — Path B では skeleton CSS に置換するため不要

特徴:
  - 1 commit に統合 → 同時 push race condition 根絶
  - 各 scraper に WALL_TIME 予算、超過時 atomic write 後 skip
  - check_freshness.py で commit 前に鮮度検証、stale なら exit 1
"""
from __future__ import annotations

import argparse
import datetime
import json
import logging
import os
import subprocess
import sys
import time
from typing import Callable

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("scrape_all")

JST = datetime.timezone(datetime.timedelta(hours=9))


def _jst_now() -> datetime.datetime:
    return datetime.datetime.now(tz=JST)


def _run_subprocess(script: str, args: list[str] | None = None, timeout_sec: int = 600) -> int:
    """scrape_*.py を subprocess で実行し、exit code を返す。"""
    cmd = [sys.executable, os.path.join(ROOT, "scripts", script)]
    if args:
        cmd.extend(args)
    log.info("  exec: %s (timeout %ds)", " ".join(cmd[1:]), timeout_sec)
    started = time.monotonic()
    try:
        result = subprocess.run(cmd, cwd=ROOT, timeout=timeout_sec, check=False)
        elapsed = time.monotonic() - started
        log.info("  exit %d in %.1fs", result.returncode, elapsed)
        return result.returncode
    except subprocess.TimeoutExpired:
        elapsed = time.monotonic() - started
        log.warning("  TIMEOUT after %.1fs (limit %ds)", elapsed, timeout_sec)
        return 124  # bash convention for timeout
    except Exception as e:
        log.error("  subprocess error: %s", e)
        return 1


def _scrape_odds() -> int:
    # 2026-11-11: スクリプト側に内部期限 ODDS_BUDGET_SEC (既定 240s) があり、
    #   この timeout に掛かる前に必ず書き出す。timeout は kill の最終保険。
    return _run_subprocess("scrape_odds_fast.py", timeout_sec=300)


def _scrape_previews() -> int:
    return _run_subprocess("scrape_previews.py", timeout_sec=300)


def _scrape_results() -> int:
    return _run_subprocess("scrape_results.py", timeout_sec=1500)


def _scrape_programs() -> int:
    # 公式 boatrace.jp racelist → openapi 互換 programs。10 場 × 12R ≒ 120 fetch。
    #   番組表は日次でほぼ静的なため 1 日 1 回（朝）取れれば十分。
    return _run_subprocess("scrape_programs.py", timeout_sec=1800)


# 2026-08-11: job 全体の wall-clock 予算。workflow の timeout-minutes: 50 に対し
#   commit & push とアーカイブ処理の余地を残して 42 分。
_RUN_STARTED = time.monotonic()
JOB_BUDGET_SEC = 42 * 60


def _remaining_budget_sec(cap_sec: int) -> int:
    """job 予算の残りと cap の小さい方を返す（最低 120 秒）。

    racedata のような長時間 scraper が job timeout を食い潰し、
    後続タスクや commit & push まで巻き添えにするのを防ぐ。
    """
    left = JOB_BUDGET_SEC - (time.monotonic() - _RUN_STARTED)
    return max(120, min(cap_sec, int(left)))


def _scrape_day_labels() -> int:
    return _run_subprocess("scrape_day_labels.py", timeout_sec=240)


def _scrape_tomorrow() -> int:
    # 2026-11-26: 翌日の出走（お気に入り選手の「明日の出走」用）。1 場 1 ページ。内部期限 240s で必ず書き出す。
    return _run_subprocess("scrape_tomorrow.py", timeout_sec=330)


# 2026-11-28: 番組表（出走表）を前もって取る（scripts/scrape_programs_tomorrow.py）。
#   夕方〜夜は翌日分、0 時〜朝の窓の前は今日の分の続き。スクリプト側の内部期限で必ず書き出すので、
#   subprocess の timeout は kill の最終保険（内部期限 + 取得中の 1 件 (最大 15 秒) + 書き出し より長く）。
#
#   内部期限は「1 回の run で 1 日分を取り切れる長さ」にしてある（1 件 9〜10 秒の日で 16 場 192 レース = 約 31 分）。
#   最初の夜（11/28）に分かったこと: 公開（18 時ごろ）から 0 時までに届く run は 1 晩に 2 回で、1 回目は公開の前に
#   着くことがある（11/28 は 17:41 着で 0 場）。20 分の期限では、残った 1 回で 192 レース中 約 120 しか取れない。
#   実際に使える時間は job の残り（_remaining_budget_sec）で決まる。夕方は real-time 系に約 11 分かかるので 約 29 分。
#   この後ろの backfill は、残り時間に収まる分だけ行う（番組表が先。_backfill_archive）。
#   同じ run の後ろに racedata（今日の今節成績）が控えている時だけは、これまでどおり 20 分で切り上げる。
#   値の関係は test_scrape_programs_tomorrow.py で固定。
PROGRAMS_TOMORROW_BUDGET_SEC = 2100
PROGRAMS_TOMORROW_SHARED_BUDGET_SEC = 1200
PROGRAMS_TODAY_AHEAD_BUDGET_SEC = 2100
PROGRAMS_AHEAD_MARGIN_SEC = 120


def _scrape_programs_ahead(target: str, budget_cap_sec: int) -> int:
    # job の残り時間が少ない時は、その分だけ短くする（取れたところまで書いて、続きは次の run）。
    timeout = _remaining_budget_sec(budget_cap_sec + PROGRAMS_AHEAD_MARGIN_SEC)
    budget = max(60, timeout - PROGRAMS_AHEAD_MARGIN_SEC)
    return _run_subprocess(
        "scrape_programs_tomorrow.py", ["--target", target, "--budget-sec", str(budget)], timeout_sec=timeout
    )


def _scrape_programs_tomorrow() -> int:
    return _scrape_programs_ahead("tomorrow", PROGRAMS_TOMORROW_BUDGET_SEC)


def _scrape_programs_tomorrow_shared() -> int:
    """翌日の番組表（同じ run の後ろに racedata が控えている時の、短い期限）。"""
    return _scrape_programs_ahead("tomorrow", PROGRAMS_TOMORROW_SHARED_BUDGET_SEC)


def _scrape_programs_today_ahead() -> int:
    return _scrape_programs_ahead("today", PROGRAMS_TODAY_AHEAD_BUDGET_SEC)


def _scrape_racedata() -> int:
    # D7 (2026-05-17): GHA runner 上では boatrace.jp scrape が遅く
    #   race loop ~20 min + photo DL 600s で 1500s を超過し silent timeout。
    #   2400s (40 min) に拡張。実 fetch は通常 25-30 min で完了。
    # 2026-08-11: 残り予算でクリップする。racedata は stadium 単位で partial 保存
    #   しており、途中で切られても次 run が続きから再開する。ここで打ち切らないと
    #   commit & push まで到達せず、その run の成果が丸ごと失われる。
    budget = _remaining_budget_sec(2400)
    rc = _run_subprocess("scrape_racedata.py", timeout_sec=budget)
    if rc == 124:
        # timeout は失敗扱いにしない: partial 保存済みで次 run が再開するため、
        # watchdog を誤検知させる意味が無い。
        log.warning("  racedata: 予算 %ds で打ち切り（partial 保存済、次 run で再開）", budget)
        return 0
    return rc


def _scrape_schedule_quick() -> int:
    return _run_subprocess("scrape_schedule.py", ["--quick"], timeout_sec=120)


def _scrape_schedule_full() -> int:
    """月間日程のフル再取得(current.json 再生成)。HTTP 2 本で軽量。

    2026-07-12: --full 必須。無印だと scrape_schedule.py 側の _is_current_fresh()
    (2 日以内なら skip) に握り潰され、パーサ修正後も壊れた current.json が
    再生成されない実障害 (schedule(full) が 0.2s で exit 0)。
    """
    return _run_subprocess("scrape_schedule.py", ["--full"], timeout_sec=180)


def _today_venue_sets() -> tuple[set[int], set[int]]:
    """(schedule の本日開催場, programs の場) を返す。読めない側は空 set。"""
    today = _jst_now().date().isoformat()
    sched: set[int] = set()
    progs: set[int] = set()
    try:
        with open(os.path.join(ROOT, "data/schedule/current.json"), encoding="utf-8") as f:
            sd = (json.load(f) or {}).get("stadium_dates", {})
        sched = {int(k) for k, v in sd.items() if isinstance(v, list) and today in v}
    except Exception:
        pass
    try:
        with open(os.path.join(ROOT, "data/programs/today.json"), encoding="utf-8") as f:
            d = json.load(f) or {}
        if str(d.get("race_date", "")) == today:
            progs = {p.get("race_stadium_number") for p in d.get("programs", [])
                     if p.get("race_stadium_number")}
    except Exception:
        pass
    return sched, progs


def _programs_if_venue_mismatch() -> int:
    """run 時評価: schedule の本日場 ⊄ programs なら programs を作り直す。

    2026-07-12: schedule パーサ修正で場が増えた日、programs は _is_fresh_today で
    skip されて欠落を継承し続けるため、場集合の差分で自己回復させる。
    schedule 側が空(未生成/非開催日)のときは何もしない。
    """
    sched, progs = _today_venue_sets()
    missing = sched - progs
    if not sched or not missing:
        log.info("  programs(sync): 本日場一致 (schedule=%d, programs=%d) → skip",
                 len(sched), len(progs))
        return 0
    log.warning("  programs(sync): 欠落場 %s を検知 → programs 再生成", sorted(missing))
    return _scrape_programs()


def _scrape_tide() -> int:
    return _run_subprocess("scrape_tide.py", timeout_sec=300)


# backfill の subprocess timeout。スクリプト側の内部期限 (backfill_archive.BUDGET_SEC = 1200 秒) で必ず書き出すので、
#   これは kill の最終保険。内部期限 + 取得中の 1 件 (最大 15 秒) + 書き出し より長く、job の timeout (50 分) より
#   十分短く。値の関係は test_backfill_archive.py で固定している。
BACKFILL_TIMEOUT_SEC = 1320
BACKFILL_MARGIN_SEC = 120
# 残りがこれより短い run では行わない（1 レース = 最大 3 ページ = 約 30 秒。1 レースも終わらない長さで始めない）
BACKFILL_MIN_BUDGET_SEC = 60


def _backfill_archive() -> int:
    # 2026-11-20: 確定済みレースの展示・オッズを日付付きアーカイブへ後追い（scripts/backfill_archive.py）。
    # 2026-11-26: 内部期限を 150 → 1200 秒に伸ばしたのに合わせて 240 → 1320 秒。
    #   boatrace.jp が夜間に応答を 1 件 8〜10 秒遅らせるため、150 秒では 6〜8 レースしか取れていなかった。
    # 2026-11-28: job の残り時間に収める。同じ run で先に番組表（最大 37 分）を取った時、固定の 22 分を足すと
    #   job の timeout (50 分) を超え、commit まで届かずにその run の成果がすべて消える。
    #   番組表に時間を使わなかった run（ふだんの夜）は、これまでどおり 1200 秒。
    timeout = _remaining_budget_sec(BACKFILL_TIMEOUT_SEC)
    budget = timeout - BACKFILL_MARGIN_SEC
    if budget < BACKFILL_MIN_BUDGET_SEC:
        log.info("  backfill: job の残り時間が無い → この run では行わない")
        return 0
    return _run_subprocess("backfill_archive.py", ["--budget-sec", str(budget)], timeout_sec=timeout)


def _prerender_top() -> int:
    return _run_subprocess("prerender_top.py", timeout_sec=120)


def _racedata_has_empty(path: str) -> bool:
    """racedata に boats が空の entry が残っているか。

    今節成績は boatrace.jp の出走表が当日分を出すまで取れない。早朝の run では
    boats=[] で保存されるが、_is_fresh_today は「partial=False かつ updated_at が今日」
    だけを見るため fresh 扱いになり、その日は二度と取りに行かなくなっていた。
    中身を見て未取得が残っていれば再取得を促す。

    Args:
        path: data/racedata/today.json への相対 or 絶対パス。

    Returns:
        boats が空の entry が 1 件でもあれば True。ファイル不在 / 壊れている場合は
        False（その場合は _is_fresh_today 側が False を返して再取得される）。
    """
    full = os.path.join(ROOT, path) if not os.path.isabs(path) else path
    try:
        with open(full, encoding="utf-8") as f:
            data = json.load(f)
        entries = data.get("racedata")
        if not isinstance(entries, list) or not entries:
            return False
        empty = sum(1 for e in entries if not e.get("boats"))
        if empty:
            log.info("  racedata: boats 空 %d/%d 件 → 再取得対象", empty, len(entries))
        return empty > 0
    except Exception:
        return False


def _is_fresh_today(path: str, now_jst: datetime.datetime) -> bool:
    """data/<scope>/today.json が今日 (JST) の完了データかを判定する。

    True なら fetch 不要、False なら要更新。判定ロジック:
      - file 不在 → False (要更新)
      - JSON parse 失敗 / updated_at 欠落 → False (要更新)
      - updated_at が today (JST) より前 → False (要更新)
      - partial=True (途中保存) → False (残り stadium 補完が必要)
      - 上記以外 → True (fresh)

    2026-05-17: GHA cron の遅延 (15-30 分) で時刻ベースの起動条件を
    すり抜ける問題への根本対策。時刻窓を広げ、内側で「今日のデータか」を
    冪等チェックすることで、毎 tick で「足りなければ取る / 足りていれば skip」
    が成立する。さらに partial=True で stadium 単位の途中保存もサポート。
    """
    full = os.path.join(ROOT, path) if not os.path.isabs(path) else path
    if not os.path.exists(full):
        return False
    try:
        with open(full, encoding="utf-8") as f:
            data = json.load(f)
        # partial=True は scrape_racedata.py が stadium 単位で書いた
        # 途中保存。残り stadium の補完が必要なので fresh とは扱わない。
        if data.get("partial") is True:
            return False
        ts = data.get("updated_at") or data.get("generated_at")
        if not ts:
            return False
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        dt = datetime.datetime.fromisoformat(ts).astimezone(JST)
        return dt.date() == now_jst.date()
    except Exception as e:
        log.warning("  freshness check failed for %s: %s", path, e)
        return False


def _age_minutes(path: str) -> float:
    """data ファイルの updated_at 経過分数。読めない/欠落は無限大扱い(要更新)。"""
    full = os.path.join(ROOT, path) if not os.path.isabs(path) else path
    try:
        with open(full, encoding="utf-8") as f:
            ts = (json.load(f) or {}).get("updated_at")
        if not ts:
            return float("inf")
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        dt = datetime.datetime.fromisoformat(ts)
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        return (now_utc - dt).total_seconds() / 60.0
    except Exception:
        return float("inf")


def _decide_tasks(now: datetime.datetime, force_all: bool) -> list[tuple[str, Callable[[], int]]]:
    """JST 現在時刻から実行 task list を決定。

    2026-05-17 改善方針 (人手不要の自己回復):
      - odds / previews: race hours は毎 tick 取得 (リアルタイム性が必要)
      - results: 30 分窓広め (cron 遅延耐性)
      - racedata / schedule / tide: 時刻窓は広く取り、内側で「今日のデータか」
        を冪等にチェック。Open API 公開遅延や GHA cron 遅延があっても
        次の tick で必ず取得される。
    """
    tasks: list[tuple[str, Callable[[], int]]] = []
    h, m = now.hour, now.minute

    if force_all:
        # 2026-06-04 (rt-fix P0-2): prerender は index.html を書き換え、
        #   複数 workflow の push を非マージ衝突させる唯一の原因だったため
        #   scrape の commit 対象から除外（index.html は skeleton + JS render）。
        return [
            ("schedule(quick)", _scrape_schedule_quick),
            ("programs", _scrape_programs),
            ("racedata", _scrape_racedata),
            ("tide", _scrape_tide),
            ("results", _scrape_results),
            ("previews", _scrape_previews),
            ("odds", _scrape_odds),
        ]

    # racedata stale 時の優先実行: GHA job timeout (25 min) と odds の timeout
    # 5 min が重なると racedata (~15 min) が完走できない事故が発生。
    # stale な racedata は 1 日 1 回しか走らないので先に取り、その後 odds 等を走らせる。
    racedata_window = (h == 8 and m >= 30) or (9 <= h <= 22)
    # FIX (2026-08-11): 「今日の日付が入っている」だけでは fresh と言えない。
    #   早朝 run では boatrace.jp の出走表に今節成績がまだ載らず boats=[] で保存される。
    #   partial=False かつ updated_at=今日 なので _is_fresh_today は True を返し、
    #   その日は二度と racedata を取りに行かない = 今節成績が一日中空のままだった。
    #   中身（boats を持つ entry の割合）も見て、空が残っていれば再取得させる。
    racedata_stale = racedata_window and (
        not _is_fresh_today("data/racedata/today.json", now)
        or _racedata_has_empty("data/racedata/today.json")
    )
    if racedata_stale:
        # 2026-08-11 FIX: racedata は **最後**に回す（従来はここで先頭に置いていた）。
        #   旧コメントの前提「stale な racedata は 1 日 1 回しか走らない」は、
        #   「boats が空なら再取得する」修正 (PR #271) で成立しなくなった。
        #   racedata は 25-40 分かかるため先頭に置くと job timeout (50 分) を食い潰し、
        #   後続の odds / previews / results が **毎 run 実行されなくなる**。
        #   実障害: 18:15 の run が 44 分 racedata に費やし、results が 92 分
        #   更新されず 32 レースの結果が欠落した。
        #   racedata は stadium 単位で partial 保存しており run をまたいで再開できる。
        #   一方 odds / previews / results は「今」取れないと価値が無い。
        #   → 速い real-time 系を先に確定させ、racedata は残り時間で進める。
        tasks.append(("schedule(quick)", _scrape_schedule_quick))

    # programs（公式番組表）: 番組表は日次でほぼ静的。本日分が未取得なら朝の窓で 1 回取得。
    #   一覧元の current.json を使うため schedule(quick) を先に確実に走らせる。
    if racedata_window and not _is_fresh_today("data/programs/today.json", now):
        if not any(name == "schedule(quick)" for name, _ in tasks):
            tasks.append(("schedule(quick)", _scrape_schedule_quick))
        tasks.append(("programs", _scrape_programs))

    # 2026-07-12: schedule/programs の場欠落 自己回復。
    #   実障害: 月間日程パーサの不具合で本日開催 16 場中 5 場が schedule から欠落し、
    #   programs も同じ欠落を継承(_is_fresh_today だけでは「今日ぶんはあるが場が
    #   足りない」を検知できない)。対策:
    #   (a) current.json が 6 時間より古ければフル再取得(1 日 1 回程度、HTTP 2 本で軽量)
    #   (b) その後 run 時評価で schedule と programs の本日場集合を比較し、
    #       不一致なら programs を作り直す(タスク実行は逐次なので (a) の結果を見られる)
    if racedata_window and _age_minutes("data/schedule/current.json") >= 360:
        tasks.append(("schedule(full)", _scrape_schedule_full))
    if racedata_window:
        tasks.append(("programs(sync)", _programs_if_venue_mismatch))

    # results: 鮮度ベース (2026-07-05)。
    # 旧条件は「実行時の分が 0-9 or 25-35」の分窓だったが、GHA の schedule 間引きで
    #   実行時刻が不定になると丸一日 skip し得る(実障害: 07-05 に 10:17 実行で
    #   results タスクが走らず、前日から results が空のまま)。
    #   updated_at が 20 分より古ければ毎 tick で取得する(冪等。並列は
    #   concurrency:scrape-all で防止されるため安全)。
    # 2026-11-11: real-time 系の順序を results → previews → odds に変更。
    #   results は確定済み・締切前を skip するので ~1 分で終わる。先に確定させると
    #   odds (get_finished_from_results) が確定レースを対象から外せる。
    if 10 <= h <= 22 and _age_minutes("data/results/today.json") >= 20:
        tasks.append(("results", _scrape_results))

    # 共通: race hours (JST 08-22) は previews + odds を毎 tick
    if 8 <= h <= 22:
        tasks.append(("previews", _scrape_previews))
        tasks.append(("odds", _scrape_odds))

    # 2026-11-20: 場ごとの開催日タブ（何日目 / 最終日 / 中止）。1 場 1 ページで軽い。中止は当日に
    #   決まることがあるので、今日の分があっても 60 分ごとに取り直す。
    if 6 <= h <= 22 and (
        not _is_fresh_today("data/schedule/day_labels.json", now)
        or _age_minutes("data/schedule/day_labels.json") >= 60
    ):
        tasks.append(("day_labels", _scrape_day_labels))

    # 2026-11-26: 翌日の出走（data/schedule/tomorrow.json）。翌日分は前日の午後〜夜に公開されるので、
    #   15 時以降の run で毎回取り直す（1 場 1 ページ、開催 14 場前後）。公開前の場は pending に残り、次の run で取る。
    #   real-time 系の後・時間のかかる racedata / backfill の前。
    if 15 <= h <= 23:
        tasks.append(("tomorrow", _scrape_tomorrow))
        # 2026-11-28: 翌日の番組表（出走表）も前の晩に取っておく（data/schedule/programs_tomorrow.json）。
        #   朝の番組表は非公式ミラー (openapi) の切り替わり待ちで、自前の取得（下の programs）が届くのは昼前後。
        #   11/28 はミラーが 9:20 すぎまで前日のままで、アプリは全場を「次節」と表示した（鳴門 1R は 8:35 締切）。
        #   日付が変わったら Worker がこのファイルを今日の番組表として配る。上の tomorrow が作る一覧を使うので、その直後。
        #   1 回の run で 1 日分を取り切る長さ（job の残り時間まで）。この run で racedata（今日の今節成績）も
        #   取る時は、その時間を残すために短い期限にする（racedata が夕方まで残る日は少ない）。
        tasks.append(
            ("programs(tomorrow)", _scrape_programs_tomorrow_shared if racedata_stale else _scrape_programs_tomorrow)
        )

    # 0 時〜朝の窓の前: 前の晩に取り切れなかった今日の番組表の続きを取る（取り切っていれば何もしない）。
    #   朝の窓に入ったら、上の programs が data/programs/today.json を取り直す。時間のかかる backfill より先に
    #   （backfill は残り時間に収まる分だけ）。
    if not racedata_window and h < 9:
        tasks.append(("programs(today)", _scrape_programs_today_ahead))

    # 2026-08-11 FIX: racedata は real-time 系 (odds/previews/results) の後に実行する。
    #   理由は上の racedata_stale ブロックのコメント参照。
    if racedata_stale:
        tasks.append(("racedata", _scrape_racedata))

    # racedata fresh だが next_open.json は古い場合 (前日跨ぎ等) の単独 refresh。
    # racedata stale 時は上の優先 block で既に処理済み。
    if (
        racedata_window
        and not racedata_stale
        and not _is_fresh_today("data/schedule/next_open.json", now)
    ):
        tasks.append(("schedule(quick)", _scrape_schedule_quick))

    # 2026-11-20: 夜間 (JST 23-07 時) は確定済みレースの展示・オッズをアーカイブへ後追いする。
    #   GitHub schedule の遅延で深夜に届く run は従来何もせず終わっていた（実測 01:28 / 03:26 / 06:05 着）。
    #   アーカイブ被覆（展示 15%・三連単オッズ 13〜30%/日）が backtest で締切前予想を評価できない原因。
    if h >= 23 or h < 7:
        tasks.append(("backfill", _backfill_archive))

    # tide: JST 07:30-09:30 で「今日のデータでなければ取る」
    tide_window = (h == 7 and m >= 30) or h == 8 or (h == 9 and m < 30)
    if tide_window and not _is_fresh_today("data/tide/today.json", now):
        tasks.append(("tide", _scrape_tide))
        # tide 取得時に next_open も refresh (低コスト、未取得なら埋める)
        if not any(name == "schedule(quick)" for name, _ in tasks):
            tasks.append(("schedule(quick)", _scrape_schedule_quick))

    return tasks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-all", action="store_true", help="全 scraper を強制実行 (debug 用)")
    parser.add_argument("--only", type=str, default=None, help="特定 scraper のみ (odds/previews/results/racedata/tide)")
    args = parser.parse_args()

    now = _jst_now()
    log.info("=== scrape_all start: JST %s ===", now.strftime("%Y-%m-%d %H:%M"))

    tasks = _decide_tasks(now, args.force_all)

    if args.only:
        m = {
            "odds": _scrape_odds,
            "previews": _scrape_previews,
            "results": _scrape_results,
            "racedata": _scrape_racedata,
            "programs": _scrape_programs,
            "schedule": _scrape_schedule_quick,
            "tide": _scrape_tide,
            "prerender": _prerender_top,
            "backfill": _backfill_archive,
            "day_labels": _scrape_day_labels,
            "tomorrow": _scrape_tomorrow,
            "programs_tomorrow": _scrape_programs_tomorrow,
            "programs_today_ahead": _scrape_programs_today_ahead,
        }
        if args.only not in m:
            log.error("unknown --only: %s", args.only)
            return 2
        tasks = [(args.only, m[args.only])]

    if not tasks:
        log.info("no scheduled task at this tick — exit 0")
        return 0

    log.info("tasks: %s", ", ".join(name for name, _ in tasks))

    overall_started = time.monotonic()
    failures: list[str] = []
    for name, fn in tasks:
        log.info("--- %s ---", name)
        try:
            rc = fn()
            if rc != 0:
                failures.append(f"{name}(exit={rc})")
        except Exception as e:
            log.exception("  unexpected error in %s: %s", name, e)
            failures.append(f"{name}(error)")

    # PR-7/PR-11 拡張 (2026-07-26): today.json を日次アーカイブ化
    #   (aggregate_form の過去日 join / backtest のフル入力を蓄積、retention 付き)。
    #   補助タスクなので失敗しても scrape 本体の成否には数えない (watchdog を誤検知させない)。
    try:
        arc = _run_subprocess("archive_daily.py", timeout_sec=120)
        if arc != 0:
            log.warning("  archive_daily exit=%d (non-fatal)", arc)
    except Exception as e:  # noqa: BLE001
        log.warning("  archive_daily error: %s (non-fatal)", e)

    # 2026-11-20: 確定した日を選手・モーターの月別集計へ畳む（data/db/racer_stats*.json）。
    #   日次アーカイブは 45〜180 日で消えるため、長期の数字はここで残す。補助タスクなので失敗は数えない。
    try:
        agg = _run_subprocess("aggregate_racer_stats.py", timeout_sec=180)
        if agg != 0:
            log.warning("  aggregate_racer_stats exit=%d (non-fatal)", agg)
    except Exception as e:  # noqa: BLE001
        log.warning("  aggregate_racer_stats error: %s (non-fatal)", e)

    # 2026-11-20: 今節成績を選手番号で引ける形に（data/racedata/series.json）。racedata 取得後に
    #   確定したレースと、racedata が前日のままの朝の表示に使う。ローカルのファイルだけで数秒。
    try:
        ser = _run_subprocess("build_series.py", timeout_sec=60)
        if ser != 0:
            log.warning("  build_series exit=%d (non-fatal)", ser)
    except Exception as e:  # noqa: BLE001
        log.warning("  build_series error: %s (non-fatal)", e)

    # 2026-11-26: 選手ごとの出走ログ（data/db/racer_log/NN.json）。前日までの確定結果から作る。
    #   ローカルのファイルだけで数秒。内容が変わらなければ何も書かない。補助タスクなので失敗は数えない。
    try:
        rlog = _run_subprocess("build_racer_log.py", timeout_sec=120)
        if rlog != 0:
            log.warning("  build_racer_log exit=%d (non-fatal)", rlog)
    except Exception as e:  # noqa: BLE001
        log.warning("  build_racer_log error: %s (non-fatal)", e)

    elapsed = time.monotonic() - overall_started
    log.info("=== scrape_all done in %.1fs, failures=%d ===", elapsed, len(failures))
    if failures:
        log.warning("failures: %s", ", ".join(failures))
        # 部分失敗は exit 0 (commit はする、watchdog が検出)
        # 全失敗は exit 1
        if len(failures) == len(tasks):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
