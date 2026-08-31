/* BDG 経営ダッシュボード — script.js */

// ══════════════════════════════════════════════════════
//  定数
// ══════════════════════════════════════════════════════

const SNAPSHOT_FILE = 'data/dashboard_snapshots/snapshot_latest.json';
const BUDGET_FILE        = 'data/budget/budget_FY2026.json';
const BUDGET_DETAIL_BE   = 'data/budget/budget_detail_BLUE_ESTATE.json';
const ACTUALS_FILE            = 'data/actuals/actuals_latest.json';
const ACTUALS_PREV_FILE       = 'data/actuals/actuals_previous.json';
const ACTUALS_MONTH_START_FILE= 'data/actuals/actuals_month_start.json';
const DAILY_HISTORY_BASE      = 'data/actuals/daily_history';
const MAPPING_FILE  = 'data/imports/freee_mapping.json';
const PORTALS_FILE  = 'data/portals/kpi_portals.json';
const HR_FILE       = 'data/hr/hr_latest.json';

const COMPANIES     = ['BLUE ESTATE', 'BLUE DESIGN', 'BLUE LIFE'];
const ALL_COMPANIES = [...COMPANIES, '青天堂'];

const SUGOI_TARGETS = {
  OP_PROFIT_ANNUAL:     150_000_000,
  VA_PER_PERSON_ANNUAL:  25_000_000,
  VA_PER_HOUR:           10_000,
  PERIOD_END: '2026-12-31',
};

const CO_COLOR = {
  'BLUE ESTATE': '#0d2957',
  'BLUE DESIGN': '#2f7fd1',
  'BLUE LIFE':   '#1c8a53',
  '青天堂':      '#b25b1e',
};

const CO_UNIT = {
  'BLUE ESTATE': 'unit_blue_estate',
  'BLUE DESIGN': 'unit_blue_design',
  'BLUE LIFE':   'unit_blue_life',
  '青天堂':      'unit_seitendo',
};
const CO_SEGMENTS = {
  'BLUE ESTATE': '不動産売買・賃貸仲介・賃貸管理 / 宿泊（BLUE HOTELS）/ ランドリー（WASH BLUE）',
  'BLUE DESIGN': '建築（新築・リフォーム）',
  'BLUE LIFE':   '福祉（デイサービス）',
  '青天堂':      '飲食（青天堂）',
};

// 売上が少なすぎる場合は率を非表示
const RATE_MIN_REVENUE = 100_000;

// ── S1指標定義（9指標 + 着地予測） ──
const S1_METRICS = [
  { id: 'revenue',  label: '売上',          isExpense: false, isRate: false },
  { id: 'gp',       label: '粗利',          isExpense: false, isRate: false },
  { id: 'gp_rate',  label: '粗利率',        isExpense: false, isRate: true  },
  { id: 'sga',      label: '販管費',        isExpense: true,  isRate: false },
  { id: 'sga_rate', label: '販管費率',      isExpense: true,  isRate: true  },
  { id: 'op',       label: '営業利益',      isExpense: false, isRate: false },
  { id: 'op_rate',  label: '営業利益率',    isExpense: false, isRate: true  },
  { id: 'cash',     label: 'キャッシュ',    isExpense: false, isRate: false },
  { id: 'land_r',   label: '着地予測/売上', isExpense: false, isRate: false },
  { id: 'land_p',   label: '着地予測/利益', isExpense: false, isRate: false },
];

// ── S2指標定義（経常利益を追加、セクション区切りあり） ──
const S2_METRICS = [
  { id: 'revenue',  label: '売上',            isExpense: false, isRate: false, sep: '収益' },
  { id: 'gp',       label: '粗利',            isExpense: false, isRate: false, sep: null   },
  { id: 'gp_rate',  label: '粗利率',          isExpense: false, isRate: true,  sep: null   },
  { id: 'sga',      label: '販管費',          isExpense: true,  isRate: false, sep: 'コスト' },
  { id: 'sga_rate', label: '販管費率',        isExpense: true,  isRate: true,  sep: null   },
  { id: 'op',       label: '営業利益',        isExpense: false, isRate: false, sep: '利益' },
  { id: 'op_rate',  label: '営業利益率',      isExpense: false, isRate: true,  sep: null   },
  { id: 'ord',      label: '経常利益',        isExpense: false, isRate: false, sep: null   },
  { id: 'ord_rate', label: '経常利益率',      isExpense: false, isRate: true,  sep: null   },
  { id: 'cash',     label: 'キャッシュ',      isExpense: false, isRate: false, sep: '財務' },
  { id: 'land_r',   label: '着地予測/売上',   isExpense: false, isRate: false, sep: '着地予測' },
  { id: 'land_p',   label: '着地予測/営業利益', isExpense: false, isRate: false, sep: null },
];

// ══════════════════════════════════════════════════════
//  アプリ状態
// ══════════════════════════════════════════════════════

let state = {
  current:   null,
  budget:    null,
  budgetDetail: null,
  actuals:           null,
  actualsPrev:       null,
  actualsMonthStart: null,
  actualsYesterday:  null,
  actualsLastWeek:   null,
  mapping:   null,
  portals:   null,
  hr:        null,
  s1Period:       'ytd',
  s2Company:      'group',
  s2Period:       'ytd',
  s2CompareYear:  '',
  s3Period:       'ytd',
  s4Unit:         'unit_blue_estate',
  s4Period:       'ytd',
  s8Period:       'monthly',
  s8DrillMode:    'dept',
  sbizNode:       'group',
  sbizPeriod:     'monthly',
  sbizDrillMode:  'dept',
};

// ══════════════════════════════════════════════════════
//  フォーマット
// ══════════════════════════════════════════════════════

function fmtYen(n) {
  if (n === null || n === undefined) return null;
  const abs  = Math.abs(n);
  const sign = n < 0 ? '▲' : '';
  if (abs >= 10_000) return sign + Math.floor(abs / 10_000).toLocaleString() + '万円';
  return sign + abs.toLocaleString() + '円';
}

function fmtRate(n) {
  if (n === null || n === undefined) return null;
  return (n < 0 ? '▲' : '') + Math.abs(n).toFixed(1) + '%';
}

function fmtRatio(current, prior) {
  if (current === null || prior === null || prior === 0) return null;
  if ((current >= 0 && prior < 0) || (current < 0 && prior > 0)) return null;
  const ratio = current / prior * 100;
  return ratio.toFixed(ratio < 10 ? 2 : 1) + '%';
}

// 差額（S1・S2共用）
function fmtDiff(current, comparison, isRate = false) {
  if (current === null || comparison === null) return null;
  const diff = current - comparison;
  if (isRate) {
    return (diff >= 0 ? '+' : '▲') + Math.abs(diff).toFixed(1) + 'pt';
  }
  if (diff === 0) return '±0';
  return (diff > 0 ? '+' : '') + fmtYen(diff);
}

// 差率（S2専用: (差額/|比較値|)×100）
function fmtDiffRate(current, comparison) {
  if (current === null || comparison === null || comparison === 0) return null;
  const diff = current - comparison;
  const rate = diff / Math.abs(comparison) * 100;
  return (rate >= 0 ? '+' : '▲') + Math.abs(rate).toFixed(1) + '%';
}

function d(v) { return v ?? '—'; }

// ══════════════════════════════════════════════════════
//  データ処理
// ══════════════════════════════════════════════════════

function addRates(data) {
  if (!data) return null;
  const r  = data.revenue ?? 0;
  const ok = r >= RATE_MIN_REVENUE;
  return {
    ...data,
    gp_rate:  ok ? data.gross_profit    / r * 100 : null,
    sga_rate: ok ? data.sga_total       / r * 100 : null,
    op_rate:  ok ? data.op_profit       / r * 100 : null,
    ord_rate: ok ? data.ordinary_profit / r * 100 : null,
  };
}

