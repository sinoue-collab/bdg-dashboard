#!/usr/bin/env python3
"""
freee OAuth 再認証スクリプト
-----------------------------
リフレッシュトークンが失効したときに実行する。
ブラウザで freee の認証画面を開き、新しいトークンを取得して
GitHub Secrets を更新する。

実行方法:
  python3 scripts/freee_reauth.py
"""

import base64
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

FREEE_TOKEN_URL = 'https://accounts.secure.freee.co.jp/public_api/token'
GITHUB_REPO     = 'sinoue-collab/bdg-dashboard'

def get_env(key):
    v = os.environ.get(key, '')
    if not v:
        v = input(f'{key}: ').strip()
    return v

def exchange_code(client_id, client_secret, code, redirect_uri):
    data = urllib.parse.urlencode({
        'grant_type':    'authorization_code',
        'client_id':     client_id,
        'client_secret': client_secret,
        'code':          code,
        'redirect_uri':  redirect_uri,
    }).encode()
    req = urllib.request.Request(FREEE_TOKEN_URL, data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def update_github_secret(repo, gh_token, name, value):
    try:
        from nacl import encoding, public as nacl_public
    except ImportError:
        print('  ⚠️  PyNaCl 未インストール: pip install PyNaCl')
        return False
    key_url = f'https://api.github.com/repos/{repo}/actions/secrets/public-key'
    req = urllib.request.Request(key_url)
    req.add_header('Authorization', f'token {gh_token}')
    req.add_header('Accept', 'application/vnd.github+json')
    with urllib.request.urlopen(req) as r:
        key_info = json.loads(r.read())
    pk        = nacl_public.PublicKey(key_info['key'].encode(), encoding.Base64Encoder)
    encrypted = base64.b64encode(nacl_public.SealedBox(pk).encrypt(value.encode())).decode()
    put_url   = f'https://api.github.com/repos/{repo}/actions/secrets/{name}'
    body      = json.dumps({'encrypted_value': encrypted, 'key_id': key_info['key_id']}).encode()
    req2      = urllib.request.Request(put_url, data=body, method='PUT')
    req2.add_header('Authorization', f'token {gh_token}')
    req2.add_header('Accept', 'application/vnd.github+json')
    req2.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req2) as r:
            return r.status in (201, 204)
    except urllib.error.HTTPError as e:
        return e.code in (201, 204)

def main():
    print('=' * 55)
    print('  freee OAuth 再認証')
    print('=' * 55)
    print()

    client_id     = get_env('FREEE_CLIENT_ID')
    client_secret = get_env('FREEE_CLIENT_SECRET')
    redirect_uri  = input('リダイレクトURI（freee アプリ設定の値）: ').strip()
    gh_token      = input('GitHub Personal Access Token（repo スコープ）: ').strip()

    # 認証URL生成
    auth_url = (
        'https://accounts.secure.freee.co.jp/public_api/authorize'
        f'?client_id={urllib.parse.quote(client_id)}'
        f'&redirect_uri={urllib.parse.quote(redirect_uri)}'
        '&response_type=code'
    )

    print()
    print('【手順】')
    print('1. 以下のURLをブラウザで開いて freee にログインし、アプリを認可してください')
    print()
    print(f'  {auth_url}')
    print()
    print('2. 認可後にリダイレクトされたURLの ?code=XXXX の部分をコピーしてください')
    print()

    code = input('認可コード（code=の後ろの値）: ').strip()
    if not code:
        print('エラー: 認可コードが入力されていません')
        sys.exit(1)

    print('\nトークン取得中...')
    try:
        tokens = exchange_code(client_id, client_secret, code, redirect_uri)
    except Exception as e:
        print(f'エラー: トークン取得失敗: {e}')
        sys.exit(1)

    access_token  = tokens.get('access_token', '')
    refresh_token = tokens.get('refresh_token', '')
    if not access_token:
        print('エラー: access_token が取得できませんでした')
        sys.exit(1)

    print(f'  ✓ access_token  : {access_token[:12]}...（{len(access_token)}文字）')
    print(f'  ✓ refresh_token : {refresh_token[:12]}...（{len(refresh_token)}文字）')

    print('\nGitHub Secrets を更新中...')
    r1 = update_github_secret(GITHUB_REPO, gh_token, 'FREEE_ACCESS_TOKEN',  access_token)
    r2 = update_github_secret(GITHUB_REPO, gh_token, 'FREEE_REFRESH_TOKEN', refresh_token)
    print(f'  FREEE_ACCESS_TOKEN:  {"✓" if r1 else "✗ 失敗"}')
    print(f'  FREEE_REFRESH_TOKEN: {"✓" if r2 else "✗ 失敗"}')

    if r1 and r2:
        print()
        print('=' * 55)
        print('  完了！GitHub Actions を再実行してください。')
        print('=' * 55)
    else:
        print('\n一部の更新に失敗しました。GitHub Settings > Secrets で手動で設定してください。')
        print(f'  FREEE_ACCESS_TOKEN  = {access_token}')
        print(f'  FREEE_REFRESH_TOKEN = {refresh_token}')

if __name__ == '__main__':
    main()
