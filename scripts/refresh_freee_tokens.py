#!/usr/bin/env python3
"""
refresh_freee_tokens.py
freee の OAuth 再認証スクリプト。
ブラウザで認可 → localhost でコールバックを自動受信 → トークンを表示します。

使い方:
  python3 scripts/refresh_freee_tokens.py
"""

import json
import os
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

REDIRECT_URI   = 'http://localhost:8765/callback'
AUTH_URL       = 'https://accounts.secure.freee.co.jp/public_api/authorize'
TOKEN_URL      = 'https://accounts.secure.freee.co.jp/public_api/token'

_auth_code = None


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _auth_code
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        code   = params.get('code', [None])[0]
        error  = params.get('error', [None])[0]

        if code:
            _auth_code = code
            body = '<h2>&#x2713; 認可完了！このタブを閉じてください。</h2>'.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(body)
        else:
            body = f'<h2>&#x2715; エラー: {error}</h2>'.encode()
            self.send_response(400)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, *args):
        pass  # ログ出力を抑制


def start_server():
    global _auth_code
    import time
    server = HTTPServer(('localhost', 8765), CallbackHandler)
    server.timeout = 1  # seconds; handle_request() returns even if nothing arrives
    deadline = time.time() + 120
    # favicon等の無関係なリクエストが先に来てもコールバックを取りこぼさないよう、
    # 認可コードを受け取るか120秒経過するまでループする
    while _auth_code is None and time.time() < deadline:
        server.handle_request()
    server.server_close()


def main():
    # CLIENT_ID / CLIENT_SECRET の取得
    client_id     = os.environ.get('FREEE_CLIENT_ID', '').strip()
    client_secret = os.environ.get('FREEE_CLIENT_SECRET', '').strip()

    if not client_id:
        client_id = input('FREEE_CLIENT_ID を入力してください: ').strip()
    if not client_secret:
        client_secret = input('FREEE_CLIENT_SECRET を入力してください: ').strip()

    if not client_id or not client_secret:
        sys.exit('エラー: CLIENT_ID と CLIENT_SECRET が必要です')

    # ローカルサーバーをバックグラウンドで起動
    t = threading.Thread(target=start_server, daemon=True)
    t.start()

    # 認可 URL を構築してブラウザで開く
    auth_params = urllib.parse.urlencode({
        'client_id':     client_id,
        'redirect_uri':  REDIRECT_URI,
        'response_type': 'code',
    })
    url = f'{AUTH_URL}?{auth_params}'

    print()
    print('ブラウザで freee の認可画面を開きます...')
    print(f'自動で開かない場合は以下のURLを手動でブラウザに貼り付けてください:')
    print(f'  {url}')
    print()
    webbrowser.open(url)

    # コールバックを待つ
    print('freee でログインして「許可する」をクリックしてください...')
    t.join(timeout=120)

    if not _auth_code:
        sys.exit('エラー: 120秒以内にコールバックが受信できませんでした')

    print('  ✓ 認可コード受信')

    # 認可コードをトークンに交換
    post_data = urllib.parse.urlencode({
        'grant_type':    'authorization_code',
        'client_id':     client_id,
        'client_secret': client_secret,
        'code':          _auth_code,
        'redirect_uri':  REDIRECT_URI,
    }).encode()

    req = urllib.request.Request(TOKEN_URL, data=post_data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    try:
        with urllib.request.urlopen(req) as resp:
            tokens = json.loads(resp.read())
    except Exception as e:
        sys.exit(f'エラー: トークン取得失敗: {e}')

    access_token  = tokens.get('access_token',  '')
    refresh_token = tokens.get('refresh_token', '')

    if not access_token:
        sys.exit(f'エラー: レスポンスに access_token がありません: {tokens}')

    print()
    print('=' * 60)
    print('  新しいトークン取得完了')
    print('=' * 60)
    print()
    print('【GitHub Secrets に設定してください】')
    print(f'  FREEE_ACCESS_TOKEN  = {access_token}')
    print(f'  FREEE_REFRESH_TOKEN = {refresh_token}')
    print()
    print('設定URL:')
    print('  https://github.com/sinoue-collab/bdg-dashboard/settings/secrets/actions')
    print()


if __name__ == '__main__':
    main()
