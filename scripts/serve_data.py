#!/usr/bin/env python3
"""
serve_data.py — データファイル専用HTTPサーバー (ハイブリッド構成用)

RPi5上でdata/*.jsonをCORS対応で配信する軽量サーバー。
GitHub PagesはHTML/JS/CSSを配信し、データだけRPiから直接取得する構成。

使い方:
  python3 scripts/serve_data.py              # ポート8080
  python3 scripts/serve_data.py --port 9000  # ポート指定

systemdサービスとして登録する場合:
  sudo cp scripts/boatrace-data.service /etc/systemd/system/
  sudo systemctl enable --now boatrace-data
"""

import os
import sys
import json
import argparse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from functools import partial


class CORSDataHandler(SimpleHTTPRequestHandler):
    """CORS対応 + dataディレクトリ限定のHTTPハンドラ"""

    def __init__(self, *args, data_dir, **kwargs):
        self.data_dir = data_dir
        super().__init__(*args, directory=data_dir, **kwargs)

    def end_headers(self):
        # CORS: GitHub Pagesからのクロスオリジンリクエストを許可
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # キャッシュ: 60秒 (スクレイプ間隔より短く)
        self.send_header("Cache-Control", "public, max-age=60")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        # アクセスログを簡潔に
        sys.stderr.write(f"[{self.log_date_time_string()}] {args[0]}\n")


def main():
    parser = argparse.ArgumentParser(description="BoatRace data HTTP server")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--data-dir", default="/home/pi/boatrace-ai/data")
    args = parser.parse_args()

    if not os.path.isdir(args.data_dir):
        print(f"Error: {args.data_dir} not found", file=sys.stderr)
        sys.exit(1)

    handler = partial(CORSDataHandler, data_dir=args.data_dir)
    server = HTTPServer((args.bind, args.port), handler)

    print(f"Serving {args.data_dir} on http://{args.bind}:{args.port}")
    print(f"Example: http://localhost:{args.port}/odds/today.json")
    print("Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
