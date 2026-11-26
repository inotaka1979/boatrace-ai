"""scripts/verify_push.sh（デプロイ後の Web Push の確認、2026-11-27）

curl と sleep を差し替えて、分岐を 1 つずつ通す。
  - 登録口・暗号の確認は、1 つでも違えば失敗させる（Web Push が動かないままデプロイを緑にしない）
  - 毎分の cron の記録は、待っても来なければ warning（失敗にはしない）

  python3 -m unittest scripts.tests.test_verify_push
"""

import json
import os
import pathlib
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "verify_push.sh"

# 差し替えの curl: 経路ごとに、呼ばれた順に $PLAN の応答を返す（足りなければ最後の応答を繰り返す）。
FAKE_CURL = r"""#!/usr/bin/env python3
import json, os, sys
from urllib.parse import urlparse
plan = json.load(open(os.environ["PLAN"], encoding="utf-8"))
log = os.environ["CALLS"]
args = sys.argv[1:]
url = [a for a in args if a.startswith("http")][-1]
path = urlparse(url).path
method = args[args.index("-X") + 1] if "-X" in args else "GET"
data = args[args.index("--data") + 1] if "--data" in args else ""
ctype = [args[i + 1] for i, a in enumerate(args) if a == "-H"]
prev = [l for l in open(log, encoding="utf-8")] if os.path.exists(log) else []
n = sum(1 for l in prev if json.loads(l)["path"] == path)
open(log, "a", encoding="utf-8").write(json.dumps({"path": path, "method": method, "data": data, "headers": ctype}) + "\n")
rs = plan.get(path) or [{"status": 404, "body": "{}"}]
r = rs[n] if n < len(rs) else rs[-1]
if r.get("fail"):
    sys.stdout.write("000")
    sys.exit(7)
out = args[args.index("-o") + 1] if "-o" in args else None
if out and out != "/dev/null":
    body = r.get("body", "")
    open(out, "w", encoding="utf-8").write(body if isinstance(body, str) else json.dumps(body))
sys.stdout.write(str(r["status"]))
"""

KEY = "B" + "a" * 86
GOOD = {
    "/push/selftest": [{"status": 200, "body": {"ok": True, "error": None}}],
    "/push/key": [{"status": 200, "body": {"key": KEY}}],
    "/push/subscribe": [{"status": 400, "body": {"error": "bad_endpoint"}}],
    "/push/test": [{"status": 404, "body": {"error": "not_registered"}}],
    "/push/status": [{"status": 200, "body": {"ok": True, "key": True, "subs": 1, "index_races": 144, "tick_at": "2026-11-27T03:00:00.000Z",
                                             "tick_age_sec": 120, "sent_today": 3, "sent_writes_today": 3, "max_sent_writes": 100,
                                             "subs_writes_today": 2, "max_subs_writes": 60}}],
}


def plan(**over):
    p = {k: list(v) for k, v in GOOD.items()}
    p.update(over)
    return p


def run(p, *extra):
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        for name, body in (("curl", FAKE_CURL), ("sleep", "#!/bin/sh\necho \"$1\" >> \"$SLEEPS\"\nexit 0\n")):
            f = d / name
            f.write_text(body, encoding="utf-8")
            f.chmod(f.stat().st_mode | stat.S_IEXEC)
        (d / "plan.json").write_text(json.dumps(p), encoding="utf-8")
        env = dict(os.environ, PATH=f"{d}:{os.environ['PATH']}", PLAN=str(d / "plan.json"), CALLS=str(d / "calls"), SLEEPS=str(d / "sleeps"))
        r = subprocess.run(["bash", str(SCRIPT), "https://w.example.dev/"] + list(extra), env=env, capture_output=True, text=True, timeout=60)
        calls = [json.loads(l) for l in (d / "calls").read_text(encoding="utf-8").splitlines()] if (d / "calls").exists() else []
        sleeps = (d / "sleeps").read_text(encoding="utf-8").split() if (d / "sleeps").exists() else []
        return r.returncode, r.stdout + r.stderr, calls, sleeps


