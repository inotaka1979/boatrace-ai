"""Epic 17 (P2-6): community weights 計算ロジックのユニットテスト

実行: python3 scripts/tests/test_community_weights.py
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compute_community_weights import softmax, get_l2_features, train_l2, INIT_WEIGHTS, FEATURE_DIM


class TestSoftmax(unittest.TestCase):
    def test_normal(self):
        r = softmax([1.0, 2.0, 3.0])
        self.assertAlmostEqual(sum(r), 1.0, places=9)
        self.assertGreater(r[2], r[1])
        self.assertGreater(r[1], r[0])

    def test_extreme(self):
        r = softmax([1000, -1000, 500])
        self.assertAlmostEqual(sum(r), 1.0, places=9)
        # 全て finite
        for v in r:
            self.assertTrue(0 <= v <= 1)

    def test_empty(self):
        self.assertEqual(softmax([]), [])

    def test_all_neginf(self):
        r = softmax([float('-inf'), float('-inf'), float('-inf')])
        self.assertAlmostEqual(sum(r), 1.0, places=6)


class TestGetL2Features(unittest.TestCase):
    def test_dimension(self):
        boat = {
            'racer_boat_number': 1, 'racer_number': 4444, 'racer_class_number': 1,
            'racer_national_top_1_percent': 5.5, 'racer_assigned_motor_top_2_percent': 38,
        }
        feats = get_l2_features(boat, None, {}, {}, '01', 0, 0)
        self.assertEqual(len(feats), FEATURE_DIM)
        for v in feats:
            self.assertIsInstance(v, float)

    def test_class_default(self):
        # class 欠損 → 3 (B1) として扱う
        boat = {
            'racer_boat_number': 2, 'racer_number': 5555,
            'racer_national_top_1_percent': 4.0, 'racer_assigned_motor_top_2_percent': 30,
        }
        feats = get_l2_features(boat, None, {}, {}, '02', 5, 5)
        # class index 4 (=classNum/4) ≈ 0.75 (3/4)
        self.assertAlmostEqual(feats[4], 0.75, places=3)


class TestTrainL2(unittest.TestCase):
    def test_no_pairs_returns_init(self):
        weights, n = train_l2([])
        self.assertEqual(weights, INIT_WEIGHTS)
        self.assertEqual(n, 0)

    def test_simple_convergence(self):
        # 全レースで 1 号艇 (idx=0) が勝つ簡単なシナリオ → 1コース重みが正方向に動く
        boat_strong = {'racer_boat_number': 1, 'racer_number': 1000, 'racer_class_number': 1,
                       'racer_national_top_1_percent': 6.0, 'racer_assigned_motor_top_2_percent': 40}
        boat_weak = {'racer_boat_number': 6, 'racer_number': 6000, 'racer_class_number': 4,
                     'racer_national_top_1_percent': 4.0, 'racer_assigned_motor_top_2_percent': 30}
        feat_strong = get_l2_features(boat_strong, None, {}, {}, '01', 0, 0)
        feat_weak = get_l2_features(boat_weak, None, {}, {}, '01', 5, 5)
        # 6 艇のうち 0 番目が常勝
        feats6 = [feat_strong] + [feat_weak] * 5
        pairs = [(feats6, 0)] * 100  # 100 サンプル
        weights, n = train_l2(pairs)
        self.assertEqual(n, 100)
        self.assertEqual(len(weights), FEATURE_DIM)
        # 全 weight が finite
        import math
        for w in weights:
            self.assertTrue(math.isfinite(w))


class TestEpic24FedAverage(unittest.TestCase):
    """Epic 24: FL upload の fed-averaging テスト"""

    def test_fed_average_single(self):
        from compute_community_weights import fed_average, FEATURE_DIM
        # 12 次元配列を渡す → 同じ配列が返る
        w = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0]
        avg = fed_average([w], [10])
        self.assertEqual(len(avg), FEATURE_DIM)
        for i in range(FEATURE_DIM):
            self.assertAlmostEqual(avg[i], w[i], places=6)

    def test_fed_average_weighted(self):
        from compute_community_weights import fed_average
        # 重み 1: [10,...] n=90, 重み 2: [0,...] n=10 → 平均 9, ...
        ws = [[10.0] * 12, [0.0] * 12]
        ns = [90, 10]
        avg = fed_average(ws, ns)
        self.assertEqual(len(avg), 12)
        # 加重平均: 10*0.9 + 0*0.1 = 9
        for v in avg:
            self.assertAlmostEqual(v, 9.0, places=6)

    def test_fed_average_empty_returns_init(self):
        from compute_community_weights import fed_average, INIT_WEIGHTS
        avg = fed_average([], [])
        self.assertEqual(avg, INIT_WEIGHTS)

    def test_fed_average_skips_invalid(self):
        from compute_community_weights import fed_average
        # NaN が混じっても 0 として扱われる
        ws = [[float('nan')] * 12, [1.0] * 12]
        ns = [50, 50]
        avg = fed_average(ws, ns)
        for v in avg:
            self.assertAlmostEqual(v, 0.5, places=6)


if __name__ == '__main__':
    unittest.main(verbosity=2)
