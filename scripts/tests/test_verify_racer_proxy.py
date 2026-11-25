"""scripts/verify_racer_proxy.sh（デプロイ後の /racer-proxy の確認、2026-11-25）

curl と sleep を差し替えて、分岐を 1 つずつ通す。
  - 経路がデプロイされていない（不正な登録番号に 400 を返さない）ときだけ失敗させる
  - 公式サイトから取れない（502 / 503）・edge の保存が効かない は、記録するが失敗させない

  python3 -m unittest scripts.tests.test_verify_racer_proxy
"""

import json
import os
import pathlib
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "verify_racer_proxy.sh"

# 差し替えの curl: 呼ばれた順に $PLAN の応答を返す。-o / -D のファイルを書き、-w の http_code を出力する。
FAKE_CURL = r"""#!/usr/bin/env python3
import json, os, sys
plan = json.load(open(os.environ["PLAN"], encoding="utf-8"))
log = os.environ["CALLS"]
n = sum(1 for _ in open(log, encoding="utf-8")) if os.path.exists(log) else 0
args = sys.argv[1:]
url = [a for a in args if a.startswith("http")][-1]
open(log, "a", encoding="utf-8").write(url + "\n")
r = plan[n] if n < len(plan) else plan[-1]
def opt(flag):
    return args[args.index(flag) + 1] if flag in args else None
if r.get("fail"):
    # 本物の curl は失敗しても -w の内容を出す（http_code は 000）
    sys.stdout.write("000 0.000000" if "time_total" in (opt("-w") or "") else "000")
    sys.exit(7)
if opt("-o") and opt("-o") != "/dev/null":
    open(opt("-o"), "w", encoding="utf-8").write(r.get("body", ""))
if opt("-D"):
    open(opt("-D"), "w", encoding="utf-8", newline="").write(
        "HTTP/2 %s\r\n" % r["status"] + "".join("%s: %s\r\n" % kv for kv in r.get("headers", {}).items()) + "\r\n")
w = opt("-w") or ""
sys.stdout.write(str(r["status"]) + (" %.6f" % r.get("sec", 0.123456) if "time_total" in w else ""))
"""

OK_BODY = json.dumps({"toban": "4320", "found": True, "schedule": [{}, {}], "back3": [{}], "wins": [], "back3_ok": True})
TIMED_BODY = json.dumps({
    "toban": "4320", "found": True, "schedule": [{}], "back3": [{}], "wins": [], "back3_ok": True,
    "timing": {"profile_ms": 9790, "back3_ms": 10471, "edge_ms": 9264, "origin_ms": 63},
})


