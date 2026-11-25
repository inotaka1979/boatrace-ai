#!/usr/bin/env python3
"""取得元 (boatrace.jp) の健全性を data/_status.json から判定する (2026-11-20)。

背景: 11/18 から GitHub Actions のオッズ・展示取得が全件 HTTP 403 になったが、
失敗した run も updated_at を更新するため鮮度監視はすべて緑のままだった。
各 scraper が http_utils.write_source_status で記録した「取りに行った件数 / 取れた件数 /
403 の件数」を見て、中身が取れていない状態を検出する。

出力 (stdout, JSON 1 行):
  {"state": "problem" | "ok" | "unknown", "lines": [...]}
  - problem: 直近 (--window-min 以内) の記録に、ブロック検知または
             「--min-attempted 件以上取りに行って 1 件も取れていない」タスクがある
  - ok:      直近の記録があり、どれも問題ない
  - unknown: 直近の記録が無い（深夜の no-op run など）。issue の開閉はしない
  応答が遅いタスクがあるときだけ "notes": [...] が付く（state は変えない。issue も開かない）。
  boatrace.jp は夜間、自動取得への応答を 1 件あたり 8〜10 秒遅らせる（2026-11-26 に確認、
  docs/RUNBOOK.md §11.2）。200 が返るのでブロック検知には掛からないが、時間の予算内に取れる件数が
  数分の一になる。日中にも起きたら気付けるよう、run のログに残す。
exit code は常に 0（判定結果は stdout で渡す）。

    python3 scripts/source_health.py data/_status.json
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys


def _parse_at(v: object) -> datetime.datetime | None:
    if not isinstance(v, str):
        return None
    try:
        return datetime.datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None


# 取れたリクエストの平均応答がこの値以上なら「遅い」と記録する（通常は 0.2〜0.5 秒、遅延時は 8〜10 秒）
SLOW_AVG_MS = 5000
SLOW_MIN_OK = 3


def _num(v: object) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def evaluate(status: dict, now: datetime.datetime, window_min: float = 120, min_attempted: int = 5) -> dict:
    tasks = status.get("tasks") if isinstance(status, dict) else None
    if not isinstance(tasks, dict):
        return {"state": "unknown", "lines": []}
    recent = 0
    lines: list[str] = []
    notes: list[str] = []
    for name in sorted(tasks):
        t = tasks[name]
        if not isinstance(t, dict):
            continue
        at = _parse_at(t.get("at"))
        if at is None or (now - at).total_seconds() > window_min * 60:
            continue
        recent += 1
        attempted = int(t.get("attempted") or 0)
        updated = int(t.get("updated") or 0)
        forbidden = int(t.get("http_403") or 0)
        if t.get("blocked"):
            lines.append(f"{name}: 取得元にブロックされています（HTTP 403 × {forbidden}、成功 0 件）")
        elif attempted >= min_attempted and updated == 0:
            lines.append(f"{name}: {attempted} 件取りに行って 1 件も取れていません（HTTP 403 × {forbidden}）")
        avg = _num(t.get("avg_ms"))
        ok = int(_num(t.get("ok")) or 0)
        if avg is not None and avg >= SLOW_AVG_MS and ok >= SLOW_MIN_OK:
            mx = _num(t.get("max_ms"))
            tail = f"、最大 {mx / 1000:.1f} 秒" if mx is not None else ""
            notes.append(f"{name}: 応答が遅い（取れた {ok} 件の平均 {avg / 1000:.1f} 秒{tail}）")
    out: dict = {"state": "problem" if lines else ("ok" if recent else "unknown"), "lines": lines}
    if notes:
        out["notes"] = notes
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?", default="data/_status.json")
    ap.add_argument("--window-min", type=float, default=120)
    ap.add_argument("--min-attempted", type=int, default=5)
    a = ap.parse_args(argv)
    try:
        with open(a.path, encoding="utf-8") as f:
            status = json.load(f)
    except (OSError, json.JSONDecodeError):
        status = {}
    now = datetime.datetime.now(datetime.timezone.utc)
    print(json.dumps(evaluate(status, now, a.window_min, a.min_attempted), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
