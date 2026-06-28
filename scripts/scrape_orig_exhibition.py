#!/usr/bin/env python3
"""各場「オリジナル展示」(一周/まわり足/直線/展示タイム)を取得する。

boatrace.jp(全国版)には無い、各場が独自に実測・公開する周回展示データを予想に取り込む。
場ごとにサイト構造が異なるため、場別パーサを持つ。現状は鳴門(jcd=14)に対応。

鳴門(n14.jp)の直前情報は AJAX:
  GET /sp/ajax/ajax_yosou.php?targetday=YYYYMMDD&race=N&req=cyokuzen&run=0
  (Referer / X-Requested-With ヘッダ必須。無いと空応答)
返る HTML の「各タイム」表: col4=展示, col5=一周, col6=まわり足, col7=直線、
各艇 2 行(メイン + 調整重量行)。rank_1/rank_2 クラスが各列の最速/2番手を示す。

出力 data/orig_exhibition/today.json(openapi 互換の補助データ):
  {"updated_at","race_date","exhibition":[
     {"race_stadium_number","race_number","boats":[
        {"racer_boat_number","ex_time","lap_time","turn_time","straight_time","adjust_weight"}]}]}
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_utils import atomic_write_json  # noqa: E402
from time_utils import utc_iso_seconds  # noqa: E402
from http_utils import fetch_text  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

JST = timezone(timedelta(hours=9))
OUTPUT = "data/orig_exhibition/today.json"

# 場レジストリ: 場ごとに platform と base(ドメイン) を登録するだけで対応場を増やせる。
#   platform "ajax_yosou": 鳴門型(n14.jp 系ベンダー)。/sp/ajax/ajax_yosou.php?req=cyokuzen を
#     Referer/XHR 付きで叩き、「各タイム」表(col4-7)を parse_naruto_cyokuzen で解析。
#     同型サイトの他場は base を足すだけで流用できる。
# ajax_yosou 形式(/sp/ajax/ajax_yosou.php?req=cyokuzen)で動く場のみ登録。
#   全24場 probe で判定: 5/10/13/18/20/21 は表取得OK、6/8/9/19 は同エンドポイント200(同ベンダー、
#   開催日/展示後に表が出る想定)。残り12場(1/2/3/4/11/12/15/16/17/22/23/24)は ajax_yosou.php が
#   404(502)=別サイト形式のため未登録(蒲郡7=静的+JSも別形式)。別形式は専用 platform で順次対応。
A = "ajax_yosou"
VENUES = {
    5: {"platform": A, "base": "https://www.boatrace-tamagawa.com"},   # 多摩川 ✓
    6: {"platform": A, "base": "https://www.boatrace-hamanako.jp"},    # 浜名湖(同ベンダー)
    8: {"platform": A, "base": "https://www.boatrace-tokoname.jp"},    # 常滑(同ベンダー)
    9: {"platform": A, "base": "https://www.boatrace-tsu.com"},        # 津(同ベンダー)
    10: {"platform": A, "base": "https://www.boatrace-mikuni.jp"},     # 三国 ✓
    13: {"platform": A, "base": "https://www.boatrace-amagasaki.jp"},  # 尼崎 ✓
    14: {"platform": A, "base": "https://www.n14.jp"},                 # 鳴門 ✓
    18: {"platform": A, "base": "https://www.boatrace-tokuyama.jp"},   # 徳山 ✓
    19: {"platform": A, "base": "https://www.boatrace-shimonoseki.jp"},  # 下関(同ベンダー)
    20: {"platform": A, "base": "https://www.wmb.jp"},                 # 若松 ✓
    21: {"platform": A, "base": "https://www.boatrace-ashiya.com"},    # 芦屋 ✓
}


def _f(s):
    try:
        v = float(str(s).strip())
        return v if v > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


# 抽出する時刻フィールド(予想に効く)。体重/チルト/調整は boatrace.jp 側で取得済みのため対象外。
_TIME_LABELS = {
    "展示": "ex_time",        # 直線150m 展示タイム
    "一周": "lap_time",       # 一周タイム
    "まわり足": "turn_time",   # まわり足
    "直線": "straight_time",  # 直線
}
_COL_RE = __import__("re").compile(r"^col\d+$")


def _header_col_map(table):
    """ヘッダ th から {field: colクラス} を作る。場により列構成が違うため動的に対応付ける。"""
    mp = {}
    for r in table.find_all("tr"):
        ths = r.find_all("th")
        if not ths:
            continue
        for th in ths:
            label = th.get_text(strip=True)
            field = _TIME_LABELS.get(label)
            if not field or field in mp:
                continue
            single = [c for c in (th.get("class") or []) if _COL_RE.match(c)]
            if single:
                mp[field] = single[0]
        # 全フィールド揃ったら終了
        if len(mp) == len(_TIME_LABELS):
            break
    return mp


def parse_naruto_cyokuzen(html, sid, rno):
    """各場の cyokuzen(オリジナル展示)HTML → {race_stadium_number,race_number,boats} | None。

    ヘッダ駆動で 展示/一周/まわり足/直線 の列を特定し、各艇(td.waku 行)から抽出する。
    場により列構成(col4-7 / col5-8 等)が違っても正しく取れる。展示前で表が無ければ None。
    """
    soup = BeautifulSoup(html, "html.parser")
    target = None
    for tbl in soup.find_all("table"):
        txt = tbl.get_text()
        if ("一周" in txt) and ("まわり足" in txt) and ("直線" in txt):
            target = tbl
            break
    if target is None:
        return None

    colmap = _header_col_map(target)
    # 最低限 一周/まわり足/直線 の列が取れないと信頼できない
    if not all(k in colmap for k in ("lap_time", "turn_time", "straight_time")):
        return None

    boats = []
    for row in target.find_all("tr"):
        waku_td = row.find("td", class_="waku")
        if not waku_td:
            continue
        try:
            waku = int(waku_td.get_text(strip=True))
        except (TypeError, ValueError):
            continue
        if not (1 <= waku <= 6):
            continue
        rec = {"racer_boat_number": waku}
        for field, colcls in colmap.items():
            td = row.find("td", class_=colcls)
            rec[field] = _f(td.get_text(strip=True)) if td else 0.0
        # 欠けたフィールドは 0.0 で補完
        for field in _TIME_LABELS.values():
            rec.setdefault(field, 0.0)
        boats.append(rec)

    if not boats:
        return None
    return {
        "race_stadium_number": int(sid),
        "race_number": int(rno),
        "boats": boats,
    }


def _has_times(race):
    """1 艇でも一周/まわり足/直線が入っていれば True(展示後)。"""
    return any(
        (b["lap_time"] or b["turn_time"] or b["straight_time"]) > 0
        for b in race.get("boats", [])
    )


def _fetch_one_ajax(base, jcd, rno, date_str, headers):
    url = (f"{base}/sp/ajax/ajax_yosou.php"
           f"?targetday={date_str}&race={rno}&req=cyokuzen&run=0")
    try:
        html = fetch_text(url, timeout=12, retries=1, headers=headers)
        race = parse_naruto_cyokuzen(html, jcd, rno)
        if race and _has_times(race):
            return race
    except Exception:
        pass  # 非対応場/欠番/展示前は静かに skip(誤データを出さない)
    return None


def scrape_ajax_yosou(base, jcd, date_str):
    """ajax_yosou 形式の全 12R を並列取得し、展示タイムが入ったレースのみ返す。"""
    headers = {"Referer": base + "/sp/", "X-Requested-With": "XMLHttpRequest"}
    out = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = [ex.submit(_fetch_one_ajax, base, jcd, rno, date_str, headers)
                for rno in range(1, 13)]
        for fut in as_completed(futs):
            race = fut.result()
            if race:
                out.append(race)
    out.sort(key=lambda r: r["race_number"])
    return out


def scrape_venue(jcd, cfg, date_str):
    """レジストリの platform に応じて場のオリジナル展示を取得する。"""
    if cfg["platform"] == "ajax_yosou":
        return scrape_ajax_yosou(cfg["base"], jcd, date_str)
    print(f"  jcd={jcd}: unknown platform {cfg['platform']}")
    return []


def main() -> int:
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    date_str = datetime.now(JST).strftime("%Y%m%d")
    exhibition = []
    for jcd, cfg in VENUES.items():
        races = scrape_venue(jcd, cfg, date_str)
        print(f"  jcd={jcd} ({cfg['platform']}): {len(races)} races with times")
        exhibition.extend(races)
    atomic_write_json(OUTPUT, {
        "updated_at": utc_iso_seconds(),
        "race_date": f"{date_str[0:4]}-{date_str[4:6]}-{date_str[6:8]}",
        "exhibition": exhibition,
    })
    print(f"wrote {OUTPUT}: {len(exhibition)} races with original exhibition times")
    return 0


if __name__ == "__main__":
    sys.exit(main())
