#!/usr/bin/env python3
"""
公式データファイルから racerDB.json / stadiumDB.json を構築する。

処理フロー:
1. レーサー期別成績（ファン手帳）をダウンロード → 全選手の基本情報+コース別成績
2. 過去30日分の競走成績をダウンロード → 直近成績・場別統計を算出
3. JSON出力 → data/db/racerDB.json, data/db/stadiumDB.json

データソース:
  ファン手帳: https://www.boatrace.jp/static_extra/pc_static/download/data/kibetsu/fan2510.lzh
  競走成績: http://www1.mbrace.or.jp/od2/K/{YYYYMM}/k{YYMMDD}.lzh

ファン手帳のレイアウト（固定長テキスト、公式仕様）:
  登番(4) 名前漢字(16) 名前カナ(15) 支部(4) 級(2) 年号(1) 生年月日(6) 性別(1) 年齢(2) 身長(3) 体重(2)
  血液型(2) 勝率(4) 複勝率(4) 1着回数(3) 2着回数(3) 出走回数(3) 優出(2) 優勝(2) 平均ST(3)
  [1〜6コース × (進入回数(3) 複勝率(4) 平均ST(3) 平均ST順位(3))]
  前期級(2) 前々期級(2) 前々々期級(2) 前期能力指数(4) 今期能力指数(4) 年(4) 期(1) 算出期間自(8) 算出期間至(8) 養成期(3)
  [1〜6コース × (1着(3) 2着(3) 3着(3) 4着(3) 5着(3) 6着(3) F(2) L0(2) L1(2) K0(2) K1(2) S0(2) S1(2) S2(2))]

注意:
- LZHの解凍にはlhafileパッケージを使用
- テキストはShift_JISエンコーディング
- リクエスト間隔3秒以上
"""

import json
import os
import time
import datetime
from urllib.request import urlopen, Request
from io import BytesIO

HEADERS = {"User-Agent": "Mozilla/5.0"}
OUTPUT_RACER = "data/db/racerDB.json"
OUTPUT_STADIUM = "data/db/stadiumDB.json"
INTERVAL = 3

# ファン手帳URL（最新版）
FAN_URL = "https://www.boatrace.jp/static_extra/pc_static/download/data/kibetsu/fan2510.lzh"
# 競走成績URL
RESULTS_BASE = "http://www1.mbrace.or.jp/od2/K/"


def download(url):
    """URLからバイナリをダウンロード"""
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=30) as r:
        return r.read()


def extract_lzh(data):
    """LZHファイルを解凍してテキストを返す"""
    try:
        import lhafile
        f = lhafile.LhaFile(BytesIO(data))
        for info in f.infolist():
            return f.read(info.filename).decode('shift_jis', errors='replace')
    except ImportError:
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.lzh', delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        out_dir = tempfile.mkdtemp()
        subprocess.run(['lha', 'x', '-w=' + out_dir, tmp_path], capture_output=True)
        os.remove(tmp_path)
        for fname in os.listdir(out_dir):
            fpath = os.path.join(out_dir, fname)
            with open(fpath, 'r', encoding='shift_jis', errors='replace') as f:
                return f.read()
    return ""


def parse_fan_handbook(text):
    """ファン手帳テキストをパースしてracerDBを構築"""
    racers = {}
    for line in text.strip().split('\n'):
        if len(line) < 100:
            continue
        try:
            pos = 0

            def read(n):
                nonlocal pos
                val = line[pos:pos + n].strip()
                pos += n
                return val

            toban = read(4)
            if not toban.isdigit():
                continue
            name = read(16)
            kana = read(15)
            branch = read(4)
            cls_str = read(2)
            cls_map = {"A1": 1, "A2": 2, "B1": 3, "B2": 4}
            cls_num = cls_map.get(cls_str, 4)
            read(1)   # nengo
            read(6)   # birthday
            read(1)   # gender
            age = int(read(2) or 0)
            read(3)   # height
            weight = int(read(2) or 0)
            read(2)   # blood
            win_rate_raw = read(4)
            win_rate = int(win_rate_raw or 0) / 100.0
            top2_rate_raw = read(4)
            top2_rate = int(top2_rate_raw or 0) / 10.0
            int(read(3) or 0)   # first_count
            int(read(3) or 0)   # second_count
            total_races = int(read(3) or 0)
            read(2)   # yusyutsu
            read(2)   # yusyo
            avg_st_raw = read(3)
            avg_st = int(avg_st_raw or 0) / 100.0

            # コース別基本統計（1〜6コース）
            course_stats = {}
            for c in range(1, 7):
                entries = int(read(3) or 0)
                c_top2 = int(read(4) or 0) / 10.0
                c_st = int(read(3) or 0) / 100.0
                c_st_rank = int(read(3) or 0) / 100.0
                course_stats[str(c)] = {
                    "entries": entries,
                    "top2Rate": c_top2,
                    "avgST": c_st,
                    "avgSTRank": c_st_rank,
                }

            # 前期級等をスキップ
            read(2)   # 前期級
            read(2)   # 前々期級
            read(2)   # 前々々期級
            read(4)   # 前期能力指数
            read(4)   # 今期能力指数
            read(4)   # 年
            read(1)   # 期
            read(8)   # 算出期間自
            read(8)   # 算出期間至
            read(3)   # 養成期

            # コース別着順分布（1〜6コース × 1着〜6着 + F/L/K/S）
            for c in range(1, 7):
                places = []
                for _ in range(6):
                    places.append(int(read(3) or 0))
                course_stats[str(c)]["places"] = places
                course_stats[str(c)]["wins"] = places[0]
                # F/L/K/S はスキップ（8フィールド × 2バイト）
                for _ in range(8):
                    read(2)

            racers[toban] = {
                "name": name,
                "kana": kana,
                "branch": branch,
                "classNum": cls_num,
                "age": age,
                "weight": weight,
                "winRate": win_rate,
                "top2Rate": top2_rate,
                "avgST": avg_st,
                "totalRaces": total_races,
                "courseStats": course_stats,
                "recentResults": [],
            }
        except Exception:
            continue

    return racers


