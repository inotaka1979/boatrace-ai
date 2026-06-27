#!/usr/bin/env python3
"""
BoatRace Oracle - 月間開催日程取得スクリプト
月1回（月初）に実行される。

処理フロー:
1. 当月と翌月の monthlyschedule HTML を取得 (boatrace.jp)
2. 場ごとの開催日付配列 (YYYY-MM-DD) を抽出
3. data/schedule/current.json に出力 + data/schedule/next_open.json に派生

出力形式 (current.json):
  {
    "updated_at": "...",
    "months": [
      {
        "year_month": "2026-05",
        "events": [
          {"stadium": 1, "grade": "一般", "title": "...",
           "dates": ["2026-05-02", "2026-05-03", ...]},
          ...
        ]
      }
    ],
    "stadium_dates": {"1": ["2026-05-02", ...], ...}  # 全場の開催日 union
  }

出力形式 (next_open.json):
  {"updated_at": "...", "next_open": {"3": "2026-05-13", ...}}
"""

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta, date as DateCls

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json
from time_utils import utc_iso_seconds, first_of_next_month
from http_utils import fetch_text

from bs4 import BeautifulSoup

JST = timezone(timedelta(hours=9))
SCHEDULE_URL = "https://www.boatrace.jp/owpc/pc/race/monthlyschedule?ym={ym}"
OUTPUT_FILE = "data/schedule/current.json"
NEXT_OPEN_FILE = "data/schedule/next_open.json"

STADIUMS = {
    1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川",
    6: "浜名湖", 7: "蒲郡", 8: "常滑", 9: "津", 10: "三国",
    11: "びわこ", 12: "住之江", 13: "尼崎", 14: "鳴門", 15: "丸亀",
    16: "児島", 17: "宮島", 18: "徳山", 19: "下関", 20: "若松",
    21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村",
}

GRADE_MAP = {
    "is-gradeColorSG": "SG",
    "is-gradeColorG1": "G1",
    "is-gradeColorG2": "G2",
    "is-gradeColorG3": "G3",
    "is-gradeColorIppan": "一般",
    "is-gradeColorLady": "女子",
}


def _build_date_axis(year: int, month: int, n_cols: int) -> list[str]:
    """ヘッダ行 (n_cols 列) に対応する YYYY-MM-DD 配列を構築。

    monthlyschedule は当月の前月末週から始まり翌月頭週まで含む。
    n_cols = 39 (場名 col を除いた値) などになる。
    第 1 列の日付 = 当月 1 日が含まれる週の月曜日。
    """
    first_of_month = DateCls(year, month, 1)
    # 月曜=0, 日曜=6
    start = first_of_month - timedelta(days=first_of_month.weekday())
    return [(start + timedelta(days=i)).isoformat() for i in range(n_cols)]


def scrape_month(year_month: str) -> dict:
    """指定月のスケジュールから (events, stadium_dates) を抽出。

    Args:
        year_month: "202605" 等 6 桁

    Returns:
        {"events": [...], "stadium_dates": {sid_str: [date, ...]}}
    """
    url = SCHEDULE_URL.format(ym=year_month)
    year = int(year_month[:4])
    month = int(year_month[4:6])
    today_iso = datetime.now(JST).date().isoformat()
    try:
        html = fetch_text(url)
        soup = BeautifulSoup(html, "html.parser")
        tables = soup.select("table.is-spritedNone1")
        events: list[dict] = []
        # sid -> set of date strings
        per_stadium: dict[str, set[str]] = {}

        for table in tables:
            rows = table.select("tr")
            if not rows:
                continue
            # ヘッダ行から列数推定 (場名 col を除く)
            header_cells = rows[0].select("th, td")
            n_date_cols = len(header_cells) - 1
            if n_date_cols <= 0:
                continue
            date_axis = _build_date_axis(year, month, n_date_cols)

            for row in rows[1:]:
                # 1 列目は場の <th> with anchor jcd
                first = row.select_one("th, td")
                if not first:
                    continue
                a = first.select_one("a[href*='jcd=']")
                if not a:
                    continue
                href = a.get("href", "")
                try:
                    jcd_str = href.split("jcd=")[1].split("&")[0]
                    sid = int(jcd_str)
                except (ValueError, IndexError):
                    continue
                if sid not in STADIUMS:
                    continue

                # 残りの cell を colspan で展開
                date_cells = row.select("td")
                idx = 0
                for cell in date_cells:
                    span = int(cell.get("colspan") or 1)
                    cls_list = cell.get("class") or []
                    grade = None
                    for cls_name, g in GRADE_MAP.items():
                        if cls_name in cls_list:
                            grade = g
                            break
                    if grade is not None:
                        # 期間内の日付を全て登録
                        seg_dates = []
                        for k in range(span):
                            di = idx + k
                            if 0 <= di < len(date_axis):
                                seg_dates.append(date_axis[di])
                        if seg_dates:
                            title = cell.get_text(" ", strip=True)
                            events.append({
                                "stadium": sid,
                                "stadium_name": STADIUMS[sid],
                                "grade": grade,
                                "title": title,
                                "dates": seg_dates,
                            })
                            per_stadium.setdefault(str(sid), set()).update(seg_dates)
                    idx += span

        # set -> sorted list
        per_stadium_sorted = {sid: sorted(d) for sid, d in per_stadium.items()}
        return {"events": events, "stadium_dates": per_stadium_sorted}
    except Exception as e:
        print(f"  スケジュール解析失敗 ({year_month}): {e}", file=sys.stderr)
        return {"events": [], "stadium_dates": {}}