function sumRaw(list) {
  const keys = ['revenue', 'gross_profit', 'sga_total', 'op_profit', 'ordinary_profit'];
  const out  = {};
  for (const k of keys) {
    const vals = list.map(d => d?.[k]).filter(v => v !== null && v !== undefined);
    out[k] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  return out;
}

// グループ集計（actual）
function groupActual(period) {
  const key  = period === 'monthly' ? 'latest' : 'ytd';
  return addRates(sumRaw(COMPANIES.map(c => state.current?.companies?.[c]?.[key])));
}

// グループ集計（月初スナップショット YTD）— S1 前月比 YTD 用
function groupMonthStart() {
  if (!state.actualsMonthStart) return null;
  return addRates(sumRaw(COMPANIES.map(c => {
    const u = state.actualsMonthStart[CO_UNIT[c]];
    if (!u) return null;
    const src = u.ytd ?? u;
    return {
      revenue:         src.revenue?.total ?? null,
      gross_profit:    src._summary?.gross_profit ?? null,
      sga_total:       src.sga?.total ?? null,
      op_profit:       src._summary?.op_profit ?? null,
      ordinary_profit: src._summary?.ordinary_profit ?? null,
    };
  })));
}

// 会社別の最新2年分の history データを返す
function getCompanyHistory(company) {
  const h = state.current?.history?.[company];
  if (!h) return { latest: null, prev: null };
  const keys = Object.keys(h).sort();
  if (keys.length === 0) return { latest: null, prev: null };
  const lk = keys[keys.length - 1];
  const pk = keys.length >= 2 ? keys[keys.length - 2] : null;
  return {
    latest: { data: addRates(h[lk]), key: lk },
    prev:   pk ? { data: addRates(h[pk]), key: pk } : null,
  };
}

// 単社 actual
function coActual(company, period) {
  const co = state.current?.companies?.[company];
  return addRates(co ? (period === 'monthly' ? co.latest : co.ytd) : null);
}

// グループ前月（snapshot_latest.json の prior フィールドから取得）
function groupPrior() {
  const items = COMPANIES.map(c => state.current?.companies?.[c]?.prior ?? null);
  return items.some(v => v === null) ? null : addRates(sumRaw(items));
}

// 単社前月
function coPrior(company) {
  return addRates(state.current?.companies?.[company]?.prior ?? null);
}

// 予算データ取得
function getBudget(company, period) {
  const key = period === 'monthly' ? 'budget_monthly' : 'budget_ytd';
  if (company === 'group') {
    return addRates(sumRaw(COMPANIES.map(c => state.budget?.companies?.[c]?.[key])));
  }
  return addRates(state.budget?.companies?.[company]?.[key] ?? null);
}

// 前年データ取得
function getPY(company, period) {
  const key = period === 'monthly' ? 'py_monthly' : 'py_ytd';
  if (company === 'group') {
    return addRates(sumRaw(COMPANIES.map(c => state.budget?.companies?.[c]?.[key])));
  }
  return addRates(state.budget?.companies?.[company]?.[key] ?? null);
}

// 過去年度データ取得（snapshot.history から）
function getHistorical(company, yearKey) {
  if (!yearKey || company === 'group') return null;
  const data = state.current?.history?.[company]?.[yearKey];
  return data ? addRates(data) : null;
}

// キャッシュ（budget.json）
function getCash(company) {
  if (company === 'group') {
    const vals = COMPANIES.map(c => state.budget?.companies?.[c]?.cash).filter(v => v != null);
    return vals.length === COMPANIES.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  return state.budget?.companies?.[company]?.cash ?? null;
}

// 着地予測（budget.json）
function getLanding(company) {
  const empty = { revenue: null, op_profit: null };
  if (company === 'group') {
    const rv = COMPANIES.map(c => state.budget?.companies?.[c]?.landing_forecast?.revenue).filter(v => v != null);
    const op = COMPANIES.map(c => state.budget?.companies?.[c]?.landing_forecast?.op_profit).filter(v => v != null);
    return {
      revenue:   rv.length === COMPANIES.length ? rv.reduce((a, b) => a + b, 0) : null,
      op_profit: op.length === COMPANIES.length ? op.reduce((a, b) => a + b, 0) : null,
    };
  }
  return state.budget?.companies?.[company]?.landing_forecast ?? empty;
}

// 指標IDから値を取得
function getValue(data, id, company) {
  if (id === 'cash')   return getCash(company);
  if (id === 'land_r') return getLanding(company).revenue;
  if (id === 'land_p') return getLanding(company).op_profit;
  if (!data) return null;
  return ({
    revenue:  data.revenue,
    gp:       data.gross_profit,
    gp_rate:  data.gp_rate,
    sga:      data.sga_total,
    sga_rate: data.sga_rate,
    op:       data.op_profit,
    op_rate:  data.op_rate,
    ord:      data.ordinary_profit,
    ord_rate: data.ord_rate,
  })[id] ?? null;
}

// ══════════════════════════════════════════════════════
//  色クラス
// ══════════════════════════════════════════════════════

function valClass(n, isExpense = false) {
  if (n === null) return 'v-dash';
  if (n === 0)   return 'v-zero';
  if (isExpense) return '';          // 費用系は金額で色分けしない
  return n < 0 ? 'v-neg' : '';      // 利益系のみ赤字
}

function diffClass(diff, isExpense = false) {
  if (diff === null || diff === undefined) return '';
  if (diff === 0) return '';
  const good = isExpense ? diff <= 0 : diff >= 0;
  return good ? 'var-good' : 'var-bad';
}

// ══════════════════════════════════════════════════════
//  S1: 経営TOP
// ══════════════════════════════════════════════════════

function renderS1() {
  renderS1HeroKPIs();
  renderS1CoCards();
  renderS1Delta();
  renderS1MetricsTable();
  renderS1Highlights();
}

// ⑤ 変化テーブル（前日比・前週比・前月比）
function renderS1Delta() {
  const el = document.getElementById('s1-delta');
  if (!el) return;

  const cur = state.actuals;
  const yd  = state.actualsYesterday;
  const wk  = state.actualsLastWeek;
  const ms  = state.actualsMonthStart;

  if (!cur) {
    el.innerHTML = '<p class="delta-empty">実績データ未読込</p>';
    return;
  }

  const UNIT_KEYS = ['unit_blue_estate', 'unit_blue_design', 'unit_blue_life', 'unit_seitendo'];

  const sumKey = (data, summaryKey) => {
    if (!data) return null;
    let total = 0, found = false;
    for (const u of UNIT_KEYS) {
      const v = summaryKey === 'revenue'
        ? (data[u]?.revenue?.total ?? null)
        : (data[u]?._summary?.[summaryKey] ?? null);
      if (v !== null && v !== undefined) { total += v; found = true; }
    }
    return found ? total : null;
  };

  const sumBkItem = (data, itemName) => {
    if (!data) return null;
    let total = 0, found = false;
    for (const u of UNIT_KEYS) {
      const bk = data[u]?.sga?.breakdown ?? [];
      const it = bk.find(i => i.item === itemName);
      if (it) { total += it.amount; found = true; }
    }
    return found ? total : null;
  };

  const diffCell = (curV, baseV, inv = false) => {
    if (curV === null || baseV === null)
      return '<td class="delta-dash">—</td>';
    const d = curV - baseV;
    if (d === 0) return '<td class="delta-zero">±0</td>';
    const up   = d > 0;
    const good = inv ? !up : up;
    const sign = up ? '+' : '';
    return `<td class="${good ? 'delta-good' : 'delta-bad'}">${sign}${fmtYen(d)}</td>`;
  };

  const MAIN_METRICS = [
    { lbl: '当月売上',     key: 'revenue',         inv: false },
    { lbl: '当月粗利',     key: 'gross_profit',    inv: false },
    { lbl: '当月営業利益', key: 'op_profit',        inv: false },
  ];

  // 上位販管費科目（グループ合計で金額上位3件）
  const sgaMap = {};
  for (const u of UNIT_KEYS) {
    for (const it of cur[u]?.sga?.breakdown ?? []) {
      sgaMap[it.item] = (sgaMap[it.item] ?? 0) + it.amount;
    }
  }
  const topSga = Object.entries(sgaMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  let rows = '';
  for (const { lbl, key, inv } of MAIN_METRICS) {
    const c = sumKey(cur, key);
    rows += `<tr>
      <td class="delta-lbl">${lbl}</td>
      <td class="delta-cur">${c !== null ? fmtYen(c) : '—'}</td>
      ${diffCell(c, sumKey(yd,  key), inv)}
      ${diffCell(c, sumKey(wk,  key), inv)}
      ${diffCell(c, sumKey(ms,  key), inv)}
    </tr>`;
  }
  for (const name of topSga) {
    const c = sgaMap[name];
    rows += `<tr class="delta-sga-row">
      <td class="delta-lbl delta-sga-lbl">${name}</td>
      <td class="delta-cur">${fmtYen(c)}</td>
      ${diffCell(c, sumBkItem(yd, name), true)}
      ${diffCell(c, sumBkItem(wk, name), true)}
      ${diffCell(c, sumBkItem(ms, name), true)}
    </tr>`;
  }

  const hasHistory = yd !== null || wk !== null;
  const note = hasHistory ? '' :
    '<div class="delta-note">※ 前日比・前週比は翌日以降の自動同期後から表示されます</div>';

  el.innerHTML = `${note}<div class="delta-tbl-wrap"><table class="delta-tbl">
    <thead><tr>
      <th>指標</th><th>今月累計</th><th>前日比</th><th>前週比</th><th>前月比</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ① ヒーローKPIカード
function renderS1HeroKPIs() {
  const snap = state.current;
  if (!snap) return;

  const grpM   = groupActual('monthly');
  const grpYTD = groupActual('ytd');
  const grpPM  = groupPrior();

  const revM   = grpM?.revenue          ?? null;
  const opM    = grpM?.op_profit        ?? null;
  const revYTD = grpYTD?.revenue        ?? null;
  const opYTD  = grpYTD?.op_profit      ?? null;
  const ordYTD = sumRaw(COMPANIES.map(c => snap.companies?.[c]?.ytd)).ordinary_profit;

  // 年度累計をメイン、当月を補足として表示
  setText('s1-rev-ytd', d(fmtYen(revYTD)));
  setText('s1-rev-m',   '当月: ' + d(fmtYen(revM)));
  setText('s1-op-ytd',  d(fmtYen(opYTD)));
  setText('s1-op-m',    '当月: ' + d(fmtYen(opM)));
  setText('s1-ord-ytd', d(fmtYen(ordYTD)));
  applyNumColor('s1-op-ytd',  opYTD,  's1-kpi-value');
  applyNumColor('s1-ord-ytd', ordYTD, 's1-kpi-value');

  // 前月比
  const momRatio = fmtRatio(revM, grpPM?.revenue ?? null);
  setText('s1-mom',     momRatio ?? '比較不可');
  setText('s1-mom-sub', '前月: ' + d(fmtYen(grpPM?.revenue ?? null)));
  if (momRatio) {
    const ratio = revM / (grpPM?.revenue ?? 1);
    document.getElementById('s1-mom').className =
      's1-kpi-value ' + (ratio >= 1 ? 'v-pos' : 'v-neg');
  }

  // データ更新日
  const genAt = snap.generated_at
    ? new Date(snap.generated_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  setText('s1-data-date', 'データ更新: ' + genAt);
}

function applyNumColor(id, n, baseClass) {
  const el = document.getElementById(id);
  if (!el || n === null) return;
  el.className = baseClass + ' ' + (n < 0 ? 'v-neg' : n > 0 ? 'v-pos' : '');
}

// ② グループ指標サマリーテーブル
function renderS1MetricsTable() {
  const period = state.s1Period;
  const actual = groupActual(period);
  const budget = getBudget('group', period);
  const py     = getPY('group', period);
  const pm     = period === 'monthly' ? groupPrior() : groupMonthStart();

  const tbody = document.getElementById('s1-tbl-body');
  tbody.innerHTML = '';

  for (const m of S1_METRICS) {
    const aVal  = getValue(actual, m.id, 'group');
    const bVal  = getValue(budget, m.id, 'group');
    const pyVal = getValue(py,     m.id, 'group');
    const pmVal = getValue(pm,     m.id, 'group');

    const fmt   = m.isRate ? fmtRate : fmtYen;
    const aStr  = d(fmt(aVal));
    const bStr  = d(fmt(bVal));

    const bDiff  = (aVal !== null && bVal  !== null) ? aVal - bVal  : null;
    const pyDiff = (aVal !== null && pyVal !== null) ? aVal - pyVal : null;
    const pmDiff = (aVal !== null && pmVal !== null) ? aVal - pmVal : null;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-metric${m.isRate ? ' rate-row' : ''}">${m.label}</td>
      <td class="${valClass(aVal, m.isExpense)}">${aStr}</td>
      <td class="v-dash">${bStr}</td>
      <td class="${diffClass(bDiff,  m.isExpense)}">${d(fmtDiff(aVal, bVal,  m.isRate))}</td>
      <td class="${diffClass(pyDiff, m.isExpense)}">${d(fmtDiff(aVal, pyVal, m.isRate))}</td>
      <td class="${diffClass(pmDiff, m.isExpense)}">${d(fmtDiff(aVal, pmVal, m.isRate))}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ③ 注目事項
function renderS1Highlights() {
  const snap      = state.current;
  const container = document.getElementById('s1-highlights');
  const alerts    = [];
  const now       = new Date();

  for (const name of COMPANIES) {
    const co = snap?.companies?.[name];
    if (!co) continue;

    // 当月営業赤字
    const op = co.latest?.op_profit;
    if (op !== null && op !== undefined && op < 0) {
      alerts.push({ type: 'warning', badge: '要注意',
        text: `${name}：当月営業損失 ${fmtYen(op)}` });
    }

    // データ鮮度チェック（2ヶ月以上前）
    if (co.latest_month) {
      const [yr, mo] = co.latest_month.split('-').map(Number);
      const diff = (now.getFullYear() - yr) * 12 + (now.getMonth() + 1 - mo);
      if (diff >= 2) {
        alerts.push({ type: 'info', badge: '情報',
          text: `${name}：最新データが ${yr}年${mo}月時点（約${diff}ヶ月前）` });
      }
    }
  }

  // 予算未入力
  const hasBudget = COMPANIES.some(c => {
    const b = state.budget?.companies?.[c]?.budget_monthly;
    return b && Object.values(b).some(v => v !== null);
  });
  if (!hasBudget) {
    alerts.push({ type: 'pending', badge: '未入力',
      text: '予算データ未入力 — data/budget/budget_FY2026.json に数値を入力してください' });
  }

  // 全社黒字
  const allBlack = COMPANIES.every(c => {
    const op = snap?.companies?.[c]?.latest?.op_profit;
    return op !== null && op !== undefined && op > 0;
  });
  if (allBlack) {
    alerts.push({ type: 'success', badge: '達成', text: '全社 当月営業黒字達成' });
  }

  if (alerts.length === 0) {
    alerts.push({ type: 'success', badge: '正常', text: '特記事項なし' });
  }

  container.innerHTML = alerts.map(a => `
    <div class="s1-alert ${a.type}">
      <span class="s1-alert-badge">${a.badge}</span>
      <span class="s1-alert-text">${a.text}</span>
    </div>
  `).join('');
}

// ④ 4社カード（売上→原価→粗利→販管費→営業利益）
function renderS1CoCards() {
  const snap      = state.current;
  const period    = state.s1Period;
  const container = document.getElementById('s1-co-grid');
  container.innerHTML = '';

  for (const name of ALL_COMPANIES) {
    const co   = snap?.companies?.[name];
    const card = document.createElement('div');
    card.className = 's1-co-card';

    if (!co) {
      card.innerHTML = `
        <div class="s1-co-hdr" style="background:${CO_COLOR[name]}">
          <div class="s1-co-name">${name}</div>
          <div class="s1-co-segs">${CO_SEGMENTS[name] ?? ''}</div>
        </div>
        <div class="s1-co-body">
          <div class="s1-co-row">
            <span class="s1-co-row-lbl">状態</span>
            <span class="s1-co-row-val muted">データなし</span>
          </div>
        </div>`;
    } else {
      const src = period === 'ytd' ? co.ytd : co.latest;
      const [yr, mo] = (co.latest_month || '').split('-');
      const periodLabel = period === 'ytd'
        ? `累計: ${yr}年${parseInt(mo)}月まで`
        : `最新: ${yr}年${parseInt(mo)}月`;

      const rev  = src?.revenue        ?? null;
      const gp   = src?.gross_profit   ?? null;
      const cogs = (rev !== null && gp !== null) ? rev - gp : null;
      const sga  = src?.sga_total      ?? null;
      const op   = src?.op_profit      ?? null;

      const pct = (n) => (rev && rev >= RATE_MIN_REVENUE && n !== null)
        ? (n / rev * 100) : null;

      const row = (lbl, val, cls = '', extra = '') =>
        `<div class="s1-co-row${extra}">
          <span class="s1-co-row-lbl">${lbl}</span>
          <span class="s1-co-row-val${cls ? ' ' + cls : ''}">${d(fmtYen(val))}</span>
          <span class="s1-co-row-rate">${d(fmtRate(pct(val)))}</span>
        </div>`;

      card.innerHTML = `
        <div class="s1-co-hdr" style="background:${CO_COLOR[name]}">
          <div class="s1-co-name">${name}</div>
          <div class="s1-co-segs">${CO_SEGMENTS[name] ?? ''}</div>
          <div class="s1-co-month">${periodLabel}</div>
        </div>
        <div class="s1-co-body">
          ${row('売上',   rev,  '')}
          ${row('原価',   cogs, '')}
          ${row('粗利',   gp,   '',  ' pl-profit')}
          ${row('販管費', sga,  '')}
          ${row('営業利益', op, op === null ? '' : op < 0 ? 'neg' : 'pos', ' pl-op')}
        </div>`;
    }
    container.appendChild(card);
    const unitId = CO_UNIT[name];
    if (unitId) {
      card.classList.add('drill-link');
      card.addEventListener('click', () => navigateToS4(unitId));
    }
  }
}

// ══════════════════════════════════════════════════════
//  S2: 財務・管理会計
// ══════════════════════════════════════════════════════

function renderS2() {
  renderS2InfoBar();
  renderS2YearSelector();
  renderS2Table();
}

function renderS2YearSelector() {
  const sel = document.getElementById('s2-compare-year');
  if (!sel) return;
  const co      = state.s2Company;
  const history = state.current?.history ?? {};

  sel.innerHTML = '<option value="">— 比較年度を選択 —</option>';

  if (co === 'group') {
    sel.disabled = true;
    return;
  }

  const coHistory = history[co] ?? {};
  const years = Object.keys(coHistory);

  if (years.length === 0) {
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  for (const yearKey of years) {
    const opt = document.createElement('option');
    opt.value = yearKey;
    opt.textContent = yearKey;
    if (yearKey === state.s2CompareYear) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderS2InfoBar() {
  const bar  = document.getElementById('s2-info-bar');
  const snap = state.current;
  if (!snap) return;
  let html = '';
  for (const co of ALL_COMPANIES) {
    const month = snap.companies?.[co]?.latest_month ?? '—';
    const [yr, mo] = (month || '').split('-');
    const label = yr && mo ? `${yr}年${parseInt(mo)}月` : '—';
    html += `<span class="info-item">
      <span class="info-dot" style="background:${CO_COLOR[co]}"></span>
      ${co}: <strong>${label}</strong>
    </span>`;
  }
  const at = snap.generated_at
    ? new Date(snap.generated_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  if (at) html += `<span class="info-item" style="margin-left:auto">更新: ${at}</span>`;
  bar.innerHTML = html;
}

function renderS2Table() {
  const co      = state.s2Company;
  const period  = state.s2Period;
  const tbody   = document.getElementById('s2-tbody');
  tbody.innerHTML = '';

  const actual  = co === 'group' ? groupActual(period) : coActual(co, period);
  const budget  = getBudget(co, period);
  const histKey = state.s2CompareYear;
  const py      = histKey ? getHistorical(co, histKey) : getPY(co, period);
  const pm      = period === 'monthly'
    ? (co === 'group' ? groupPrior() : coPrior(co))
    : null;

  // 比較年度列ヘッダーを動的更新
  const pyGrpHdr = document.getElementById('s2-py-grp-header');
  const pyColHdr = document.getElementById('s2-py-col-header');
  if (pyGrpHdr) pyGrpHdr.textContent = histKey ? `${histKey}対比` : '比較年度対比';
  if (pyColHdr) pyColHdr.textContent = histKey || '比較年度';

  let prevSep = null;

  for (const m of S2_METRICS) {
    if (m.sep && m.sep !== prevSep) {
      const sep = document.createElement('tr');
      sep.className = 'sep';
      sep.innerHTML = `<td colspan="11">${m.sep}</td>`;
      tbody.appendChild(sep);
      prevSep = m.sep;
    }

    const aVal  = getValue(actual, m.id, co);
    const bVal  = getValue(budget, m.id, co);
    const pyVal = getValue(py,     m.id, co);
    const pmVal = getValue(pm,     m.id, co);

    const fmt   = m.isRate ? fmtRate : fmtYen;
    const aStr  = d(fmt(aVal));
    const aCls  = valClass(aVal, m.isExpense);
    const bStr  = d(fmt(bVal));
    const pyStr = d(fmt(pyVal));
    const pmStr = d(fmt(pmVal));

    const bDiff  = (aVal !== null && bVal  !== null) ? aVal - bVal  : null;
    const pyDiff = (aVal !== null && pyVal !== null) ? aVal - pyVal : null;
    const pmDiff = (aVal !== null && pmVal !== null) ? aVal - pmVal : null;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-metric${m.isRate ? ' rate-row' : ''}">${m.label}</td>
      <td class="${aCls}">${aStr}</td>
      <td class="v-dash">${bStr}</td>
      <td class="${diffClass(bDiff,  m.isExpense)}">${d(fmtDiff(aVal, bVal,  m.isRate))}</td>
      <td class="${diffClass(bDiff,  m.isExpense)}">${m.isRate ? '—' : d(fmtDiffRate(aVal, bVal))}</td>
      <td class="v-dash">${pyStr}</td>
      <td class="${diffClass(pyDiff, m.isExpense)}">${d(fmtDiff(aVal, pyVal, m.isRate))}</td>
      <td class="${diffClass(pyDiff, m.isExpense)}">${m.isRate ? '—' : d(fmtDiffRate(aVal, pyVal))}</td>
      <td class="v-dash">${pmStr}</td>
      <td class="${diffClass(pmDiff, m.isExpense)}">${d(fmtDiff(aVal, pmVal, m.isRate))}</td>
      <td class="${diffClass(pmDiff, m.isExpense)}">${m.isRate ? '—' : d(fmtDiffRate(aVal, pmVal))}</td>
    `;
    if (!m.isRate && !['cash', 'land_r', 'land_p'].includes(m.id)) {
      const navUnit = co === 'group' ? 'group' : CO_UNIT[co];
      if (navUnit) {
        tr.classList.add('drill-link');
        tr.addEventListener('click', () => navigateToS4(navUnit));
      }
    }
    tbody.appendChild(tr);
  }
}

// ══════════════════════════════════════════════════════
//  S3: 会社別分析
// ══════════════════════════════════════════════════════

function renderS3() {
  renderS3InfoBar();
  renderS3Table();
}

function renderS3InfoBar() {
  const bar  = document.getElementById('s3-info-bar');
  if (!bar) return;
  const snap = state.current;
  if (!snap) return;
  let html = '';
  for (const co of COMPANIES) {
    const month = snap.companies?.[co]?.latest_month ?? '—';
    const [yr, mo] = (month || '').split('-');
    const label = yr && mo ? `${yr}年${parseInt(mo)}月` : '—';
    html += `<span class="info-item">
      <span class="info-dot" style="background:${CO_COLOR[co]}"></span>
      ${co}: <strong>${label}</strong>
    </span>`;
  }
  bar.innerHTML = html;
}

function renderS3Table() {
  const period = state.s3Period;
  const tbody  = document.getElementById('s3-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const groupData = groupActual(period);
  const coDataMap = {};
  for (const co of ALL_COMPANIES) {
    coDataMap[co] = coActual(co, period);
  }

  let prevSep = null;

  for (const m of S2_METRICS) {
    if (m.sep && m.sep !== prevSep) {
      const sep = document.createElement('tr');
      sep.className = 'sep';
      sep.innerHTML = `<td colspan="${2 + ALL_COMPANIES.length}">${m.sep}</td>`;
      tbody.appendChild(sep);
      prevSep = m.sep;
    }

    const fmt      = m.isRate ? fmtRate : fmtYen;
    const groupVal = getValue(groupData, m.id, 'group');

    let cells = `<td class="td-metric${m.isRate ? ' rate-row' : ''}">${m.label}</td>`;
    cells += `<td class="${valClass(groupVal, m.isExpense)}" data-s3-co="group">${d(fmt(groupVal))}</td>`;

    for (const co of ALL_COMPANIES) {
      const data = coDataMap[co];
      const val  = data !== null ? getValue(data, m.id, co) : null;
      cells += `<td class="${valClass(val, m.isExpense)}" data-s3-co="${co}">${d(fmt(val))}</td>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  }

  // ── 前年比較セクション（history から最新2年度の差分）──
  const HIST_METRICS = [
    { id: 'revenue', label: '売上高',   isExpense: false },
    { id: 'gp',      label: '粗利',     isExpense: false },
    { id: 'sga',     label: '販管費',   isExpense: true  },
    { id: 'op',      label: '営業利益', isExpense: false },
  ];
  const histMap = {};
  let hasHist = false;
  for (const co of ALL_COMPANIES) {
    const h = getCompanyHistory(co);
    histMap[co] = h;
    if (h.latest) hasHist = true;
  }

  if (hasHist) {
    // 年度ラベル行
    const labelTr = document.createElement('tr');
    labelTr.className = 'sep';
    let lbHtml = '<td>前年比較（最新完了年度 対 前年度）</td><td>—</td>';
    for (const co of ALL_COMPANIES) {
      const h = histMap[co];
      if (h.latest && h.prev) {
        lbHtml += `<td style="font-size:.78em;text-align:center;white-space:nowrap">${h.latest.key} / ${h.prev.key}</td>`;
      } else if (h.latest) {
        lbHtml += `<td style="font-size:.78em;text-align:center">${h.latest.key}</td>`;
      } else {
        lbHtml += '<td>—</td>';
      }
    }
    labelTr.innerHTML = lbHtml;
    tbody.appendChild(labelTr);

    for (const m of HIST_METRICS) {
      // 最新年度値行
      const trL = document.createElement('tr');
      let lHtml = `<td class="td-metric" style="padding-left:1em">${m.label}（前年実績）</td><td class="v-dash">—</td>`;
      for (const co of ALL_COMPANIES) {
        const val = histMap[co].latest ? getValue(histMap[co].latest.data, m.id, co) : null;
        lHtml += `<td class="${valClass(val, m.isExpense)}" data-s3-co="${co}">${d(fmtYen(val))}</td>`;
      }
      trL.innerHTML = lHtml;
      tbody.appendChild(trL);

      // 対前年差行
      const trD = document.createElement('tr');
      let dHtml = `<td class="td-metric" style="padding-left:1.5em;font-size:.82em;color:#6B7280">└ 対前年差</td><td class="v-dash">—</td>`;
      for (const co of ALL_COMPANIES) {
        const lv = histMap[co].latest ? getValue(histMap[co].latest.data, m.id, co) : null;
        const pv = histMap[co].prev   ? getValue(histMap[co].prev.data,   m.id, co) : null;
        dHtml += `<td class="${diffClass(lv !== null && pv !== null ? lv - pv : null, m.isExpense)}" data-s3-co="${co}">${d(fmtDiff(lv, pv, false))}</td>`;
      }
      trD.innerHTML = dHtml;
      tbody.appendChild(trD);
    }
  }
}

// ══════════════════════════════════════════════════════
//  事業分析（S4 新版）
// ══════════════════════════════════════════════════════

// 円表示（完全形：1,234,567円）
function fmtFull(n) {
  if (n === null || n === undefined) return '—';
  return (n < 0 ? '▲' : '') + Math.abs(n).toLocaleString() + '円';
}

const UNIT_COLOR = {
  'unit_blue_estate': '#0d2957',
  'unit_blue_design': '#2f7fd1',
  'unit_blue_life':   '#1c8a53',
  'unit_seitendo':    '#b25b1e',
};
const UNIT_LABEL = {
  'unit_blue_estate': 'BLUE ESTATE',
  'unit_blue_design': 'BLUE DESIGN',
  'unit_blue_life':   'BLUE LIFE',
  'unit_seitendo':    '青天堂',
};

function renderS4() {
  renderSbizNav();
  renderSbizContent();
}

// ── サイドバー ──────────────────────────────────────────

function renderSbizNav() {
  const el = document.getElementById('sbiz-nav');
  if (!el) return;

  const cur = state.sbizNode;

  // 全体ノード
  let html = `<div class="sbiz-nav-item level-group${cur === 'group' ? ' active' : ''}" data-node="group">
    <span class="sbiz-nav-dot" style="background:#3452d9"></span>全体
  </div>`;

  const units = Object.keys(UNIT_LABEL);
  for (const unitId of units) {
    const label = UNIT_LABEL[unitId];
    const color = UNIT_COLOR[unitId];
    const nodeId = unitId;
    const isCo = cur === nodeId;

    html += `<div class="sbiz-nav-sep"></div>`;
    html += `<div class="sbiz-nav-item level-company${isCo ? ' active' : ''}" data-node="${nodeId}">
      <span class="sbiz-nav-dot" style="background:${color}"></span>${label}
    </div>`;

    // BLUE ESTATEのみ部門サブ項目を表示
    if (unitId === 'unit_blue_estate') {
      const depts = getSbizDepts('unit_blue_estate');
      for (const dept of depts) {
        const deptNodeId = `dept:unit_blue_estate:${dept}`;
        const isDept = cur === deptNodeId;
        html += `<div class="sbiz-nav-item level-dept${isDept ? ' active' : ''}" data-node="${deptNodeId}">
          <span class="sbiz-nav-dot" style="background:${color};opacity:0.5"></span>${dept}
        </div>`;
      }
    }
  }

  el.innerHTML = html;

  el.querySelectorAll('[data-node]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sbizNode = btn.dataset.node;
      renderSbizNav();
      renderSbizContent();
    });
  });
}

function getSbizDepts(unitId) {
  const act = state.actuals?.[unitId];
  if (!act) return [];
  // 全セクションの by_department を合計して部門リストを作成
  const deptAmts = {};
  const SECTIONS = ['revenue', 'cogs', 'sga', 'non_op_income', 'non_op_expense'];
  for (const sec of SECTIONS) {
    for (const item of act[sec]?.breakdown ?? []) {
      for (const d of item.by_department ?? []) {
        if (!d.deprecated && d.name !== '（部門未設定）') {
          deptAmts[d.name] = (deptAmts[d.name] ?? 0) + Math.abs(d.amount);
        }
      }
    }
  }
  return Object.entries(deptAmts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);
}

// ── データ取得 ──────────────────────────────────────────

function getSbizActuals(unitId, period) {
  const u = state.actuals?.[unitId];
  if (!u) return null;
  return period === 'ytd' ? (u.ytd ?? u) : u;
}

function getSbizNodeData() {
  const node   = state.sbizNode;
  const period = state.sbizPeriod;

  if (node === 'group') {
    // 全4社合計
    return mergeSbizActuals(Object.keys(UNIT_LABEL).map(uid => getSbizActuals(uid, period)));
  }
  if (node.startsWith('dept:')) {
    const [, unitId, ...nameParts] = node.split(':');
    const deptName = nameParts.join(':');
    return extractDeptData(unitId, deptName);
  }
  // 単社
  return getSbizActuals(node, period);
}

function getSbizPrevData() {
  const node   = state.sbizNode;
  if (node.startsWith('dept:')) {
    const [, unitId, ...nameParts] = node.split(':');
    return extractDeptData(unitId, nameParts.join(':'), true);
  }
  if (node === 'group') {
    return mergeSbizActuals(Object.keys(UNIT_LABEL).map(uid => state.actuals?.[uid]?.previous_month));
  }
  return state.actuals?.[node]?.previous_month ?? null;
}

function mergeSbizActuals(list) {
  const valid = list.filter(Boolean);
  if (!valid.length) return null;
  const mergeSection = (key) => {
    const totals = valid.map(v => v[key]?.total ?? 0);
    const total  = totals.reduce((a, b) => a + b, 0);
    // breakdown: merge by item name
    const bkMap = {};
    for (const v of valid) {
      for (const it of v[key]?.breakdown ?? []) {
        if (!bkMap[it.item]) bkMap[it.item] = { item: it.item, amount: 0, by_department: [], by_item: [] };
        bkMap[it.item].amount += it.amount;
        for (const d of it.by_department ?? []) {
          const ex = bkMap[it.item].by_department.find(x => x.name === d.name);
          if (ex) ex.amount += d.amount;
          else bkMap[it.item].by_department.push({ ...d });
        }
        for (const i of it.by_item ?? []) {
          const ex = bkMap[it.item].by_item.find(x => x.name === i.name);
          if (ex) ex.amount += i.amount;
          else bkMap[it.item].by_item.push({ ...i });
        }
      }
    }
    return { total, breakdown: Object.values(bkMap).sort((a, b) => b.amount - a.amount) };
  };
  const revenue = mergeSection('revenue');
  const cogs    = mergeSection('cogs');
  const sga     = mergeSection('sga');
  const noi     = mergeSection('non_op_income');
  const noe     = mergeSection('non_op_expense');
  const gp  = revenue.total - cogs.total;
  const op  = gp - sga.total;
  const ord = op + noi.total - noe.total;
  return {
    revenue, cogs, sga,
    non_op_income: noi, non_op_expense: noe,
    _summary: { gross_profit: gp, op_profit: op, ordinary_profit: ord },
  };
}

function extractDeptData(unitId, deptName, usePrevMonth = false) {
  const u = state.actuals?.[unitId];
  if (!u) return null;
  const src = usePrevMonth ? (u.previous_month ?? u) : u;

  const extractSection = (sec) => {
    let total = 0;
    const breakdown = [];
    for (const item of sec?.breakdown ?? []) {
      const d = item.by_department?.find(x => x.name === deptName);
      if (d && d.amount > 0) {
        total += d.amount;
        breakdown.push({ item: item.item, amount: d.amount, by_department: [], by_item: item.by_item ?? [] });
      }
    }
    return { total, breakdown };
  };

  const revenue = extractSection(src.revenue);
  const cogs    = extractSection(src.cogs);
  const sga     = extractSection(src.sga);
  const noi     = extractSection(src.non_op_income);
  const noe     = extractSection(src.non_op_expense);
  const gp = revenue.total - cogs.total;
  const op = gp - sga.total;
  return {
    revenue, cogs, sga, non_op_income: noi, non_op_expense: noe,
    _summary: { gross_profit: gp, op_profit: op, ordinary_profit: op + noi.total - noe.total },
  };
}

// ── コンテンツ描画 ──────────────────────────────────────

function renderSbizContent() {
  renderSbizBreadcrumb();
  renderSbizKpis();
  renderSbizWaterfall();
}

function renderSbizBreadcrumb() {
  const el = document.getElementById('sbiz-bc');
  if (!el) return;
  const node = state.sbizNode;
  if (node === 'group') { el.textContent = '全体'; return; }
  if (node.startsWith('dept:')) {
    const [, unitId, ...nameParts] = node.split(':');
    el.textContent = `全体 › ${UNIT_LABEL[unitId]} › ${nameParts.join(':')}`;
    return;
  }
  el.textContent = `全体 › ${UNIT_LABEL[node] ?? node}`;
}

function renderSbizKpis() {
  const el = document.getElementById('sbiz-kpis');
  if (!el) return;
  const data    = getSbizNodeData();
  const prev    = getSbizPrevData();
  const isYtd   = state.sbizPeriod === 'ytd';
  const isDept  = state.sbizNode.startsWith('dept:');
  // 部門はYTD集計データなし→当月を表示、それ以外はperiodに従う
  const pfx     = isYtd && !isDept ? '累計' : '当月';
  const momLbl  = isYtd && !isDept ? '前月比' : '前月比';

  const kpiCard = (lbl, val, prevVal) => {
    const isNeg = val !== null && val < 0;
    const momHtml = (() => {
      if (val === null || prevVal === null) return '<span>—</span>';
      const d = val - prevVal;
      if (d === 0) return '<span>±0</span>';
      const up = d > 0;
      return `<span class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'}${fmtYen(Math.abs(d))}</span>`;
    })();
    return `<div class="sbiz-kpi">
      <div class="sbiz-kpi-lbl">${lbl}</div>
      <div class="sbiz-kpi-val${isNeg ? ' neg' : (val > 0 ? ' pos' : '')}">${val !== null ? fmtYen(val) : '—'}</div>
      <div class="sbiz-kpi-mom">${momLbl} ${momHtml}</div>
    </div>`;
  };

  const rev  = data?.revenue?.total ?? null;
  const gp   = data?._summary?.gross_profit ?? null;
  const op   = data?._summary?.op_profit ?? null;
  const pRev = prev?.revenue?.total ?? null;
  const pGp  = prev?._summary?.gross_profit ?? null;
  const pOp  = prev?._summary?.op_profit ?? null;

  const deptYtdNote = isDept && isYtd
    ? `<div class="sbiz-period-note">⚠ 部門別の年度累計データは対象外のため当月値を表示しています</div>`
    : '';

  el.innerHTML = deptYtdNote
    + kpiCard(`${pfx}売上`, rev, pRev)
    + kpiCard(`${pfx}粗利`, gp, pGp)
    + kpiCard(`${pfx}営業利益`, op, pOp);
}

// BLUE ESTATE予算詳細から勘定科目予算を取得
function getSbizAcctBudget(section, accountName) {
  if (!state.budgetDetail) return null;
  const node = state.sbizNode;
  if (node === 'group' || node.startsWith('dept:')) return null;
  if (node !== 'unit_blue_estate') return null;

  const CAT_MAP = { revenue: '売上高', cogs: '売上原価', sga: '販売管理費' };
  const NAME_MAP = { '給料手当': '給与手当', '福利厚生費': '福利厚生費' };
  const cat = CAT_MAP[section];
  if (!cat) return null;

  const budgetName = NAME_MAP[accountName] ?? accountName;
  const acct = state.budgetDetail.categories?.[cat]?.[budgetName];
  if (!acct) return null;

  const targetMonth = state.budget?.target_month ?? '2026-07';
  const isYtd = state.sbizPeriod === 'ytd';
  if (!isYtd) return acct.monthly_budget?.[targetMonth] ?? null;

  // YTD: fy_start から targetMonth までの累計
  const fyStart = state.budgetDetail.fy_start ?? '2026-01';
  let ytd = 0;
  let cur = fyStart;
  while (cur <= targetMonth) {
    ytd += acct.monthly_budget?.[cur] ?? 0;
    const [y, m] = cur.split('-').map(Number);
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return ytd;
}

function renderSbizWaterfall() {
  const el = document.getElementById('sbiz-waterfall');
  if (!el) return;
  const data   = getSbizNodeData();
  const prev   = getSbizPrevData();
  const isYtd  = state.sbizPeriod === 'ytd';
  const isDept = state.sbizNode.startsWith('dept:');

  if (!data) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--sbiz-ink-faint)">データを読み込めませんでした</div>';
    return;
  }

  const ytdNote = isYtd && !isDept
    ? `<div class="sbiz-period-note">📋 年度累計では科目別内訳のみ表示。部門・品目ドリルダウンは当月モードで確認できます</div>`
    : '';

  const rev  = data.revenue?.total ?? 0;
  const cogs = data.cogs?.total ?? 0;
  const sga  = data.sga?.total ?? 0;
  const noi  = data.non_op_income?.total ?? 0;
  const noe  = data.non_op_expense?.total ?? 0;
  const gp   = data._summary?.gross_profit ?? (rev - cogs);
  const op   = data._summary?.op_profit    ?? (gp - sga);
  const ord  = data._summary?.ordinary_profit ?? (op + noi - noe);
  const maxAbs = Math.max(rev, Math.abs(op), 1);

  const pRev  = prev?.revenue?.total ?? null;
  const pCogs = prev?.cogs?.total ?? null;
  const pSga  = prev?.sga?.total ?? null;
  const pGp   = prev?._summary?.gross_profit ?? null;
  const pOp   = prev?._summary?.op_profit ?? null;
  const pOrd  = prev?._summary?.ordinary_profit ?? null;

  const momBadge = (cur, prv, inv = false) => {
    if (cur === null || prv === null) return '<span>—</span>';
    const d = cur - prv;
    if (d === 0) return '<span>±0</span>';
    const up   = d > 0;
    const good = inv ? !up : up;
    return `<span class="${good ? 'up' : 'down'}">${up ? '▲' : '▼'}${fmtYen(Math.abs(d))}</span>`;
  };

  // BLUE ESTATE 予算対比バッジ
  const bgtBadge = (cur, bgt, inv = false) => {
    if (cur === null || bgt === null) return '';
    const d = cur - bgt;
    if (d === 0) return '<div class="sbiz-wf-bgt-line">予算比 <span>±0</span></div>';
    const up = d > 0;
    const good = inv ? !up : up;
    return `<div class="sbiz-wf-bgt-line">予算比 <span class="${good ? 'up' : 'down'}">${up ? '▲' : '▼'}${fmtYen(Math.abs(d))}</span></div>`;
  };

  // 要約行の予算値（budget_FY2026.jsonから）
  const isBeUnit = state.sbizNode === 'unit_blue_estate';
  const bePeriod = state.sbizPeriod;
  const beBudget = isBeUnit ? getBudget('BLUE ESTATE', bePeriod) : null;
  const bgtRev  = beBudget?.revenue        ?? null;
  const bgtCogs = beBudget ? ((beBudget.revenue ?? 0) - (beBudget.gross_profit ?? 0)) : null;
  const bgtGp   = beBudget?.gross_profit   ?? null;
  const bgtSga  = beBudget?.sga_total      ?? null;
  const bgtOp   = beBudget?.op_profit      ?? null;

  const barW = (v) => Math.min(100, Math.abs(v) / maxAbs * 100).toFixed(1) + '%';
  const wfRow = (lbl, val, prevVal, color, clickable = true, extraClass = '', bgtVal = null) => {
    const isNeg = val < 0;
    const expand = clickable ? '<span class="expand-icon">›</span>' : '';
    const inv = lbl === '販管費' || lbl === '売上原価';
    return `<div class="sbiz-wf-row${extraClass ? ' ' + extraClass : ''}${clickable ? ' clickable-row' : ''}" data-section="${lbl}">
      <div class="sbiz-wf-lbl${clickable ? ' clickable' : ''}">${expand}${lbl}</div>
      <div class="sbiz-wf-bar-cell">
        <div class="sbiz-wf-bar-bg"><div class="sbiz-wf-bar" style="width:${barW(val)};background:${color}"></div></div>
      </div>
      <div class="sbiz-wf-amt${isNeg ? ' neg' : (val > 0 ? ' pos' : '')}">${fmtYen(val)}</div>
      <div class="sbiz-wf-mom">${momBadge(val, prevVal, inv)}${bgtBadge(val, bgtVal, inv)}</div>
    </div>`;
  };

  const renderBkList = (section, sectionKey, color, inv = false) => {
    const bk   = data[sectionKey]?.breakdown ?? [];
    const prevBk = prev?.[sectionKey]?.breakdown ?? [];
    if (!bk.length) return '';

    let rows = '';
    for (const it of bk) {
      const prevIt = prevBk.find(p => p.item === it.item);
      const hasDept = it.by_department?.length > 0;
      const hasItem = it.by_item?.length > 0;
      const hasDrill = hasDept || hasItem;
      const acctBgt = getSbizAcctBudget(section, it.item);
      rows += `<div class="sbiz-bk-row${hasDrill ? ' has-drill' : ''}" data-bk="${it.item}" data-section-key="${sectionKey}">
        <div class="sbiz-wf-lbl">${it.item}</div>
        <div class="sbiz-wf-bar-cell">
          <div class="sbiz-wf-bar-bg"><div class="sbiz-wf-bar" style="width:${barW(it.amount)};background:${color}88"></div></div>
        </div>
        <div class="sbiz-wf-amt">${fmtYen(it.amount)}</div>
        <div class="sbiz-wf-mom">${momBadge(it.amount, prevIt?.amount ?? null, inv)}${bgtBadge(it.amount, acctBgt, inv)}</div>
      </div>`;

      if (hasDrill) {
        // タブは実際にデータがある方だけ表示
        const tabDept = hasDept ? `<button class="sbiz-drill-tab${state.sbizDrillMode === 'dept' ? ' active' : ''}" data-drill="dept">部門別 <span class="sbiz-drill-count">${it.by_department.length}</span></button>` : '';
        const tabItem = hasItem ? `<button class="sbiz-drill-tab${state.sbizDrillMode === 'item' ? ' active' : ''}" data-drill="item">品目別 <span class="sbiz-drill-count">${it.by_item.length}</span></button>` : '';
        rows += `<div class="sbiz-drill-header" id="drill-hdr-${it.item.replace(/\s/g,'_')}" style="display:none">${tabDept}${tabItem}</div>`;

        // 現在のモードにデータがなければ反対側にフォールバック
        const effectiveMode = state.sbizDrillMode === 'item' && hasItem ? 'item'
                            : state.sbizDrillMode === 'dept' && hasDept ? 'dept'
                            : hasItem ? 'item' : 'dept';
        const drillList = effectiveMode === 'item' ? it.by_item : it.by_department;
        rows += `<div class="sbiz-drill-list" id="drill-${it.item.replace(/\s/g,'_')}">`;
        if (!drillList?.length) {
          rows += `<div class="sbiz-drill-empty">データなし（freeeで品目を設定してください）</div>`;
        } else {
          for (const d of drillList) {
            const isUntagged = d.name === '（部門未設定）' || d.name === '（品目未設定）';
            const isDepr = d.deprecated ?? false;
            rows += `<div class="sbiz-drill-row${isUntagged ? ' untagged' : ''}${isDepr ? ' deprecated' : ''}">
              <span>${isDepr ? '⚠ ' : ''}${d.name}</span>
              <span class="sbiz-drill-amt">${fmtYen(d.amount)}</span>
            </div>`;
          }
        }
        rows += `</div>`;
      }
    }
    return `<div class="sbiz-bk-list" id="bk-${section}">${rows}</div>`;
  };

  el.innerHTML = ytdNote +
    wfRow('売上', rev, pRev, '#3452d9', true, '', bgtRev) +
    renderBkList('revenue', 'revenue', '#3452d9') +
    wfRow('売上原価', cogs, pCogs, '#e74c3c', true, '', bgtCogs) +
    renderBkList('cogs', 'cogs', '#e74c3c', true) +
    wfRow('粗利', gp, pGp, '#1c8a53', false, 'summary', bgtGp) +
    wfRow('販管費', sga, pSga, '#b45309', true, '', bgtSga) +
    renderBkList('sga', 'sga', '#b45309', true) +
    wfRow('営業利益', op, pOp, '#1c8a53', false, op >= 0 ? 'summary' : 'summary neg-row', bgtOp) +
    (noi > 0 ? wfRow('営業外収益', noi, pOrd, '#059669') + renderBkList('noi', 'non_op_income', '#059669') : '') +
    (noe > 0 ? wfRow('営業外費用', noe, null,  '#e74c3c', true) + renderBkList('noe', 'non_op_expense', '#e74c3c', true) : '') +
    wfRow('経常利益', ord, pOrd, '#1c8a53', false, ord >= 0 ? 'total-row' : 'total-row neg-row');

  // アコーディオン: 大項目クリック → breakdown 開閉
  el.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', () => {
      const sec   = row.dataset.section;
      const secMap = { '売上':'revenue','売上原価':'cogs','販管費':'sga','営業外収益':'noi','営業外費用':'noe' };
      const bkId  = 'bk-' + secMap[sec];
      const bkEl  = el.querySelector(`#${bkId}`);
      if (!bkEl) return;
      const open = bkEl.classList.contains('open');
      el.querySelectorAll('.sbiz-bk-list').forEach(x => x.classList.remove('open'));
      el.querySelectorAll('.sbiz-wf-row').forEach(x => x.classList.remove('expanded'));
      if (!open) { bkEl.classList.add('open'); row.classList.add('expanded'); }
    });
  });

  // 科目行クリック → 部門/品目ドリル開閉
  el.querySelectorAll('.sbiz-bk-row.has-drill').forEach(row => {
    row.addEventListener('click', () => {
      const bkKey = row.dataset.bk?.replace(/\s/g,'_');
      const drillEl = el.querySelector(`#drill-${bkKey}`);
      const hdrEl   = el.querySelector(`#drill-hdr-${bkKey}`);
      if (!drillEl) return;
      const open = drillEl.classList.contains('open');
      el.querySelectorAll('.sbiz-drill-list').forEach(x => x.classList.remove('open'));
      el.querySelectorAll('.sbiz-drill-header').forEach(x => x.style.display = 'none');
      el.querySelectorAll('.sbiz-bk-row').forEach(x => x.classList.remove('expanded'));
      if (!open) {
        drillEl.classList.add('open');
        if (hdrEl) hdrEl.style.display = 'flex';
        row.classList.add('expanded');
      }
    });
  });

  // 部門/品目タブ切り替え（展開状態を保持して再描画）
  el.querySelectorAll('.sbiz-drill-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 現在開いている大項目・科目を記憶
      const openSecEl = el.querySelector('.sbiz-bk-list.open');
      const openBkEl  = el.querySelector('.sbiz-bk-row.expanded');
      const openSecId = openSecEl?.id;
      const openBkKey = openBkEl?.dataset.bk?.replace(/\s/g,'_');

      state.sbizDrillMode = btn.dataset.drill;
      renderSbizWaterfall();

      // 再描画後に同じ行を復元
      if (openSecId) {
        el.querySelector(`#${openSecId}`)?.classList.add('open');
        const secLabel = openSecId.replace('bk-','');
        const secLabelMap = { revenue:'売上', cogs:'売上原価', sga:'販管費', noi:'営業外収益', noe:'営業外費用' };
        el.querySelector(`.sbiz-wf-row[data-section="${secLabelMap[secLabel] ?? secLabel}"]`)?.classList.add('expanded');
      }
      if (openBkKey) {
        el.querySelector(`#drill-${openBkKey}`)?.classList.add('open');
        el.querySelector(`#drill-hdr-${openBkKey}`)?.style.setProperty('display','flex');
        el.querySelector(`.sbiz-bk-row[data-bk="${openBkEl.dataset.bk}"]`)?.classList.add('expanded');
      }
    });
  });
}

