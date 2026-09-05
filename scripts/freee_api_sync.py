#!/usr/bin/env python3
"""
freee API → actuals_latest.json / snapshot_latest.json 同期スクリプト
----------------------------------------------------------------------
GitHub Actions から毎日自動実行される想定。以下の環境変数（GitHub Secrets）が必要:

  FREEE_ACCESS_TOKEN            - freee アクセストークン（起動時に自動更新）
  FREEE_REFRESH_TOKEN           - freee リフレッシュトークン
  FREEE_CLIENT_ID               - freee クライアントID
  FREEE_CLIENT_SECRET           - freee クライアントシークレット
  FREEE_COMPANY_ID_BLUE_ESTATE  - BLUE ESTATE の freee 会社ID
  FREEE_COMPANY_ID_BLUE_DESIGN  - BLUE DESIGN の freee 会社ID
  FREEE_COMPANY_ID_BLUE_LIFE    - BLUE LIFE の freee 会社ID
  GH_PAT                        - GitHub PAT（repo スコープ、Secrets 書き戻し用）

手動実行:
  python3 scripts/freee_api_sync.py [--month 2026-08] [--dry-run] [--debug]
"""

import argparse
import base64
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

# ─────────────────────────────────────────
#  定数
# ─────────────────────────────────────────
JST = timezone(timedelta(hours=9))

FREEE_TOKEN_URL = 'https://accounts.secure.freee.co.jp/public_api/token'
FREEE_API_BASE  = 'https://api.freee.co.jp'

GITHUB_REPO = os.environ.get('GITHUB_REPOSITORY', 'sinoue-collab/bdg-dashboard')

# fiscal_start_month: freee で設定している会計期間の開始月（1月=1、4月=4）
COMPANIES = {
    'BLUE ESTATE': {
        'env_key':  'FREEE_COMPANY_ID_BLUE_ESTATE',
        'unit_key': 'unit_blue_estate',
    },
    'BLUE DESIGN': {
        'env_key':  'FREEE_COMPANY_ID_BLUE_DESIGN',
        'unit_key': 'unit_blue_design',
    },
    'BLUE LIFE': {
        'env_key':  'FREEE_COMPANY_ID_BLUE_LIFE',
        'unit_key': 'unit_blue_life',
    },
}

SCRIPT_DIR       = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT        = os.path.dirname(SCRIPT_DIR)
ACTUALS_DIR      = os.path.join(REPO_ROOT, 'data', 'actuals')
SNAPSHOT_DIR     = os.path.join(REPO_ROOT, 'data', 'dashboard_snapshots')
MAPPING_FILE     = os.path.join(REPO_ROOT, 'data', 'imports', 'freee_mapping.json')
ACTUALS_LATEST      = os.path.join(ACTUALS_DIR, 'actuals_latest.json')
ACTUALS_PREVIOUS    = os.path.join(ACTUALS_DIR, 'actuals_previous.json')
ACTUALS_MONTH_START = os.path.join(ACTUALS_DIR, 'actuals_month_start.json')
DAILY_HISTORY_DIR   = os.path.join(ACTUALS_DIR, 'daily_history')
SNAPSHOT_LATEST  = os.path.join(SNAPSHOT_DIR, 'snapshot_latest.json')


# ─────────────────────────────────────────
#  会計年度計算
# ─────────────────────────────────────────

def get_fiscal_year(cal_year, cal_month, fiscal_start_month):
    """
    カレンダー年月 → freee の fiscal_year パラメータ値を返す。
    freee は start_month / end_month をカレンダー月として扱うため、
    「当月が属する会計年度の開始カレンダー年」が fiscal_year になる。
    例: 4月期, 2026年8月 → fiscal_year=2026（4月期FY2026=2026/4〜2027/3）
    例: 4月期, 2027年1月 → fiscal_year=2026（FY2026の期中）
    """
    if cal_month >= fiscal_start_month:
        return cal_year
    else:
        return cal_year - 1


# ─────────────────────────────────────────
#  トークン管理
# ─────────────────────────────────────────

def do_token_refresh(client_id, client_secret, refresh_tok):
    data = urllib.parse.urlencode({
        'grant_type':    'refresh_token',
        'client_id':     client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_tok,
    }).encode()
    req = urllib.request.Request(FREEE_TOKEN_URL, data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def update_github_secret(repo, gh_token, name, value):
    try:
        from nacl import encoding, public as nacl_public
    except ImportError:
        print(f'  ⚠️  PyNaCl 未インストール。{name} の書き戻しをスキップ')
        return False

    key_url = f'https://api.github.com/repos/{repo}/actions/secrets/public-key'
    req = urllib.request.Request(key_url)
    req.add_header('Authorization', f'token {gh_token}')
    req.add_header('Accept', 'application/vnd.github+json')
    with urllib.request.urlopen(req) as r:
        key_info = json.loads(r.read())

    pk        = nacl_public.PublicKey(key_info['key'].encode(), encoding.Base64Encoder)
    encrypted = base64.b64encode(nacl_public.SealedBox(pk).encrypt(value.encode())).decode()

    put_url = f'https://api.github.com/repos/{repo}/actions/secrets/{name}'
    body    = json.dumps({'encrypted_value': encrypted, 'key_id': key_info['key_id']}).encode()
    req2    = urllib.request.Request(put_url, data=body, method='PUT')
    req2.add_header('Authorization', f'token {gh_token}')
    req2.add_header('Accept', 'application/vnd.github+json')
    req2.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req2) as r:
            return r.status in (201, 204)
    except urllib.error.HTTPError as e:
        return e.code in (201, 204)


# ─────────────────────────────────────────
#  freee API
# ─────────────────────────────────────────

def freee_get(path, access_token, params=None):
    url = FREEE_API_BASE + path
    if params:
        url += '?' + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {access_token}')
    req.add_header('Accept', 'application/json')
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'freee API {e.code}: {body[:500]}')