class TestRoutes(unittest.TestCase):
    def test_all_good(self):
        code, out, calls, _ = run(plan())
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("✅"), 4, out)
        self.assertNotIn("❌", out)
        self.assertEqual([c["path"] for c in calls], ["/push/selftest", "/push/key", "/push/key", "/push/subscribe", "/push/test", "/push/status"])
        self.assertIn("宛先 1 件 / 索引 144 レース / 今日送った数 3", out)
        self.assertIn("今日の KV 書込: 宛先の文書 2/60 回・送った記録 3/100 回", out)
        self.assertNotIn("::warning::", out)

    def test_write_caps_reached_are_warnings_not_failures(self):
        # 書込の上限に達していたら知らせる（デプロイは失敗させない）。上限の 1 つ手前では出さない
        def status(**over):
            body = dict(GOOD["/push/status"][0]["body"])
            body.update(over)
            return [{"status": 200, "body": body}]

        code, out, _, _ = run(plan(**{"/push/status": status(subs_writes_today=60)}))
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("::warning::"), 1, out)
        self.assertIn("宛先の書込が今日の上限 (60 回)", out)
        code, out, _, _ = run(plan(**{"/push/status": status(sent_writes_today=100)}))
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("::warning::"), 1, out)
        self.assertIn("「送った記録」の書込が今日の上限 (100 回)", out)
        code, out, _, _ = run(plan(**{"/push/status": status(subs_writes_today=59, sent_writes_today=99)}))
        self.assertNotIn("::warning::", out)
        # 項目の無い版・読めない値では落ちず、警告も出さない
        for body in ({"ok": True, "subs": 0}, {"ok": True, "subs_writes_today": "x", "max_subs_writes": None, "sent_writes_today": [], "max_sent_writes": {}}, "not json"):
            code, out, _, _ = run(plan(**{"/push/status": [{"status": 200, "body": body}]}))
            self.assertEqual(code, 0, out)
            self.assertNotIn("::warning::", out)
            self.assertIn("今日の KV 書込:", out)
        # 登録口の確認が失敗していれば、書込の表示に関係なく失敗のまま
        code, out, _, _ = run(plan(**{"/push/status": status(subs_writes_today=60), "/push/test": [{"status": 200, "body": {"ok": True}}]}))
        self.assertEqual(code, 1, out)

    def test_posts_are_text_plain_json_that_cannot_register_or_send(self):
        _, _, calls, _ = run(plan())
        sub = [c for c in calls if c["path"] == "/push/subscribe"][0]
        test = [c for c in calls if c["path"] == "/push/test"][0]
        for c in (sub, test):
            self.assertEqual(c["method"], "POST")
            self.assertIn("content-type: text/plain;charset=UTF-8", c["headers"])
        body = json.loads(sub["data"])
        # 決まった push service ではない宛先（登録されない）
        self.assertTrue(body["sub"]["endpoint"].startswith("https://push-check.invalid/"))
        # 登録されていない宛先（送信されない）
        self.assertIn("not-registered", json.loads(test["data"])["endpoint"])
        self.assertTrue(json.loads(test["data"])["endpoint"].startswith("https://fcm.googleapis.com/"))

    def test_trailing_slash_and_missing_argument(self):
        _, _, calls, _ = run(plan())
        self.assertTrue(all(not c["path"].startswith("//") for c in calls))
        r = subprocess.run(["bash", str(SCRIPT)], capture_output=True, text=True, timeout=20)
        self.assertEqual(r.returncode, 2)

    def test_selftest_not_deployed_fails(self):
        # 経路の無い古い版: 別の応答（200 でも ok が無い / 404）
        for resp in ({"status": 200, "body": {"ok": True, "mode": "scrape-engine"}}, {"status": 404, "body": {"error": "not_found"}}, {"status": 200, "body": "not json"}):
            p = plan()
            p["/push/selftest"] = [resp] if resp["body"] != {"ok": True, "mode": "scrape-engine"} else [{"status": 200, "body": {"mode": "x"}}]
            code, out, calls, sleeps = run(p)
            self.assertEqual(code, 1, out)
            self.assertIn("❌ /push/selftest", out)
            self.assertEqual(len([c for c in calls if c["path"] == "/push/selftest"]), 3, "デプロイ直後の反映を 3 回まで待つ")
            self.assertEqual(sleeps, ["5", "5"])

    def test_selftest_crypto_mismatch_fails(self):
        p = plan()
        p["/push/selftest"] = [{"status": 500, "body": {"ok": False, "error": "Unrecognized name."}}]
        code, out, _, _ = run(p)
        self.assertEqual(code, 1)
        self.assertIn("error=Unrecognized name.", out)

    def test_selftest_recovers_on_retry(self):
        p = plan()
        p["/push/selftest"] = [{"fail": True}, {"status": 200, "body": {"mode": "old"}}, {"status": 200, "body": {"ok": True}}]
        code, out, _, sleeps = run(p)
        self.assertEqual(code, 0, out)
        self.assertEqual(sleeps, ["5", "5"])

    def test_key_must_be_87_chars_and_stable(self):
        for keys in ([{"status": 200, "body": {"key": "short"}}],
                     [{"status": 200, "body": {"key": KEY}}, {"status": 200, "body": {"key": "C" + "a" * 86}}],
                     [{"status": 503, "body": {"error": "no_key"}}],
                     [{"status": 200, "body": {"key": KEY}}, {"fail": True}]):
            p = plan()
            p["/push/key"] = keys
            code, out, _, _ = run(p)
            self.assertEqual(code, 1, out)
            self.assertIn("❌ /push/key", out)

    def test_subscribe_must_reject_unknown_push_service(self):
        for resp in ({"status": 200, "body": {"ok": True, "id": "x"}}, {"status": 400, "body": {"error": "bad_key"}}, {"status": 403, "body": {"error": "forbidden_origin"}}, {"fail": True}):
            p = plan()
            p["/push/subscribe"] = [resp]
            code, out, _, _ = run(p)
            self.assertEqual(code, 1, out)
            self.assertIn("❌ /push/subscribe", out)

    def test_test_endpoint_must_not_send_to_unregistered(self):
        for resp in ({"status": 200, "body": {"ok": True, "status": 201}}, {"status": 404, "body": {"error": "not_found"}}, {"status": 429, "body": {"error": "busy"}}):
            p = plan()
            p["/push/test"] = [resp]
            code, out, _, _ = run(p)
            self.assertEqual(code, 1, out)
            self.assertIn("❌ /push/test", out)

    def test_all_checks_run_even_after_a_failure(self):
        p = plan()
        p["/push/selftest"] = [{"status": 404, "body": {}}]
        p["/push/test"] = [{"status": 200, "body": {"ok": True}}]
        code, out, _, _ = run(p)
        self.assertEqual(code, 1)
        self.assertEqual(out.count("❌"), 2, out)
        self.assertEqual(out.count("✅"), 2, out)


