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
from urllib.parse import urlparse, parse_qs


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

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/race':
            params = parse_qs(parsed.query)
            try:
                stadium = int(params.get('stadium', [0])[0])
                race = int(params.get('race', [0])[0])
            except (ValueError, IndexError):
                self.send_response(400)
                self.end_headers()
                return
            self._serve_race(stadium, race)
        else:
            super().do_GET()

    def _serve_race(self, stadium, race):
        """特定の場・レースのデータのみを返すエンドポイント"""
        result = {'stadium': stadium, 'race': race}

        # 直前情報
        previews_path = os.path.join(self.data_dir, 'previews', 'today.json')
        if os.path.exists(previews_path):
            try:
                with open(previews_path, encoding='utf-8') as f:
                    data = json.load(f)
                result['previews_updated_at'] = data.get('updated_at')
                for r in data.get('races', []):
                    if r.get('stadium') == stadium and r.get('race') == race:
                        result['preview'] = r
                        break
            except Exception:
                pass

        # オッズ
        odds_path = os.path.join(self.data_dir, 'odds', 'today.json')
        if os.path.exists(odds_path):
            try:
                with open(odds_path, encoding='utf-8') as f:
                    data = json.load(f)
                result['odds_updated_at'] = data.get('updated_at')
                for o in data.get('odds', []):
                    if o.get('stadium') == stadium and o.get('race') == race:
                        result['odds'] = o
                        break
            except Exception:
                pass

        # 今節成績データ（全体を返す — ファイルが小さいため）
        racedata_path = os.path.join(self.data_dir, 'racedata', 'today.json')
        if os.path.exists(racedata_path):
            try:
                with open(racedata_path, encoding='utf-8') as f:
                    result['racedata'] = json.load(f)
            except Exception:
                pass

        body = json.dumps(result, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