def fetch_ytd_probing(company_id, access_token, cal_year, cal_month, debug=False):
    """
    YTD を取得しつつ会計期首月を自動検出する。
    候補月 [1, 4, 5, 6, 7, 8, cal_month] を順に試し、
    最初に 400 エラーなく取得できた月を会計期首として採用する。
    Returns: (balances, fiscal_start_month, fiscal_year)
    """
    seen: list[int] = []
    for fs in [1, 4, 5, 6, 7, 8, cal_month]:
        if fs > cal_month or fs in seen:
            continue
        seen.append(fs)
        fy = get_fiscal_year(cal_year, cal_month, fs)
        try:
            bal = fetch_trial_pl(company_id, access_token, fy, fs, cal_month, debug=debug)
            if debug:
                print(f'    [DEBUG] 会計期首={fs}月 で YTD 取得成功（fiscal_year={fy}）')
            return bal, fs, fy
        except RuntimeError:
            if debug:
                print(f'    [DEBUG] 会計期首={fs}月 は無効（400）')
            continue
    raise RuntimeError(f'会計期首の自動検出に失敗しました (company_id={company_id})')


DEPRECATED_SECTION_PREFIXES = ('<', '×')

def is_deprecated_section(name: str) -> bool:
    return name.startswith(DEPRECATED_SECTION_PREFIXES)


def fetch_sections_all(company_id, access_token):
    """全部門マスタを取得（ページネーション対応・廃止部門を含む全件）。"""
    all_sections = []
    offset = 0
    while True:
        try:
            d = freee_get('/api/1/sections', access_token, {
                'company_id': company_id,
                'offset':     offset,
                'limit':      100,
            })
        except RuntimeError as e:
            print(f'  ⚠️  部門マスタ取得失敗 (offset={offset}): {e}')
            break
        secs = d.get('sections', [])
        all_sections.extend(secs)
        if len(secs) < 100:
            break
        offset += 100
    return all_sections


def enrich_with_departments(cur_data, company_id, access_token,
                             cur_fy, cur_month, sections, mapping, debug=False):
    """
    cur_data の各 breakdown アイテムに by_department を付与する（当月のみ）。
    部門ごとに trial_pl を呼び出し、科目金額を部門別に集計する。
    """
    SECTION_KEYS = ['revenue', 'cogs', 'sga', 'non_op_income', 'non_op_expense']

    for sec in sections:
        sec_id   = sec.get('id')
        sec_name = (sec.get('name') or '').strip()
        if not sec_id or not sec_name:
            continue
        deprecated = is_deprecated_section(sec_name)

        sec_data = None
        for attempt in range(2):
            try:
                sec_bal  = fetch_trial_pl(
                    company_id, access_token,
                    cur_fy, cur_month, cur_month,
                    section_id=sec_id,
                )
                sec_data = parse_balances(sec_bal, mapping)
                break
            except RuntimeError as e:
                if attempt == 0:
                    if debug:
                        print(f'    [DEBUG] 部門 "{sec_name}"(id={sec_id}) 一時失敗、5秒後再試行: {e}')
                    time.sleep(5)
                else:
                    if debug:
                        print(f'    [DEBUG] 部門 "{sec_name}"(id={sec_id}) 取得失敗（再試行済）: {e}')
        if sec_data is None:
            continue

        for sk in SECTION_KEYS:
            for item in cur_data[sk]['breakdown']:
                sec_item = next(
                    (i for i in sec_data[sk]['breakdown'] if i['item'] == item['item']),
                    None,
                )
                if sec_item and sec_item['amount'] > 0:
                    item.setdefault('by_department', []).append({
                        'name':       sec_name,
                        'amount':     sec_item['amount'],
                        'deprecated': deprecated,
                    })

    # 部門合計と科目合計の差分 = 部門未設定分 を末尾に追加
    for sk in SECTION_KEYS:
        for item in cur_data[sk]['breakdown']:
            dept_list = item.get('by_department')
            if not dept_list:
                continue
            dept_sum = sum(d['amount'] for d in dept_list)
            untagged = item['amount'] - dept_sum
            if untagged > 100:  # 端数誤差は無視
                dept_list.append({
                    'name':       '（部門未設定）',
                    'amount':     untagged,
                    'deprecated': False,
                })
            # 金額降順ソート
            dept_list.sort(key=lambda d: -d['amount'])


def fetch_cogs_from_trial_cr(company_id, access_token, cur_fy, cal_start, cal_end, debug=False):
    """
    BLUE DESIGN 専用: trial_cr（製造原価報告書）から COGS 構造を構築する。

    freee API の start_month / end_month はカレンダー月番号（4月始まりFYでも 8月=8）。
    単月: cal_start == cal_end == カレンダー月番号
    YTD:  cal_start == 会計期首カレンダー月、cal_end == 当月カレンダー月

    戻り値: {'total': int, 'breakdown': [...], '_source': 'trial_cr'}
    失敗時: None（呼び出し元で trial_pl フォールバックに切り替える）
    """
    try:
        resp = freee_get('/api/1/reports/trial_cr', access_token, {
            'company_id':             company_id,
            'fiscal_year':            cur_fy,
            'start_month':            cal_start,
            'end_month':              cal_end,
            'breakdown_display_type': 'item',
        })
    except RuntimeError as e:
        print(f'    [trial_cr] 取得失敗: {e}')
        return None

    balances = resp.get('trial_cr', {}).get('balances', [])
    if not balances:
        print('    [trial_cr] balances が空')
        return None

    # 総製造費用（null 名行）を COGS 合計として採用
    total = 0
    for b in balances:
        name     = (b.get('account_item_name') or '').strip()
        category = (b.get('account_category_name') or '').strip()
        op       = b.get('opening_balance', 0) or 0
        cl       = b.get('closing_balance',  0) or 0
        diff     = cl - op
        if not name and category == '総製造費用' and diff:
            total = abs(int(diff))
            break

    if total == 0:
        print('    [trial_cr] 総製造費用が0 → フォールバック')
        return None

    # 案件別内訳: 材料費・製造経費カテゴリの named account の items を集計
    COST_CATS = {'当期原材料仕入高', '製造経費'}
    breakdown = []
    for b in balances:
        name     = (b.get('account_item_name') or '').strip()
        category = (b.get('account_category_name') or '').strip()
        op       = b.get('opening_balance', 0) or 0
        cl       = b.get('closing_balance',  0) or 0
        diff     = cl - op
        items    = b.get('items') or []

        if not name or category not in COST_CATS or not diff:
            continue
        amount = abs(int(diff))
        if amount == 0:
            continue

        by_item = []
        for itm in items:
            inm = (itm.get('name') or itm.get('item_name') or '').strip()
            iop = itm.get('opening_balance', 0) or 0
            icl = itm.get('closing_balance',  0) or 0
            idf = icl - iop
            iamt = abs(int(idf)) if idf else 0
            if inm and iamt > 0:
                by_item.append({'name': inm, 'amount': iamt})

        by_item.sort(key=lambda x: -x['amount'])

        # 案件タグなし分を末尾に追加
        item_sum = sum(i['amount'] for i in by_item)
        untagged = amount - item_sum
        if untagged > 100:
            by_item.append({'name': '（案件未設定）', 'amount': untagged})

        entry = {'item': name, 'amount': amount}
        if by_item:
            entry['by_item'] = by_item
        breakdown.append(entry)

    if debug:
        print(f'    [trial_cr] total={total:,}  breakdown={len(breakdown)}件')
        for b in breakdown:
            print(f'      {b["item"]}: {b["amount"]:,}  by_item={len(b.get("by_item", []))}件')

    return {
        'total':     total,
        'breakdown': breakdown,
        '_source':   'trial_cr',
    }


