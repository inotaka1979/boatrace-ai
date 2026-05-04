#!/usr/bin/env python3
"""data/db/racerDB.json の全選手の顔写真を data/photos/ にリフレッシュ。

- 既存 (>500B) はスキップ。失敗は記録するが exit 0
- 1選手あたり最大 2 回試行 + 0.3s 間隔（boatrace.jp への配慮）
- cron 月初に走らせて新人/復帰選手をカバーする想定 (cron_scrape.sh photos)

使用例:
    python3 scripts/refresh_all_photos.py
    python3 scripts/refresh_all_photos.py --all  # 既存サイズ問わず全件再 DL
"""
from __future__ import annotations

import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from scrape_racedata import download_photo, PHOTO_DIR

RACER_DB = os.path.join(ROOT, "data/db/racerDB.json")


def main() -> int:
    if not os.path.exists(RACER_DB):
        print(f"[refresh_photos] {RACER_DB} not found, skip")
        return 0
    with open(RACER_DB, encoding="utf-8") as f:
        db = json.load(f)
    racers = db.get("racers") or {}
    print(f"[refresh_photos] target racer count: {len(racers)}")

    os.chdir(ROOT)  # download_photo は相対パス前提
    photo_dir_abs = os.path.join(ROOT, PHOTO_DIR)
    os.makedirs(photo_dir_abs, exist_ok=True)

    todo = list(racers.keys())
    t_start = time.time()
    ok, fail, skip = 0, 0, 0
    for i, rn in enumerate(todo):
        path = os.path.join(photo_dir_abs, f"{rn}.jpg")
        if os.path.exists(path) and os.path.getsize(path) > 500:
            skip += 1
            continue
        if download_photo(rn):
            ok += 1
        else:
            fail += 1
        if (ok + fail) % 100 == 0 and (ok + fail) > 0:
            elapsed = int(time.time() - t_start)
            print(f"[refresh_photos] progress {i+1}/{len(todo)} (ok={ok}, fail={fail}, skip={skip}, {elapsed}s)")

    elapsed = int(time.time() - t_start)
    print(f"[refresh_photos] done: ok={ok} fail={fail} skip={skip} elapsed={elapsed}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