def run(plan, toban=None):
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        for name, body in (("curl", FAKE_CURL), ("sleep", "#!/bin/sh\nexit 0\n")):
            f = d / name
            f.write_text(body, encoding="utf-8")
            f.chmod(f.stat().st_mode | stat.S_IEXEC)
        (d / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
        env = dict(os.environ, PATH=f"{d}:{os.environ['PATH']}", PLAN=str(d / "plan.json"), CALLS=str(d / "calls"))
        args = ["bash", str(SCRIPT), "https://w.example.dev/"] + ([toban] if toban else [])
        p = subprocess.run(args, env=env, capture_output=True, text=True, timeout=60)
        calls = (d / "calls").read_text(encoding="utf-8").split() if (d / "calls").exists() else []
        return p.returncode, p.stdout + p.stderr, calls


BAD = {"status": 400}


def ok(xcache, cc="public, max-age=10800", body=OK_BODY, sec=0.123456, colo="NRT"):
    headers = {"X-Cache": xcache, "Cache-Control": cc}
    if colo:
        headers["CF-RAY"] = "8f3a1b2c3d4e5f60-" + colo
    return {"status": 200, "headers": headers, "body": body, "sec": sec}


class VerifyRacerProxy(unittest.TestCase):
    def test_deployed_and_edge_cache_works(self):
        code, out, calls = run([BAD, ok("MISS"), ok("HIT", "public, max-age=10797")])
        self.assertEqual(code, 0, out)
        self.assertIn("デプロイ済み", out)
        self.assertIn("1 回目: HTTP 200 (0.1 秒) / x-cache: MISS / 拠点: NRT / cache-control: public, max-age=10800", out)
        self.assertIn("found=True 出場予定 2 件 / 過去 3 節 1 件", out)
        self.assertIn("2 回目: HTTP 200 (0.1 秒) / x-cache: HIT / 拠点: NRT", out)
        self.assertIn("edge の保存が効いている (2 回目は公式サイトに取りに行っていない)", out)
        self.assertNotIn("3 回目", out, "HIT が出たらそこで止める")
        self.assertNotIn("::warning::", out)
        # 不正な登録番号で 1 回、実在の選手で 2 回。URL の末尾の / は重ねない
        self.assertEqual(calls, [
            "https://w.example.dev/racer-proxy?toban=abc",
            "https://w.example.dev/racer-proxy?toban=4320",
            "https://w.example.dev/racer-proxy?toban=4320",
        ])

    def test_route_missing_fails_the_deploy(self):
        # 経路の無い版は既定の応答（200）を返す
        code, out, calls = run([{"status": 200}])
        self.assertEqual(code, 1, out)
        self.assertIn("デプロイされていない", out)
        self.assertIn("HTTP 200", out)
        self.assertEqual(len(calls), 3, "3 回まで待つ。実在の選手は呼ばない")
        self.assertTrue(all(c.endswith("toban=abc") for c in calls))

    def test_unreachable_fails_the_deploy(self):
        code, out, _ = run([{"fail": True}])
        self.assertEqual(code, 1, out)
        self.assertIn("HTTP 000、期待は 400", out)  # 000 を重ねて出さない

    def test_slow_first_fetch_is_recorded_and_warned(self):
        # 本番の初回取得は 10.9 秒だった（2026-11-25）。記録はするが、15 秒までは警告しない
        code, out, _ = run([BAD, ok("MISS", sec=10.923456), ok("HIT", sec=0.098)])
        self.assertEqual(code, 0, out)
        self.assertIn("1 回目: HTTP 200 (10.9 秒)", out)
        self.assertNotIn("::warning::", out)
        code, out, _ = run([BAD, ok("MISS", sec=17.5), ok("HIT")])
        self.assertEqual(code, 0, out)
        self.assertIn("::warning::初回の取得に 17.5 秒かかった", out)
        self.assertIn("edge の保存が効いている (2 回目", out, "遅くても 2 回目の確認は続ける")
        # ちょうど 15 秒は警告しない
        code, out, _ = run([BAD, ok("MISS", sec=15.0), ok("HIT")])
        self.assertNotIn("::warning::", out)

    def test_curl_failure_on_the_real_call_does_not_fail_the_deploy(self):
        code, out, calls = run([BAD, {"fail": True}])
        self.assertEqual(code, 0, out)
        self.assertIn("公式サイトから取得できなかった (HTTP 000", out)
        self.assertEqual(len(calls), 2)

    def test_old_version_lingers_then_new_one_answers(self):
        code, out, calls = run([{"status": 200}, BAD, ok("MISS"), ok("HIT")])
        self.assertEqual(code, 0, out)
        self.assertEqual(len(calls), 4)

    def test_upstream_failure_is_reported_but_does_not_fail(self):
        for status, body in ((502, '{"error":"upstream"}'), (503, '{"error":"blocked"}'), (429, '{"error":"busy"}')):
            code, out, calls = run([BAD, {"status": status, "headers": {}, "body": body}])
            self.assertEqual(code, 0, out)
            self.assertIn(f"::warning::/racer-proxy は動いているが、公式サイトから取得できなかった (HTTP {status}", out)
            self.assertIn(body, out)
            self.assertEqual(len(calls), 2, "失敗したら 2 回目は呼ばない（公式サイトを叩き直さない）")

    def test_same_location_never_hits_is_a_warning(self):
        # 同じ拠点が 3 回応答して 3 回とも MISS = 保存が効いていない（失敗にはしない）
        code, out, calls = run([BAD, ok("MISS"), ok("MISS"), ok("MISS")])
        self.assertEqual(code, 0, out)
        self.assertIn("::warning::同じ拠点 (NRT → NRT → NRT) で 3 回とも保存した結果が返らなかった", out)
        self.assertNotIn("edge の保存が効いている (", out)
        self.assertEqual(len(calls), 4, "不正な番号 1 回 + 実在の選手 3 回まで")
        self.assertIn("3 回目: HTTP 200", out)

    def test_different_locations_cannot_be_judged(self):
        # 2026-11-25 の run 78: MISS → MISS。拠点が違えば保存は共有されないので「判定できない」と書く
        code, out, _ = run([BAD, ok("MISS", colo="IAD"), ok("MISS", colo="EWR"), ok("MISS", colo="IAD")])
        self.assertEqual(code, 0, out)
        self.assertIn("::notice::呼び出しごとに Cloudflare の拠点が違った (IAD → EWR → IAD)", out)
        self.assertIn("判定できない", out)
        self.assertNotIn("::warning::", out)

    def test_unknown_location_is_a_notice(self):
        code, out, _ = run([BAD, ok("MISS", colo=""), ok("MISS", colo=""), {"status": 200, "headers": {}, "body": OK_BODY}])
        self.assertEqual(code, 0, out)
        self.assertIn("拠点: 不明", out)
        self.assertIn("::notice::3 回とも保存した結果が返らなかった（応答した拠点は不明）", out)
        self.assertNotIn("::warning::", out)
        # 1 回でも拠点が分からなければ「同じ拠点」とは言わない（1 回目・途中・最後のどれが欠けても）
        for missing in (0, 1, 2):
            plan = [BAD] + [ok("MISS", colo="" if i == missing else "NRT") for i in range(3)]
            code, out, _ = run(plan)
            self.assertIn("（応答した拠点は不明）", out, f"missing={missing}")
            self.assertNotIn("同じ拠点", out, f"missing={missing}")
            self.assertNotIn("::warning::", out, f"missing={missing}")

    def test_hit_on_third_call_counts(self):
        code, out, calls = run([BAD, ok("MISS", colo="IAD"), ok("MISS", colo="EWR"), ok("HIT", colo="IAD")])
        self.assertEqual(code, 0, out)
        self.assertIn("edge の保存が効いている (3 回目は公式サイトに取りに行っていない)", out)
        self.assertNotIn("::notice::", out)
        self.assertEqual(len(calls), 4)

    def test_already_cached_on_first_call(self):
        # 3 時間以内に同じ拠点で取得済みなら 1 回目から HIT。それ以上は呼ばない
        code, out, calls = run([BAD, ok("HIT", "public, max-age=9000")])
        self.assertEqual(code, 0, out)
        self.assertIn("edge の保存が効いている (1 回目から保存した結果が返った", out)
        self.assertEqual(len(calls), 2)

    def test_reports_where_the_time_went(self):
        code, out, _ = run([BAD, ok("MISS", body=TIMED_BODY, sec=10.5), ok("HIT", body=TIMED_BODY)])
        self.assertEqual(code, 0, out)
        self.assertIn("公式サイトの応答（Worker が測った値）: profile 9.8 秒 / back3 10.5 秒", out)
        self.assertIn("（公式サイト自身の計測: 配信側 9.3 秒 / サーバ本体 0.1 秒）", out)
        # 公式の計測ヘッダが無いときは、その部分を出さない
        body = json.dumps({"found": True, "schedule": [{}], "back3": [], "timing": {"profile_ms": 400, "back3_ms": 350, "edge_ms": None, "origin_ms": None}})
        code, out, _ = run([BAD, ok("MISS", body=body), ok("HIT", body=body)])
        self.assertIn("profile 0.4 秒 / back3 0.", out)
        self.assertNotIn("公式サイト自身の計測", out)
        # timing が無い古い Worker でも落ちない
        code, out, _ = run([BAD, ok("MISS"), ok("HIT")])
        self.assertEqual(code, 0, out)
        self.assertNotIn("Worker が測った値", out)

    def test_timing_of_a_cached_result_is_labelled_as_stored(self):
        # 1 回目から HIT のとき、応答に入っているのは保存した時点（最大 3 時間前）の計測。今の値として読ませない
        code, out, _ = run([BAD, ok("HIT", "public, max-age=9000", body=TIMED_BODY)])
        self.assertEqual(code, 0, out)
        self.assertIn("公式サイトの応答（保存した時点に Worker が測った値）: profile 9.8 秒", out)
        self.assertNotIn("（Worker が測った値）", out)

    def test_empty_parse_result_warns_about_page_shape(self):
        empty = json.dumps({"toban": "4320", "found": True, "schedule": [], "back3": [], "wins": [], "back3_ok": True})
        code, out, _ = run([BAD, ok("MISS", body=empty), ok("HIT", body=empty)])
        self.assertEqual(code, 0, out)
        self.assertIn("公式ページの形が変わった可能性", out)
        # 存在しない選手（found: false）は形の問題ではない
        gone = json.dumps({"toban": "9999", "found": False, "schedule": [], "back3": [], "wins": []})
        code, out, calls = run([BAD, ok("MISS", "public, max-age=600", gone), ok("HIT", body=gone)], toban="9999")
        self.assertEqual(code, 0, out)
        self.assertNotIn("形が変わった", out)
        self.assertTrue(calls[1].endswith("toban=9999"))

    def test_non_json_body_does_not_crash(self):
        code, out, _ = run([BAD, ok("MISS", body="<html>oops"), ok("HIT", body="<html>oops")])
        self.assertEqual(code, 0, out)
        self.assertIn("JSON として読めない", out)

    def test_usage(self):
        p = subprocess.run(["bash", str(SCRIPT)], capture_output=True, text=True, timeout=20)
        self.assertEqual(p.returncode, 2)

    def test_workflow_runs_the_script_after_deploy(self):
        wf = (ROOT / ".github" / "workflows" / "deploy-worker.yml").read_text(encoding="utf-8")
        deploy = wf.split("  deploy-sentinel:")[0]
        self.assertIn("bash scripts/verify_racer_proxy.sh https://boatrace-scrape-trigger.inotaka1979.workers.dev", deploy)
        self.assertLess(deploy.index("name: Verify deploy"), deploy.index("name: Verify /racer-proxy"))


if __name__ == "__main__":
    unittest.main()