def fetch_items_all(company_id, access_token):
    """全品目マスタを取得（ページネーション対応・全件）。"""
    all_items = []
    offset = 0
    while True:
        try:
            d = freee_get('/api/1/items', access_token, {
                'company_id': company_id,
                'offset':     offset,
                'limit':      100,
            })
        except RuntimeError as e:
            print(f'  ⚠️  品目マスタ取得失敗 (offset={offset}): {e}')
            break
        items = d.get('items', [])
        all_items.extend(items)
        if len(items) < 100:
            break
        offset += 100
    return all_items


def _finalize_by_item(cur_data, SECTION_KEYS):
    """by_item に（品目未設定）分を追加して金額降順ソート。
    trial_cr 由来の COGS（_source='trial_cr'）は既に（案件未設定）を含むためスキップ。
    """
    cogs_from_trial_cr = cur_data.get('cogs', {}).get('_source') == 'trial_cr'
    for sk in SECTION_KEYS:
        # trial_cr で取得した COGS breakdown は by_item が既に完成しているためスキップ
        if sk == 'cogs' and cogs_from_trial_cr:
            continue
        for acct in cur_data[sk]['breakdown']:
            item_list = acct.get('by_item')
            if not item_list:
                continue
            item_sum = sum(i['amount'] for i in item_list)
            untagged = acct['amount'] - item_sum
            if untagged > 100:
                item_list.append({'name': '（品目未設定）', 'amount': untagged})
            item_list.sort(key=lambda i: -i['amount'])


