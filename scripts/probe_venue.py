#!/usr/bin/env python3
"""本日開催場の欠落診断: 公式 boatrace.jp の本日レース一覧と data/programs を突合。

「本日開催しているのに表示されない場がある」(2026-07-12) の調査。
アプリ側は schedule(current.json) → programs の 11 場
[2,6,8,9,14,15,16,19,20,22,23] で一致しており、上流の取りこぼしなら
schedule 生成(公式月間日程)の欠落。公式の本日インデックスから実開催場を
列挙して diff を出す。確認後撤去。
"""
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_utils import fetch_text  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STADIUMS = {1:"桐生",2:"戸田",3:"江戸川",4:"平和島",5:"多摩川",6:"浜名湖",7:"蒲郡",8:"常滑",
            9:"津",10:"三国",11:"びわこ",12:"住之江",13:"尼崎",14:"鳴門",15:"丸亀",16:"児島",
            17:"宮島",18:"徳山",19:"下関",20:"若松",21:"芦屋",22:"福岡",23:"唐津",24:"大村"}


def main() -> int:
    hd = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime("%Y%m%d")
    url = f"https://www.boatrace.jp/owpc/pc/race/index?hd={hd}"
    print(f"official index: {url}")
    try:
        html = fetch_text(url, timeout=25, retries=1)
    except Exception as e:
        print(f"FETCH FAIL: {str(e)[:120]}")
        return 0
    print(f"len={len(html)}")
    # 本日一覧の各場リンク jcd=NN を列挙
    jcds = sorted(set(int(m) for m in re.findall(r"jcd=(\d{2})", html)))
    print(f"公式 本日開催場: {jcds}")
    print("  " + " ".join(f"{j}:{STADIUMS.get(j,'?')}" for j in jcds))

    # data/programs と diff
    try:
        with open(os.path.join(ROOT, "data/programs/today.json"), encoding="utf-8") as f:
            d = json.load(f)
        have = sorted(set(p.get("race_stadium_number") for p in d.get("programs", [])))
    except Exception as e:
        print(f"programs read fail: {e}")
        have = []
    print(f"data/programs の場: {have}")
    missing = [j for j in jcds if j not in have]
    extra = [j for j in have if j not in jcds]
    print(f"=> 欠落(公式にあるが data に無い): {[(j, STADIUMS.get(j)) for j in missing]}")
    print(f"=> 過剰(data にあるが公式に無い): {[(j, STADIUMS.get(j)) for j in extra]}")

    # schedule 側の判定も表示
    try:
        with open(os.path.join(ROOT, "data/schedule/current.json"), encoding="utf-8") as f:
            sc = json.load(f)
        today = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime("%Y-%m-%d")
        sd = sc.get("stadium_dates", {})
        sch = sorted(int(k) for k, v in sd.items() if isinstance(v, list) and today in v)
        print(f"schedule(current.json) の本日: {sch} (updated {sc.get('updated_at')})")
        for j in missing:
            dates = sd.get(str(j), [])
            near = [x for x in dates if abs((datetime.date.fromisoformat(x)
                    - datetime.date.fromisoformat(today)).days) <= 3]
            print(f"  欠落場 {j}:{STADIUMS.get(j)} の schedule 近傍日: {near}")
    except Exception as e:
        print(f"schedule read fail: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
