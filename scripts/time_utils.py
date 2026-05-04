"""共通時刻ユーティリティ (P2 D-02 / D-10)

`datetime.utcnow()` は Python 3.12+ で deprecated 警告。
全 scraper でこのモジュール経由に統一すれば、
将来の Python 更新で慌てる必要がない。

使い方:
    from time_utils import utc_iso_seconds, jst_now
    record["updated_at"] = utc_iso_seconds()  # "2026-05-04T00:53:36Z"
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))


def utc_now() -> datetime:
    """現在の UTC datetime（aware）を返す。"""
    return datetime.now(timezone.utc)


def utc_iso_seconds() -> str:
    """UTC の ISO8601 文字列 "YYYY-MM-DDTHH:MM:SSZ" を返す。

    マイクロ秒は切り捨て、末尾は "Z"（GitHub Pages 配信先のクライアントが扱いやすい形式）。
    """
    return utc_now().isoformat(timespec="seconds").replace("+00:00", "Z")


def jst_now() -> datetime:
    """現在の JST datetime（aware）を返す。"""
    return datetime.now(JST)


def jst_today_str() -> str:
    """今日 (JST) の YYYYMMDD 文字列を返す。"""
    return jst_now().strftime("%Y%m%d")


def first_of_next_month(now: datetime | None = None) -> datetime:
    """指定 datetime の翌月 1 日 00:00:00 を返す（D-06 修正版）。

    旧実装 `now.replace(day=1) + timedelta(days=32)` は、
    例えば 1/1 → 2/2 となり、月末扱いがズレるバグがあった。
    """
    if now is None:
        now = jst_now()
    if now.month == 12:
        return now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