def enrich_with_items(cur_data, company_id, access_token,
                      cur_fy, cur_month, items, mapping, debug=False,
                      start_month=None):
    """
    cur_data の各 breakdown アイテムに by_item を付与する。

    start_month を指定すると start_month〜cur_month の累計（YTD）で取得する。
    省略時は cur_month 単月。

    まず breakdown_display_type=item で1回のみ試算表を取得し、レスポンスの
    balances に items サブ配列が含まれる場合は一括パースする（API呼び出し1回）。
    含まれない場合は品目ごとに個別取得するが、タイムアウト対策として
    MAX_ITEMS_FALLBACK 件に制限する。
    """
    SECTION_KEYS = ['revenue', 'cogs', 'sga', 'non_op_income', 'non_op_expense']
    MAX_ITEMS_FALLBACK = 80  # フォールバック時の上限（タイムアウト対策）
    _start = start_month if start_month is not None else cur_month

    # ── ① 一括取得: breakdown_display_type=item で試みる ─────────────
    try:
        bulk_resp = freee_get('/api/1/reports/trial_pl', access_token, {
            'company_id':             company_id,
            'fiscal_year':            cur_fy,
            'start_month':            _start,
            'end_month':              cur_month,
            'breakdown_display_type': 'item',
        })
        bulk_balances = bulk_resp.get('trial_pl', {}).get('balances', [])

        if debug and bulk_balances:
            b0 = bulk_balances[0]
            print(f'    [DEBUG] breakdown=item balances 件数: {len(bulk_balances)}')
            print(f'    [DEBUG]   balances[0] keys: {list(b0.keys())}')
            print(f'    [DEBUG]   "items" in balances[0]: {"items" in b0}')
            if 'items' in b0:
                print(f'    [DEBUG]   items 件数: {len(b0.get("items") or [])}  例: {(b0.get("items") or [{}])[:1]}')

        # items サブ配列があれば一括パース（API 呼び出しはこの1回のみ）
        if bulk_balances and 'items' in bulk_balances[0]:
            if debug:
                print('    [DEBUG] → 一括パースモードで処理（per-item 呼び出しなし）')
                # ── COGS 調査: bulk_balances の全エントリ構造を出力 ──
                print('    [DEBUG] === COGS調査: bulk_balances 全エントリ ===')
                for _b in bulk_balances:
                    _nm  = _b.get('account_item_name') or '(null)'
                    _cat = _b.get('account_category_name') or '(null)'
                    _op  = _b.get('opening_balance') or 0
                    _cl  = _b.get('closing_balance')  or 0
                    _has = len(_b.get('items') or [])
                    print(f'    [DEBUG]   cat={_cat!r:25s} name={_nm!r:30s} diff={_cl-_op:>12,}  items={_has}件')
                print('    [DEBUG] === cur_data COGS breakdown ===')
                for _a in cur_data['cogs']['breakdown']:
                    print(f'    [DEBUG]   item={_a["item"]!r}  amount={_a["amount"]:,}')
                print('    [DEBUG] === 売上原価カテゴリのbulkエントリ詳細 ===')
                COGS_CATS = {'売上原価', '製品売上原価', '完成工事原価', '当期商品仕入', '売上原価合計'}
                for _b in bulk_balances:
                    _cat = _b.get('account_category_name') or ''
                    _nm  = _b.get('account_item_name') or ''
                    if _cat in COGS_CATS or _nm in COGS_CATS or '原価' in _cat or '原価' in _nm or '仕入' in _cat or '仕入' in _nm:
                        _items = _b.get('items') or []
                        _op = _b.get('opening_balance') or 0
                        _cl = _b.get('closing_balance') or 0
                        print(f'    [DEBUG]   cat={_cat!r}  name={_nm!r}  diff={_cl-_op:,}  items件数={len(_items)}')
                        for _i in _items[:5]:
                            _io = _i.get('opening_balance') or 0
                            _ic = _i.get('closing_balance') or 0
                            print(f'    [DEBUG]     item: name={(_i.get("name") or "")!r}  diff={_ic-_io:,}')
                        if len(_items) > 5:
                            print(f'    [DEBUG]     ... 他{len(_items)-5}件')
            for bal in bulk_balances:
                acct_name  = bal.get('account_item_name') or ''
                item_array = bal.get('items') or []
                for sk in SECTION_KEYS:
                    for acct in cur_data[sk]['breakdown']:
                        if acct['item'] != acct_name:
                            continue
                        for itm in item_array:
                            name    = (itm.get('name') or itm.get('item_name') or '').strip()
                            closing = itm.get('closing_balance') or 0
                            opening = itm.get('opening_balance') or 0
                            amount  = abs(closing - opening)  # 当期変動額（parse_balances と同じ計算）
                            if name and amount > 0:
                                acct.setdefault('by_item', []).append({'name': name, 'amount': amount})
            if debug:
                # "BLUE" または "MAGAZINE" を含む品目をすべてトレース
                print('    [DEBUG] === BLUE/MAGAZINE 品目サーチ ===')
                found_any = False
                for bal in bulk_balances:
                    for itm in (bal.get('items') or []):
                        nm = itm.get('name') or itm.get('item_name') or ''
                        if 'BLUE' in nm.upper() or 'MAGAZINE' in nm.upper():
                            op = itm.get('opening_balance') or 0
                            cl = itm.get('closing_balance') or 0
                            print(f'    [DEBUG]   acct={bal.get("account_item_name")!r}  item={nm!r}  diff={cl-op:,}')
                            found_any = True
                if not found_any:
                    print('    [DEBUG]   → 該当品目なし（APIレスポンスに存在しない）')
                # by_item が設定されたアカウント一覧
                print('    [DEBUG] === by_item 設定済アカウント ===')
                for sk in SECTION_KEYS:
                    for acct in cur_data[sk]['breakdown']:
                        if acct.get('by_item'):
                            names = [i['name'] for i in acct['by_item']]
                            print(f'    [DEBUG]   [{sk}] {acct["item"]!r}: {names[:5]}{"…" if len(names)>5 else ""}')
            _finalize_by_item(cur_data, SECTION_KEYS)
            return

        if debug:
            print('    [DEBUG] → items サブ配列なし。フォールバック（個別取得）へ')

    except RuntimeError as e:
        if debug:
            print(f'    [DEBUG] 一括取得失敗、フォールバックへ: {e}')

    # ── ② フォールバック: 品目1件ずつ取得（上限あり） ──────────────
    fetch_targets = items[:MAX_ITEMS_FALLBACK]
    if len(items) > MAX_ITEMS_FALLBACK:
        print(f'    ⚠️  品目数 {len(items)}件 → タイムアウト対策で先頭 {MAX_ITEMS_FALLBACK}件のみ取得')

    for itm in fetch_targets:
        itm_id   = itm.get('id')
        itm_name = (itm.get('name') or '').strip()
        if not itm_id or not itm_name:
            continue

        itm_data = None
        for attempt in range(2):
            try:
                itm_bal  = fetch_trial_pl(
                    company_id, access_token,
                    cur_fy, _start, cur_month,
                    item_id=itm_id,
                )
                itm_data = parse_balances(itm_bal, mapping)
                break
            except RuntimeError as e:
                if attempt == 0:
                    if debug:
                        print(f'    [DEBUG] 品目 "{itm_name}"(id={itm_id}) 一時失敗、5秒後再試行: {e}')
                    time.sleep(5)
                else:
                    if debug:
                        print(f'    [DEBUG] 品目 "{itm_name}"(id={itm_id}) 取得失敗（再試行済）: {e}')
        if itm_data is None:
            continue

        for sk in SECTION_KEYS:
            for acct in cur_data[sk]['breakdown']:
                itm_item = next(
                    (i for i in itm_data[sk]['breakdown'] if i['item'] == acct['item']),
                    None,
                )
                if itm_item and itm_item['amount'] > 0:
                    acct.setdefault('by_item', []).append({'name': itm_name, 'amount': itm_item['amount']})

    _finalize_by_item(cur_data, SECTION_KEYS)


def fetch_trial_pl(company_id, access_token, fiscal_year, start_month, end_month,
                   section_id=None, item_id=None, debug=False):
    """
    指定した会計年度・会計月番号で損益試算表を取得。
    start_month / end_month は freee の「会計月番号」（会計年度の第N月）。
    section_id を指定すると当該部門のみに絞り込む。item_id を指定すると品目のみ。
    """
    params = {
        'company_id':  company_id,
        'fiscal_year': fiscal_year,
        'start_month': start_month,
        'end_month':   end_month,
    }
    if section_id is not None:
        params['section_id'] = section_id
    if item_id is not None:
        params['item_id'] = item_id
    data     = freee_get('/api/1/reports/trial_pl', access_token, params)
    balances = data.get('trial_pl', {}).get('balances', [])

    if debug:
        print(f'    [DEBUG] balances 件数: {len(balances)}')
        for b in balances[:12]:
            name     = b.get('account_item_name')     or '(不明)'
            category = b.get('account_category_name') or '(なし)'
            opening  = b.get('opening_balance', 0) or 0
            closing  = b.get('closing_balance',  0) or 0
            diff     = closing - opening
            print(f'    [DEBUG]   cat={category!r:25s} name={name!r:25s} diff={diff:>13,}')
        if len(balances) > 12:
            print(f'    [DEBUG]   ... 残り {len(balances)-12} 件')

    return balances


# ─────────────────────────────────────────
#  現金・預金残高取得
# ─────────────────────────────────────────

