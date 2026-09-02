#!/usr/bin/env python3
"""
investigate_trial_cr.py
BLUE DESIGN の trial_cr（製造原価報告書）エンドポイント実地確認スクリプト
指示書㉜ 調査専用。実装には着手しない。

調査内容:
  1. GET /api/1/companies/{id}  → 業種設定を確認
  2. GET /api/1/reports/trial_cr            → 通常取得
  3. GET /api/1/reports/trial_cr (item)     → breakdown_display_type=item
  4. GET /api/1/reports/trial_pl (item)     → 比較用（既存の品目取得）
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

JST          = timezone(timedelta(hours=9))
FREEE_API    = 'https://api.freee.co.jp'
TOKEN_URL    = 'https://accounts.secure.freee.co.jp/public_api/token'

TARGET_MONTH = '2026-08'   # 確認対象月
# BLUE DESIGNは4月決算と判定されている
FISCAL_YEAR   = 2026
START_MONTH   = 5   # 5月目（会計月番号）= カレンダー8月（4月始まりFY）
END_MONTH     = 5


def tok_refresh(cid, csec, rtok):
    data = urllib.parse.urlencode({
        'grant_type': 'refresh_token', 'client_id': cid,
        'client_secret': csec, 'refresh_token': rtok,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())['access_token']


def get(path, token, params=None):
    url = FREEE_API + path
    if params:
        url += '?' + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Accept', 'application/json')
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        return {'_error': body[:2000]}, e.code


def sep(title):
    print()
    print('=' * 70)
    print(f'  {title}')
    print('=' * 70)


def main():
    access_token = os.environ.get('FREEE_ACCESS_TOKEN', '')
    refresh_tok  = os.environ.get('FREEE_REFRESH_TOKEN', '')
    client_id    = os.environ.get('FREEE_CLIENT_ID', '')
    client_secret= os.environ.get('FREEE_CLIENT_SECRET', '')
    company_id_s = os.environ.get('FREEE_COMPANY_ID_BLUE_DESIGN', '')

    if not all([access_token, refresh_tok, client_id, client_secret, company_id_s]):
        sys.exit('ERROR: 必要な環境変数が未設定です')

    company_id = int(company_id_s)
    print(f'BLUE DESIGN company_id = {company_id}')
    print(f'対象月: {TARGET_MONTH}  (fiscal_year={FISCAL_YEAR}, month番号={START_MONTH})')

    # トークン更新
    try:
        access_token = tok_refresh(client_id, client_secret, refresh_tok)
        print('  ✓ トークン更新完了')
    except Exception as e:
        print(f'  ⚠️  トークン更新失敗（既存で続行）: {e}')

    # ─────────────────────────────────────────
    sep('① 会社情報・業種設定')
    # ─────────────────────────────────────────
    data, status = get(f'/api/1/companies/{company_id}', access_token)
    print(f'  HTTP {status}')
    if '_error' in data:
        print(f'  ERROR: {data["_error"]}')
    else:
        co = data.get('company', data)
        keys_of_interest = [
            'name', 'name_kana', 'corporate_number',
            'industry_class', 'industry_code',
            'fiscal_years',
        ]
        for k in keys_of_interest:
            v = co.get(k)
            if v is not None:
                print(f'  {k}: {v}')
        # その他のキーも一覧表示
        other = {k: v for k, v in co.items() if k not in keys_of_interest and not isinstance(v, dict)}
        if other:
            print(f'  その他フィールド: {list(other.keys())}')

    # ─────────────────────────────────────────
    sep('② trial_cr（製造原価報告書）通常取得')
    # ─────────────────────────────────────────
    cr_params = {
        'company_id':  company_id,
        'fiscal_year': FISCAL_YEAR,
        'start_month': START_MONTH,
        'end_month':   END_MONTH,
    }
    data, status = get('/api/1/reports/trial_cr', access_token, cr_params)
    print(f'  HTTP {status}')
    if '_error' in data:
        print(f'  ERROR: {data["_error"]}')
    else:
        cr = data.get('trial_cr', {})
        balances = cr.get('balances', [])
        print(f'  trial_cr キー: {list(cr.keys())}')
        print(f'  balances 件数: {len(balances)}')
        print()
        print('  --- balances 全件 ---')
        for b in balances:
            name     = b.get('account_item_name') or '(null)'
            category = b.get('account_category_name') or '(なし)'
            op       = b.get('opening_balance', 0) or 0
            cl       = b.get('closing_balance',  0) or 0
            diff     = cl - op
            items    = b.get('items') or []
            print(f'  cat={category!r:30s} name={name!r:30s} diff={diff:>12,}  items={len(items)}件')
            for it in items[:5]:
                ino = it.get('opening_balance', 0) or 0
                icl = it.get('closing_balance',  0) or 0
                idf = icl - ino
                inm = it.get('name') or it.get('item_name') or '(unnamed)'
                print(f'      item: {inm!r:40s} diff={idf:>12,}')
            if len(items) > 5:
                print(f'      ... 他{len(items)-5}件')

    # ─────────────────────────────────────────
    sep('③ trial_cr breakdown_display_type=item')
    # ─────────────────────────────────────────
    cr_item_params = {**cr_params, 'breakdown_display_type': 'item'}
    data, status = get('/api/1/reports/trial_cr', access_token, cr_item_params)
    print(f'  HTTP {status}')
    if '_error' in data:
        print(f'  ERROR: {data["_error"]}')
    else:
        cr = data.get('trial_cr', {})
        balances = cr.get('balances', [])
        print(f'  balances 件数: {len(balances)}')
        print()
        print('  --- 全balances（items付き）---')
        for b in balances:
            name     = b.get('account_item_name') or '(null)'
            category = b.get('account_category_name') or '(なし)'
            op       = b.get('opening_balance', 0) or 0
            cl       = b.get('closing_balance',  0) or 0
            diff     = cl - op
            items    = b.get('items') or []
            has_items = 'items' in b
            print(f'  cat={category!r:30s} name={name!r:25s} diff={diff:>12,}  items-key={has_items} 件={len(items)}')
            for it in items[:10]:
                ino = it.get('opening_balance', 0) or 0
                icl = it.get('closing_balance',  0) or 0
                idf = icl - ino
                inm = it.get('name') or it.get('item_name') or '(unnamed)'
                print(f'      item: {inm!r:50s} diff={idf:>12,}')
            if len(items) > 10:
                print(f'      ... 他{len(items)-10}件')

    # ─────────────────────────────────────────
    sep('④ trial_pl breakdown_display_type=item（比較用・COGSカテゴリに注目）')
    # ─────────────────────────────────────────
    pl_item_params = {
        'company_id':             company_id,
        'fiscal_year':            FISCAL_YEAR,
        'start_month':            START_MONTH,
        'end_month':              END_MONTH,
        'breakdown_display_type': 'item',
    }
    data, status = get('/api/1/reports/trial_pl', access_token, pl_item_params)
    print(f'  HTTP {status}')
    if '_error' in data:
        print(f'  ERROR: {data["_error"]}')
    else:
        balances = data.get('trial_pl', {}).get('balances', [])
        print(f'  balances 件数: {len(balances)}')
        COGS_CATS = {'売上原価', '製品売上原価', '完成工事原価', '当期商品仕入', '製造原価', '製造費用'}
        print()
        print('  --- COGSカテゴリ行のみ抜粋 ---')
        found = False
        for b in balances:
            name     = b.get('account_item_name') or '(null)'
            category = b.get('account_category_name') or ''
            op       = b.get('opening_balance', 0) or 0
            cl       = b.get('closing_balance',  0) or 0
            diff     = cl - op
            items    = b.get('items') or []
            if category in COGS_CATS or '原価' in category or '仕入' in category or '製造' in category:
                found = True
                print(f'  cat={category!r:30s} name={name!r:25s} diff={diff:>12,}  items={len(items)}件')
                for it in items[:10]:
                    ino = it.get('opening_balance', 0) or 0
                    icl = it.get('closing_balance',  0) or 0
                    idf = icl - ino
                    inm = it.get('name') or it.get('item_name') or '(unnamed)'
                    print(f'      item: {inm!r:50s} diff={idf:>12,}')
                if len(items) > 10:
                    print(f'      ... 他{len(items)-10}件')
        if not found:
            print('  → COGSカテゴリ行は見つかりませんでした')

    print()
    print('=== 調査完了 ===')


if __name__ == '__main__':
    main()
