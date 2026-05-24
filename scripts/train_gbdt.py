#!/usr/bin/env python3
"""GBDT (Gradient Boosted Decision Trees) trainer for boat race prediction.

Tier 3 (2026-05-24) — Tier 1/2 (L2 + Isotonic + per-stadium Platt) の上に GBDT を
重ねて非線形 feature 交互作用を学習する。

入力:
  - data/results/*.json (過去レース結果)
  - data/db/racerDB.json (選手 DB)
  - data/db/stadiumDB.json (場 DB)

出力:
  - data/db/gbdt_model.json (br_gbdt_v1 schema)

実行:
  python3 scripts/train_gbdt.py                    # 学習
  python3 scripts/train_gbdt.py --dry-run          # データ件数のみ確認
  python3 scripts/train_gbdt.py --min-races 5000   # 最小サンプル数 override

設計:
  - 6 艇それぞれの 1 着確率を独立に予測 (one-vs-rest, multi-class)
  - 特徴量は compute_community_weights.py と同じ 24 dim
    (v1 領域 12 dim のみ実値、v2 領域 12 dim はサーバ側未取得のため 0)
  - sklearn.ensemble.GradientBoostingClassifier (純粋な Python、軽量)
  - 学習サンプル < min-races (既定 5000) なら placeholder JSON 出力 (no-op model)
  - sklearn の DecisionTreeClassifier の tree_ structure を JSON にシリアライズ

注:
  - lightgbm は使わず sklearn のみ (GHA setup 時間短縮 + pure Python)
  - 学習は単体 (full) のみ、incremental は将来検討
  - 過学習防止: depth=4 / n_estimators=50 / learning_rate=0.1 (保守的)
"""
from __future__ import annotations

import argparse
import datetime
import json
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("train_gbdt")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

RESULTS_DIR = ROOT / "data" / "results"
RACER_DB_PATH = ROOT / "data" / "db" / "racerDB.json"
STADIUM_DB_PATH = ROOT / "data" / "db" / "stadiumDB.json"
OUTPUT = ROOT / "data" / "db" / "gbdt_model.json"

# Hyperparameters (保守的、過学習防止寄り)
N_ESTIMATORS = 50
MAX_DEPTH = 4
LEARNING_RATE = 0.1
MIN_SAMPLES = 5000  # この未満なら placeholder 出力 (実 ML せず)
FEATURE_DIM = 24
FEATURE_VERSION = 2


def _safe_load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _collect_training_pairs() -> tuple[list[list[float]], list[int]]:
    """results からレース毎の (features_6_boats, winner_idx) を集めて、各艇を別サンプルとして展開。

    Returns:
        X: shape=(n_samples, FEATURE_DIM) features per boat
        y: shape=(n_samples,) — 1 if this boat won, 0 otherwise
    """
    # 既存 compute_community_weights.py の特徴量生成を再利用 (24 dim、v2 領域は 0 fallback)
    from compute_community_weights import get_l2_features  # type: ignore

    racer_db = _safe_load_json(RACER_DB_PATH, {}) or {}
    stadium_db = _safe_load_json(STADIUM_DB_PATH, {}) or {}

    X: list[list[float]] = []
    y: list[int] = []
    if not RESULTS_DIR.exists():
        log.warning("results dir not found: %s", RESULTS_DIR)
        return X, y

    files = sorted(RESULTS_DIR.glob("*.json"))
    log.info("scanning %d result files", len(files))
    for fp in files:
        data = _safe_load_json(fp, {}) or {}
        for race in data.get("results", []):
            sid = str(race.get("race_stadium_number") or "")
            boats = race.get("boats") or []
            if not sid or len(boats) < 6:
                continue
            winner_idx = -1
            for i, b in enumerate(boats):
                if b.get("racer_place") == 1:
                    winner_idx = i
                    break
            if winner_idx < 0:
                continue
            # 各艇を個別サンプルとして展開 (winner=1, それ以外=0)
            for i, b in enumerate(boats):
                feats = get_l2_features(b, None, racer_db, stadium_db, sid, 5, 5)
                X.append(feats)
                y.append(1 if i == winner_idx else 0)
    return X, y