// ══════════════════════════════════════════════════════
//  S5: KPIポータル
// ══════════════════════════════════════════════════════

function renderS5() {
  const el = document.getElementById('s5-content');
  if (!el) return;

  const portals = state.portals?.portals;
  if (!portals) {
    el.innerHTML = '<div class="s5-empty">kpi_portals.json を読み込めませんでした</div>';
    return;
  }

  // KPI ポータルのベースURL（グループ全体の最初のURLから取得）
  const kpiBaseUrl = portals
    .flatMap(u => u.depts.flatMap(d => d.kpis))
    .find(k => k.url)?.url ?? null;

  let h = '';

  // ── KPIダッシュボード 開くバナー ──
  if (kpiBaseUrl) {
    h += `<a class="s5-kpi-banner" href="${kpiBaseUrl}" target="_blank" rel="noopener">
      <div class="s5-kpi-banner-icon">📊</div>
      <div class="s5-kpi-banner-body">
        <div class="s5-kpi-banner-title">KPI ダッシュボード</div>
        <div class="s5-kpi-banner-sub">部署別達成率・着地予測・月間ランキングを確認</div>
      </div>
      <div class="s5-kpi-banner-arrow">↗</div>
    </a>`;
  }

  // ── ポータルカード（URLありのみ表示）──
  h += '<div class="s5-grid">';
  for (const unit of portals) {
    const linkedDepts = unit.depts
      .map(dept => ({ ...dept, kpis: dept.kpis.filter(k => k.url) }))
      .filter(dept => dept.kpis.length > 0);

    if (linkedDepts.length === 0) continue;

    const col = unit.color || '#0090BA';
    h += `<div class="s5-unit-card">
      <div class="s5-unit-hdr" style="background:${col}">
        <span class="s5-unit-name">${unit.unit}</span>
      </div>
      <div class="s5-unit-body">`;

    for (const dept of linkedDepts) {
      h += `<div class="s5-dept">
        <div class="s5-dept-title">${dept.dept}</div>
        <div class="s5-kpi-list">`;

      for (const kpi of dept.kpis) {
        h += `<a class="s5-kpi-btn has-url" href="${kpi.url}" target="_blank" rel="noopener">
          <span class="s5-kpi-icon">${kpi.icon || '📊'}</span>
          <span class="s5-kpi-label">${kpi.theme}</span>
          <span class="s5-kpi-arrow">↗</span>
        </a>`;
      }

      h += '</div></div>';
    }

    h += '</div></div>';
  }
  h += '</div>';

  el.innerHTML = h;
}

