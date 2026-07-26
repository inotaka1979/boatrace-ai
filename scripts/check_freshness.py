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
    0 : fresh、または stale/insufficient だが warning mode
    1 : 引数 / I/O 系の予期せぬエラー
    2 : stale (--strict 指定時のみ)
    3 : file 不在
    4 : JSON parse error / フィールド不在 / 検証パス不在
    5 : 鮮度は OK だが中身が空 / 欠損率が高い (--strict 指定時のみ)

中身の充足度検証 (S-05):
    updated_at が新しいだけで「取れている」と判断してはならない。
    build_db.py の Step 2 (競走成績 K ファイル) が 30 日分すべて失敗しても
    Step 1 は成功するため updated_at は更新される — この静かな縮退を検出する。

    # stadiumDB: 24 場のうち 20 場以上のデータが必要
    python3 scripts/check_freshness.py data/db/stadiumDB.json \\
        --max-age-min 2880 --min-keys stadiums=20 --strict

    # racerDB: 直近フォームが半数以上の選手で埋まっている必要がある
    python3 scripts/check_freshness.py data/db/racerDB.json \\
        --max-age-min 2880 --min-ratio racers.recentResults=0.5 --strict
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
EXIT_INSUFFICIENT = 5   # 鮮度は OK だが中身が空 / 欠損率が高い

_MISSING = object()   # _resolve_node の「パス不在」センチネル


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


def _resolve_node(data: dict, path: str):
    """dotted path でノードを取得。途中で不在 / 非 dict traverse なら _MISSING。"""
    cur = data
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return _MISSING
        cur = cur[part]
    return cur


def _parse_kv_spec(items: list[str] | None) -> dict[str, float]:
    """['stadiums=20', 'racers.recentResults=0.5'] → {'stadiums': 20.0, ...}

    Raises:
        ValueError: 'key=value' 形式でない場合 (silent OK にしない)。
    """
    out: dict[str, float] = {}
    for it in items or []:
        if "=" not in it:
            raise ValueError(f"bad spec {it!r}, expected key=value")
        k, v = it.rsplit("=", 1)
        out[k] = float(v)
    return out


def check_content(
    data: dict,
    *,
    min_keys: dict[str, float] | None = None,
    min_ratio: dict[str, float] | None = None,
) -> tuple[int, str]:
    """データの「充足度」を検証する (S-05)。

    Args:
        min_keys:  {"stadiums": 20} → data["stadiums"] のキー数が 20 未満なら不足。
        min_ratio: {"racers.recentResults": 0.5} → data["racers"] の各要素の
                   "recentResults" が非空 (truthy) である割合が 0.5 未満なら不足。

    Returns:
        (exit_code, message)。EXIT_OK / EXIT_INSUFFICIENT / EXIT_MALFORMED。
        検証パスが存在しない場合は silent OK にせず EXIT_MALFORMED を返す。
    """
    for path, need in (min_keys or {}).items():
        node = _resolve_node(data, path)
        if node is _MISSING:
            return EXIT_MALFORMED, f"MALFORMED err=min_keys_path_absent:{path}"
        if not isinstance(node, dict):
            return EXIT_MALFORMED, f"MALFORMED err=min_keys_not_dict:{path}"
        n = len(node)
        if n < need:
            return (
                EXIT_INSUFFICIENT,
                f"INSUFFICIENT {path} keys={n} < {need:g}",
            )

    for spec, need in (min_ratio or {}).items():
        if "." not in spec:
            return EXIT_MALFORMED, f"MALFORMED err=min_ratio_needs_container.subkey:{spec}"
        container_path, subkey = spec.rsplit(".", 1)
        container = _resolve_node(data, container_path)
        if container is _MISSING or not isinstance(container, dict):
            return EXIT_MALFORMED, f"MALFORMED err=min_ratio_path_absent:{container_path}"
        items = list(container.values())
        if not items:
            return EXIT_INSUFFICIENT, f"INSUFFICIENT {spec} ratio_denom=0"
        nonempty = 0
        for v in items:
            if isinstance(v, dict) and v.get(subkey):
                nonempty += 1
        ratio = nonempty / len(items)
        if ratio < need:
            return (
                EXIT_INSUFFICIENT,
                f"INSUFFICIENT {spec} ratio={ratio:.2f} < {need:g} "
                f"(nonempty={nonempty}/{len(items)})",
            )

    return EXIT_OK, "CONTENT OK"


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
        help="exit 2/5 on stale/insufficient (otherwise exit 0 with WARN log)",
    )
    parser.add_argument(
        "--min-keys",
        action="append",
        metavar="PATH=N",
        help="dotted path の dict がキー数 N 以上であることを要求 (repeatable)",
    )
    parser.add_argument(
        "--min-ratio",
        action="append",
        metavar="CONTAINER.SUBKEY=R",
        help="container の各要素の subkey 非空率が R 以上であることを要求 (repeatable)",
    )
    args = parser.parse_args(argv)

    try:
        min_keys = _parse_kv_spec(args.min_keys)
        min_ratio = _parse_kv_spec(args.min_ratio)
    except ValueError as e:
        print(f"MALFORMED err=arg:{e}", file=sys.stderr)
        return EXIT_MALFORMED

    code, msg = check(args.file, max_age_min=args.max_age_min, field=args.field)

    # 鮮度 stale / missing / malformed は content 検証より先に報告する
    #   (stale なデータの中身を評価しても意味がないため)。
    if code == EXIT_STALE:
        if args.strict:
            print(msg, file=sys.stderr)
            return EXIT_STALE
        print(f"WARN {msg}")
        # stale (warn mode) のときは content 検証をスキップして既存挙動を維持
        return EXIT_OK
    if code != EXIT_OK:
        # missing / malformed は strict 関係なく fail
        print(msg, file=sys.stderr)
        return code

    # 鮮度 OK — 中身の充足度を検証 (指定があるときのみ)
    if min_keys or min_ratio:
        with open(args.file, "r", encoding="utf-8") as f:
            data = json.load(f)   # check() で parse 済のため安全
        ccode, cmsg = check_content(data, min_keys=min_keys, min_ratio=min_ratio)
        if ccode == EXIT_INSUFFICIENT:
            full = f"{cmsg} file={args.file}"
            if args.strict:
                print(full, file=sys.stderr)
                return EXIT_INSUFFICIENT
            print(f"WARN {full}")
            return EXIT_OK
        if ccode == EXIT_MALFORMED:
            print(f"{cmsg} file={args.file}", file=sys.stderr)
            return EXIT_MALFORMED

    print(msg)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