def _merge_stadium_dates(*per_stadium_dicts) -> dict[str, list[str]]:
    out: dict[str, set[str]] = {}
    for d in per_stadium_dicts:
        for sid, dates in d.items():
            out.setdefault(sid, set()).update(dates)
    return {sid: sorted(d) for sid, d in out.items()}


def _compute_next_open(stadium_dates: dict[str, list[str]],
                       today_iso: str) -> dict[str, str]:
    """各場の「今日より後で最初の開催日（＝次回開催日）」を返す。

    rt-fix3 (2026-06-27): 判定を `>= today` → `> today`（今日を除外）に変更。
    next_open.json はトップ画面の「非開催(グレー)カード」専用に消費される（開催中の場は
    プログラムから active=青で描画され next_open を使わない）。従来は当日開催予定を today で
    返していたため、上流の月間スケジュールが「今日開催」と載せていてもプログラム未掲載でグレーの
    場に「今日」が入り、クライアント側ガードで日付が出ない／矛盾表示になっていた。非開催カードに
    とって意味があるのは「次に開催する未来日」なので、今日を除いた最初の未来日を返す。
    対象外（未来日が無い）の場は欠落。
    """
    out: dict[str, str] = {}
    for sid, dates in stadium_dates.items():
        for d in dates:
            if d > today_iso:
                out[sid] = d
                break
    return out


def _is_current_fresh(max_age_days: int = 2) -> bool:
    """current.json が存在し、updated_at が max_age_days 以内なら True。

    rt-fix3 (2026-06-27): 既定を 14→2 日に短縮。current.json はフルスケジュール
    (各場の開催日一覧) の元データで、ここから next_open.json を算出する。14 日許容だと
    終了済/予定変更の場の開催日が next_open に残り、「非開催なのに本日開催」と誤表示する
    主因になっていた。フル fetch は refresh-next-open.yml が全取得モードで定期的に呼ぶため、
    2 日以内に current.json が自動で再取得される。
    """
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", OUTPUT_FILE)
    if not os.path.exists(p):
        return False
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        upd = d.get("updated_at", "")
        if not upd:
            return False
        # ISO 8601 解析（Z 付きも考慮）
        ts = datetime.fromisoformat(upd.replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - ts
        return age <= timedelta(days=max_age_days) and bool(d.get("stadium_dates"))
    except Exception:
        return False


def _refresh_next_open_only() -> int | None:
    """current.json から next_open.json だけ再計算する（HTTP fetch なし）。

    FIX: current.json が無い / 読み取り失敗時は None を返し、呼び出し側がフル
    fetch にフォールバック。以前は FileNotFoundError で crash していた。
    """
    today_iso = datetime.now(JST).date().isoformat()
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", OUTPUT_FILE)
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"current.json 読込失敗 ({e.__class__.__name__}) — フル取得に切替え")
        return None
    stadium_dates = d.get("stadium_dates", {})
    next_open = _compute_next_open(stadium_dates, today_iso)
    next_output = {
        "updated_at": utc_iso_seconds(),
        "today": today_iso,
        "next_open": next_open,
    }
    atomic_write_json(NEXT_OPEN_FILE, next_output, indent=2)
    print(f"next_open.json 更新: {len(next_open)}場 (current.json は再利用)")
    return len(next_open)


def main():
    # --quick: HTTP fetch を避けて next_open.json だけ更新（毎日呼んで OK）
    quick = "--quick" in sys.argv

    if quick or _is_current_fresh():
        # FIX: TOCTOU を避けるため exists() チェックを撤去し、
        #   _refresh_next_open_only() 内部の try/except でハンドル。None なら full fetch。
        if _refresh_next_open_only() is not None:
            return

    now = datetime.now(JST)
    today_iso = now.date().isoformat()
    months_data = []
    per_stadium_all: list[dict] = []

    # 当月
    ym1 = now.strftime("%Y%m")
    print(f"当月取得: {ym1}")
    res1 = scrape_month(ym1)
    months_data.append({
        "year_month": now.strftime("%Y-%m"),
        "events": res1["events"],
    })
    per_stadium_all.append(res1["stadium_dates"])
    time.sleep(3)

    # 翌月
    next_month = first_of_next_month(now)
    ym2 = next_month.strftime("%Y%m")
    print(f"翌月取得: {ym2}")
    res2 = scrape_month(ym2)
    months_data.append({
        "year_month": next_month.strftime("%Y-%m"),
        "events": res2["events"],
    })
    per_stadium_all.append(res2["stadium_dates"])

    stadium_dates = _merge_stadium_dates(*per_stadium_all)
    next_open = _compute_next_open(stadium_dates, today_iso)

    output = {
        "updated_at": utc_iso_seconds(),
        "months": months_data,
        "stadium_dates": stadium_dates,
    }
    atomic_write_json(OUTPUT_FILE, output, indent=2)

    next_output = {
        "updated_at": utc_iso_seconds(),
        "today": today_iso,
        "next_open": next_open,
    }
    atomic_write_json(NEXT_OPEN_FILE, next_output, indent=2)

    total_events = sum(len(m["events"]) for m in months_data)
    print(f"完了: {total_events}イベント / 次回開催 {len(next_open)}場 を保存")


if __name__ == "__main__":
    main()
