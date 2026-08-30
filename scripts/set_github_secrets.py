#!/usr/bin/env python3
"""
GitHub Secrets 一括登録スクリプト
-----------------------------------
実行方法:
  python3 scripts/set_github_secrets.py

必要なもの:
  GitHub Personal Access Token（repoスコープ）
  https://github.com/settings/tokens/new
"""

import base64
import json
import os
import sys
import urllib.request
import urllib.error

from nacl import encoding, public

REPO   = 'sinoue-collab/bdg-dashboard'
SECRETS = {
    'FREEE_CLIENT_ID':     os.environ.get('FREEE_CLIENT_ID',     ''),
    'FREEE_CLIENT_SECRET': os.environ.get('FREEE_CLIENT_SECRET', ''),
    'FREEE_ACCESS_TOKEN':  os.environ.get('FREEE_ACCESS_TOKEN',  ''),
    'FREEE_REFRESH_TOKEN': os.environ.get('FREEE_REFRESH_TOKEN', ''),
}

def api_get(url, token):
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'token {token}')
    req.add_header('Accept', 'application/vnd.github+json')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def api_put(url, token, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method='PUT')
    req.add_header('Authorization', f'token {token}')
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code

def encrypt_secret(public_key_b64, secret_value):
    pk = public.PublicKey(public_key_b64.encode(), encoding.Base64Encoder)
    box = public.SealedBox(pk)
    encrypted = box.encrypt(secret_value.encode())
    return base64.b64encode(encrypted).decode()

def main():
    print('=' * 50)
    print('  GitHub Secrets 一括登録')
    print('=' * 50)
    print(f'対象リポジトリ: {REPO}')
    print()

    # 環境変数 or コマンドライン引数からトークンを取得
    token = os.environ.get('GITHUB_TOKEN', '')
    if not token and len(sys.argv) > 1:
        token = sys.argv[1]
    if not token:
        token = input('GitHub Personal Access Token を入力してください: ')

    token = token.strip()
    if not token:
        print('エラー: トークンが未入力です')
        return

    # リポジトリの公開鍵を取得
    print('\nGitHubに接続中...')
    try:
        key_url = f'https://api.github.com/repos/{REPO}/actions/secrets/public-key'
        key_info = api_get(key_url, token)
        key_id  = key_info['key_id']
        pub_key = key_info['key']
    except Exception as e:
        print(f'エラー: リポジトリへのアクセスに失敗しました')
        print(f'  → トークンのスコープ（repo）とリポジトリ名を確認してください')
        print(f'  詳細: {e}')
        return

    print('接続OK\n')

    # 各Secretを登録
    success = 0
    for name, value in SECRETS.items():
        encrypted = encrypt_secret(pub_key, value)
        secret_url = f'https://api.github.com/repos/{REPO}/actions/secrets/{name}'
        status = api_put(secret_url, token, {
            'encrypted_value': encrypted,
            'key_id': key_id,
        })
        if status in (201, 204):
            print(f'  ✓ {name}')
            success += 1
        else:
            print(f'  ✗ {name}  (HTTP {status})')

    print()
    if success == len(SECRETS):
        print('=' * 50)
        print('  全て登録完了！')
        print('=' * 50)
    else:
        print(f'{success}/{len(SECRETS)} 件登録できました。失敗した項目は手動で登録してください。')

if __name__ == '__main__':
    main()