def fetch_cash_balances(company_id, access_token,
                        cur_fy, cur_month, cur_year,
                        prv_fy, prv_month, prv_year):
    """
    預金残高を取得する。
    - 主表示: walletables.last_balance（銀行API同期残高）
    - 参考  : trial_bs.closing_balance（月末確定値・当月・前月）

    フィルタ:
      bank_account → 全件対象
      wallet       → 名前に「現金」を含むもののみ（倒産防止共済掛金等は除外）
      credit_card  → 全件除外

    last_balance も trial_bs 残高も 0 の口座（解約済み等）は出力から除外。
    update_date が STALE_DAYS 以上前の口座は stale=True で警告を付ける。
    """
    from datetime import date as _date
    STALE_DAYS = 14
    today_str  = _date.today().isoformat()

    # ── walletables（口座タイプ・同期残高・更新日）──────────
    try:
        ws_resp    = freee_get('/api/1/walletables', access_token,
                               {'company_id': company_id, 'with_balance': 'true'})
        walletables = ws_resp.get('walletables', [])
    except Exception:
        walletables = []

    # ── trial_bs（月末確定値）──────────────────────────
    def _get_bs_map(fy, month):
        try:
            resp = freee_get('/api/1/reports/trial_bs', access_token, {
                'company_id':  company_id,
                'fiscal_year': fy,
                'start_month': month,
                'end_month':   month,
            })
            return {
                row['account_item_name']: row.get('closing_balance', 0) or 0
                for row in resp.get('trial_bs', {}).get('balances', [])
                if row.get('account_category_name') == '現金・預金'
            }
        except Exception:
            return {}

    cur_bs = _get_bs_map(cur_fy, cur_month)
    prv_bs = _get_bs_map(prv_fy, prv_month)

    # ── 口座リスト構築 ──────────────────────────────────
    accounts = []
    for w in walletables:
        acc_type = w.get('type', '')
        name     = w.get('name', '')

        # フィルタ
        if acc_type == 'credit_card':
            continue
        if acc_type == 'wallet' and '現金' not in name:
            continue

        last_balance = w.get('last_balance') or 0
        update_date  = w.get('update_date')  or ''
        balance      = cur_bs.get(name, 0)
        prev_balance = prv_bs.get(name, 0)

        # last_balance も trial_bs 残高も 0 の口座はスキップ（解約済み等）
        if last_balance == 0 and balance == 0 and prev_balance == 0:
            continue

        # 同期停止チェック（14日以上更新なし）
        stale = False
        if update_date:
            try:
                days_old = (_date.fromisoformat(today_str) - _date.fromisoformat(update_date)).days
                stale    = days_old >= STALE_DAYS
            except Exception:
                pass

        accounts.append({
            'name':         name,
            'type':         acc_type,
            'last_balance': last_balance,
            'update_date':  update_date,
            'stale':        stale,
            'balance':      balance,      # trial_bs 当月末（参考）
            'prev_balance': prev_balance, # trial_bs 前月末（参考）
        })

    last_balance_total = sum(a['last_balance'] for a in accounts)
    total              = sum(a['balance']      for a in accounts)
    prev_total         = sum(a['prev_balance'] for a in accounts)

    return {
        'period':             f'{cur_year}-{cur_month:02d}',
        'prev_period':        f'{prv_year}-{prv_month:02d}',
        'sync_date':          today_str,
        'last_balance_total': last_balance_total,
        'total':              total,      # trial_bs 当月末合計（参考）
        'prev_total':         prev_total, # trial_bs 前月末合計（参考）
        'accounts':           accounts,
    }


# ─────────────────────────────────────────
#  試算表パース
# ─────────────────────────────────────────

def parse_balances(balances, mapping):
    """
    freee balances → {revenue, cogs, sga, non_op_income, non_op_expense}

    判定キー: account_category_name（例: "売上高", "販売費及び一般管理費"）
    期間金額: closing_balance - opening_balance
      月次リクエスト → 当該月の取引高
      YTD リクエスト → 期首からの累計（P&L 科目は期首残高=0 のため closing ≒ YTD）
    """
    section_starters = mapping['section_starters']
    cogs_markers     = set(mapping['cogs_markers'])
    end_markers      = set(mapping['section_end_markers'])

    result = {
        'revenue':        {'total': 0, 'breakdown': []},
        'cogs':           {'total': 0, 'breakdown': []},
        'sga':            {'total': 0, 'breakdown': []},
        'non_op_income':  {'total': 0, 'breakdown': []},
        'non_op_expense': {'total': 0, 'breakdown': []},
    }

    seen = set()
    for row in balances:
        name     = (row.get('account_item_name')     or '').strip()
        category = (row.get('account_category_name') or '').strip()
        opening  = row.get('opening_balance', 0) or 0
        closing  = row.get('closing_balance',  0) or 0
        amount   = closing - opening   # 当期変動額（月次 or YTD）

        if not name or name in end_markers or name in seen:
            continue
        # COGS セクション合計行をスキップ（cat='売上原価', name='売上原価' のパターン）。
        # 売上高 等では name==category が実勘定科目名と一致するケースがあるため COGS 限定。
        if name == category and category in cogs_markers:
            continue
        seen.add(name)

        if amount == 0:
            continue

        # account_category_name でセクション判定
        section = None
        if category in section_starters:
            section = section_starters[category]
        elif category in cogs_markers:
            section = 'cogs'

        if section:
            result[section]['breakdown'].append({
                'item':   name,
                'amount': abs(int(amount)),
            })

    for sec in result.values():
        sec['total'] = sum(i['amount'] for i in sec['breakdown'])

    # ── Pass 2: null 名の COGS 集計行を常時チェック（replace 方式）────────────
    # freee では account_item_name=null の行がセクション合計（親行）として返ることがある。
    # 建設業など月中に少額の named 明細だけ先に入力されるケースで、Pass 1 合計が過小に
    # なっても、null 集計行の方が大きければ置換して正しい合計を採用する。
    cogs_null: dict[str, int] = {}
    for row in balances:
        name     = (row.get('account_item_name')     or '').strip()
        category = (row.get('account_category_name') or '').strip()
        opening  = row.get('opening_balance', 0) or 0
        closing  = row.get('closing_balance',  0) or 0
        amount   = closing - opening
        if name or not amount:
            continue
        if category in cogs_markers:
            # 複数の null 名行がある場合は最大値（= セクション合計）を採用
            cogs_null[category] = max(cogs_null.get(category, 0), abs(int(amount)))

    # ダブルカウント防止: 売上原価（最上位）があればそれだけを採用
    if cogs_null.get('売上原価', 0) > 0:
        null_items = [{'item': '売上原価', 'amount': cogs_null['売上原価']}]
    else:
        null_items = [{'item': cat, 'amount': amt} for cat, amt in cogs_null.items()]
    null_total  = sum(i['amount'] for i in null_items)
    pass1_total = result['cogs']['total']

    if null_total > pass1_total:
        # null 集計行の方が大きい → Pass 1 named 行を捨てて置換（replace）
        # _pass2_replaced フラグで将来の構造変化を検知できるようにする
        result['cogs']['breakdown']       = null_items
        result['cogs']['total']           = null_total
        result['cogs']['_pass2_replaced'] = True
        print(f'    [COGS] Pass2 replace: null={null_total:,} > named={pass1_total:,}  → null側を採用')
    # else: Pass 1 の named 行のまま（pass1 >= null の場合は Pass1 が正確）

    return result


