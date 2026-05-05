#!/usr/bin/env python3
"""Epic 17 (P2-6): 疑似 federated learning — server-side L2 weight 計算

すべてのクライアントが手元で行っている L2 ロジスティック回帰の学習を、
サーバ側で全レース結果から再現する「中央化重み」を計算し、
data/db/community_weights.json として serve する。

クライアントは起動時にこれを fetch し、自身の学習サンプル数 n に応じて blend:
  n < 100 (新規):    community 0.7 + local 0.3
  n >= 100 (経験者): community 0.3 + local 0.7

これにより:
  - 新規ユーザのコールドスタート問題を解消（即座に良い予測）
  - 経験ユーザは自身の学習を維持しつつ community 知見も僅かに反映

実行: python3 scripts/compute_community_weights.py
出力: data/db/community_weights.json
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from time_utils import utc_iso_seconds  # noqa: E402
from io_utils import atomic_write_json, quality_header, safe_load_json  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
RESULTS_DIR = ROOT / "data" / "results"
PROGRAMS_DIR = ROOT / "data" / "programs"
PREVIEWS_DIR = ROOT / "data" / "previews"
RACER_DB_PATH = ROOT / "data" / "db" / "racerDB.json"
STADIUM_DB_PATH = ROOT / "data" / "db" / "stadiumDB.json"
FL_UPLOADS_DIR = ROOT / "data" / "db" / "fl_uploads"   # Epic 24
OUTPUT = ROOT / "data" / "db" / "community_weights.json"

FEATURE_DIM = 12
INIT_WEIGHTS = [3.0, 1.5, -1.0, -4.0, -1.5, 0.5, 4.0, -0.8, 1.0, 1.5, 0.3, 3.5]
LR0 = 0.05
LR_TAU = 5000.0
LAMBDA = 1e-4
MAX_RACES = 5000  # 集計上限（過去日分含めた直近 5000 レース）


def softmax(logits: list[float]) -> list[float]:
    if not logits:
        return []
    clean = [v if math.isfinite(v) else 0.0 for v in logits]
    m = max(clean)
    if not math.isfinite(m):
        m = 0.0
    exps = [math.exp(min(v - m, 50.0)) for v in clean]
    s = sum(exps)
    if s <= 0 or not math.isfinite(s):
        return [1.0 / len(clean)] * len(clean)
    return [x / s for x in exps]


def get_l2_features(boat: dict, preview: dict | None, racer_db: dict, stadium_db: dict, sid: str, et_rank: int, st_rank: int) -> list[float]:
    """assets/app.js getL2Features と同等の 12 次元特徴量計算。"""
    course = (preview or {}).get("racer_course_number") or boat.get("racer_boat_number") or 1
    rid = str(boat.get("racer_number") or 0)
    rdb = (racer_db.get("racers") or {}).get(rid) or {}
    sdb = stadium_db.get(sid) or {}

    cwr_obj = (sdb.get("courseWinRate") or {}).get(str(course)) or {}
    stad_cwr = (cwr_obj.get("win", 0) / cwr_obj["races"]) if cwr_obj.get("races", 0) >= 10 else 0.0

    cs = (rdb.get("courseStats") or {}).get(str(course)) or {}
    racer_cwr = (cs.get("win", 0) / cs.get("races", 1)) if cs.get("races", 0) >= 5 else None

    my_pv = preview or {}
    st = float(my_pv.get("racer_start_timing") or 99)
    tilt = float(my_pv.get("racer_tilt_adjustment") or 0)

    nat_win = float(boat.get("racer_national_top_1_percent") or 0)
    motor_rate = float(boat.get("racer_assigned_motor_top_2_percent") or 0)
    cls_num = boat.get("racer_class_number") or 3

    wind_course = 0.0
    et_comp = 0.0
    if et_rank <= 1 and 0 < st <= 0.10:
        et_comp = 1.0
    elif et_rank >= 4 and st >= 0.15:
        et_comp = -1.0

    tilt_align = 0.0
    if course <= 2 and tilt <= -0.5:
        tilt_align = 1.0
    elif course >= 4 and tilt >= 0.5:
        tilt_align = 1.0
    elif (course <= 2 and tilt >= 0.5) or (course >= 4 and tilt <= -0.5):
        tilt_align = -1.0

    return [
        nat_win / 10.0,
        motor_rate / 100.0,
        (et_rank + 1) / 6.0,
        course / 6.0,
        cls_num / 4.0,
        wind_course,
        racer_cwr if racer_cwr is not None else nat_win / 100.0,
        (st_rank + 1) / 6.0,
        et_comp,
        0.0,  # formScore は server 側で recentResults を持たないので 0
        tilt_align,
        stad_cwr,
    ]


def collect_training_pairs() -> list[tuple[list[list[float]], int]]:
    """直近 results から (features6, winnerIdx) ペアを収集。"""
    racer_db = safe_load_json(str(RACER_DB_PATH), {}) or {}
    stadium_db = safe_load_json(str(STADIUM_DB_PATH), {}) or {}

    pairs: list[tuple[list[list[float]], int]] = []
    if not RESULTS_DIR.exists():
        return pairs

    files = sorted(RESULTS_DIR.glob("*.json"))[-30:]   # 直近 30 ファイル（=日次なら 30 日）
    for fp in files:
        data = safe_load_json(str(fp), {}) or {}
        for race in data.get("results", []):
            sid = str(race.get("race_stadium_number") or "")
            if not sid or not race.get("boats"):
                continue
            boats = race["boats"]
            if len(boats) < 6:
                continue
            # 1 着艇 → winner_idx
            winner_idx = -1
            for i, b in enumerate(boats):
                if b.get("racer_place") == 1:
                    winner_idx = i
                    break
            if winner_idx < 0:
                continue
            # 6 艇分の features6
            feats = []
            for b in boats:
                # preview / et_rank / st_rank はサーバ側に無いので 0/5 で fallback
                feats.append(get_l2_features(b, None, racer_db, stadium_db, sid, 5, 5))
            pairs.append((feats, winner_idx))
            if len(pairs) >= MAX_RACES:
                return pairs
    return pairs


def train_l2(pairs: list[tuple[list[list[float]], int]]) -> tuple[list[float], int]:
    """LR decay + L2 正則化付き SGD で 12 次元重みを学習。"""
    weights = INIT_WEIGHTS[:]
    n_steps = 0
    for feats6, winner_idx in pairs:
        # L2 forward
        logits = []
        for boat_feat in feats6:
            z = sum(weights[i] * boat_feat[i] for i in range(FEATURE_DIM))
            logits.append(z)
        probs = softmax(logits)
        # LR decay
        lr = LR0 / (1 + n_steps / LR_TAU)
        # gradient (cross entropy)
        for b in range(6):
            err = probs[b] - (1.0 if b == winner_idx else 0.0)
            for i in range(FEATURE_DIM):
                grad = err * (feats6[b][i] or 0.0) + LAMBDA * weights[i]
                weights[i] -= lr * grad
        n_steps += 1
    return weights, n_steps


def collect_training_pairs_by_stadium() -> dict[str, list]:
    """場別 training pairs を返す（階層的 FL の per-stadium 学習用）。"""
    racer_db = safe_load_json(str(RACER_DB_PATH), {}) or {}
    stadium_db = safe_load_json(str(STADIUM_DB_PATH), {}) or {}
    by_sid: dict[str, list] = {}
    if not RESULTS_DIR.exists():
        return by_sid
    files = sorted(RESULTS_DIR.glob("*.json"))[-30:]
    for fp in files:
        data = safe_load_json(str(fp), {}) or {}
        for race in data.get("results", []):
            sid = str(race.get("race_stadium_number") or "")
            if not sid or not race.get("boats"):
                continue
            boats = race["boats"]
            if len(boats) < 6:
                continue
            winner_idx = -1
            for i, b in enumerate(boats):
                if b.get("racer_place") == 1:
                    winner_idx = i
                    break
            if winner_idx < 0:
                continue
            feats = [get_l2_features(b, None, racer_db, stadium_db, sid, 5, 5) for b in boats]
            by_sid.setdefault(sid, []).append((feats, winner_idx))
    return by_sid


def collect_fl_uploads() -> list[dict]:
    """Epic 24: クライアント由来の DP gradient upload を収集。"""
    if not FL_UPLOADS_DIR.exists():
        return []
    uploads = []
    for fp in sorted(FL_UPLOADS_DIR.glob("*.json")):
        try:
            data = safe_load_json(str(fp), None)
            if data and isinstance(data.get("weights"), list) and len(data["weights"]) == FEATURE_DIM:
                uploads.append(data)
        except Exception as e:
            print(f"[community] fl_upload load failed {fp.name}: {e}")
    return uploads


def fed_average(weights_list: list[list[float]], n_list: list[int]) -> list[float]:
    """federated averaging — n (学習ステップ数) で重み付け平均。"""
    if not weights_list:
        return INIT_WEIGHTS[:]
    total_n = sum(n_list) or 1
    avg = [0.0] * FEATURE_DIM
    for w, n in zip(weights_list, n_list):
        for i in range(FEATURE_DIM):
            v = w[i] if i < len(w) and isinstance(w[i], (int, float)) and math.isfinite(w[i]) else 0.0
            avg[i] += v * (n / total_n)
    return avg


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    print(f"[community] collecting training pairs from {RESULTS_DIR}/*.json")

    # Epic 21 拡張: global + per-stadium の階層的学習
    pairs = collect_training_pairs()
    print(f"[community] collected {len(pairs)} race samples (global)")
    if not pairs:
        print("[community] no training data, skipping")
        return
    weights, n_steps = train_l2(pairs)

    # Epic 24: クライアントからの FL upload を fed-averaging で blend
    fl_uploads = collect_fl_uploads()
    if fl_uploads:
        print(f"[community] blending {len(fl_uploads)} FL uploads via fed-averaging")
        # サーバ学習結果 + 全クライアント upload で fed-average
        all_weights = [weights] + [u["weights"] for u in fl_uploads]
        all_n = [n_steps] + [int(u.get("n_steps") or 100) for u in fl_uploads]
        weights = fed_average(all_weights, all_n)
        n_steps = sum(all_n)

    # per-stadium の独立学習（場別の流れ・水面特性を吸収）
    by_sid = collect_training_pairs_by_stadium()
    stadium_weights: dict[str, list[float]] = {}
    stadium_n: dict[str, int] = {}
    for sid, sid_pairs in by_sid.items():
        if len(sid_pairs) < 20:  # 学習には最低 20 サンプル必要
            continue
        sw, sn = train_l2(sid_pairs)
        stadium_weights[sid] = sw
        stadium_n[sid] = sn
    print(f"[community] per-stadium weights computed for {len(stadium_weights)} stadiums")

    payload = {
        "weights": weights,
        "n": n_steps,
        "feature_dim": FEATURE_DIM,
        "feature_version": 1,
        "fitted_at": utc_iso_seconds(),
        # Epic 21: 階層的 FL 構造 — クライアントは self / stadium / global を blend
        "stadium_weights": stadium_weights,
        "stadium_n": stadium_n,
        "fl_architecture": "centralized_hierarchical_with_uploads",  # Epic 24
        "fl_upload_count": len(fl_uploads),  # Epic 24: 取り込んだクライアント数
        "_meta": quality_header(
            schema_version=2,  # bump (stadium_weights 追加)
            source_freshness_sec=0.0,
            reliability_score=min(1.0, len(pairs) / 1000.0),
            scraper="community_weights",
        ),
    }
    atomic_write_json(str(OUTPUT), payload)
    print(f"[community] wrote {OUTPUT} (global n={n_steps}, stadium_weights={len(stadium_weights)})")


if __name__ == "__main__":
    main()