// ══════════════════════════════════════════════════════
//  S6: 人事・生産性
// ══════════════════════════════════════════════════════

// ユニットIDと表示ラベル・actuals_latest.jsonキーのマッピング
const S6_UNITS = [
  { id: 'unit_blue_estate', label: 'BLUE ESTATE', color: '#1A3A5C' },
  { id: 'unit_blue_design', label: 'BLUE DESIGN', color: '#0090BA' },
  { id: 'unit_blue_life',   label: 'BLUE LIFE',   color: '#059669' },
  { id: 'unit_seitendo',    label: '青天堂',       color: '#B45309' },
];

function s6CalcUnit(unitId) {
  const hr  = state.hr?.[unitId];
  const act = state.actuals?.[unitId];
  if (!hr) return null;

  const hc    = hr.headcount;
  const total = hc.total || 0;
  const hours = hr.hours.total_monthly_hours || 0;

  const rev = act?.revenue?.total ?? null;
  const gp  = act?._summary?.gross_profit ?? null;
  const op  = act?._summary?.op_profit ?? null;

  return {
    total,
    full_time:       hc.full_time,
    part_time:       hc.part_time,
    new_hires_ytd:   hc.new_hires_ytd,
    departures_ytd:  hc.departures_ytd,
    avg_overtime:    hr.hours.avg_overtime_monthly,
    total_hours:     hours,
    rev_per_head:    (rev !== null && total > 0) ? Math.round(rev / total) : null,
    gp_per_head:     (gp  !== null && total > 0) ? Math.round(gp  / total) : null,
    op_per_head:     (op  !== null && total > 0) ? Math.round(op  / total) : null,
    gp_per_hour:     (gp  !== null && hours > 0) ? Math.round(gp  / hours) : null,
    va_per_hour:     (gp  !== null && hours > 0) ? Math.round(gp  / hours) : null,
    data_status:     hr.data_status,
  };
}

