"""共通 I/O ユーティリティ (P2 D-01)

atomic_write_json:
  tempfile + os.replace で JSON をアトミックに書き込む。
  途中で kill / 電源断 / disk full が起きても既存ファイルが破壊されないことを保証する。

使い方:
    from io_utils import atomic_write_json
    atomic_write_json("data/odds/today.json", {"odds": [...]})
"""

from __future__ import annotations

import json
import os
import tempfile
from typing import Any


def atomic_write_json(
    path: str,
    data: Any,
    *,
    encoding: str = "utf-8",
    ensure_ascii: bool = False,
    indent: int | None = None,
    fsync: bool = True,
) -> None:
    """JSON をアトミックに書き込む (POSIX rename 保証)。

    Parameters
    ----------
    path : 出力ファイルパス
    data : json.dump に渡す任意のオブジェクト
    encoding : 文字コード
    ensure_ascii : json.dump に渡す
    indent : json.dump に渡す（None なら separators で最小化）
    fsync : True なら fsync して耐電源断性を確保（デフォルト True）
    """
    abs_path = os.path.abspath(path)
    parent = os.path.dirname(abs_path) or "."
    os.makedirs(parent, exist_ok=True)

    fd, tmp = tempfile.mkstemp(prefix=".tmp_", dir=parent)
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            if indent is None:
                json.dump(data, f, ensure_ascii=ensure_ascii, separators=(",", ":"))
            else:
                json.dump(data, f, ensure_ascii=ensure_ascii, indent=indent)
            f.flush()
            if fsync:
                os.fsync(f.fileno())
        os.replace(tmp, abs_path)   # POSIX 上は atomic
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def safe_load_json(path: str, default: Any = None) -> Any:
    """JSON を安全にロード。失敗時は default を返し例外を呑まない（D-04 で使う場合は呼出側でログ）。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (json.JSONDecodeError, OSError):
        raise


# P1-B4: Scraper 出力の品質メタヘッダ
#   各 scraper 出力 JSON に統一して埋め込むことで、クライアント側で
#   「鮮度・信頼度・スキーマ版」を取り扱える。retention/監視ダッシュボードでも利用。
def quality_header(
    *,
    schema_version: int = 1,
    source_freshness_sec: float | None = None,
    reliability_score: float = 1.0,
    scraper: str = "",
) -> dict:
    """共通品質メタヘッダを返す。

    Parameters
    ----------
    schema_version : 出力スキーマのバージョン（互換性破壊時に bump）
    source_freshness_sec : ソース取得から書込までの秒数
    reliability_score : 0.0-1.0 の取得成功率（部分失敗を表現）
    scraper : スクレイパ識別名（例 'results' / 'previews'）
    """
    return {
        "schema_version": int(schema_version),
        "source_freshness_sec": (
            float(source_freshness_sec) if source_freshness_sec is not None else None
        ),
        "reliability_score": max(0.0, min(1.0, float(reliability_score))),
        "scraper": str(scraper or ""),
    }
