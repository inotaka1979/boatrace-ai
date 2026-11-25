"""scripts/vrt_request.sh — 意図して見た目を変えた VRT スナップショットの申告（2026-11-25）

一時的な git リポジトリを作り、PR（merge commit）/ main への push を再現して、
申告ファイルが「今回のイベントで変更されたとき」だけパターンが出ることを確かめる。

    python3 -m unittest scripts.tests.test_vrt_request -v
"""

import os
import subprocess
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT = os.path.join(ROOT, "scripts", "vrt_request.sh")
REQ = "tests/e2e/vrt-baseline-request"


class VrtRequestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@example.invalid")
        self.git("config", "user.name", "t")
        self.git("config", "commit.gpgsign", "false")
        os.makedirs(os.path.join(self.repo, "tests", "e2e"))
        self.write(REQ, "# 説明\n\nold: title\n")
        self.write("app.js", "v1\n")
        self.commit("base")

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True, text=True).stdout.strip()

    def write(self, rel, text):
        with open(os.path.join(self.repo, rel), "w", encoding="utf-8") as f:
            f.write(text)

    def commit(self, msg):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg)
        return self.git("rev-parse", "HEAD")

    def run_script(self, *args):
        r = subprocess.run(["bash", SCRIPT, *args], cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def merge_pr(self, change):
        """PR ブランチで change() を commit し、main との merge commit を checkout した状態にする。"""
        self.git("checkout", "-q", "-b", "pr")
        change()
        self.commit("pr change")
        self.git("checkout", "-q", "main")
        self.write("data.json", "bot\n")  # PR と無関係な main 側の更新
        self.commit("bot data")
        self.git("merge", "-q", "--no-ff", "-m", "Merge pull request", "pr")

    # ---- pull_request ----
    def test_pr_that_changes_the_request_file(self):
        self.merge_pr(lambda: self.write(REQ, "# 説明\n#  コメント\n\nnav: bottom navigation  \nraces page: wrapper\n"))
        self.assertEqual(self.run_script("pull_request"), "nav: bottom navigation|races page: wrapper")

    def test_pr_that_does_not_touch_the_request_file(self):
        self.merge_pr(lambda: self.write("app.js", "v2\n"))
        self.assertEqual(self.run_script("pull_request"), "")

    def test_pr_changing_only_comments_still_lists_the_current_lines(self):
        # 申告ファイルを触った以上、書かれているテストは撮り直しの対象（ファイルの説明に明記）
        self.merge_pr(lambda: self.write(REQ, "# 説明を直した\n\nold: title\n"))
        self.assertEqual(self.run_script("pull_request"), "old: title")

    def test_pr_with_only_comments_left_yields_nothing(self):
        self.merge_pr(lambda: self.write(REQ, "# 申告なし\n\n"))
        self.assertEqual(self.run_script("pull_request"), "")

    def test_shallow_checkout_without_parent_is_strict(self):
        # fetch-depth: 1 相当（親が無い）→ 判定できないので何も出さない = 全テスト比較
        self.write(REQ, "nav: bottom navigation\n")
        self.commit("change")
        clone = os.path.join(self.repo, "shallow")
        subprocess.run(["git", "clone", "-q", "--depth", "1", "file://" + self.repo, clone], check=True, capture_output=True)
        r = subprocess.run(["bash", SCRIPT, "pull_request"], cwd=clone, capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, ""))

    # ---- push ----
    def test_push_range_including_the_change(self):
        before = self.git("rev-parse", "HEAD")
        self.merge_pr(lambda: self.write(REQ, "nav: bottom navigation\n"))
        self.assertEqual(self.run_script("push", before), "nav: bottom navigation")

    def test_push_range_without_the_change(self):
        self.merge_pr(lambda: self.write(REQ, "nav: bottom navigation\n"))
        before = self.git("rev-parse", "HEAD")
        self.write("app.js", "v3\n")
        self.commit("later change")
        self.assertEqual(self.run_script("push", before), "")

    def test_push_with_several_commits_looks_at_the_whole_range(self):
        # 1 回の push に複数 commit（申告の変更は先頭の commit、最後の commit は別のファイル）
        before = self.git("rev-parse", "HEAD")
        self.write(REQ, "nav: bottom navigation\n")
        self.commit("request")
        self.write("app.js", "v2\n")
        self.commit("code")
        self.assertEqual(self.run_script("push", before), "nav: bottom navigation")

    def test_push_new_branch_or_unknown_before(self):
        self.write(REQ, "nav: bottom navigation\n")
        self.commit("change")
        self.assertEqual(self.run_script("push", "0" * 40), "")
        self.assertEqual(self.run_script("push", ""), "")
        self.assertEqual(self.run_script("push", "1" * 40), "")  # 取りに行けない SHA

    # ---- その他 ----
    def test_other_events_and_missing_file(self):
        self.merge_pr(lambda: self.write(REQ, "nav: bottom navigation\n"))
        self.assertEqual(self.run_script("workflow_dispatch"), "")
        self.assertEqual(self.run_script(), "")
        os.remove(os.path.join(self.repo, REQ))
        self.assertEqual(self.run_script("pull_request"), "")

    def test_repo_request_file_names_an_existing_vrt_test(self):
        """リポジトリの申告ファイルに書いたタイトルが、実在する VRT テストに当たること。"""
        import re

        with open(os.path.join(ROOT, REQ), encoding="utf-8") as f:
            lines = [ln.strip() for ln in f if ln.strip() and not ln.lstrip().startswith("#")]
        with open(os.path.join(ROOT, "tests", "e2e", "screens.vrt.spec.mjs"), encoding="utf-8") as f:
            titles = re.findall(r"^test\('([^']+)'", f.read(), flags=re.M)
        self.assertTrue(titles)
        for pat in lines:
            hit = [t for t in titles if re.search(pat, t)]
            self.assertTrue(hit, f"申告 {pat!r} に当たる VRT テストが無い")
            self.assertLess(len(hit), len(titles), f"申告 {pat!r} が全テストに当たる（比較が無効になる）")


if __name__ == "__main__":
    unittest.main()
