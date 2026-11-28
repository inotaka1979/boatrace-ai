"""scrape-all.yml の決まりごと（2026-11-28）

1. checkout は event の SHA ではなく、ブランチの今の先頭から始める。
   実害: 前の run の終了待ち (concurrency) の後で始まった run は、前の run が commit する前の状態から同じ
   data/*.json を作り直すので、push の rebase が必ず衝突して 5 回とも失敗し、その run の成果が消える
   （2026-11-27 run 1523: マージで起動 → 定時の run 1522 の終了待ち → push failed after 5 attempts）。
   番組表を前の晩に取る run は 40 分かかることがあり、待たされる run が増える。

2. schedule は「1 日 1 回の行」だけで書く。
   実測 (2026-11-25〜28): 1 行で何度も発火する書き方（毎時など）は、前の 1 件が届くまで次が捨てられ、
   1 日 2 回ほどしか届かない（worker-watchdog = 1 行・毎時 → 1 日 2 回）。1 日 1 回の行は、5〜12 時間
   遅れても全部届く（この workflow の 6 行 → 1 日 6 回）。docs/RUNBOOK.md §15.4。

3. 1 つの job の長さ: scrape_all.py の予算 (JOB_BUDGET_SEC) の後に、集計と commit の時間が残る。

  python3 -m unittest scripts.tests.test_scrape_all_workflow
"""
from __future__ import annotations

import os
import re
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import scrape_all  # noqa: E402

WORKFLOW = os.path.join(ROOT, ".github", "workflows", "scrape-all.yml")


def _text() -> str:
    with open(WORKFLOW, encoding="utf-8") as f:
        return f.read()


def _no_comments(block: str) -> str:
    return "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("#"))


def checkout_block(text: str) -> str:
    """actions/checkout の step（次の step の手前まで）。コメント行は除く。"""
    m = re.search(r"^(\s*)- uses: actions/checkout@\S+\n", text, re.M)
    if not m:
        return ""
    indent = m.group(1)
    rest = text[m.end():]
    nxt = re.search(r"^%s- " % re.escape(indent), rest, re.M)
    return _no_comments(rest[: nxt.start()] if nxt else rest)


def cron_lines(text: str) -> list[str]:
    return re.findall(r"^\s*-\s*cron:\s*'([^']+)'", text, re.M)


class TestCheckout(unittest.TestCase):
    def test_starts_from_the_branch_tip_not_the_event_sha(self):
        block = checkout_block(_text())
        self.assertTrue(block, "actions/checkout の step がある")
        # ref を明示すると、action は event の SHA に固定せず、その ref の今の先頭を取る
        self.assertRegex(block, r"(?m)^\s*ref:\s*\$\{\{\s*github\.ref\s*\}\}\s*$")
        self.assertRegex(block, r"(?m)^\s*persist-credentials:\s*false\s*$", "push は明示の token で行う")

    def test_helper_reads_only_the_checkout_step(self):
        sample = (
            "    steps:\n"
            "      - uses: actions/checkout@v7\n"
            "        with:\n"
            "          # ref: ${{ github.ref }}\n"
            "          persist-credentials: false\n"
            "      - uses: actions/setup-python@v7\n"
            "        with:\n"
            "          ref: ${{ github.ref }}\n"
        )
        block = checkout_block(sample)
        self.assertIn("persist-credentials: false", block)
        self.assertNotIn("ref:", block, "コメントの中・次の step の ref は数えない")

    def test_runs_are_queued_not_cancelled(self):
        # 前の run の終了を待つ設定（途中で止めると、その run が取った分が commit されない）
        text = _no_comments(_text())
        self.assertRegex(text, r"(?m)^concurrency:\n\s+group:\s*scrape-all\s*$")
        self.assertRegex(text, r"(?m)^\s+cancel-in-progress:\s*false\s*$")


class TestSchedule(unittest.TestCase):
    def test_every_line_fires_once_a_day(self):
        lines = cron_lines(_text())
        self.assertGreaterEqual(len(lines), 6)
        for expr in lines:
            self.assertRegex(expr, r"^\d{1,2} \d{1,2} \* \* \*$",
                             "1 行で何度も発火する書き方は、前の 1 件が届くまで次が捨てられる: %r" % expr)
            minute, hour = (int(x) for x in expr.split()[:2])
            self.assertTrue(0 <= minute <= 59 and 0 <= hour <= 23, expr)
        self.assertEqual(len(set(lines)), len(lines), "同じ行が 2 つある")

    def test_helper_reads_cron_lines(self):
        sample = "  schedule:\n    - cron: '30 23 * * *'   # JST 8:30\n    # - cron: '0 0 * * *'\n    - cron: '*/5 0-12 * * *'\n"
        self.assertEqual(cron_lines(sample), ["30 23 * * *", "*/5 0-12 * * *"])


class TestJobLength(unittest.TestCase):
    def test_scrape_budget_leaves_time_for_the_commit(self):
        m = re.search(r"^\s*timeout-minutes:\s*(\d+)", _text(), re.M)
        self.assertIsNotNone(m)
        job_sec = int(m.group(1)) * 60
        # 予算を使い切った後に始まる作業は最低 120 秒だけ動く（_remaining_budget_sec の下限）。
        #   その後ろに集計（archive_daily ほか）と commit & push が続く
        from unittest import mock

        with mock.patch.object(scrape_all.time, "monotonic", return_value=90000.0), \
             mock.patch.object(scrape_all, "_RUN_STARTED", 90000.0 - scrape_all.JOB_BUDGET_SEC - 500):
            floor = scrape_all._remaining_budget_sec(2400)
        self.assertEqual(floor, 120)
        self.assertGreaterEqual(job_sec - scrape_all.JOB_BUDGET_SEC, floor + 300)


if __name__ == "__main__":
    unittest.main()