function s6CalcGroup() {
  const units = S6_UNITS.map(u => s6CalcUnit(u.id)).filter(Boolean);
  if (!units.length) return null;
  const sum = (key) => units.reduce((s, u) => (u[key] !== null ? s + u[key] : s), 0);
  const avg = (key) => {
    const vals = units.map(u => u[key]).filter(v => v !== null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const totalHead  = sum('total');
  const totalHours = sum('total_hours');
  const actGroup   = state.actuals;
  let groupRev = 0, groupGP = 0, groupOP = 0;
  for (const u of S6_UNITS) {
    const a = actGroup?.[u.id];
    if (a) {
      groupRev += a.revenue?.total ?? 0;
      groupGP  += a._summary?.gross_profit ?? 0;
      groupOP  += a._summary?.op_profit ?? 0;
    }
  }
  return {
    total:           totalHead,
    full_time:       sum('full_time'),
    part_time:       sum('part_time'),
    new_hires_ytd:   sum('new_hires_ytd'),
    departures_ytd:  sum('departures_ytd'),
    avg_overtime:    avg('avg_overtime'),
    total_hours:     totalHours,
    rev_per_head:    totalHead > 0 ? Math.round(groupRev / totalHead) : null,
    gp_per_head:     totalHead > 0 ? Math.round(groupGP  / totalHead) : null,
    op_per_head:     totalHead > 0 ? Math.round(groupOP  / totalHead) : null,
    gp_per_hour:     totalHours > 0 ? Math.round(groupGP  / totalHours) : null,
    va_per_hour:     totalHours > 0 ? Math.round(groupGP  / totalHours) : null,
    data_status:     'dummy',
  };
}

function s6CalcSugoi() {
  // 前月（prior）データで計算。なければ当月（latest）
  const coKeys = ['BLUE ESTATE', 'BLUE DESIGN', 'BLUE LIFE', '青天堂'];
  const unitIds = ['unit_blue_estate', 'unit_blue_design', 'unit_blue_life', 'unit_seitendo'];

  let totalGP = 0, totalOP = 0, totalHead = 0, totalHours = 0;
  let hasData = false;

  const companies = state.current?.companies ?? {};
  for (let i = 0; i < coKeys.length; i++) {
    const coName = coKeys[i];
    const uid    = unitIds[i];
    const co     = companies[coName];
    const hr     = state.hr?.[uid];

    const pl = co?.prior ?? co?.latest ?? null;
    if (pl) {
      totalGP += pl.gross_profit ?? 0;
      totalOP += pl.op_profit    ?? 0;
      hasData  = true;
    }
    if (hr) {
      totalHead  += hr.headcount.total || 0;
      totalHours += hr.hours.total_monthly_hours || 0;
    }
  }

  if (!hasData) return null;

  const annualOP       = totalOP * 12;
  const vaPerPerson    = totalHead  > 0 ? totalGP * 12 / totalHead  : null;
  const vaPerHour      = totalHours > 0 ? totalGP      / totalHours : null;

  const pctClamp = (val, tgt) => tgt <= 0 ? 0 : Math.max(0, Math.min(100, val / tgt * 100));

  return {
    annualOP,
    vaPerPerson,
    vaPerHour,
    pctOP:       pctClamp(annualOP,    SUGOI_TARGETS.OP_PROFIT_ANNUAL),
    pctPerson:   vaPerPerson !== null ? pctClamp(vaPerPerson, SUGOI_TARGETS.VA_PER_PERSON_ANNUAL) : 0,
    pctHour:     vaPerHour   !== null ? pctClamp(vaPerHour,   SUGOI_TARGETS.VA_PER_HOUR)          : 0,
  };
}

function renderSugoiPanel(sg) {
  if (!sg) return '';
  const fmtOku = (n) => {
    if (n === null || n === undefined) return '—';
    const sign = n < 0 ? '−' : '';
    return `${sign}${(Math.abs(n) / 100_000_000).toFixed(2)}億円`;
  };
  const fmtMan = (n) => {
    if (n === null || n === undefined) return '—';
    const sign = n < 0 ? '−' : '';
    return `${sign}${Math.round(Math.abs(n) / 10_000).toLocaleString()}万円`;
  };
  const fmtYen = (n) => {
    if (n === null || n === undefined) return '—';
    return `${Math.round(n).toLocaleString()}円/h`;
  };
  const bar = (pct, color) =>
    `<div class="sg-bar-bg"><div class="sg-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>`;

  const kpis = [
    {
      label:  '営業利益（年換算ペース）',
      actual: fmtOku(sg.annualOP),
      target: `目標 ${fmtOku(SUGOI_TARGETS.OP_PROFIT_ANNUAL)}`,
      pct:    sg.pctOP,
      color:  sg.annualOP >= 0 ? '#059669' : '#dc2626',
    },
    {
      label:  '1人あたり年間付加価値（粗利）',
      actual: fmtMan(sg.vaPerPerson),
      target: `目標 ${fmtMan(SUGOI_TARGETS.VA_PER_PERSON_ANNUAL)}`,
      pct:    sg.pctPerson,
      color:  '#0090BA',
    },
    {
      label:  '1時間あたり付加価値（粗利）',
      actual: fmtYen(sg.vaPerHour),
      target: `目標 ${SUGOI_TARGETS.VA_PER_HOUR.toLocaleString()}円/h`,
      pct:    sg.pctHour,
      color:  '#B45309',
    },
  ];

  let h = '<div class="sg-panel">';
  h += '<div class="sg-panel-title">すごい会議 経営目標 — 2026年12月末</div>';
  h += '<div class="sg-kpi-grid">';
  for (const k of kpis) {
    h += `<div class="sg-kpi-card">
      <div class="sg-kpi-label">${k.label}</div>
      <div class="sg-kpi-actual">${k.actual}</div>
      <div class="sg-kpi-target">${k.target}</div>
      ${bar(k.pct, k.color)}
      <div class="sg-kpi-pct">${k.pct.toFixed(1)}%</div>
    </div>`;
  }
  h += '</div>';
  h += '<div class="sg-note">前月実績をベースに算出。付加価値＝粗利（控除法）で代替。</div>';
  h += '</div>';
  return h;
}

function fmtManYen(n) {
  if (n === null || n === undefined) return '—';
  return Math.round(n / 10000).toLocaleString() + '万円';
}

function renderS6() {
  const el = document.getElementById('s6-content');
  if (!el) return;

  if (!state.hr) {
    el.innerHTML = '<div class="s6-empty">hr_latest.json を読み込めませんでした</div>';
    return;
  }

  const grp   = s6CalcGroup();
  const units = S6_UNITS.map(u => ({ ...u, calc: s6CalcUnit(u.id) }));

  // ── ① すごい会議 経営目標 ──
  let h = renderSugoiPanel(s6CalcSugoi());

  // ── ② グループ全体サマリー ──
  const heroCards = [
    { label: '総社員数',       value: grp ? `${grp.total}名`                 : '—', sub: `正社員 ${grp?.full_time ?? '—'}名 / パート ${grp?.part_time ?? '—'}名` },
    { label: '採用数（当期累計）', value: grp ? `${grp.new_hires_ytd}名`      : '—', sub: `離職 ${grp?.departures_ytd ?? '—'}名` },
    { label: '平均残業時間',   value: grp && grp.avg_overtime != null ? `${grp.avg_overtime.toFixed(1)}h/月` : '—', sub: 'グループ平均' },
    { label: '1人当たり粗利（月）', value: grp ? fmtManYen(grp.gp_per_head) : '—', sub: `時間当たり ${grp?.gp_per_hour?.toLocaleString() ?? '—'}円/h` },
  ];

  h += '<div class="s6-section-title">グループ全体サマリー</div>';
  h += '<div class="s6-hero-grid">';
  for (const c of heroCards) {
    h += `<div class="s6-hero-card">
      <div class="s6-hero-label">${c.label}</div>
      <div class="s6-hero-value">${c.value}</div>
      <div class="s6-hero-sub">${c.sub}</div>
    </div>`;
  }
  h += '</div>';

  // ── ② 経営単位別サマリー ──
  h += '<div class="s6-section-title">経営単位別サマリー</div>';
  h += '<div class="s6-unit-grid">';
  for (const u of units) {
    const c = u.calc;
    const dummy = c?.data_status === 'dummy';
    h += `<div class="s6-unit-card">
      <div class="s6-unit-hdr" style="background:${u.color}">
        <span class="s6-unit-name">${u.label}</span>
        ${dummy ? '<span class="s6-dummy-badge">ダミー</span>' : ''}
      </div>
      <div class="s6-unit-body">
        <div class="s6-kv-row"><span class="s6-kv-lbl">社員数</span><span class="s6-kv-val">${c ? `${c.total}名` : '—'}</span></div>
        <div class="s6-kv-row sub"><span class="s6-kv-lbl">正社員</span><span class="s6-kv-val">${c?.full_time ?? '—'}名</span></div>
        <div class="s6-kv-row sub"><span class="s6-kv-lbl">パート</span><span class="s6-kv-val">${c?.part_time ?? '—'}名</span></div>
        <div class="s6-kv-row"><span class="s6-kv-lbl">採用（当期）</span><span class="s6-kv-val">${c ? `${c.new_hires_ytd}名` : '—'}</span></div>
        <div class="s6-kv-row"><span class="s6-kv-lbl">離職（当期）</span><span class="s6-kv-val">${c ? `${c.departures_ytd}名` : '—'}</span></div>
        <div class="s6-kv-row"><span class="s6-kv-lbl">平均残業</span><span class="s6-kv-val">${c && c.avg_overtime != null ? `${c.avg_overtime.toFixed(1)}h/月` : '—'}</span></div>
        <div class="s6-kv-sep"></div>
        <div class="s6-kv-row"><span class="s6-kv-lbl">1人当たり売上</span><span class="s6-kv-val">${fmtManYen(c?.rev_per_head)}</span></div>
        <div class="s6-kv-row"><span class="s6-kv-lbl">1人当たり粗利</span><span class="s6-kv-val">${fmtManYen(c?.gp_per_head)}</span></div>
        <div class="s6-kv-row"><span class="s6-kv-lbl">1人当たり営業利益</span><span class="s6-kv-val">${fmtManYen(c?.op_per_head)}</span></div>
        <div class="s6-kv-row"><span class="s6-kv-lbl">時間当たり粗利</span><span class="s6-kv-val">${c?.gp_per_hour !== null && c?.gp_per_hour !== undefined ? `${c.gp_per_hour.toLocaleString()}円/h` : '—'}</span></div>
      </div>
    </div>`;
  }
  h += '</div>';

  // ── ③ 比較表 ──
  h += '<div class="s6-section-title">人員・生産性 比較表</div>';
  const cols  = [grp, ...units.map(u => u.calc)];
  const heads = ['指標', 'グループ計', ...units.map(u => u.label)];

  const rows = [
    { label: '社員数（合計）',        key: 'total',          fmt: n => `${n}名` },
    { label: '└ 正社員',              key: 'full_time',      fmt: n => `${n}名`, sub: true },
    { label: '└ パート/アルバイト',   key: 'part_time',      fmt: n => `${n}名`, sub: true },
    { label: '採用数（当期）',        key: 'new_hires_ytd',  fmt: n => `${n}名` },
    { label: '離職数（当期）',        key: 'departures_ytd', fmt: n => `${n}名` },
    { label: '月平均残業時間',        key: 'avg_overtime',   fmt: n => n != null ? `${n.toFixed(1)}h` : '—' },
    { sep: '生産性指標' },
    { label: '1人当たり売上（月）',   key: 'rev_per_head',   fmt: fmtManYen },
    { label: '1人当たり粗利（月）',   key: 'gp_per_head',    fmt: fmtManYen },
    { label: '1人当たり営業利益（月）', key: 'op_per_head',  fmt: fmtManYen },
    { label: '時間当たり粗利',        key: 'gp_per_hour',    fmt: n => n !== null && n !== undefined ? `${n.toLocaleString()}円/h` : '—' },
    { label: '時間当たり付加価値 ※', key: 'va_per_hour',    fmt: n => n !== null && n !== undefined ? `${n.toLocaleString()}円/h` : '—' },
  ];

  h += '<div class="s6-tbl-wrap"><table class="s6-tbl"><thead><tr>';
  for (let i = 0; i < heads.length; i++) {
    const col = units[i - 1];
    const style = i === 0 ? '' : `style="background:${col?.color ?? '#0d2137'};color:#fff"`;
    h += `<th ${style}>${heads[i]}</th>`;
  }
  h += '</tr></thead><tbody>';
  for (const row of rows) {
    if (row.sep) {
      h += `<tr class="s6-sep-row"><td colspan="${heads.length}">${row.sep}</td></tr>`;
      continue;
    }
    h += `<tr${row.sub ? ' class="s6-sub-row"' : ''}>`;
    h += `<td class="s6-tbl-lbl">${row.label}</td>`;
    for (const col of cols) {
      const v = col?.[row.key];
      h += `<td class="s6-tbl-val">${v !== null && v !== undefined ? row.fmt(v) : '—'}</td>`;
    }
    h += '</tr>';
  }
  h += '</tbody></table></div>';
  h += '<div class="s6-note">※ 付加価値は暫定値（粗利で代替）。正確な付加価値は別途集計が必要です。</div>';

  // ── ④ データステータス ──
  const dummyUnits = units.filter(u => u.calc?.data_status === 'dummy').map(u => u.label);
  if (dummyUnits.length) {
    h += `<div class="s6-status-box">
      <div class="s6-status-title">📋 データ入力状況</div>
      <div class="s6-status-body">
        <div class="s6-status-row"><span class="s6-status-badge dummy">ダミー</span><span>社員数・残業時間・採用/離職数 — ${dummyUnits.join(' / ')}（data/hr/hr_latest.json に実データを入力してください）</span></div>
        <div class="s6-status-row"><span class="s6-status-badge actual">実績</span><span>売上・粗利・営業利益 — actuals_latest.json から自動取得</span></div>
      </div>
    </div>`;
  }

  el.innerHTML = h;

  const lbl = document.getElementById('s6-period-label');
  if (lbl && state.hr) lbl.textContent = `データ期間: ${Object.values(state.hr)[0]?.period ?? '—'}`;
}

// ══════════════════════════════════════════════════════
//  ユーティリティ
// ══════════════════════════════════════════════════════

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateClock() {
  setText('hdr-datetime', new Date().toLocaleString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }));
}