def _placeholder_output(reason: str, n_train: int) -> None:
    """学習データ不足時の placeholder JSON 出力。"""
    out = {
        "schema": "br_gbdt_v1",
        "feature_dim": FEATURE_DIM,
        "feature_version": FEATURE_VERSION,
        "n_classes": 6,
        "trees": [],
        "n_trees": 0,
        "learning_rate": LEARNING_RATE,
        "fitted_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "n_train": n_train,
        "_meta": {
            "placeholder": True,
            "reason": reason,
        },
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("wrote placeholder: %s (reason=%s)", OUTPUT, reason)


def _serialize_tree(tree, learner_idx: int, class_idx: int) -> dict:
    """sklearn DecisionTreeRegressor の tree_ を {nodes: [...]} 形式に変換。

    sklearn の tree_ 構造:
      - tree_.feature[i]: 内部 node の特徴量 index (-2 = leaf)
      - tree_.threshold[i]: 閾値 (<=)
      - tree_.children_left[i] / children_right[i]: 子 node index
      - tree_.value[i][0][0]: leaf value (GBM regressor の場合)
    """
    t = tree.tree_
    nodes = []
    for i in range(t.node_count):
        if t.children_left[i] == t.children_right[i] == -1:
            # 葉ノード
            nodes.append({"value": float(t.value[i][0][0])})
        else:
            nodes.append({
                "feat": int(t.feature[i]),
                "thr": float(t.threshold[i]),
                "left": int(t.children_left[i]),
                "right": int(t.children_right[i]),
            })
    return {"class": class_idx, "nodes": nodes}


def _train_and_serialize(X: list[list[float]], y: list[int]) -> dict:
    """sklearn GradientBoostingClassifier で学習し、JSON シリアライズ。"""
    try:
        import numpy as np  # type: ignore
        from sklearn.ensemble import GradientBoostingClassifier  # type: ignore
    except ImportError as e:
        log.error("sklearn / numpy 未インストール: %s — pip install scikit-learn numpy", e)
        raise SystemExit(2)

    Xa = np.array(X, dtype=np.float32)
    ya = np.array(y, dtype=np.int32)
    log.info("training X.shape=%s, y.sum=%d (positive rate=%.3f)", Xa.shape, int(ya.sum()), float(ya.mean()))

    clf = GradientBoostingClassifier(
        n_estimators=N_ESTIMATORS,
        max_depth=MAX_DEPTH,
        learning_rate=LEARNING_RATE,
        subsample=0.8,
        random_state=42,
    )
    clf.fit(Xa, ya)
    log.info("training done, train_score=%.4f", clf.score(Xa, ya))

    # 二値分類なので class=0 (winner) の単一 estimator chain
    # estimators_ shape: (n_estimators, n_classes-1) for binary = (50, 1)
    trees = []
    for est_idx, est_row in enumerate(clf.estimators_):
        for cls_idx, tree in enumerate(est_row):
            # 二値分類なら class_idx は 0 のみ (winner=1 の logit に向かう regressor)
            # gbdt_runtime.js 側は 1..6 号艇それぞれ logit を別途計算する設計だが、
            # 今は全艇に同じ「自艇が勝つ確率」を推定する 1 channel として利用
            trees.append(_serialize_tree(tree, est_idx, 0))

    out = {
        "schema": "br_gbdt_v1",
        "feature_dim": FEATURE_DIM,
        "feature_version": FEATURE_VERSION,
        "n_classes": 6,
        "trees": trees,
        "n_trees": len(trees),
        "learning_rate": LEARNING_RATE,
        "fitted_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "n_train": int(Xa.shape[0]),
        "init_logit": float(clf.init_.class_prior_[1]) if hasattr(clf.init_, "class_prior_") else 0.0,
        "_meta": {
            "placeholder": False,
            "sklearn_estimators": N_ESTIMATORS,
            "max_depth": MAX_DEPTH,
            "subsample": 0.8,
        },
    }
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="train_gbdt 実行せず収集件数のみ表示")
    parser.add_argument("--min-races", type=int, default=MIN_SAMPLES, help="学習開始最低サンプル数 (既定 5000)")
    args = parser.parse_args()

    log.info("=== train_gbdt start (min_races=%d) ===", args.min_races)
    X, y = _collect_training_pairs()
    n = len(X)
    log.info("collected %d samples (positive=%d)", n, sum(y))

    if args.dry_run:
        log.info("dry-run: would train if n >= %d (current n=%d)", args.min_races, n)
        return 0

    if n < args.min_races:
        _placeholder_output(f"insufficient samples: {n} < {args.min_races}", n)
        return 0

    out = _train_and_serialize(X, y)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("wrote %s (n_trees=%d, n_train=%d)", OUTPUT, out["n_trees"], out["n_train"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