def parse_results_text(text, racers, stadium_stats):
    """
    競走成績テキストから直近成績と場別統計を更新。

    競走成績ファイル (kYYMMDD.txt) のレイアウト概要:
    - 各レースブロックはヘッダ行で始まる
    - レース結果行: 着順(2) 枠番(1) 登番(4) 選手名(8) ... の固定長
    - 場番号・レース番号はヘッダ行から取得
    """
    current_stadium = None
    current_race = None

    for line in text.strip().split('\n'):
        line = line.rstrip()
        if not line:
            continue

        # レースヘッダ行の検出（"KBGN" や場番号+レース番号を含む行）
        # 一般的なフォーマット: 先頭に場番号(2桁)+日(2桁)+レース番号(2桁)
        if len(line) >= 6 and line[:2].isdigit() and line[2:4].isdigit() and line[4:6].isdigit():
            try:
                current_stadium = str(int(line[:2]))
                current_race = int(line[4:6])
            except ValueError:
                pass
            continue

        # 着順行の検出（先頭が数字1-6で始まる行）
        if current_stadium and current_race and len(line) >= 15:
            try:
                # 着順(2) 枠番(1) 登番(4)
                place_str = line[:2].strip()
                if not place_str.isdigit():
                    continue
                place = int(place_str)
                if place < 1 or place > 6:
                    continue

                boat_str = line[2:3].strip()
                if not boat_str.isdigit():
                    continue
                boat = int(boat_str)
                if boat < 1 or boat > 6:
                    continue

                toban = line[3:7].strip()
                if not toban.isdigit() or len(toban) != 4:
                    continue

                # racerDBの直近成績を更新
                if toban in racers:
                    results = racers[toban].get("recentResults", [])
                    results.append(place)
                    if len(results) > 30:
                        results = results[-30:]
                    racers[toban]["recentResults"] = results

                # 場別統計を更新
                course = str(boat)
                if current_stadium not in stadium_stats:
                    stadium_stats[current_stadium] = {}
                if course not in stadium_stats[current_stadium]:
                    stadium_stats[current_stadium][course] = {"races": 0, "wins": 0}
                stadium_stats[current_stadium][course]["races"] += 1
                if place == 1:
                    stadium_stats[current_stadium][course]["wins"] += 1

            except (ValueError, IndexError):
                continue


def main():
    os.makedirs(os.path.dirname(OUTPUT_RACER), exist_ok=True)
    os.makedirs(os.path.dirname(OUTPUT_STADIUM), exist_ok=True)

    print("=== Step 1: ファン手帳ダウンロード ===")
    try:
        fan_data = download(FAN_URL)
        fan_text = extract_lzh(fan_data)
        racers = parse_fan_handbook(fan_text)
        print(f"  選手数: {len(racers)}")
    except Exception as e:
        print(f"  ファン手帳取得失敗: {e}")
        racers = {}

    print("=== Step 2: 過去30日分の競走成績 ===")
    stadium_stats = {}
    for d in range(1, 31):
        date = datetime.datetime.now() - datetime.timedelta(days=d)
        yyyymm = date.strftime("%Y%m")
        yymmdd = date.strftime("%y%m%d")
        url = f"{RESULTS_BASE}{yyyymm}/k{yymmdd}.lzh"
        try:
            data = download(url)
            text = extract_lzh(data)
            if text:
                parse_results_text(text, racers, stadium_stats)
                print(f"  {date.strftime('%Y-%m-%d')}: OK")
            time.sleep(INTERVAL)
        except Exception as e:
            print(f"  {date.strftime('%Y-%m-%d')}: {e}")
            time.sleep(INTERVAL)

    # stadiumDB構築
    stadiums = {}
    for sid, courses in stadium_stats.items():
        cwr = {}
        total = 0
        for c, stats in courses.items():
            if stats["races"] > 0:
                cwr[c] = round(stats["wins"] / stats["races"], 4)
            total += stats["races"]
        stadiums[sid] = {"courseWinRate": cwr, "totalRaces": total // 6}

    # JSON出力
    now = datetime.datetime.utcnow().isoformat() + "Z"
    racer_out = {"updated_at": now, "racers": racers}
    stadium_out = {"updated_at": now, "stadiums": stadiums}

    with open(OUTPUT_RACER, "w", encoding="utf-8") as f:
        json.dump(racer_out, f, ensure_ascii=False)
    with open(OUTPUT_STADIUM, "w", encoding="utf-8") as f:
        json.dump(stadium_out, f, ensure_ascii=False)

    print(f"=== 完了: {len(racers)}選手, {len(stadiums)}場 ===")


if __name__ == "__main__":
    main()
