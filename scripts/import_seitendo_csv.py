#!/usr/bin/env python3
"""
import_seitendo_csv.py
青天堂（オフィス栗原）月次P&L CSV → actuals_latest.json の unit_seitendo を更新

Usage:
    cd /path/to/deploy
    python3 scripts/import_seitendo_csv.py

data/imports/seitendo/ に新しい YYYY-MM_pl.csv を追加して再実行すると更新される。
CSVはfreee月次推移PLフォーマット（CP932）、会計年度は2月始まり。
"""

import csv
import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
CSV_DIR  = BASE_DIR / 'data' / 'imports' / 'seitendo'
ACTUALS  = BASE_DIR / 'data' / 'actuals' / 'actuals_latest.json'

MONTH_LABEL_MAP = {
    'Feb-26': '2026-02', 'Mar-26': '2026-03', 'Apr-26': '2026-04',
    'May-26': '2026-05', 'Jun-26': '2026-06', 'Jul-26': '2026-07',
    'Aug-26': '2026-08', 'Sep-26': '2026-09', 'Oct-26': '2026-10',
    'Nov-26': '2026-11', 'Dec-26': '2026-12', 'Jan-27': '2027-01',
}
FY_ORDER = [
    '2026-02','2026-03','2026-04','2026-05','2026-06','2026-07',
    '2026-08','2026-09','2026-10','2026-11','2026-12','2027-01',
]

# --- 状態定義 ---
S_INIT = 0
S_REVENUE = 1
S_COGS = 2
S_SGA = 3
S_NOI = 4   # 営業外収益
S_NOE = 5   # 営業外費用


def to_int(s):
    try:
        return int(str(s).replace(',', '').strip() or '0')
    except ValueError:
        return 0


def get_depth(row):
    for j in range(7):
        if j < len(row) and row[j].strip():
            return j
    return 7


def get_label(row):
    for j in range(7):
        if j < len(row) and row[j].strip():
            return row[j].strip()
    return ''


def load_csv(path):
    with open(path, encoding='cp932') as f:
        return list(csv.reader(f))


def build_col_map(rows):
    """ヘッダー行（index=1）から月キー→列インデックスのマップを返す"""
    col_map = {}
    for j, cell in enumerate(rows[1]):
        cell = cell.strip()
        if cell in MONTH_LABEL_MAP:
            col_map[MONTH_LABEL_MAP[cell]] = j
    return col_map


def build_structured(rows, col_map):
    """全行を {depth, label, monthly: {month: amount}} のリストに変換"""
    result = []
    for row in rows[2:]:  # title + header をスキップ
        depth = get_depth(row)
        label = get_label(row)
        monthly = {m: to_int(row[ci]) if ci < len(row) else 0
                   for m, ci in col_map.items()}
        result.append({'depth': depth, 'label': label, 'monthly': monthly})
    return result


def month_val(s, months):
    """単月（str）または複数月（list）の合計値を返す"""
    if isinstance(months, list):
        return sum(s['monthly'].get(m, 0) for m in months)
    return s['monthly'].get(months, 0)


