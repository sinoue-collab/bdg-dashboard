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
  python3 scripts/freee_api_sync.py [--month 2026-08] [--dry-run]
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

# 3社の設定（fiscal_start_month: 月次YTD集計の起算月）
COMPANIES = {
    'BLUE ESTATE': {
        'env_key':            'FREEE_COMPANY_ID_BLUE_ESTATE',
        'unit_key':           'unit_blue_estate',
        'fiscal_start_month': 1,
    },
    'BLUE DESIGN': {
        'env_key':            'FREEE_COMPANY_ID_BLUE_DESIGN',
        'unit_key':           'unit_blue_design',
        'fiscal_start_month': 1,
    },
    'BLUE LIFE': {
        'env_key':            'FREEE_COMPANY_ID_BLUE_LIFE',
        'unit_key':           'unit_blue_life',
        'fiscal_start_month': 1,
    },
}

SCRIPT_DIR       = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT        = os.path.dirname(SCRIPT_DIR)
ACTUALS_DIR      = os.path.join(REPO_ROOT, 'data', 'actuals')
SNAPSHOT_DIR     = os.path.join(REPO_ROOT, 'data', 'dashboard_snapshots')
MAPPING_FILE     = os.path.join(REPO_ROOT, 'data', 'imports', 'freee_mapping.json')
ACTUALS_LATEST   = os.path.join(ACTUALS_DIR,  'actuals_latest.json')
ACTUALS_PREVIOUS = os.path.join(ACTUALS_DIR,  'actuals_previous.json')
SNAPSHOT_LATEST  = os.path.join(SNAPSHOT_DIR, 'snapshot_latest.json')


# ─────────────────────────────────────────
#  トークン管理
# ─────────────────────────────────────────

def do_token_refresh(client_id, client_secret, refresh_tok):
    """リフレッシュトークンで新しいアクセストークンを取得"""
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
    """PyNaCl で暗号化して GitHub Secrets に PUT"""
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
        raise RuntimeError(f'freee API {e.code}: {body[:400]}')


def fetch_trial_pl(company_id, access_token, fiscal_year, start_month, end_month):
    """指定期間の損益試算表 balances を返す"""
    params = {
        'company_id':  company_id,
        'fiscal_year': fiscal_year,
        'start_month': start_month,
        'end_month':   end_month,
    }
    data = freee_get('/api/1/reports/trial_pl', access_token, params)
    return data.get('trial_pl', {}).get('balances', [])


# ─────────────────────────────────────────
#  試算表パース
# ─────────────────────────────────────────

def parse_balances(balances, mapping):
    """
    freee balances → {revenue, cogs, sga, non_op_income, non_op_expense}
    各セクション内の金額ゼロ以外のリーフ項目のみ収集する。
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
    current_section = None

    for row in balances:
        name   = (row.get('account_item_name') or '').strip()
        amount = row.get('closing_balance') or 0

        if name in end_markers:
            continue
        if name in section_starters:
            current_section = section_starters[name]
            continue
        if name in cogs_markers:
            current_section = 'cogs'
            continue

        if current_section and amount != 0:
            result[current_section]['breakdown'].append({
                'item':   name,
                'amount': abs(int(amount)),
            })

    for sec in result.values():
        sec['total'] = sum(i['amount'] for i in sec['breakdown'])

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

    print('=' * 55)
    print('  freee API データ同期')
    print('=' * 55)
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
            print(f'  ⚠️  {co_name}: {cfg["env_key"]} 未設定 → スキップ')
            continue

        company_id = int(company_id_str)
        fs         = cfg['fiscal_start_month']

        # YTD 起算月（当年内に fiscal_start_month があるか）
        if cur_month >= fs:
            ytd_year, ytd_sm = cur_year, fs
        else:
            ytd_year, ytd_sm = cur_year - 1, fs

        print(f'  [{co_name}] (id={company_id})')
        try:
            print(f'    当月    {cur_year}-{cur_month:02d}...')
            cur_bal  = fetch_trial_pl(company_id, access_token, cur_year, cur_month, cur_month)
            cur_data = parse_balances(cur_bal, mapping)
            cur_sum  = compute_summary(cur_data)

            ytd_label = f'{ytd_year}-{ytd_sm:02d}〜{cur_year}-{cur_month:02d}'
            print(f'    YTD     {ytd_label}...')
            ytd_bal  = fetch_trial_pl(company_id, access_token, ytd_year, ytd_sm, cur_month)
            ytd_data = parse_balances(ytd_bal, mapping)
            ytd_sum  = compute_summary(ytd_data)

            print(f'    前月    {prv_year}-{prv_month:02d}...')
            prv_bal  = fetch_trial_pl(company_id, access_token, prv_year, prv_month, prv_month)
            prv_data = parse_balances(prv_bal, mapping)
            prv_sum  = compute_summary(prv_data)

            print(f'    ✓ 完了  売上={cur_data["revenue"]["total"]:,}  経常={cur_sum["ordinary_profit"]:,}')

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

    # 青天堂はfreee対象外のため既存データを引き継ぎ
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
    print('=' * 55)
    print('  同期完了')
    print('=' * 55)


if __name__ == '__main__':
    main()
