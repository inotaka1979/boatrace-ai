#!/usr/bin/env python3
"""公式番組表 (data/programs/today.json) のローカル読込ヘルパ。

公式移行 Phase 2 (2026-06-28): scrape_programs.py が boatrace.jp 出走表から
openapi 互換の programs を生成し data/programs/today.json に書く。previews / results /
racedata の各 scraper はレース一覧・締切時刻・日付をこのローカル公式ファイルから取る
ことで「非公式ミラー(openapi)の race_date が前日のまま残ると別日のページをスクレイプ
してしまう」wrong-day バグを構造的に解消する。

公式ファイルが無い / programs が空 / race_date が JST 当日でない 場合は None を返し、
呼び出し側は従来通り openapi にフォールバックする(silent 劣化防止)。
"""
import json
import os
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))
OFFICIAL_PROGRAMS = "data/programs/today.json"


def load_local_official_programs(path: str | None = None) -> dict | None:
    """ローカル公式 programs を返す。新鮮で非空のときのみ dict、それ以外は None。

    Args:
        path: 明示パス(テスト用)。未指定なら repo の data/programs/today.json。

    Returns:
        openapi 互換 dict {"programs": [...], "race_date": "YYYY-MM-DD", ...} または None。
    """
    if path is None:
        path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", OFFICIAL_PROGRAMS
        )
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    if not isinstance(d, dict):
        return None
    progs = d.get("programs") or []
    if not progs:
        return None
    today = datetime.now(JST).strftime("%Y-%m-%d")
    rd = d.get("race_date") or (progs[0].get("race_date") if progs else "")
    if rd and rd != today:
        return None
    return d
