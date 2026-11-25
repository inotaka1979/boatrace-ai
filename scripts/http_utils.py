"""共通 HTTP ユーティリティ (PC-1)

全 sync scraper の HTTP 取得 / retry / UA を一元化。

提供:
  - USER_AGENT / DEFAULT_HEADERS / DEFAULT_TIMEOUT 等の共通定数
  - fetch_text(url, ...)  → str
  - fetch_bytes(url, ...) → bytes
  - fetch_json(url, ...)  → dict | list

設計:
  - 失敗時は指数バックオフで retry（既定 2 回 = 計 3 試行）
  - 最終リトライ後の失敗は raise（呼出側でログ）
  - 429 / 5xx は HTTPError として retry 対象、404 は即時 raise
  - async 版は scrape_previews / scrape_odds / scrape_tide が独自に
    aiohttp ベースで実装しているため統合せず、定数のみ共有

非同期版:
  ここでは提供しない。各 async scraper のローカル実装を維持
  （RateLimiter / SmartScheduler 等の特殊化を保つため）。
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

log = logging.getLogger("http_utils")

# B-07 (2026-07-26): ブラウザ偽装をやめ、正直な bot UA に統一。
#   Googlebot 等と同じ "Mozilla/5.0 (compatible; <bot>; +<url>)" 形式で、
#   誰がアクセスしているか + 連絡先を明示する（ブロック時に交渉できる状態を保つ）。
USER_AGENT = "Mozilla/5.0 (compatible; BoatRaceOracle/1.0; +https://github.com/inotaka1979/boatrace-ai)"
DEFAULT_HEADERS: dict[str, str] = {"User-Agent": USER_AGENT}
DEFAULT_TIMEOUT = 15
DEFAULT_RETRIES = 2
DEFAULT_BACKOFF = 2.0  # 1, 2, 4 秒


# 即時 raise する HTTP ステータス（リトライしても改善しない）
_NON_RETRY_STATUS = {400, 401, 403, 404, 410}


class HTTPStatusError(RuntimeError):
    """リトライしない HTTP ステータスでの失敗。``status`` で呼出側が判別できる。"""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


# 2026-11-20: 取得元 (boatrace.jp) によるブロックの検知。
#   11/18 以降、GitHub Actions から boatrace.jp の全ページが HTTP 403 になった
#   (同じ UA で別ネットワークからは 200)。旧実装は 403 を 3 回ずつ再試行し
#   (1 run で 270 回)、失敗した run も updated_at を更新するため鮮度監視は緑のままだった。
#   ブロックを回避する細工はしない。検知したら以降のリクエストを止め、状態を記録して
#   人に知らせる。
SOURCE_BLOCK_THRESHOLD = 5


class SourceBlockDetector:
    """成功 0 件のまま 403 が ``threshold`` 回続いたら「ブロックされている」と判定する。

    1 件でも 200 が返れば判定しない（個別ページの 403 で全体を止めない）。
    スレッド並列の scraper からも使えるよう lock で保護する。

    2026-11-26: 取れたリクエスト (200) の応答時間も集計する（``record`` の第 2 引数、秒）。
    boatrace.jp は夜間、自動取得への応答を 1 件あたり 8〜10 秒遅らせる（拒否ではなく 200 が返るので、
    403 を数えるブロック検知には掛からない）。「止められてはいないが遅い」状態を data/_status.json に
    残すため。測っていない scraper では ``stats()`` の形は従来どおり。
    """

    def __init__(self, threshold: int = SOURCE_BLOCK_THRESHOLD):
        self.threshold = threshold
        self.ok = 0
        self.forbidden = 0
        self._streak = 0
        self._timed = 0
        self._total_sec = 0.0
        self._max_sec = 0.0
        self._lock = threading.Lock()

    def record(self, status: int | str | None, elapsed: float | None = None) -> None:
        with self._lock:
            if status == 200:
                self.ok += 1
                self._streak = 0
                if (
                    isinstance(elapsed, (int, float))
                    and not isinstance(elapsed, bool)
                    and math.isfinite(elapsed)
                    and elapsed >= 0
                ):
                    self._timed += 1
                    self._total_sec += elapsed
                    self._max_sec = max(self._max_sec, elapsed)
            elif status == 403:
                self.forbidden += 1
                self._streak += 1

    @property
    def blocked(self) -> bool:
        with self._lock:
            return self.ok == 0 and self._streak >= self.threshold

    def stats(self) -> dict[str, Any]:
        out: dict[str, Any] = {"ok": self.ok, "http_403": self.forbidden, "blocked": self.blocked}
        with self._lock:
            if self._timed:
                # 取れたリクエスト 1 件あたりの応答時間（ミリ秒）。再試行を含む呼び出しはその合計
                out["avg_ms"] = round(self._total_sec / self._timed * 1000)
                out["max_ms"] = round(self._max_sec * 1000)
        return out


def timed_call(fn, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN201
    """``fn(*args, **kwargs)`` を呼び、``(戻り値, 経過秒)`` を返す。例外はそのまま上げる。

    scraper が 1 リクエストの応答時間を測って ``SourceBlockDetector.record`` に渡すのに使う。
    ``await asyncio.to_thread(timed_call, fetch_once, url, ...)`` とすれば、スレッドの順番待ちを含まない
    （リクエストそのものの）時間になる。
    """
    t0 = time.monotonic()
    out = fn(*args, **kwargs)
    return out, time.monotonic() - t0


SOURCE_STATUS_PATH = "data/_status.json"


def write_source_status(task: str, stats: dict[str, Any], path: str = SOURCE_STATUS_PATH) -> None:
    """scraper ごとの取得状況を ``data/_status.json`` の ``tasks[task]`` に記録する。

    監視 (scrape-all の issue 起票) とアプリの状態表示が読む。失敗しても scrape 本体は止めない。
    """
    from io_utils import atomic_write_json  # 循環 import 回避
    from time_utils import utc_iso_seconds

    try:
        cur: dict[str, Any] = {}
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    cur = json.load(f)
            except (OSError, json.JSONDecodeError):
                cur = {}  # 壊れたファイルは作り直す
        if not isinstance(cur, dict):
            cur = {}
        tasks = cur.get("tasks") if isinstance(cur.get("tasks"), dict) else {}
        tasks[task] = {**stats, "at": utc_iso_seconds()}
        cur["tasks"] = tasks
        cur["source_blocked"] = any(bool(t.get("blocked")) for t in tasks.values() if isinstance(t, dict))
        cur["updated_at"] = utc_iso_seconds()
        atomic_write_json(path, cur)
    except Exception as e:  # noqa: BLE001
        log.warning("write_source_status(%s) failed: %s", task, e)


def _merge_headers(extra: dict[str, str] | None) -> dict[str, str]:
    h = dict(DEFAULT_HEADERS)
    if extra:
        h.update(extra)
    return h


def fetch_bytes(
    url: str,
    *,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    headers: dict[str, str] | None = None,
) -> bytes:
    """URL を GET し本文を bytes で返す（写真・LZH 等のバイナリ向け）。

    リトライ後に失敗したら RuntimeError を raise。
    """
    h = _merge_headers(headers)
    last_err: BaseException | None = None
    for i in range(retries + 1):
        try:
            req = Request(url, headers=h)
            with urlopen(req, timeout=timeout) as r:
                return r.read()
        except HTTPError as e:
            last_err = e
            if e.code in _NON_RETRY_STATUS:
                raise HTTPStatusError(f"fetch_bytes {e.code}: {url}", e.code) from e
            log.warning("fetch_bytes retry %d/%d %s: HTTP %s",
                        i + 1, retries + 1, url, e.code)
        except (URLError, TimeoutError, OSError) as e:
            last_err = e
            log.warning("fetch_bytes retry %d/%d %s: %s",
                        i + 1, retries + 1, url, e)
        if i < retries:
            time.sleep(DEFAULT_BACKOFF ** i)
    raise RuntimeError(
        f"fetch_bytes failed after {retries + 1} tries: {url}: {last_err}"
    )


def fetch_once(
    url: str,
    *,
    timeout: int = DEFAULT_TIMEOUT,
    headers: dict[str, str] | None = None,
    encoding: str = "utf-8",
) -> tuple[int | str, str | None]:
    """1 回だけ GET し ``(status, text)`` を返す（raise しない、retry しない）。

    async scraper が ``asyncio.to_thread`` 経由で使う。再試行と rate limit は呼出側の責務。
    通信例外は ``status="exc:<型名>"``・``text=None``。

    2026-11-20: boatrace.jp は 11/18 から aiohttp のリクエストを HTTP 403 で拒否するようになった
    （同じ UA・同じネットワークで urllib / curl は 200。拒否の対象はクライアントで、UA の身元ではない）。
    scrape_odds_fast / scrape_previews の HTTP をこの共通クライアントに揃えた。UA は正直な bot UA のまま。
    """
    req = Request(url, headers=_merge_headers(headers))
    try:
        with urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode(encoding, errors="replace")
    except HTTPError as e:
        return e.code, None
    except (URLError, TimeoutError, OSError) as e:
        return f"exc:{type(e).__name__}", None


def fetch_text(
    url: str,
    *,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    headers: dict[str, str] | None = None,
    encoding: str = "utf-8",
) -> str:
    """URL を GET し本文を str で返す。失敗時は raise。"""
    raw = fetch_bytes(url, timeout=timeout, retries=retries, headers=headers)
    return raw.decode(encoding, errors="replace")


def fetch_json(
    url: str,
    *,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    headers: dict[str, str] | None = None,
) -> Any:
    """URL を GET し JSON を dict / list で返す。失敗時は raise。"""
    text = fetch_text(url, timeout=timeout, retries=retries, headers=headers)
    return json.loads(text)
