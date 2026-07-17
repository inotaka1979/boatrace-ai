#!/usr/bin/env python3
"""API取得失敗バナー診断: クライアントが叩く全 tier のエンドポイントを外形プローブ。

2026-07-17: ユーザ報告「ここ数日 API取得失敗 が表示され続けている」。
バナー条件 = _apiHealth[k]=='fail' (programs/previews/results/odds のどれかで
Worker → 公式data → openapi → LS cache が全滅) または _workerHealthy=false。
各 URL の status / 応答時間 / updated_at / entries / 本文先頭 を出力し、
どの系がいつから死んでいるかを特定する。確認後撤去。
"""
import json
import sys
import time
import urllib.request

TARGETS = [
    ("worker /health", "https://boatrace-scrape-trigger.inotaka1979.workers.dev/health"),
    ("worker /health?strict=1", "https://boatrace-scrape-trigger.inotaka1979.workers.dev/health?strict=1"),
    ("worker /api/programs", "https://boatrace-scrape-trigger.inotaka1979.workers.dev/api/programs"),
    ("worker /api/previews", "https://boatrace-scrape-trigger.inotaka1979.workers.dev/api/previews"),
    ("worker /api/results", "https://boatrace-scrape-trigger.inotaka1979.workers.dev/api/results"),
    ("openapi programs", "https://boatraceopenapi.github.io/programs/v2/today.json"),
    ("openapi previews", "https://boatraceopenapi.github.io/previews/v2/today.json"),
    ("openapi results", "https://boatraceopenapi.github.io/results/v2/today.json"),
    ("pages data/programs", "https://inotaka1979.github.io/boatrace-ai/data/programs/today.json"),
    ("pages data/odds", "https://inotaka1979.github.io/boatrace-ai/data/odds/today.json"),
    ("pages data/previews", "https://inotaka1979.github.io/boatrace-ai/data/previews/today.json"),
    ("pages data/results", "https://inotaka1979.github.io/boatrace-ai/data/results/today.json"),
    ("pages index.html", "https://inotaka1979.github.io/boatrace-ai/index.html"),
]

UA = "Mozilla/5.0 (probe; boatrace-ai diag)"


def probe(label: str, url: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read()
            ms = (time.monotonic() - t0) * 1000
            info = f"{label}: HTTP {r.status} {ms:.0f}ms {len(body)}B"
            ctype = r.headers.get("Content-Type", "")
            if "json" in ctype or url.endswith(".json") or "/api/" in url or "/health" in url:
                try:
                    d = json.loads(body)
                    ua = d.get("updated_at") or d.get("fetched_at") or ""
                    keys = [k for k in ("programs", "previews", "results", "odds") if k in d]
                    n = len(d.get(keys[0], []) or []) if keys else None
                    extra = {k: d[k] for k in ("ok", "cron_age_sec", "_source") if k in d}
                    rd = ""
                    if keys and d.get(keys[0]):
                        first = (d[keys[0]] or [{}])[0]
                        if isinstance(first, dict):
                            rd = first.get("race_date", "")
                    print(f"{info} updated_at={ua} entries[{keys[0] if keys else '-'}]={n} race_date={rd} {extra}")
                    if "/health" in url:
                        print(f"   health body: {body[:400].decode('utf-8', 'replace')}")
                except Exception as e:
                    print(f"{info} (JSON parse 失敗: {e}) head={body[:120]!r}")
            else:
                print(info)
    except Exception as e:
        ms = (time.monotonic() - t0) * 1000
        print(f"{label}: FAIL {ms:.0f}ms {type(e).__name__}: {str(e)[:160]}")


def main() -> int:
    for label, url in TARGETS:
        probe(label, url)
        time.sleep(1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
