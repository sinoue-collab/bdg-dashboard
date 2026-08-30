#!/usr/bin/env python3
"""
freee API 初期認可スクリプト
-------------------------------
実行方法:
  python3 scripts/freee_auth.py

必要なもの:
  - freee アプリのクライアントID・クライアントシークレット
  - freee アプリに登録されたリダイレクトURI
    （初回は https://localhost や urn:ietf:wg:oauth:2.0:oob を推奨）

取得したトークンは GitHub Secrets に登録する:
  FREEE_CLIENT_ID
  FREEE_CLIENT_SECRET
  FREEE_ACCESS_TOKEN
  FREEE_REFRESH_TOKEN
"""

import os
import sys
import json
import urllib.parse
import urllib.request
import webbrowser

# ──────────────────────────────────────────
#  設定（環境変数 or 直接入力）
# ──────────────────────────────────────────

CLIENT_ID     = os.environ.get('FREEE_CLIENT_ID',     '')
CLIENT_SECRET = os.environ.get('FREEE_CLIENT_SECRET', '')
REDIRECT_URI  = os.environ.get('FREEE_REDIRECT_URI',  'urn:ietf:wg:oauth:2.0:oob')

AUTHORIZE_URL = 'https://accounts.secure.freee.co.jp/public_api/authorize'
TOKEN_URL     = 'https://accounts.secure.freee.co.jp/public_api/token'


def build_auth_url(client_id: str, redirect_uri: str) -> str:
    params = {
        'client_id':     client_id,
        'redirect_uri':  redirect_uri,
        'response_type': 'code',
    }
    return AUTHORIZE_URL + '?' + urllib.parse.urlencode(params)


def exchange_code(client_id: str, client_secret: str,
                  code: str, redirect_uri: str) -> dict:
    data = urllib.parse.urlencode({
        'grant_type':    'authorization_code',
        'client_id':     client_id,
        'client_secret': client_secret,
        'code':          code,
        'redirect_uri':  redirect_uri,
    }).encode()

    req = urllib.request.Request(TOKEN_URL, data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def main():
    print('=' * 55)
    print('  freee API 初期認可セットアップ')
    print('=' * 55)

    # クライアントID
    client_id = CLIENT_ID
    if not client_id:
        client_id = input('\nFREEE_CLIENT_ID を入力してください: ').strip()
    if not client_id:
        sys.exit('エラー: クライアントIDが未入力です')

    # クライアントシークレット
    client_secret = CLIENT_SECRET
    if not client_secret:
        client_secret = input('FREEE_CLIENT_SECRET を入力してください: ').strip()
    if not client_secret:
        sys.exit('エラー: クライアントシークレットが未入力です')

    # リダイレクトURI
    redirect_uri = REDIRECT_URI
    print(f'\nリダイレクトURI: {redirect_uri}')
    change = input('変更する場合は入力（そのままEnterでOK）: ').strip()
    if change:
        redirect_uri = change

    # 認可URLを生成・表示
    url = build_auth_url(client_id, redirect_uri)
    print('\n' + '─' * 55)
    print('【認可URL】')
    print(url)
    print('─' * 55)

    # ブラウザで開く
    open_browser = input('\nブラウザで開きますか？ [Y/n]: ').strip().lower()
    if open_browser != 'n':
        webbrowser.open(url)
        print('ブラウザを開きました。freeeにログインして「許可」を押してください。')

    # 認可コードの入力
    print('\nブラウザに表示された認可コードを貼り付けてください。')
    code = input('認可コード: ').strip()
    if not code:
        print('認可コードが入力されませんでした。')
        print('URLだけ使う場合はここで終了してください。')
        sys.exit(0)

    # トークン取得
    print('\nトークンを取得中…')
    try:
        tokens = exchange_code(client_id, client_secret, code, redirect_uri)
    except Exception as e:
        sys.exit(f'エラー: トークン取得に失敗しました\n{e}')

    access_token  = tokens.get('access_token',  '')
    refresh_token = tokens.get('refresh_token', '')
    expires_in    = tokens.get('expires_in',    '—')

    print('\n' + '=' * 55)
    print('  取得成功！以下を GitHub Secrets に登録してください')
    print('=' * 55)
    print(f'FREEE_CLIENT_ID     = {client_id}')
    print(f'FREEE_CLIENT_SECRET = （入力済みの値）')
    print(f'FREEE_ACCESS_TOKEN  = {access_token}')
    print(f'FREEE_REFRESH_TOKEN = {refresh_token}')
    print(f'（アクセストークン有効期限: {expires_in}秒）')
    print()
    print('⚠️  これらの値はチャットや指示書に書かず、')
    print('   GitHubのSettings > Secrets and variables > Actions から直接登録してください。')
    print('=' * 55)

    # .env ファイルに保存するか確認
    save = input('\n.env ファイルに保存しますか？（gitignoreに追加済みの場合のみ） [y/N]: ').strip().lower()
    if save == 'y':
        env_path = '.env.freee'
        with open(env_path, 'w') as f:
            f.write(f'FREEE_CLIENT_ID={client_id}\n')
            f.write(f'FREEE_CLIENT_SECRET={client_secret}\n')
            f.write(f'FREEE_ACCESS_TOKEN={access_token}\n')
            f.write(f'FREEE_REFRESH_TOKEN={refresh_token}\n')
        print(f'→ {env_path} に保存しました（.gitignore に追加することを強く推奨）')


if __name__ == '__main__':
    main()
