#!/usr/bin/env python3
"""結果反映遅延の実測プローブ (2026-07-19: 「相変わらず結果の反映が遅い」)。

締切から 6 分〜6 時間経過したレース (=結果が出ているはず) について、
  a) Worker /api/results に着順 (race_technique_number) / 払戻 (trifecta) があるか
  b) openapi results ミラーにあるか
  c) (a で欠けるものは) boatrace.jp 公式 raceresult に結果が出ているか
を突合し、どの層で遅延しているかを確定する。/health で cron 生死も見る。確認後撤去。
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
WORKER = "https://boatrace-scrape-trigger.inotaka1979.workers.dev"
UA = "Mozilla/5.0 (probe; boatrace-ai diag)"


def get(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_json(url: str) -> dict:
    return json.loads(get(url))


def parse_closed(s: str):
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=JST)
    except Exception:
        return None


def main() -> int:
    now = datetime.now(JST)
    print(f"now JST: {now.isoformat()}")

    health = get_json(WORKER + "/health")
    print(f"health: ok={health.get('ok')} cron_age_sec={health.get('cron_age_sec')}")
    for k, v in (health.get("keys") or {}).items():
        print(f"  kv[{k}]: wrote_at={v.get('wrote_at')} age_sec={v.get('age_sec')} src={v.get('src')}")

    progs = get_json(WORKER + "/api/programs")
    res_w = get_json(WORKER + "/api/results")
    print(f"worker results: updated_at={res_w.get('updated_at')} _source={res_w.get('_source','kv')} "
          f"entries={len(res_w.get('results') or [])}")
    try:
        res_o = get_json("https://boatraceopenapi.github.io/results/v2/today.json")
    except Exception as e:
        res_o = {}
        print(f"openapi results FAIL: {e}")

    def idx(d):
        m = {}
        for r in d.get("results") or []:
            m[(r.get("race_stadium_number"), r.get("race_number"))] = r
        return m

    iw, io = idx(res_w), idx(res_o)

    def state(r):
        if not r:
            return "無"
        t = r.get("race_technique_number") is not None
        p = bool(((r.get("payouts") or {}).get("trifecta") or []))
        return ("着順+払戻" if p else "着順のみ") if t else "未確定"

    should_be_done = []
    for p in progs.get("programs") or []:
        c = parse_closed(p.get("race_closed_at") or "")
        if not c:
            continue
        age_min = (now - c).total_seconds() / 60
        if 6 <= age_min <= 360:
            should_be_done.append((c, age_min, p))

    should_be_done.sort(key=lambda x: x[0])
    print(f"\n締切+6分〜6時間のレース: {len(should_be_done)} 件")
    missing_in_worker = []
    for c, age_min, p in should_be_done:
        sid, rno = p["race_stadium_number"], p["race_number"]
        sw, so = state(iw.get((sid, rno))), state(io.get((sid, rno)))
        mark = "" if sw == "着順+払戻" else "  ★遅延"
        print(f"  場{sid:2d} {rno:2d}R 締切+{age_min:5.1f}分  worker={sw:6s} openapi={so:6s}{mark}")
        if sw != "着順+払戻":
            missing_in_worker.append((sid, rno, p.get("race_date", ""), age_min))

    # worker 欠落分は公式に出ているか確認 (最大 6 件)
    print(f"\nworker 欠落/不完全: {len(missing_in_worker)} 件 → 公式確認 (最大6件)")
    for sid, rno, rd, age_min in missing_in_worker[:6]:
        hd = rd.replace("-", "")
        url = f"https://www.boatrace.jp/owpc/pc/race/raceresult?rno={rno}&jcd={sid:02d}&hd={hd}"
        try:
            html = get(url, timeout=25).decode("utf-8", "replace")
            has_result = "レース結果" in html and ("３連単" in html or "3連単" in html)
            has_payout = "払戻金" in html
            print(f"  場{sid:2d} {rno:2d}R (+{age_min:.0f}分): 公式結果={'有' if has_result else '無'} 払戻表記={'有' if has_payout else '無'} len={len(html)}")
        except Exception as e:
            print(f"  場{sid:2d} {rno:2d}R: 公式 fetch FAIL {type(e).__name__}: {str(e)[:80]}")
        time.sleep(2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
