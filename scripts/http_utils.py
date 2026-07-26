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
                raise RuntimeError(f"fetch_bytes {e.code}: {url}") from e
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