class TestCron(unittest.TestCase):
    def test_tick_recorded(self):
        code, out, calls, sleeps = run(plan(), "--cron")
        self.assertEqual(code, 0, out)
        self.assertIn("✅ 毎分の cron が動いている", out)
        self.assertEqual([c["path"] for c in calls], ["/push/status"])
        self.assertEqual(sleeps, [])

    def test_waits_until_the_first_tick_is_recorded(self):
        none = {"status": 200, "body": {"ok": True, "subs": 0, "index_races": 0, "tick_at": None, "tick_age_sec": None, "sent_today": 0}}
        ok = {"status": 200, "body": {"ok": True, "subs": 0, "index_races": 0, "tick_at": "2026-11-27T03:01:00.000Z", "tick_age_sec": 20, "sent_today": 0}}
        code, out, calls, sleeps = run(plan(**{"/push/status": [none, none, {"fail": True}, ok]}), "--cron")
        self.assertEqual(code, 0, out)
        self.assertIn("✅ 毎分の cron が動いている", out)
        self.assertEqual(len(calls), 4)
        self.assertEqual(sleeps, ["15", "15", "15"])
        self.assertIn("::notice::締切の索引 (push:index) がまだありません", out)

    def test_gives_a_warning_not_a_failure_when_no_tick(self):
        none = {"status": 200, "body": {"ok": True, "tick_at": None, "tick_age_sec": None}}
        code, out, calls, sleeps = run(plan(**{"/push/status": [none]}), "--cron", "45")
        self.assertEqual(code, 0, out)
        self.assertIn("::warning::毎分の cron", out)
        self.assertNotIn("✅", out)
        self.assertEqual(sleeps, ["15", "15", "15"], "45 秒まで 15 秒おき")
        self.assertEqual(len(calls), 4)

    def test_old_record_is_not_alive(self):
        # 記録は 6 時間に 1 回。それより古ければ、動いているとは言えない
        old = {"status": 200, "body": {"ok": True, "tick_at": "2026-11-26T12:00:00.000Z", "tick_age_sec": 6 * 3600 + 301}}
        code, out, _, _ = run(plan(**{"/push/status": [old]}), "--cron", "15")
        self.assertEqual(code, 0)
        self.assertIn("::warning::", out)
        edge = {"status": 200, "body": {"ok": True, "tick_at": "2026-11-26T21:00:00.000Z", "tick_age_sec": 6 * 3600 + 300, "index_races": 10}}
        code, out, _, _ = run(plan(**{"/push/status": [edge]}), "--cron", "15")
        self.assertIn("✅", out)
        self.assertNotIn("::notice::", out)

    def test_broken_status_does_not_crash(self):
        for resp in ({"status": 500, "body": "oops"}, {"status": 200, "body": "not json"}, {"status": 200, "body": {"tick_at": "x", "tick_age_sec": "abc"}},
                     {"status": 200, "body": {"tick_at": "x", "tick_age_sec": -5}}, {"status": 200, "body": {"tick_at": None, "tick_age_sec": 10}},
                     {"status": 200, "body": {"tick_at": "2026-11-27T03:00:00.000Z", "tick_age_sec": None}}):
            code, out, _, _ = run(plan(**{"/push/status": [resp]}), "--cron", "15")
            self.assertEqual(code, 0, out)
            self.assertIn("::warning::", out)


class TestWiring(unittest.TestCase):
    def test_deploy_workflow_runs_both_modes(self):
        wf = (ROOT / ".github" / "workflows" / "deploy-worker.yml").read_text(encoding="utf-8")
        self.assertIn("bash scripts/verify_push.sh https://boatrace-scrape-trigger.inotaka1979.workers.dev\n", wf)
        self.assertIn("bash scripts/verify_push.sh https://boatrace-scrape-trigger.inotaka1979.workers.dev --cron", wf)

    def test_paths_match_the_worker(self):
        worker = (ROOT / "cloudflare-worker" / "push.js").read_text(encoding="utf-8")
        script = SCRIPT.read_text(encoding="utf-8")
        for p in ("/push/selftest", "/push/key", "/push/subscribe", "/push/test", "/push/status"):
            self.assertIn(f"'{p}'", worker)
            self.assertIn(p, script)
        for word in ("bad_endpoint", "not_registered", "tick_at", "tick_age_sec", "index_races"):
            self.assertIn(word, worker)
            self.assertIn(word, script)


if __name__ == "__main__":
    unittest.main()