def extract_pl(structured, months):
    """
    指定月（単月文字列 or 合計用リスト）のP&Lデータを抽出。
    戻り値: revenue / cogs / sga / non_op_income / non_op_expense / _summary
    """
    def v(s):
        return month_val(s, months)

    state = S_INIT

    revenue_total = 0
    revenue_breakdown = []
    cur_rev = None          # {'item': str, 'amount': int}
    cur_rev_items = []      # by_item list

    cogs_total = 0
    cogs_by_item = []

    sga_total = 0
    sga_breakdown = []
    cur_sga = None
    cur_sga_items = []

    noi_breakdown = []
    cur_noi = None
    cur_noi_items = []

    noe_breakdown = []
    cur_noe = None
    cur_noe_items = []

    def flush_rev():
        nonlocal cur_rev, cur_rev_items
        if cur_rev and cur_rev['amount'] != 0:
            revenue_breakdown.append({**cur_rev, 'by_item': cur_rev_items})
        cur_rev = None
        cur_rev_items = []

    def flush_sga():
        nonlocal cur_sga, cur_sga_items
        if cur_sga and cur_sga['amount'] != 0:
            sga_breakdown.append({**cur_sga, 'by_item': cur_sga_items})
        cur_sga = None
        cur_sga_items = []

    def flush_noi():
        nonlocal cur_noi, cur_noi_items
        if cur_noi and cur_noi['amount'] != 0:
            noi_breakdown.append({**cur_noi, 'by_item': cur_noi_items})
        cur_noi = None
        cur_noi_items = []

    def flush_noe():
        nonlocal cur_noe, cur_noe_items
        if cur_noe and cur_noe['amount'] != 0:
            noe_breakdown.append({**cur_noe, 'by_item': cur_noe_items})
        cur_noe = None
        cur_noe_items = []

    for s in structured:
        d = s['depth']
        l = s['label']
        val = v(s)

        # ─── 状態遷移 ───
        if l == '売上高' and d == 0:
            state = S_REVENUE
            continue

        if l == '売上高 計' and d == 0:
            revenue_total = val
            flush_rev()
            state = S_COGS
            continue

        if l == '販売管理費' and d == 1:
            state = S_SGA
            continue

        if l == '販売管理費 計' and d == 1:
            sga_total = val
            flush_sga()
            state = S_INIT
            continue

        if l == '営業外収益' and d == 1:
            state = S_NOI
            continue

        if l == '営業外費用' and d == 1:
            flush_noi()
            state = S_NOE
            continue

        if l == '経常損益金額' and d == 0:
            flush_noe()
            break

        # ─── 状態アクション ───
        if state == S_REVENUE:
            if d == 1:
                flush_rev()
                cur_rev = {'item': l, 'amount': val}
                cur_rev_items = []
            elif d == 2 and cur_rev and val != 0:
                cur_rev_items.append({'name': l, 'amount': val})

        elif state == S_COGS:
            # 売上原価の合計行（値あり）を取得
            if d == 1 and l == '売上原価' and val != 0 and cogs_total == 0:
                cogs_total = val
            # depth=5: 食材/飲料 by_item
            elif d == 5 and val != 0:
                cogs_by_item.append({'name': l, 'amount': val})

        elif state == S_SGA:
            if d == 2:
                flush_sga()
                cur_sga = {'item': l, 'amount': val}
                cur_sga_items = []
            elif d == 3 and cur_sga and val != 0:
                cur_sga_items.append({'name': l, 'amount': val})

        elif state == S_NOI:
            if d == 2:
                flush_noi()
                cur_noi = {'item': l, 'amount': val}
                cur_noi_items = []
            elif d == 3 and cur_noi and val != 0:
                cur_noi_items.append({'name': l, 'amount': val})

        elif state == S_NOE:
            if d == 2:
                flush_noe()
                cur_noe = {'item': l, 'amount': val}
                cur_noe_items = []
            elif d == 3 and cur_noe and val != 0:
                cur_noe_items.append({'name': l, 'amount': val})

    # COGS breakdown組み立て
    cogs_breakdown = []
    if cogs_total != 0:
        cogs_breakdown = [{'item': '売上原価', 'amount': cogs_total, 'by_item': cogs_by_item}]

    noi_total = sum(i['amount'] for i in noi_breakdown)
    noe_total = sum(e['amount'] for e in noe_breakdown)
    gross_profit   = revenue_total - cogs_total
    op_profit      = gross_profit - sga_total
    ordinary_profit = op_profit + noi_total - noe_total

    return {
        'revenue':         {'total': revenue_total, 'breakdown': revenue_breakdown},
        'cogs':            {'total': cogs_total,    'breakdown': cogs_breakdown},
        'sga':             {'total': sga_total,     'breakdown': sga_breakdown},
        'non_op_income':   {'total': noi_total,     'breakdown': noi_breakdown},
        'non_op_expense':  {'total': noe_total,     'breakdown': noe_breakdown},
        '_summary': {
            'gross_profit':    gross_profit,
            'op_profit':       op_profit,
            'ordinary_profit': ordinary_profit,
        },
    }