def apply_cogs_reclassify(data, co_name, mapping):
    """
    freee_mapping.json の cogs_reclassify.non_op_expense_to_cogs に基づき、
    営業外費用に誤分類されている勘定科目を COGS に振り替える（会社別設定）。
    振替後に total を再計算する。summary の再計算は呼び出し元で行うこと。
    """
    rules        = mapping.get('cogs_reclassify', {}).get('non_op_expense_to_cogs', {})
    target_items = set(rules.get(co_name, []))
    if not target_items:
        return

    moved     = [i for i in data['non_op_expense']['breakdown'] if i['item'] in target_items]
    remaining = [i for i in data['non_op_expense']['breakdown'] if i['item'] not in target_items]
    if not moved:
        return

    data['non_op_expense']['breakdown'] = remaining
    data['non_op_expense']['total']     = sum(i['amount'] for i in remaining)
    data['cogs']['breakdown'].extend(moved)
    data['cogs']['total']               = sum(i['amount'] for i in data['cogs']['breakdown'])

    for m in moved:
        print(f'    [COGS Reclassify] {co_name}: "{m["item"]}" {m["amount"]:,}円 → 営業外費用→COGS 振替')


def compute_summary(parsed):
    rev   = parsed['revenue']['total']
    cogs  = parsed['cogs']['total']
    sga   = parsed['sga']['total']
    noi   = parsed['non_op_income']['total']
    noe   = parsed['non_op_expense']['total']
    gross = rev - cogs
    op    = gross - sga
    return {
        'gross_profit':    gross,
        'op_profit':       op,
        'ordinary_profit': op + noi - noe,
    }


def snapshot_row(parsed, summary):
    return {
        'revenue':         parsed['revenue']['total'],
        'gross_profit':    summary['gross_profit'],
        'sga_total':       parsed['sga']['total'],
        'op_profit':       summary['op_profit'],
        'ordinary_profit': summary['ordinary_profit'],
    }


