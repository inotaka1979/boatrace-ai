#!/usr/bin/env python3
"""データ鮮度チェッカ (Phase 0 of REDESIGN.md)

各 scraper の出力 JSON が指定した updated_at フィールドを持ち、
現在時刻との差が閾値以内であることを確認する。

設計原則 (REDESIGN.md §3):
  - 鮮度はデータ自身が持つ (生成側 write-only)
  - silent success を構造的に禁止
  - 観測はデータ層に置く

使い方:
    python3 scripts/check_freshness.py data/odds/today.json \\
        --max-age-min 10

    # strict mode (default は warning): exit 2 で stale を主張
    python3 scripts/check_freshness.py data/odds/today.json \\
        --max-age-min 10 --strict

    # 別フィールドを使う
    python3 scripts/check_freshness.py data/foo.json --field generated_at

exit codes (--strict なし時は 0 と 1 のみ):
    0 : fresh、または stale だが warning mode
    1 : 引数 / I/O 系の予期せぬエラー
    2 : stale (--strict 指定時のみ)
    3 : file 不在
    4 : JSON parse error / フィールド不在
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone


EXIT_OK = 0
EXIT_ERR = 1
EXIT_STALE = 2
EXIT_MISSING = 3
EXIT_MALFORMED = 4


def _parse_iso8601_utc(s: str) -> datetime:
    """ISO8601 UTC 文字列 (末尾 Z / +00:00) を aware datetime に変換。"""
    if not isinstance(s, str) or not s:
        raise ValueError(f"empty or non-string timestamp: {s!r}")
    # "2026-05-10T12:02:50Z" を fromisoformat が読めるよう正規化
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _resolve_timestamp(data: dict, field: str) -> str:
    """data 内の field を取得。ネスト ("a.b.c") にも対応。"""
    cur = data
    for part in field.split("."):
        if not isinstance(cur, dict):
            raise KeyError(f"field path {field!r} traverses non-dict at {part!r}")
        if part not in cur:
            raise KeyError(f"field {field!r} not present (missing {part!r})")
        cur = cur[part]
    if not isinstance(cur, str):
        raise TypeError(f"field {field!r} is not a string, got {type(cur).__name__}")
    return cur


def check(
    path: str,
    *,
    max_age_min: float,
    field: str = "updated_at",
    now: datetime | None = None,
) -> tuple[int, str]:
    """鮮度チェックの core ロジック。

    Returns
    -------
    (exit_code, message) のタプル。--strict / warning の判定は呼出側で行う。
    exit_code は EXIT_OK / EXIT_STALE / EXIT_MISSING / EXIT_MALFORMED のいずれか。
    """
    if not os.path.exists(path):
        return EXIT_MISSING, f"MISSING file={path}"

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return EXIT_MALFORMED, f"MALFORMED file={path} err=json:{e}"
    except OSError as e:
        return EXIT_MALFORMED, f"MALFORMED file={path} err=io:{e}"

    if not isinstance(data, dict):
        return EXIT_MALFORMED, f"MALFORMED file={path} err=root_not_dict"

    try:
        ts_str = _resolve_timestamp(data, field)
    except (KeyError, TypeError) as e:
        return EXIT_MALFORMED, f"MALFORMED file={path} err=field:{e}"

    try:
        ts = _parse_iso8601_utc(ts_str)
    except ValueError as e:
        return EXIT_MALFORMED, f"MALFORMED file={path} err=parse:{e}"

    now_ = now or datetime.now(timezone.utc)
    age_sec = (now_ - ts).total_seconds()
    age_min = age_sec / 60.0
    threshold_sec = max_age_min * 60.0

    if age_sec < 0:
        # 未来時刻 — clock skew の可能性、stale ではないが警告は出す
        return (
            EXIT_OK,
            f"OK file={path} age_sec={age_sec:.0f} (future ts, clock skew?)",
        )

    if age_sec > threshold_sec:
        return (
            EXIT_STALE,
            f"STALE file={path} age_min={age_min:.1f} threshold_min={max_age_min:.1f}",
        )

    return EXIT_OK, f"OK file={path} age_min={age_min:.1f} threshold_min={max_age_min:.1f}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("file", help="JSON file path to check")
    parser.add_argument(
        "--max-age-min",
        type=float,
        required=True,
        help="staleness threshold in minutes",
    )
    parser.add_argument(
        "--field",
        default="updated_at",
        help="timestamp field name (supports dotted path). default: updated_at",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit 2 on stale (otherwise exit 0 with WARN log)",
    )
    args = parser.parse_args(argv)

    code, msg = check(args.file, max_age_min=args.max_age_min, field=args.field)

    if code == EXIT_OK:
        print(msg)
        return EXIT_OK

    if code == EXIT_STALE:
        if args.strict:
            print(msg, file=sys.stderr)
            return EXIT_STALE
        print(f"WARN {msg}")
        return EXIT_OK

    # missing / malformed は strict 関係なく fail
    print(msg, file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