// ══════════════════════════════════════════════════════
//  画面切替・イベント
// ══════════════════════════════════════════════════════

function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${screenId}`)?.classList.add('active');
  if (screenId === 's1') renderS1();
  if (screenId === 's2') renderS2();
  if (screenId === 's3') renderS3();
  if (screenId === 's4') renderS4();
  if (screenId === 's5') renderS5();
  if (screenId === 's6') renderS6();
}

function navigateToS4(unitId) {
  state.sbizNode = unitId ?? 'group';
  document.querySelectorAll('.screen-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.screen-btn[data-screen="s4"]')?.classList.add('active');
  switchScreen('s4');
}

function bindEvents() {
  // 画面切替
  document.querySelectorAll('.screen-btn[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.screen-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchScreen(btn.dataset.screen);
    });
  });

  // S1: 期間切替
  document.querySelectorAll('#s1-period-toggle .mini-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#s1-period-toggle .mini-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.s1Period = btn.dataset.period;
      renderS1MetricsTable();
      renderS1CoCards();
    });
  });

  // S2: 会社選択
  document.querySelectorAll('#s2-company-tabs .co-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#s2-company-tabs .co-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.s2Company = btn.dataset.co;
      state.s2CompareYear = '';
      renderS2YearSelector();
      renderS2Table();
    });
  });

  // S2: 期間切替
  document.querySelectorAll('#s2-period-toggle .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#s2-period-toggle .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.s2Period = btn.dataset.period;
      renderS2Table();
    });
  });

  // S2: 比較年度選択
  document.getElementById('s2-compare-year')?.addEventListener('change', e => {
    state.s2CompareYear = e.target.value;
    renderS2Table();
  });

  // S3: 期間切替
  document.querySelectorAll('#s3-period-toggle .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#s3-period-toggle .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.s3Period = btn.dataset.period;
      renderS3Table();
    });
  });

  // S3: 会社セルクリックでS4ドリルダウン
  document.getElementById('s3-tbody')?.addEventListener('click', e => {
    const td = e.target.closest('td[data-s3-co]');
    if (!td) return;
    const co = td.dataset.s3Co;
    navigateToS4(co === 'group' ? 'group' : (CO_UNIT[co] ?? 'group'));
  });
  // S3: 列ヘッダークリック
  const s3Ths = document.querySelectorAll('.s3-co-hdr th');
  if (s3Ths.length >= 2) {
    s3Ths[1].classList.add('drill-link');
    s3Ths[1].addEventListener('click', () => navigateToS4('group'));
  }
  ALL_COMPANIES.forEach((co, i) => {
    const th = s3Ths[i + 2];
    if (th) {
      th.classList.add('drill-link');
      th.addEventListener('click', () => navigateToS4(CO_UNIT[co] ?? 'group'));
    }
  });

  // 事業分析（S4新版）: 期間切替
  document.getElementById('sbiz-period-toggle')?.addEventListener('click', e => {
    const btn = e.target.closest('.sbiz-period-btn');
    if (!btn) return;
    document.querySelectorAll('.sbiz-period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.sbizPeriod = btn.dataset.period;
    renderSbizContent();
  });
}

// ══════════════════════════════════════════════════════
//  初期化
// ══════════════════════════════════════════════════════

async function tryFetch(url) {
  try { const r = await fetch(url); return r.ok ? r.json() : null; }
  catch { return null; }
}

async function init() {
  updateClock();
  setInterval(updateClock, 60_000);

  // 日次履歴ファイルのパスを JST 基準で生成
  const _jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const _jstDate = (d) => new Date(d.getTime()).toISOString().slice(0, 10);
  const _ydDate  = new Date(_jstNow.getTime() - 86400000);
  const _wkDate  = new Date(_jstNow.getTime() - 7 * 86400000);
  const DAILY_YD = `${DAILY_HISTORY_BASE}/${_jstDate(_ydDate)}.json`;
  const DAILY_WK = `${DAILY_HISTORY_BASE}/${_jstDate(_wkDate)}.json`;

  const [snapshot, budget, actualsRaw, actualsPrevRaw, actualsMonthStartRaw, mapping, portals, hrRaw, ydRaw, wkRaw, budgetDetailBE] = await Promise.all([
    tryFetch(SNAPSHOT_FILE),
    tryFetch(BUDGET_FILE),
    tryFetch(ACTUALS_FILE),
    tryFetch(ACTUALS_PREV_FILE),
    tryFetch(ACTUALS_MONTH_START_FILE),
    tryFetch(MAPPING_FILE),
    tryFetch(PORTALS_FILE),
    tryFetch(HR_FILE),
    tryFetch(DAILY_YD),
    tryFetch(DAILY_WK),
    tryFetch(BUDGET_DETAIL_BE),
  ]);

  state.current          = snapshot;
  state.budget           = budget;
  state.budgetDetail     = budgetDetailBE;
  state.actuals          = actualsRaw?.data          ?? null;
  state.actualsPrev      = actualsPrevRaw?.data      ?? null;
  state.actualsMonthStart= actualsMonthStartRaw?.data ?? null;
  state.actualsYesterday = ydRaw?.data               ?? null;
  state.actualsLastWeek  = wkRaw?.data               ?? null;
  state.mapping     = mapping;
  state.portals     = portals;
  state.hr          = hrRaw?.data ?? null;

  if (!snapshot) {
    document.getElementById('s1-highlights').innerHTML =
      '<div class="s1-alert warning"><span class="s1-alert-badge">エラー</span><span class="s1-alert-text">データの読み込みに失敗しました</span></div>';
    return;
  }

  setText('footer-data-src', 'データ: ' + (snapshot.generated_at
    ? new Date(snapshot.generated_at).toLocaleString('ja-JP') : '—'));

  bindEvents();
  renderS1();
}

document.addEventListener('DOMContentLoaded', init);
