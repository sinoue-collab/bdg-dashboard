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

        try:
            sec_bal  = fetch_trial_pl(
                company_id, access_token,
                cur_fy, cur_month, cur_month,
                section_id=sec_id,
            )
            sec_data = parse_balances(sec_bal, mapping)
        except RuntimeError as e:
            if debug:
                print(f'    [DEBUG] 部門 "{sec_name}"(id={sec_id}) 取得失敗: {e}')
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


def fetch_items_all(company_id, access_token):
    """全品目マスタを取得。"""
    try:
        d = freee_get('/api/1/items', access_token, {'company_id': company_id})
        return d.get('items', [])
    except RuntimeError as e:
        print(f'  ⚠️  品目マスタ取得失敗: {e}')
        return []


def enrich_with_items(cur_data, company_id, access_token,
                      cur_fy, cur_month, items, mapping, debug=False):
    """
    cur_data の各 breakdown アイテムに by_item を付与する（当月のみ）。
    品目ごとに trial_pl を呼び出し、科目金額を品目別に集計する。
    """
    SECTION_KEYS = ['revenue', 'cogs', 'sga', 'non_op_income', 'non_op_expense']

    for itm in items:
        itm_id   = itm.get('id')
        itm_name = (itm.get('name') or '').strip()
        if not itm_id or not itm_name:
            continue

        try:
            itm_bal  = fetch_trial_pl(
                company_id, access_token,
                cur_fy, cur_month, cur_month,
                item_id=itm_id,
            )
            itm_data = parse_balances(itm_bal, mapping)
        except RuntimeError as e:
            if debug:
                print(f'    [DEBUG] 品目 "{itm_name}"(id={itm_id}) 取得失敗: {e}')
            continue

        for sk in SECTION_KEYS:
            for acct in cur_data[sk]['breakdown']:
                itm_item = next(
                    (i for i in itm_data[sk]['breakdown'] if i['item'] == acct['item']),
                    None,
                )
                if itm_item and itm_item['amount'] > 0:
                    acct.setdefault('by_item', []).append({
                        'name':   itm_name,
                        'amount': itm_item['amount'],
                    })

    # 品目合計と科目合計の差分 = 品目未設定分 を末尾に追加
    for sk in SECTION_KEYS:
        for acct in cur_data[sk]['breakdown']:
            item_list = acct.get('by_item')
            if not item_list:
                continue
            item_sum = sum(i['amount'] for i in item_list)
            untagged = acct['amount'] - item_sum
            if untagged > 100:
                item_list.append({'name': '（品目未設定）', 'amount': untagged})
            item_list.sort(key=lambda i: -i['amount'])


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

    # ── Pass 2: null 名の COGS 項目を補完 ────────────────────────────────
    # 建設業など、工事原価が account_item_name=null で返る場合への対応。
    # COGS の breakdown が空の場合のみ、cogs_markers カテゴリの最大 null 名金額を使う。
    if result['cogs']['total'] == 0:
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
        # 売上原価（最上位合計）がある場合はそれだけを採用し、
        # 製品売上原価・完成工事原価 等の下位カテゴリとのダブルカウントを防ぐ。
        if cogs_null.get('売上原価', 0) > 0:
            result['cogs']['breakdown'].append({'item': '売上原価', 'amount': cogs_null['売上原価']})
        else:
            for cat, amt in cogs_null.items():
                result['cogs']['breakdown'].append({'item': cat, 'amount': amt})
        result['cogs']['total'] = sum(i['amount'] for i in result['cogs']['breakdown'])

    return result


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

            print(f'    前月    {prv_year}-{prv_month:02d}...')
            prv_bal  = fetch_trial_pl(company_id, access_token, prv_fy, prv_month, prv_month, debug=args.debug)
            prv_data = parse_balances(prv_bal, mapping)
            prv_sum  = compute_summary(prv_data)

            print(f'    ✓ 完了  売上={cur_data["revenue"]["total"]:,}  経常={cur_sum["ordinary_profit"]:,}')
            if cur_data['revenue']['total'] == 0:
                print(f'    ⚠️  売上が0です。freee への入力が未完了か、科目マッピングを確認してください。')

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

        with open(ACTUALS_LATEST, 'w', encoding='utf-8') as f:
            json.dump(actuals_out, f, ensure_ascii=False, indent=2)
        print(f'  ✓ actuals_latest.json 更新')

        with open(SNAPSHOT_LATEST, 'w', encoding='utf-8') as f:
            json.dump(snapshot_out, f, ensure_ascii=False, indent=2)
        print(f'  ✓ snapshot_latest.json 更新')

    print()
    print('=' * 60)
    print('  同期完了')
    print('=' * 60)


if __name__ == '__main__':
    main()