# ─────────────────────────────────────────
#  メイン
# ─────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--month',   help='対象月 YYYY-MM（省略時は当月）')
    ap.add_argument('--dry-run', action='store_true', help='ファイル書き込みをスキップ')
    ap.add_argument('--debug',   action='store_true', help='API レスポンスの詳細ログを出力')
    args = ap.parse_args()

    now = datetime.now(JST)
    if args.month:
        target = datetime.strptime(args.month, '%Y-%m').replace(tzinfo=JST)
    else:
        target = now

    cur_year  = target.year
    cur_month = target.month

    if cur_month == 1:
        prv_year, prv_month = cur_year - 1, 12
    else:
        prv_year, prv_month = cur_year, cur_month - 1

    print('=' * 60)
    print('  freee API データ同期')
    print('=' * 60)
    print(f'対象月 : {cur_year}-{cur_month:02d}')
    print(f'前月   : {prv_year}-{prv_month:02d}')
    print()

    # 環境変数
    access_token  = os.environ.get('FREEE_ACCESS_TOKEN',  '')
    refresh_tok   = os.environ.get('FREEE_REFRESH_TOKEN', '')
    client_id     = os.environ.get('FREEE_CLIENT_ID',     '')
    client_secret = os.environ.get('FREEE_CLIENT_SECRET', '')
    gh_pat        = os.environ.get('GH_PAT', '')

    missing = [k for k, v in {
        'FREEE_ACCESS_TOKEN':  access_token,
        'FREEE_REFRESH_TOKEN': refresh_tok,
        'FREEE_CLIENT_ID':     client_id,
        'FREEE_CLIENT_SECRET': client_secret,
    }.items() if not v]
    if missing:
        sys.exit(f'エラー: 未設定の環境変数: {", ".join(missing)}')

    # ── トークン更新 ──────────────────────────
    print('【1/4】アクセストークン更新中...')
    new_refresh = refresh_tok
    try:
        tokens       = do_token_refresh(client_id, client_secret, refresh_tok)
        access_token = tokens['access_token']
        new_refresh  = tokens['refresh_token']
        print('  ✓ 更新完了')
    except Exception as e:
        print(f'  ⚠️  更新失敗（既存トークンで続行）: {e}')

    # ── GitHub Secrets 書き戻し ───────────────
    print('【2/4】GitHub Secrets 書き戻し中...')
    if gh_pat and new_refresh != refresh_tok:
        r1 = update_github_secret(GITHUB_REPO, gh_pat, 'FREEE_ACCESS_TOKEN',  access_token)
        r2 = update_github_secret(GITHUB_REPO, gh_pat, 'FREEE_REFRESH_TOKEN', new_refresh)
        print(f'  FREEE_ACCESS_TOKEN:  {"✓" if r1 else "✗"}')
        print(f'  FREEE_REFRESH_TOKEN: {"✓" if r2 else "✗"}')
    elif not gh_pat:
        print('  GH_PAT 未設定のためスキップ')
    else:
        print('  トークン未変更のためスキップ')

    # ── マッピング読み込み ────────────────────
    with open(MAPPING_FILE, encoding='utf-8') as f:
        mapping = json.load(f)

    # ── 既存 snapshot からヒストリを引き継ぎ ──
    try:
        with open(SNAPSHOT_LATEST, encoding='utf-8') as f:
            existing_snap = json.load(f)
    except Exception:
        existing_snap = {}
    history = existing_snap.get('history', {})

    # ── 各社データ取得 ────────────────────────
    print('【3/4】freee からデータ取得中...')
    actuals_data       = {}
    snapshot_companies = {}

    for co_name, cfg in COMPANIES.items():
        company_id_str = os.environ.get(cfg['env_key'], '')
        if not company_id_str:
            print(f'  ⚠️  {co_name}: 環境変数 {cfg["env_key"]} が未設定 → スキップ')
            continue

        company_id = int(company_id_str)
        print(f'  [{co_name}] company_id={company_id}')

        try:
            # YTD 取得と同時に会計期首月を自動検出（候補月を順に試す）
            print(f'    YTD     （会計期首を自動検出しながら取得）...')
            ytd_bal, fs, cur_fy = fetch_ytd_probing(
                company_id, access_token, cur_year, cur_month, debug=args.debug)
            ytd_data = parse_balances(ytd_bal, mapping)
            # BLUE DESIGN 専用: trial_cr で YTD COGS を上書き（カレンダー月番号で指定）
            if co_name == 'BLUE DESIGN':
                cr_ytd = fetch_cogs_from_trial_cr(
                    company_id, access_token, cur_fy,
                    cal_start=fs, cal_end=cur_month, debug=args.debug)
                if cr_ytd:
                    ytd_data['cogs'] = cr_ytd
                    print(f'    [trial_cr] YTD COGS: {cr_ytd["total"]:,}（trial_crへ切替）')
                else:
                    print(f'    [trial_cr] YTD: フォールバック → trial_pl COGS を使用')
            apply_cogs_reclassify(ytd_data, co_name, mapping)  # C案: 営業外→COGS振替
            ytd_sum  = compute_summary(ytd_data)

            ytd_start_month = fs
            ytd_label = f'{cur_fy}-{fs:02d}〜{cur_year}-{cur_month:02d}'
            prv_fy    = get_fiscal_year(prv_year, prv_month, fs)

            if args.debug:
                print(f'    当月  fiscal_year={cur_fy} month={cur_month}  (fiscal_start={fs}月)')
                print(f'    前月  fiscal_year={prv_fy} month={prv_month}')
                print(f'    YTD   {ytd_label}')

            print(f'    当月    {cur_year}-{cur_month:02d}...')
            cur_bal  = fetch_trial_pl(company_id, access_token, cur_fy, cur_month, cur_month, debug=args.debug)
            cur_data = parse_balances(cur_bal, mapping)
            # BLUE DESIGN 専用: trial_cr で当月 COGS を上書き（カレンダー月番号で指定）
            if co_name == 'BLUE DESIGN':
                cr_cur = fetch_cogs_from_trial_cr(
                    company_id, access_token, cur_fy,
                    cal_start=cur_month, cal_end=cur_month, debug=args.debug)
                if cr_cur:
                    cur_data['cogs'] = cr_cur
                    print(f'    [trial_cr] 当月COGS: {cr_cur["total"]:,}（trial_crへ切替）')
                else:
                    print(f'    [trial_cr] 当月: フォールバック → trial_pl COGS を使用')
            apply_cogs_reclassify(cur_data, co_name, mapping)  # C案: 営業外→COGS振替
            cur_sum  = compute_summary(cur_data)

            # 部門別内訳を当月データに付与
            print(f'    部門別内訳取得中...')
            sections = fetch_sections_all(company_id, access_token)
            print(f'      部門数: {len(sections)}件')
            enrich_with_departments(
                cur_data, company_id, access_token,
                cur_fy, cur_month, sections, mapping, debug=args.debug,
            )

            # 品目別内訳を当月データに付与
            print(f'    品目別内訳取得中...')
            items_master = fetch_items_all(company_id, access_token)
            print(f'      品目数: {len(items_master)}件')
            enrich_with_items(
                cur_data, company_id, access_token,
                cur_fy, cur_month, items_master, mapping, debug=args.debug,
            )

            # 品目別内訳をYTDデータにも付与（年度累計ドリルダウン用）
            print(f'    品目別内訳取得中（YTD）...')
            enrich_with_items(
                ytd_data, company_id, access_token,
                cur_fy, cur_month, items_master, mapping, debug=args.debug,
                start_month=fs,
            )

            print(f'    前月    {prv_year}-{prv_month:02d}...')
            prv_bal  = fetch_trial_pl(company_id, access_token, prv_fy, prv_month, prv_month, debug=args.debug)
            prv_data = parse_balances(prv_bal, mapping)
            # BLUE DESIGN 専用: trial_cr で前月 COGS を上書き（カレンダー月番号で指定）
            if co_name == 'BLUE DESIGN':
                cr_prv = fetch_cogs_from_trial_cr(
                    company_id, access_token, prv_fy,
                    cal_start=prv_month, cal_end=prv_month, debug=args.debug)
                if cr_prv:
                    prv_data['cogs'] = cr_prv
                    print(f'    [trial_cr] 前月COGS: {cr_prv["total"]:,}（trial_crへ切替）')
                else:
                    print(f'    [trial_cr] 前月: フォールバック → trial_pl COGS を使用')
            apply_cogs_reclassify(prv_data, co_name, mapping)  # C案: 営業外→COGS振替
            prv_sum  = compute_summary(prv_data)

            # 前月にも品目別内訳を付与（当月がゼロの月初はこちらをS4で使用）
            enrich_with_items(
                prv_data, company_id, access_token,
                prv_fy, prv_month, items_master, mapping, debug=args.debug,
            )

            print(f'    ✓ 完了  売上={cur_data["revenue"]["total"]:,}  経常={cur_sum["ordinary_profit"]:,}')
            if cur_data['revenue']['total'] == 0:
                print(f'    ⚠️  売上が0です。freee への入力が未完了か、科目マッピングを確認してください。')

            # 現金・預金残高取得（trial_bs）
            print(f'    現金・預金残高取得中...')
            try:
                cash_data = fetch_cash_balances(
                    company_id, access_token,
                    cur_fy, cur_month, cur_year,
                    prv_fy, prv_month, prv_year,
                )
                print(f'      合計: {cash_data["total"]:,}（口座数: {len(cash_data["accounts"])}件）')
            except Exception as ce:
                print(f'      ⚠️  取得失敗: {ce}')
                cash_data = None

        except Exception as e:
            print(f'    ✗ エラー: {e}')
            continue

        unit_key = cfg['unit_key']

        actuals_data[unit_key] = {
            'period':      f'{cur_year}-{cur_month:02d}',
            'source_file': 'Freee API',
            'revenue':     cur_data['revenue'],
            'cogs':        cur_data['cogs'],
            'sga':         cur_data['sga'],
            'non_op_income':  cur_data['non_op_income'],
            'non_op_expense': cur_data['non_op_expense'],
            '_summary':    cur_sum,
            'previous_month': {
                'period':  f'{prv_year}-{prv_month:02d}',
                'revenue': prv_data['revenue'],
                'cogs':    prv_data['cogs'],
                'sga':     prv_data['sga'],
                'non_op_income':  prv_data['non_op_income'],
                'non_op_expense': prv_data['non_op_expense'],
                '_summary': prv_sum,
            },
            'ytd': {
                'period':      ytd_label,
                'source_file': 'Freee API',
                'revenue':     ytd_data['revenue'],
                'cogs':        ytd_data['cogs'],
                'sga':         ytd_data['sga'],
                'non_op_income':  ytd_data['non_op_income'],
                'non_op_expense': ytd_data['non_op_expense'],
                '_summary':    ytd_sum,
            },
            'cash': cash_data,
        }

        snapshot_companies[co_name] = {
            'latest_month': f'{cur_year}-{cur_month:02d}',
            'prior_month':  f'{prv_year}-{prv_month:02d}',
            'latest':       snapshot_row(cur_data, cur_sum),
            'prior':        snapshot_row(prv_data, prv_sum),
            'ytd':          snapshot_row(ytd_data, ytd_sum),
        }

    if not actuals_data:
        sys.exit('エラー: 取得できた会社データが0件です')

    # 青天堂は freee 対象外のため既存データを引き継ぎ
    existing_companies = existing_snap.get('companies', {})
    if '青天堂' in existing_companies:
        snapshot_companies['青天堂'] = existing_companies['青天堂']
        print('  [青天堂] 既存データを引き継ぎ')

    # ── ファイル書き出し ──────────────────────
    print('【4/4】ファイルを書き出し中...')
    generated_at = now.isoformat()

    actuals_out = {
        'schema_version': '1.1',
        'generated_at':   generated_at,
        'note':           '各経営単位の最新データ。freee_api_sync.py で生成。',
        'data':           actuals_data,
    }

    snapshot_out = {
        'schema_version': '2.1',
        'generated_at':   generated_at,
        'data_periods':   {co: v['latest_month'] for co, v in snapshot_companies.items()},
        'companies':      snapshot_companies,
        'history':        history,
    }

    if args.dry_run:
        print('\n[DRY RUN] ファイルは書き込みません。プレビュー:')
        for co, data in snapshot_companies.items():
            s = data['latest']
            print(f'  {co}: 売上={s["revenue"]:,}  経常={s["ordinary_profit"]:,}')
    else:
        # ── 月初スナップショット（前月末データ）の保存 ──────────────
        # 月が変わった最初の同期時のみ保存。ACTUALS_LATEST の新データ書き込み前に実行。
        cur_month_str = f'{cur_year}-{cur_month:02d}'
        save_month_start = True
        if os.path.exists(ACTUALS_MONTH_START):
            try:
                with open(ACTUALS_MONTH_START, encoding='utf-8') as f:
                    ms_meta = json.load(f)
                if ms_meta.get('month_start_for') == cur_month_str:
                    save_month_start = False  # 今月分はすでに保存済み
            except Exception:
                pass
        if save_month_start and os.path.exists(ACTUALS_LATEST):
            try:
                with open(ACTUALS_LATEST, encoding='utf-8') as f:
                    ms_content = json.load(f)
                ms_content['month_start_for'] = cur_month_str  # どの月の月初か記録
                with open(ACTUALS_MONTH_START, 'w', encoding='utf-8') as f:
                    json.dump(ms_content, f, ensure_ascii=False, indent=2)
                print(f'  ✓ actuals_month_start.json に前月末スナップショット保存（{cur_month_str} 用）')
            except Exception as e:
                print(f'  ⚠️  月初スナップショット保存失敗: {e}')

        if os.path.exists(ACTUALS_LATEST):
            shutil.copy2(ACTUALS_LATEST, ACTUALS_PREVIOUS)
            print(f'  ✓ actuals_previous.json に退避')

            # freee 管轄外のユニット（青天堂など）を既存ファイルから引き継ぐ
            try:
                with open(ACTUALS_LATEST, encoding='utf-8') as f:
                    existing = json.load(f)
                freee_keys = set(actuals_data.keys())
                for k, v in existing.get('data', {}).items():
                    if k not in freee_keys:
                        actuals_out['data'][k] = v
                        print(f'  ✓ {k}: 既存データを引き継ぎ')
            except Exception as e:
                print(f'  ⚠️  既存データ引き継ぎ失敗: {e}')

        with open(ACTUALS_LATEST, 'w', encoding='utf-8') as f:
            json.dump(actuals_out, f, ensure_ascii=False, indent=2)
        print(f'  ✓ actuals_latest.json 更新')

        with open(SNAPSHOT_LATEST, 'w', encoding='utf-8') as f:
            json.dump(snapshot_out, f, ensure_ascii=False, indent=2)
        print(f'  ✓ snapshot_latest.json 更新')

        # 日次履歴スナップショット保存
        os.makedirs(DAILY_HISTORY_DIR, exist_ok=True)
        today_str   = now.strftime('%Y-%m-%d')
        daily_file  = os.path.join(DAILY_HISTORY_DIR, f'{today_str}.json')
        shutil.copy2(ACTUALS_LATEST, daily_file)
        print(f'  ✓ 日次履歴 data/actuals/daily_history/{today_str}.json 保存')

    print()
    print('=' * 60)
    print('  同期完了')
    print('=' * 60)


if __name__ == '__main__':
    main()