def main():
    # 最新CSVを自動選択
    csv_files = sorted(CSV_DIR.glob('*_pl.csv'))
    if not csv_files:
        print(f'ERROR: No CSV files in {CSV_DIR}', file=sys.stderr)
        sys.exit(1)
    csv_path = csv_files[-1]
    print(f'CSV: {csv_path.name}')

    rows = load_csv(csv_path)
    col_map = build_col_map(rows)
    structured = build_structured(rows, col_map)

    # 実データのある月のみ（FY順）― CSVヘッダーには全12ヶ月あるが将来月は全行ゼロ
    all_months = [m for m in FY_ORDER if m in col_map]
    available = [m for m in all_months
                 if any(s['monthly'].get(m, 0) != 0 for s in structured)]
    if not available:
        print('ERROR: No months with actual data found in CSV', file=sys.stderr)
        sys.exit(1)

    # 確定月を検出（売上高計が非ゼロの最後の月）
    rev_totals_row = next(
        (s for s in structured if s['label'] == '売上高 計' and s['depth'] == 0),
        None
    )
    if rev_totals_row is None:
        print('ERROR: "売上高 計" row not found', file=sys.stderr)
        sys.exit(1)

    confirmed = None
    for m in reversed(available):
        if rev_totals_row['monthly'].get(m, 0) != 0:
            confirmed = m
            break

    if confirmed is None:
        print('ERROR: All months have zero revenue', file=sys.stderr)
        sys.exit(1)

    period      = available[-1]              # 最新月（未締めの可能性あり）
    prev_month  = confirmed                  # 確定済み最終月
    conf_idx    = available.index(confirmed)
    ytd_months  = available[:conf_idx + 1]  # FY開始〜確定月

    print(f'period={period}  confirmed/prev={prev_month}  ytd={ytd_months[0]}〜{ytd_months[-1]}')

    # P&L抽出
    cur_pl  = extract_pl(structured, period)
    prev_pl = extract_pl(structured, prev_month)
    ytd_pl  = extract_pl(structured, ytd_months)

    source = f'data/imports/seitendo/{csv_path.name}'

    unit = {
        'period': period,
        'source_file': source,
        **cur_pl,
        'previous_month': {
            'period': prev_month,
            **prev_pl,
        },
        'ytd': {
            'period': f'{ytd_months[0]}〜{ytd_months[-1]}',
            'source_file': source,
            **ytd_pl,
        },
    }

    # actuals_latest.json を更新（他社データに触れない）
    with open(ACTUALS, encoding='utf-8') as f:
        actuals = json.load(f)

    actuals['data']['unit_seitendo'] = unit

    with open(ACTUALS, 'w', encoding='utf-8') as f:
        json.dump(actuals, f, ensure_ascii=False, indent=2)

    print('✓ actuals_latest.json → unit_seitendo 更新完了')

    # サマリー表示
    def fmt(n):
        return f'¥{n:>12,.0f}'

    print()
    print('─── 青天堂 データサマリー ──────────────────')
    for label, pl, prd in [
        ('当月', cur_pl,  period),
        ('前月', prev_pl, prev_month),
        ('YTD', ytd_pl,  f'{ytd_months[0]}〜{ytd_months[-1]}'),
    ]:
        s = pl['_summary']
        print(f'  {label} ({prd})')
        print(f'    売上高    {fmt(pl["revenue"]["total"])}')
        print(f'    粗利      {fmt(s["gross_profit"])}')
        print(f'    営業利益  {fmt(s["op_profit"])}')
        print(f'    経常利益  {fmt(s["ordinary_profit"])}')


if __name__ == '__main__':
    main()
