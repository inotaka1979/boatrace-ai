#!/usr/bin/env python3
"""Epic 24: GitHub Issue 経由の FL gradient upload を集約

クライアント (assets/app.js _shareLearnedWeights) が github.com/issues/new で
作成した Issue (label: fl-gradient-upload) から JSON payload を抽出し、
data/db/fl_uploads/ に保存する。

Issue 本文フォーマット:
    ## FL Gradient Upload (DP-noised)
    ```json
    {
      "schema": "br_fl_upload_v1",
      "feature_dim": 12,
      "weights": [...],
      "n_steps": ...,
      "dp": {...},
      "submitted_at": "..."
    }
    ```

実行: GH_TOKEN=... python3 scripts/aggregate_fl_uploads.py
出力: data/db/fl_uploads/<issue_number>.json
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "db" / "fl_uploads"
SCHEMA = "br_fl_upload_v1"
FEATURE_DIM = 24  # v2 (2026-05-24): 12 → 24 拡張 (assets/app.js と同期)
MAX_ISSUES = 100   # 一度に処理する上限

JSON_BLOCK_RE = re.compile(r"```json\s*\n(.*?)\n```", re.DOTALL)


def gh_list_issues(label: str = "fl-gradient-upload", state: str = "open") -> list[dict]:
    """gh CLI で labeled issue 一覧を取得。"""
    try:
        result = subprocess.run(
            ["gh", "issue", "list", "--label", label, "--state", state, "--limit", str(MAX_ISSUES),
             "--json", "number,title,body,createdAt,author"],
            capture_output=True, text=True, check=True, timeout=60,
        )
        return json.loads(result.stdout or "[]")
    except (subprocess.CalledProcessError, json.JSONDecodeError, FileNotFoundError) as e:
        print(f"[fl_aggregate] gh list failed: {e}")
        return []


def extract_payload(body: str) -> dict | None:
    """Issue body から JSON ブロックを抽出して validate。"""
    m = JSON_BLOCK_RE.search(body or "")
    if not m:
        return None
    try:
        payload = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    if payload.get("schema") != SCHEMA:
        return None
    if payload.get("feature_dim") != FEATURE_DIM:
        return None
    weights = payload.get("weights")
    if not isinstance(weights, list) or len(weights) != FEATURE_DIM:
        return None
    # 全要素が数値か確認
    for w in weights:
        if not isinstance(w, (int, float)):
            return None
        if abs(w) > 100:
            return None  # outlier rejection
    return payload


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    issues = gh_list_issues()
    print(f"[fl_aggregate] found {len(issues)} open fl-gradient-upload issues")

    n_saved = 0
    n_invalid = 0
    for issue in issues:
        num = issue.get("number")
        body = issue.get("body", "")
        author = (issue.get("author") or {}).get("login", "anonymous")
        payload = extract_payload(body)
        if not payload:
            n_invalid += 1
            print(f"[fl_aggregate]   #{num}: invalid payload (skip)")
            continue
        # メタ情報を追加
        payload["_meta"] = {
            "issue_number": num,
            "issue_author": author,
            "issue_created_at": issue.get("createdAt"),
        }
        out = OUT_DIR / f"{num}.json"
        atomic_write_json(str(out), payload)
        n_saved += 1
        print(f"[fl_aggregate]   #{num}: saved (author={author})")

    print(f"[fl_aggregate] saved {n_saved} payloads, {n_invalid} invalid")


if __name__ == "__main__":
    main()
