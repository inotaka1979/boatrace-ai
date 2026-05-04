"""PC-1 / PC-8: http_utils のユニットテスト

mock の urlopen を用いて retry / 即時失敗 / decode の挙動を検証。

実行:
    python3 -m unittest scripts.tests.test_http_utils -v
"""

from __future__ import annotations

import io
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import http_utils


def _mk_response(payload: bytes):
    """contextlib 風の擬似レスポンス（with urlopen as r: r.read() に応える）。"""
    m = mock.MagicMock()
    m.__enter__ = mock.MagicMock(return_value=m)
    m.__exit__ = mock.MagicMock(return_value=False)
    m.read = mock.MagicMock(return_value=payload)
    return m


class TestFetchSuccess(unittest.TestCase):
    @mock.patch("http_utils.urlopen")
    def test_fetch_text_basic(self, mock_open):
        mock_open.return_value = _mk_response(b"hello")
        self.assertEqual(http_utils.fetch_text("http://x"), "hello")

    @mock.patch("http_utils.urlopen")
    def test_fetch_json_basic(self, mock_open):
        mock_open.return_value = _mk_response(b'{"a":1,"b":[2,3]}')
        self.assertEqual(http_utils.fetch_json("http://x"), {"a": 1, "b": [2, 3]})

    @mock.patch("http_utils.urlopen")
    def test_fetch_bytes_basic(self, mock_open):
        mock_open.return_value = _mk_response(b"\x00\x01\x02")
        self.assertEqual(http_utils.fetch_bytes("http://x"), b"\x00\x01\x02")

    @mock.patch("http_utils.urlopen")
    def test_user_agent_present(self, mock_open):
        mock_open.return_value = _mk_response(b"ok")
        http_utils.fetch_text("http://x")
        called_req = mock_open.call_args[0][0]
        ua = called_req.get_header("User-agent")
        self.assertIn("BoatRaceOracle", ua)

    @mock.patch("http_utils.urlopen")
    def test_extra_headers_merged(self, mock_open):
        mock_open.return_value = _mk_response(b"ok")
        http_utils.fetch_text("http://x", headers={"X-Test": "1"})
        called_req = mock_open.call_args[0][0]
        self.assertEqual(called_req.get_header("X-test"), "1")
        # default UA should still be present
        self.assertIn("BoatRaceOracle", called_req.get_header("User-agent"))


class TestRetryBehavior(unittest.TestCase):
    @mock.patch("http_utils.time.sleep", lambda *_: None)  # backoff 短縮
    @mock.patch("http_utils.urlopen")
    def test_retry_then_success(self, mock_open):
        # 1 回目 OSError、2 回目 OK
        mock_open.side_effect = [OSError("net"), _mk_response(b"ok")]
        self.assertEqual(http_utils.fetch_text("http://x", retries=2), "ok")
        self.assertEqual(mock_open.call_count, 2)

    @mock.patch("http_utils.time.sleep", lambda *_: None)
    @mock.patch("http_utils.urlopen")
    def test_retry_exhausted_raises(self, mock_open):
        mock_open.side_effect = OSError("net down")
        with self.assertRaises(RuntimeError) as cm:
            http_utils.fetch_text("http://x", retries=2)
        self.assertIn("failed after 3 tries", str(cm.exception))
        self.assertEqual(mock_open.call_count, 3)


class TestNonRetryStatus(unittest.TestCase):
    @mock.patch("http_utils.time.sleep", lambda *_: None)
    @mock.patch("http_utils.urlopen")
    def test_404_immediate_raise(self, mock_open):
        from urllib.error import HTTPError
        mock_open.side_effect = HTTPError("http://x", 404, "Not Found", {}, None)
        with self.assertRaises(RuntimeError) as cm:
            http_utils.fetch_text("http://x", retries=3)
        self.assertIn("404", str(cm.exception))
        # リトライしない
        self.assertEqual(mock_open.call_count, 1)

    @mock.patch("http_utils.time.sleep", lambda *_: None)
    @mock.patch("http_utils.urlopen")
    def test_500_retries(self, mock_open):
        from urllib.error import HTTPError
        mock_open.side_effect = HTTPError("http://x", 500, "Server", {}, None)
        with self.assertRaises(RuntimeError):
            http_utils.fetch_text("http://x", retries=2)
        # 5xx はリトライ対象
        self.assertEqual(mock_open.call_count, 3)


class TestEncoding(unittest.TestCase):
    @mock.patch("http_utils.urlopen")
    def test_utf8_decode(self, mock_open):
        mock_open.return_value = _mk_response("日本語".encode("utf-8"))
        self.assertEqual(http_utils.fetch_text("http://x"), "日本語")

    @mock.patch("http_utils.urlopen")
    def test_invalid_bytes_replaced(self, mock_open):
        # 不正バイト → errors='replace' で文字化け文字に置換、例外なし
        mock_open.return_value = _mk_response(b"\xff\xfe ok")
        out = http_utils.fetch_text("http://x")
        self.assertIn("ok", out)


if __name__ == "__main__":
    unittest.main()
