#!/usr/bin/env python3
"""日次アーカイブ + retention (PR-7 / PR-11 拡張, 2026-07-26)。

data/{programs,previews,odds,results}/today.json を data/<domain>/<YYYYMMDD>.json に
コピーし、KEEP_DAYS より古い日次ファイルを削除する。これにより:
  - aggregate_form.py が過去日の results を登番へ join できる（過去日 programs が必要）
  - backtest_offline.mjs がフル入力（programs/previews/odds/results）を蓄積できる

retention: レビュー D1/B-06 の repo 肥大を抑えるため working tree を KEEP_DAYS 日に
制限する。git 履歴は増えるため、恒久解はデータ専用 orphan ブランチ（設計書 P2-9）。
その分離までの実務的な bound として本 retention を置く。

silent success 禁止: アーカイブした domain 数を stdout に出し、0 なら exit 5。
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import jst_now  # noqa: E402

DOMAINS = ("programs", "previews", "odds", "results")
KEEP_DAYS = 45
_DATED = re.compile(r"^\d{8}\.json$")


def archive_date(obj: dict, now: datetime.datetime) -> str:
    """アーカイブ日を決める。race_date 優先、無ければ JST 当日。"""
    rd = obj.get("race_date")
    if isinstance(rd, str) and len(rd) >= 10:
        return rd[:10].replace("-", "")
    return now.strftime("%Y%m%d")


def prune(dirpath: str, keep_days: int, now: datetime.datetime) -> int:
    """dirpath 内の YYYYMMDD.json のうち keep_days より古いものを削除。件数を返す。"""
    cutoff = now.date() - datetime.timedelta(days=keep_days)
    removed = 0
    if not os.path.isdir(dirpath):
        return 0
    for fn in os.listdir(dirpath):
        if not _DATED.match(fn):
            continue   # today.json 等は対象外
        try:
            d = datetime.date(int(fn[:4]), int(fn[4:6]), int(fn[6:8]))
        except ValueError:
            continue
        if d < cutoff:
            try:
                os.remove(os.path.join(dirpath, fn))
                removed += 1
            except OSError:
                pass
    return removed


def archive_domain(domain: str, now: datetime.datetime) -> str | None:
    """data/<domain>/today.json を日次ファイルにコピーし prune。アーカイブ日を返す。"""
    src = os.path.join("data", domain, "today.json")
    if not os.path.exists(src):
        return None
    try:
        with open(src, "r", encoding="utf-8") as f:
            obj = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"  skip {domain}: {type(e).__name__}: {e}")
        return None
    date = archive_date(obj, now)
    dst = os.path.join("data", domain, f"{date}.json")
    atomic_write_json(dst, obj)
    pruned = prune(os.path.join("data", domain), KEEP_DAYS, now)
    print(f"  {domain}: → {dst} (pruned {pruned})")
    return date


def main() -> int:
    now = jst_now()
    n = 0
    for dom in DOMAINS:
        if archive_domain(dom, now):
            n += 1
    print(f"archived {n}/{len(DOMAINS)} domains (retention {KEEP_DAYS}d)")
    if n == 0:
        print("::warning::no today.json found to archive", file=sys.stderr)
        return 5
    return 0


if __name__ == "__main__":
    sys.exit(main())
