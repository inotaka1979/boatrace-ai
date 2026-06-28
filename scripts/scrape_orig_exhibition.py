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
# platform "ajax_cyokuzen": 桐生/福岡型(yosou.js ベンダー)。
#   ?page=yosou-cyokuzen&race=N で session 設定 → /sp/ajax/ajax_cyokuzen.php を
#   取得し、レスポンス(<!--sep--> 区切り先頭ページ)を parse_kiryu_cyokuzen で解析。
#   桐生は「一周」でなく「半周」を計測(lap_time に格納)。福岡は同ベンダーで流用。
C = "ajax_cyokuzen"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 BoatRaceOracle/1.0")
VENUES = {
    1: {"platform": C, "base": "https://www.kiryu-kyotei.com"},        # 桐生(半周計測)
    22: {"platform": C, "base": "https://www.boatrace-fukuoka.com"},   # 福岡(同ベンダー)
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


def parse_kiryu_cyokuzen(html, sid, rno):
    """桐生/福岡型(ajax_cyokuzen.php)の cyokuzen HTML → race dict | None。

    レスポンスは '<!--sep-->' 区切りの複数ページで、先頭が直前情報。
    テーブル thead: 艇番/体重/チルト/展示タイム(col4)/オリジナル展示データ
      (col5_1=半周, col5_2=まわり足, col5_3=直線)。各艇 2 行(メイン + 調整行)。
    本体セルは col5-1/col5-2/col5-3(ハイフン)。展示前は col5-7 に
    「表示するデータがありません」が merge されるため時刻は 0.0 になる。
    ※桐生は「一周」でなく「半周」を独自計測。順位ベースの予想加点に使うため
      半周を lap_time に格納する(スケールでなく艇間順位が効くので互換)。
    """
    segments = html.split("<!--sep-->")
    target = None
    for seg in segments or [html]:
        soup = BeautifulSoup(seg, "html.parser")
        for tbl in soup.find_all("table"):
            head = tbl.find("thead")
            if not head:
                continue
            t = head.get_text()
            if ("半周" in t) and ("まわり足" in t) and ("直線" in t):
                target = tbl
                break
        if target is not None:
            break
    if target is None:
        return None

    body = target.find("tbody") or target
    boats = []
    for row in body.find_all("tr"):
        c1 = row.find("td", class_="col1")
        if not c1:
            continue  # 調整行(col2_1 のみ)はスキップ
        try:
            waku = int(c1.get_text(strip=True))
        except (TypeError, ValueError):
            continue
        if not (1 <= waku <= 6):
            continue
        ex = row.find("td", class_="col4")
        rec = {
            "racer_boat_number": waku,
            "ex_time": _f(ex.get_text(strip=True)) if ex else 0.0,
            "lap_time": 0.0, "turn_time": 0.0, "straight_time": 0.0,
        }
        # 展示前は col5-7(merge セル)=データ無し → 0.0 のまま
        if not row.find("td", class_="col5-7"):
            cells = [row.find("td", class_=f"col5-{n}") for n in (1, 2, 3)]
            if not any(cells):
                # クラスが付かない場合の位置フォールバック: col4 の後ろ 3 セル
                tds = row.find_all("td")
                idx = next((i for i, td in enumerate(tds)
                            if "col4" in (td.get("class") or [])), -1)
                if idx >= 0:
                    cells = tds[idx + 1: idx + 4]
            vals = [_f(td.get_text(strip=True)) if td else 0.0 for td in cells]
            vals += [0.0] * (3 - len(vals))
            rec["lap_time"], rec["turn_time"], rec["straight_time"] = vals[:3]
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


def _cookie_get(opener, url, ref):
    """cookie 維持のため opener 経由で GET。失敗時は例外。"""
    import urllib.request
    req = urllib.request.Request(url, headers={
        "User-Agent": _UA, "Referer": ref,
        "X-Requested-With": "XMLHttpRequest"})
    with opener.open(req, timeout=12) as r:
        return r.read().decode("utf-8", errors="replace")


_TOBAN_RE = __import__("re").compile(r"toban=(\d{3,5})")


def _roster(html):
    """レスポンス中の登録番号(toban)先頭 6 件 = 出走選手。レース選択の検証用。"""
    return tuple(_TOBAN_RE.findall(html)[:6])


def _fetch_one_cyokuzen(base, jcd, rno):
    """桐生/福岡型: race=N ページで session を設定 → ajax_cyokuzen.php を取得。

    返す race には検証用の出走選手 roster(_roster)を添える。展示前(時刻無し)でも
    roster は取れるため、レース選択が効いているかの判定に使える。
    """
    import http.cookiejar
    import urllib.request
    page = base + f"/sp/index.php?page=yosou-cyokuzen&race={rno}"
    ajax = base + "/sp/ajax/ajax_cyokuzen.php"
    try:
        cj = http.cookiejar.CookieJar()
        op = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cj))
        _cookie_get(op, page, base + "/sp/")       # session にレースを設定
        html = _cookie_get(op, ajax, page)
        race = parse_kiryu_cyokuzen(html, jcd, rno)
        if race and _has_times(race):
            race["_roster"] = _roster(html)
            return race
    except Exception:
        pass  # 非対応/欠番/展示前は静かに skip(誤データを出さない)
    return None


def scrape_ajax_cyokuzen(base, jcd, date_str):
    """桐生/福岡型の全 12R を取得。レース選択不具合による重複は抑止する。

    cookie session でレースを選べない実装差異があると全レースが同一データを
    返し得る。non-zero 署名(各艇の半周/まわり足/直線)が複数レースで重複する
    場合はレース選択が信頼できないと判断し、その場の出力を空にする(誤った
    レース割当を出さない=silent な予想劣化を防ぐ)。
    """
    out = []
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(_fetch_one_cyokuzen, base, jcd, rno)
                for rno in range(1, 13)]
        for fut in as_completed(futs):
            race = fut.result()
            if race:
                out.append(race)

    # 出走選手 roster でレース選択の妥当性を検証: cookie でレースを切替えられない
    # 実装差異があると全レースが同一 roster を返す → 重複したら誤割当を避けて全抑止。
    rosters = [r.get("_roster") or () for r in out]
    if any(rosters) and len(set(rosters)) != len(rosters):
        print(f"  jcd={jcd}: race-selection unreliable "
              f"(duplicate rosters) → suppress all {len(out)} races")
        return []
    for r in out:
        r.pop("_roster", None)
    out.sort(key=lambda r: r["race_number"])
    return out


def scrape_venue(jcd, cfg, date_str):
    """レジストリの platform に応じて場のオリジナル展示を取得する。"""
    if cfg["platform"] == "ajax_yosou":
        return scrape_ajax_yosou(cfg["base"], jcd, date_str)
    if cfg["platform"] == "ajax_cyokuzen":
        return scrape_ajax_cyokuzen(cfg["base"], jcd, date_str)
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
