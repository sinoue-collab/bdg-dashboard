#!/usr/bin/env python3
"""
freee 部門・品目タグ付与率 調査スクリプト
-----------------------------------------
目的: S8ドリルダウン実装前に、実際の取引データで
      department_id / item_id がどれだけ付いているか確認する。

使用API:
  - /api/1/deals          (取引一覧)
  - /api/1/reports/trial_pl (breakdown_display_type で部門別試算表)
  - /api/1/sections       (部門マスタ)
  - /api/1/items          (品目マスタ)
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

JST             = timezone(timedelta(hours=9))
FREEE_TOKEN_URL = 'https://accounts.secure.freee.co.jp/public_api/token'
FREEE_API_BASE  = 'https://api.freee.co.jp'

COMPANIES = {
    'BLUE ESTATE': os.environ.get('FREEE_COMPANY_ID_BLUE_ESTATE', ''),
    'BLUE DESIGN': os.environ.get('FREEE_COMPANY_ID_BLUE_DESIGN', ''),
    'BLUE LIFE':   os.environ.get('FREEE_COMPANY_ID_BLUE_LIFE',   ''),
}

# ── 認証 ────────────────────────────────────────────────────────────────
# 注意: プローブはトークンを更新しない。
# freee は rotating refresh token 方式のため、プローブがリフレッシュすると
# 新トークンが GitHub Secrets に書き戻されず、本番同期が壊れる。

def get_token():
    return os.environ.get('FREEE_ACCESS_TOKEN', '')


def freee_get(path, token, params=None):
    url = FREEE_API_BASE + path
    if params:
        url += '?' + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Accept', 'application/json')
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'HTTP {e.code}: {body[:300]}')


# ── 部門マスタ取得 ────────────────────────────────────────────────────────

def fetch_sections(company_id, token):
    try:
        d = freee_get('/api/1/sections', token, {'company_id': company_id})
        secs = d.get('sections', [])
        return {s['id']: s['name'] for s in secs}
    except RuntimeError as e:
        print(f'  [WARN] 部門マスタ取得失敗: {e}')
        return {}


def fetch_items(company_id, token):
    try:
        d = freee_get('/api/1/items', token, {'company_id': company_id})
        items = d.get('items', [])
        return {i['id']: i['name'] for i in items}
    except RuntimeError as e:
        print(f'  [WARN] 品目マスタ取得失敗: {e}')
        return {}


# ── 取引明細の付与率チェック ────────────────────────────────────────────

def probe_deals(company_id, token, section_map, item_map):
    """直近3ヶ月の取引を取得し、部門・品目タグの付与率を集計する"""
    now   = datetime.now(JST)
    start = (now.replace(day=1) - timedelta(days=90)).strftime('%Y-%m-%d')
    end   = now.strftime('%Y-%m-%d')

    offset     = 0
    limit      = 100
    all_details = []   # detail行（仕訳の各明細）

    while True:
        try:
            d = freee_get('/api/1/deals', token, {
                'company_id': company_id,
                'start_date': start,
                'end_date':   end,
                'offset':     offset,
                'limit':      limit,
            })
        except RuntimeError as e:
            print(f'  [ERROR] deals 取得失敗 (offset={offset}): {e}')
            break

        deals = d.get('deals', [])
        if not deals:
            break

        for deal in deals:
            for det in deal.get('details', []):
                all_details.append({
                    'deal_id':    deal.get('id'),
                    'account':    det.get('account_item_name', ''),
                    'amount':     det.get('amount', 0),
                    'section_id': det.get('section_id'),
                    'item_id':    det.get('item_id'),
                    'section_nm': section_map.get(det.get('section_id'), ''),
                    'item_nm':    item_map.get(det.get('item_id'), ''),
                })

        total_count = d.get('meta', {}).get('total_count', 0)
        offset += limit
        if offset >= total_count or offset >= 500:  # 最大500明細で打ち切り
            break

    return all_details


def summarize(details, label):
    total = len(details)
    if total == 0:
        print(f'  {label}: データなし')
        return

    with_section = sum(1 for d in details if d['section_id'])
    with_item    = sum(1 for d in details if d['item_id'])

    sec_pct  = with_section / total * 100
    item_pct = with_item    / total * 100

    print(f'  明細行数:     {total:>5}件')
    print(f'  部門タグあり: {with_section:>5}件  ({sec_pct:5.1f}%)')
    print(f'  品目タグあり: {with_item:>5}件  ({item_pct:5.1f}%)')

    # 部門ランキング TOP10
    if with_section:
        from collections import Counter
        sec_counter = Counter(
            d['section_nm'] or f'ID:{d["section_id"]}'
            for d in details if d['section_id']
        )
        print(f'\n  【部門別 TOP10】')
        for nm, cnt in sec_counter.most_common(10):
            print(f'    {cnt:>5}件  {nm}')

    # 品目ランキング TOP10
    if with_item:
        from collections import Counter
        item_counter = Counter(
            d['item_nm'] or f'ID:{d["item_id"]}'
            for d in details if d['item_id']
        )
        print(f'\n  【品目別 TOP10】')
        for nm, cnt in item_counter.most_common(10):
            print(f'    {cnt:>5}件  {nm}')

    # 部門なし ×科目 — どの科目が未タグか
    no_section = [d for d in details if not d['section_id']]
    if no_section and sec_pct < 100:
        from collections import Counter
        acct_counter = Counter(d['account'] for d in no_section)
        print(f'\n  【部門未設定の科目 TOP10（要確認）】')
        for nm, cnt in acct_counter.most_common(10):
            print(f'    {cnt:>5}件  {nm}')


# ── trial_pl 部門別取得テスト ──────────────────────────────────────────

def probe_trial_pl_by_section(company_id, token, section_map):
    """
    trial_pl に breakdown_display_type パラメータが使えるか確認する。
    freee API ドキュメントには記載があるが、プランによって使えないことがある。
    """
    now = datetime.now(JST)
    print(f'\n  [試算表 breakdown テスト]')
    for breakdown_type in ['section', 'item']:
        try:
            d = freee_get('/api/1/reports/trial_pl', token, {
                'company_id':            company_id,
                'fiscal_year':           now.year,
                'start_month':           1,
                'end_month':             now.month,
                'breakdown_display_type': breakdown_type,
            })
            balances = d.get('trial_pl', {}).get('balances', [])
            # breakdown フィールドがあるか確認
            has_bd = any(b.get('breakdown') for b in balances)
            print(f'  breakdown_display_type={breakdown_type!r}: OK '
                  f'(balances={len(balances)}, has_breakdown={has_bd})')
            if has_bd:
                # サンプル表示
                for b in balances:
                    if b.get('breakdown'):
                        print(f'    サンプル科目: {b.get("account_item_name")}')
                        for bd in b['breakdown'][:3]:
                            print(f'      {bd}')
                        break
        except RuntimeError as e:
            print(f'  breakdown_display_type={breakdown_type!r}: 失敗 → {str(e)[:120]}')


# ── メイン ──────────────────────────────────────────────────────────────

def main():
    print('=' * 60)
    print('  freee 部門・品目タグ付与率 調査レポート')
    print('=' * 60)

    token = get_token()
    if not token:
        print('ERROR: FREEE_ACCESS_TOKEN が未設定です')
        sys.exit(1)

    for name, company_id in COMPANIES.items():
        if not company_id:
            print(f'\n【{name}】会社IDが未設定。スキップ。')
            continue

        print(f'\n{"─" * 55}')
        print(f'【{name}】(company_id={company_id})')
        print('─' * 55)

        section_map = fetch_sections(company_id, token)
        item_map    = fetch_items(company_id, token)
        print(f'  部門マスタ: {len(section_map)}件  品目マスタ: {len(item_map)}件')
        if section_map:
            print(f'  部門一覧: {", ".join(list(section_map.values())[:8])}')
        if item_map:
            print(f'  品目一覧: {", ".join(list(item_map.values())[:8])}')

        details = probe_deals(company_id, token, section_map, item_map)
        summarize(details, name)

        # trial_pl breakdown テスト（BLUE ESTATE のみ、代表チェック）
        if name == 'BLUE ESTATE':
            probe_trial_pl_by_section(company_id, token, section_map)

    print(f'\n{"=" * 60}')
    print('  調査完了')
    print('=' * 60)


if __name__ == '__main__':
    main()
