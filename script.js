/* BDG 経営ダッシュボード — script.js */

// ══════════════════════════════════════════════════════
//  定数
// ══════════════════════════════════════════════════════

const SNAPSHOT_FILE = 'data/dashboard_snapshots/snapshot_latest.json';
const BUDGET_FILE   = 'data/budget/budget_FY2026.json';
const ACTUALS_FILE            = 'data/actuals/actuals_latest.json';
const ACTUALS_PREV_FILE       = 'data/actuals/actuals_previous.json';
const ACTUALS_MONTH_START_FILE= 'data/actuals/actuals_month_start.json';
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
  'BLUE ESTATE': '#1A3A5C',
  'BLUE DESIGN': '#0090BA',
  'BLUE LIFE':   '#059669',
  '青天堂':      '#B45309',
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
  actuals:          null,
  actualsPrev:      null,
  actualsMonthStart: null,
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
    return u.ytd ?? u;
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
  renderS1MetricsTable();
  renderS1Highlights();
  renderS1CoCards();
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
    cells += `<td class="${valClass(groupVal, m.isExpense)}">${d(fmt(groupVal))}</td>`;

    for (const co of ALL_COMPANIES) {
      const data = coDataMap[co];
      const val  = data !== null ? getValue(data, m.id, co) : null;
      cells += `<td class="${valClass(val, m.isExpense)}">${d(fmt(val))}</td>`;
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
        lHtml += `<td class="${valClass(val, m.isExpense)}">${d(fmtYen(val))}</td>`;
      }
      trL.innerHTML = lHtml;
      tbody.appendChild(trL);

      // 対前年差行
      const trD = document.createElement('tr');
      let dHtml = `<td class="td-metric" style="padding-left:1.5em;font-size:.82em;color:#6B7280">└ 対前年差</td><td class="v-dash">—</td>`;
      for (const co of ALL_COMPANIES) {
        const lv = histMap[co].latest ? getValue(histMap[co].latest.data, m.id, co) : null;
        const pv = histMap[co].prev   ? getValue(histMap[co].prev.data,   m.id, co) : null;
        dHtml += `<td class="${diffClass(lv !== null && pv !== null ? lv - pv : null, m.isExpense)}">${d(fmtDiff(lv, pv, false))}</td>`;
      }
      trD.innerHTML = dHtml;
      tbody.appendChild(trD);
    }
  }
}

// ══════════════════════════════════════════════════════
//  S4: 利益構造分析
// ══════════════════════════════════════════════════════

const UNIT_META = {
  unit_blue_estate: { label: 'BLUE ESTATE', color: '#1A3A5C' },
  unit_blue_design: { label: 'BLUE DESIGN', color: '#0090BA' },
  unit_blue_life:   { label: 'BLUE LIFE',   color: '#059669' },
  unit_seitendo:    { label: '青天堂',       color: '#B45309' },
};

// 展開状態（ユニット切替時にリセット）
let s4Exp = { revenue: false, cogs: false, sga: true, sgaCats: {}, sgaOther: false };
function resetS4Exp() { s4Exp = { revenue: false, cogs: false, sga: true, sgaCats: {}, sgaOther: false }; }


// 円表示（完全形：1,234,567円）
function fmtFull(n) {
  if (n === null || n === undefined) return '—';
  return (n < 0 ? '▲' : '') + Math.abs(n).toLocaleString() + '円';
}

// 対売上比率（%）
function wfPct(n, rev) {
  if (!rev || rev < RATE_MIN_REVENUE || n === null) return null;
  return n / rev * 100;
}
function wfFmtPct(p) {
  if (p === null) return '—';
  return (p < 0 ? '▲' : '') + Math.abs(p).toFixed(1) + '%';
}
// バー幅（対売上比率 0–100%）
function wfBw(n, rev) {
  if (!rev || !n) return '0%';
  return Math.min(100, Math.abs(n) / Math.abs(rev) * 100).toFixed(1) + '%';
}

function renderS4() {
  renderS4InfoBar();
  renderS4Waterfall();
}

function renderS4InfoBar() {
  const el = document.getElementById('s4-info-bar');
  if (!el) return;
  if (!state.actuals) { el.textContent = '実績データ未読込'; return; }
  const u = state.actuals[state.s4Unit];
  if (!u) { el.textContent = `データなし: ${state.s4Unit}`; return; }
  const data = (state.s4Period === 'ytd' && u.ytd) ? u.ytd : u;
  const period = data.period || '';
  const [yr, mo] = period.split('-');
  const label = yr && mo ? `${yr}年${parseInt(mo)}月` : period;
  const periodLabel = state.s4Period === 'ytd' ? `年度累計 (${label})` : `対象月: ${label}`;
  el.innerHTML = `<span class="info-item"><strong>${periodLabel}</strong></span>
    <span class="info-item">ソース: ${u.source_file}</span>`;
}

function renderS4Waterfall() {
  const el = document.getElementById('s4-content');
  if (!el) return;
  if (!state.actuals) { el.innerHTML = '<div class="wf-empty">actuals_latest.json を読み込めませんでした</div>'; return; }
  const u = state.actuals[state.s4Unit];
  if (!u) { el.innerHTML = '<div class="wf-empty">このユニットのデータがありません</div>'; return; }

  const meta = UNIT_META[state.s4Unit] || { color: '#0090BA' };
  const data = (state.s4Period === 'ytd' && u.ytd) ? u.ytd : u;
  const rev  = data.revenue.total;
  const cogs = data.cogs.total;
  const sga  = data.sga.total;
  const gp   = data._summary.gross_profit;
  const op   = data._summary.op_profit;
  const ord  = data._summary.ordinary_profit;
  const noi  = data.non_op_income.total;
  const noe  = data.non_op_expense.total;
  const p    = n => wfPct(n, rev);
  const bw   = n => wfBw(n, rev);
  const sgaSorted = [...data.sga.breakdown].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const wfRow = (key, label, amount, color, isExpense, revPct) => {
    const open = s4Exp[key];
    return `<div class="wf-row${open ? ' open' : ''}">
      <div class="wf-main" data-expand="${key}">
        <button class="wf-tog">${open ? '▼' : '▶'}</button>
        <span class="wf-lbl">${label}</span>
        <div class="wf-bar-w"><div class="wf-bar" style="width:${bw(Math.abs(amount))};background:${color}"></div></div>
        <span class="wf-amt${isExpense ? ' neg' : ''}">${d(fmtYen(amount))}</span>
        <span class="wf-rate">${wfFmtPct(revPct)}</span>
      </div>`;
  };

  const wfItem = (label, amount, color, revPct) =>
    `<div class="wf-item">
      <span class="wf-item-lbl">${label}</span>
      <div class="wf-bar-w"><div class="wf-bar" style="width:${bw(amount)};background:${color}"></div></div>
      <span class="wf-item-amt">${fmtFull(amount)}</span>
      <span class="wf-item-rate">${wfFmtPct(revPct)}</span>
    </div>`;

  const wfProfit = (label, amount, revPct, muted) => {
    const cls = muted ? 'muted' : (amount >= 0 ? 'pos' : 'neg');
    const barW = Math.max(0, revPct ?? 0).toFixed(1) + '%';
    return `<div class="wf-profit ${cls}">
      <span class="wf-profit-lbl">${label}</span>
      <div class="wf-bar-w"><div class="wf-profit-bar" style="width:${barW}"></div></div>
      <span class="wf-profit-amt">${d(fmtYen(amount))}</span>
      <span class="wf-profit-rate">${wfFmtPct(revPct)}</span>
    </div>`;
  };

  let h = '<div class="wf-container">';

  // ── 売上 ──
  h += wfRow('revenue', '売上', rev, meta.color, false, 100);
  if (s4Exp.revenue) {
    h += '<div class="wf-sub">';
    for (const it of data.revenue.breakdown) {
      h += wfItem(it.item, it.amount, meta.color + '88', p(it.amount));
    }
    h += '</div>';
  }
  h += '</div>';

  // ── 売上原価 ──
  h += wfRow('cogs', '売上原価', -cogs, '#e74c3c88', true, p(cogs));
  if (s4Exp.cogs) {
    h += '<div class="wf-sub">';
    if (!data.cogs.breakdown.length) {
      h += '<div class="wf-no-items">原価内訳なし（サービス業）</div>';
    } else {
      for (const it of data.cogs.breakdown) {
        h += wfItem(it.item, it.amount, '#e74c3c88', p(it.amount));
      }
    }
    h += '</div>';
  }
  h += '</div>';

  // ══ 粗利 ══
  h += wfProfit('粗利', gp, p(gp), false);

  // ── 販管費（常時展開・勘定科目を金額順でフラット表示）──
  h += wfRow('sga', '販売費・一般管理費', -sga, '#B4530988', true, p(sga));
  if (s4Exp.sga) {
    const MAIN_N     = 8;
    const mainItems  = sgaSorted.slice(0, MAIN_N);
    const minorItems = sgaSorted.slice(MAIN_N);
    const minorTotal = minorItems.reduce((s, it) => s + it.amount, 0);

    h += '<div class="wf-sub">';
    for (const it of mainItems) {
      h += wfItem(it.item, it.amount, '#B4530988', p(it.amount));
    }
    if (minorItems.length > 0) {
      const otherOpen = !!s4Exp.sgaOther;
      h += `<div class="wf-cat${otherOpen ? ' open' : ''}">
        <div class="wf-cat-main" data-expand="sgaOther">
          <button class="wf-tog sm">${otherOpen ? '▼' : '▶'}</button>
          <span class="wf-item-lbl">その他（${minorItems.length}件）</span>
          <div class="wf-bar-w"><div class="wf-bar" style="width:${bw(minorTotal)};background:#B4530955"></div></div>
          <span class="wf-item-amt">${fmtFull(minorTotal)}</span>
          <span class="wf-item-rate">${wfFmtPct(p(minorTotal))}</span>
        </div>`;
      if (otherOpen) {
        h += '<div class="wf-sub-items">';
        for (const it of minorItems) {
          h += `<div class="wf-item indented">
            <span class="wf-item-lbl">${it.item}</span>
            <div class="wf-bar-w"><div class="wf-bar" style="width:${bw(it.amount)};background:#B4530944"></div></div>
            <span class="wf-item-amt">${fmtFull(it.amount)}</span>
            <span class="wf-item-rate">${wfFmtPct(p(it.amount))}</span>
          </div>`;
        }
        h += '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
  }
  h += '</div>';

  // ══ 営業利益 ══
  h += wfProfit('営業利益', op, p(op), false);

  // ── 営業外（コンパクト） ──
  if (noi > 0 || noe > 0) {
    h += `<div class="wf-nonop">
      ${noi > 0 ? `<span>営業外収益 <strong class="wf-pos">+${d(fmtYen(noi))}</strong></span>` : ''}
      ${noe > 0 ? `<span>営業外費用 <strong class="wf-neg">▲${d(fmtYen(noe))}</strong></span>` : ''}
    </div>`;
    h += wfProfit('経常利益', ord, p(ord), true);
  }

  h += '</div>';
  el.innerHTML = h;
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
//  S8: 費用サマリー
// ══════════════════════════════════════════════════════

function renderS8() {
  renderS8InfoBar();
  renderS8Cards();
}

function renderS8InfoBar() {
  const bar  = document.getElementById('s8-info-bar');
  if (!bar) return;
  const snap = state.current;
  if (!snap) { bar.textContent = 'データ未読込'; return; }
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
  const at = snap.generated_at
    ? new Date(snap.generated_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  if (at) html += `<span class="info-item" style="margin-left:auto">更新: ${at}</span>`;
  bar.innerHTML = html;
}

function renderS8Cards() {
  const container = document.getElementById('s8-cards');
  if (!container) return;
  container.innerHTML = '';
  const period = state.s8Period;

  for (const name of COMPANIES) {
    const co  = state.current?.companies?.[name];
    const src = period === 'ytd' ? co?.ytd    : co?.latest;
    const prSrc = period === 'monthly' ? co?.prior : null;

    const month = co?.latest_month ?? '';
    const [yr, mo] = month.split('-');
    const periodLabel = (yr && mo && !isNaN(parseInt(mo)))
      ? (period === 'ytd'
          ? `累計: ${yr}年${parseInt(mo)}月まで`
          : `最新: ${yr}年${parseInt(mo)}月`)
      : 'データなし';

    const rev = src?.revenue        ?? null;
    const gp  = src?.gross_profit   ?? null;
    const sga = src?.sga_total      ?? null;
    const op  = src?.op_profit      ?? null;

    const prRev = prSrc?.revenue        ?? null;
    const prGp  = prSrc?.gross_profit   ?? null;
    const prSga = prSrc?.sga_total      ?? null;
    const prOp  = prSrc?.op_profit      ?? null;

    // MoM バッジ（pct + 差額）
    const momTag = (cur, prev, inv = false) => {
      if (cur === null || prev === null || prev === 0) {
        return '<span class="s8-mom-pct muted" style="color:var(--sub)">—</span>';
      }
      const pct  = (cur - prev) / Math.abs(prev) * 100;
      const diff = cur - prev;
      const up   = pct >= 0;
      const cls  = inv ? (up ? 'up inv' : 'down inv') : (up ? 'up' : 'down');
      return `<span class="s8-mom-pct ${cls}">${up ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%</span>
              <span class="s8-mom-diff">${fmtDiff(cur, prev)}</span>`;
    };

    const metricRow = (lbl, val, prVal, inv = false) => {
      const negCls = val !== null && val < 0 ? ' neg' : '';
      const posCls = val !== null && val > 0 && lbl === '営業利益' ? ' pos' : '';
      return `<div class="s8-metric-row">
        <span class="s8-metric-lbl">${lbl}</span>
        <span class="s8-metric-val${negCls}${posCls}">${d(fmtYen(val))}</span>
        <div class="s8-mom">${momTag(val, prVal, inv)}</div>
      </div>`;
    };

    const card = document.createElement('div');
    card.className = 's8-card';
    card.innerHTML = `
      <div class="s8-card-hdr" style="background:${CO_COLOR[name]}">
        <div>
          <div class="s8-co-name">${name}</div>
          <div class="s8-co-segs">${CO_SEGMENTS[name] ?? ''}</div>
          <div class="s8-co-period">${periodLabel}</div>
        </div>
        <button class="s8-detail-btn" data-co="${name}">費用明細 →</button>
      </div>
      <div class="s8-card-body">
        ${metricRow('売上',     rev, prRev)}
        ${metricRow('粗利',     gp,  prGp)}
        ${metricRow('販管費',   sga, prSga, true)}
        ${metricRow('営業利益', op,  prOp)}
      </div>`;
    container.appendChild(card);
  }
}

// ── 費用明細ドロワー ──

function openCostDrawer(coName) {
  const drawer  = document.getElementById('cost-drawer');
  const body    = document.getElementById('cd-body');
  const nameEl  = document.getElementById('cd-co-name');
  const periodEl= document.getElementById('cd-period');
  const hdrEl   = document.getElementById('cd-hdr');
  if (!drawer || !body) return;

  const co     = state.current?.companies?.[coName];
  const unitId = CO_UNIT[coName];

  // 内訳は当月データを使用し、前月データ（same JSON内の previous_month）と比較
  const act      = state.actuals?.[unitId];
  const actData  = act;                        // 当月 breakdown
  const prevData = act?.previous_month ?? null; // 前月 breakdown（同一 JSON 内）

  // サマリー数値はS8の期間設定に従う
  const period = state.s8Period;
  const src    = period === 'ytd' ? co?.ytd : co?.latest;
  const prSrc  = period === 'monthly' ? co?.prior : null;

  const month = co?.latest_month ?? '';
  const [yr, mo] = month.split('-');
  const prevMonth = act?.previous_month?.period ?? null;
  const [pyr, pmo] = (prevMonth ?? '').split('-');
  const prevLabel = (pyr && pmo) ? `${pyr}年${parseInt(pmo)}月` : '前月';

  nameEl.textContent   = coName;
  periodEl.textContent = `当月内訳（前月比: ${prevLabel}）`;
  hdrEl.style.borderTopColor = CO_COLOR[coName];

  const rev = src?.revenue        ?? null;
  const gp  = src?.gross_profit   ?? null;
  const sga = src?.sga_total      ?? null;
  const op  = src?.op_profit      ?? null;
  const ord = src?.ordinary_profit ?? null;

  const prGp  = prSrc?.gross_profit   ?? null;
  const prOp  = prSrc?.op_profit      ?? null;
  const prOrd = prSrc?.ordinary_profit ?? null;

  // 前回同名科目の金額をルックアップ
  const findPrev = (prevBreakdown, itemName) =>
    prevBreakdown?.find(i => i.item === itemName)?.amount ?? null;

  const momBadge = (cur, prev, inv = false) => {
    if (cur === null || prev === null || prev === 0) return '';
    const pct  = (cur - prev) / Math.abs(prev) * 100;
    const up   = pct >= 0;
    const good = inv ? !up : up;
    return `<span class="cd-section-mom ${good ? 'var-good' : 'var-bad'}">${up ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%</span>`;
  };

  const summaryMom = (cur, prev, inv = false) => {
    if (cur === null || prev === null || prev === 0) return '';
    const pct  = (cur - prev) / Math.abs(prev) * 100;
    const up   = pct >= 0;
    const good = inv ? !up : up;
    const col  = good ? 'var(--green)' : 'var(--red)';
    return `<span class="cd-summary-mom" style="color:${col}">${up ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%</span>`;
  };

  // barItem: 科目行（前回比差分列付き）
  const barItem = (item, amount, total, color, prevAmount, inv = false) => {
    const pct  = (rev && rev >= RATE_MIN_REVENUE && amount !== null) ? (amount / rev * 100) : null;
    const barW = total && total !== 0 ? Math.min(100, Math.abs(amount) / Math.abs(total) * 100).toFixed(1) + '%' : '0%';
    let diffHtml = '<span class="cd-item-diff muted">—</span>';
    if (prevAmount !== null && prevAmount !== undefined) {
      const diff = amount - prevAmount;
      if (diff !== 0) {
        const up   = diff > 0;
        const good = inv ? !up : up;
        const cls  = good ? 'cost-good' : 'cost-bad';
        const sign = up ? '+' : '▲';
        diffHtml = `<span class="cd-item-diff ${cls}">${sign}${Math.abs(diff).toLocaleString()}</span>`;
      } else {
        diffHtml = '<span class="cd-item-diff muted">±0</span>';
      }
    }
    return `<div class="cd-item">
      <span class="cd-item-name" title="${item}">${item}</span>
      <div class="cd-bar-w"><div class="cd-bar" style="width:${barW};background:${color}"></div></div>
      <span class="cd-item-amt">${fmtFull(amount)}</span>
      <span class="cd-item-pct">${pct !== null ? pct.toFixed(1) + '%' : '—'}</span>
      ${diffHtml}
    </div>`;
  };

  let html = '';

  if (!actData) {
    html = '<p style="color:var(--sub);text-align:center;padding:40px">詳細データ未読込（actuals_latest.json）</p>';
  } else {
    const hasPrev = !!prevData;
    if (!hasPrev) {
      html += `<div class="cd-prev-note">前回データなし — 次回更新後から前回更新比が表示されます</div>`;
    }

    // 売上内訳
    const revBreak  = actData.revenue?.breakdown ?? [];
    const prevRevBk = prevData?.revenue?.breakdown;
    if (revBreak.length) {
      const ytdRev = revBreak.reduce((s, i) => s + i.amount, 0);
      const prevYtdRev = prevRevBk ? prevRevBk.reduce((s, i) => s + i.amount, 0) : null;
      const sorted = [...revBreak].sort((a, b) => b.amount - a.amount);
      html += `<div class="cd-section">
        <div class="cd-section-hdr">
          <span class="cd-section-title">売上内訳（YTD累計）</span>
          <div class="cd-section-right">
            <span class="cd-section-total">${d(fmtYen(ytdRev))}</span>
            ${momBadge(ytdRev, prevYtdRev)}
          </div>
        </div>`;
      for (const it of sorted) {
        const prev = findPrev(prevRevBk, it.item);
        html += barItem(it.item, it.amount, ytdRev, CO_COLOR[coName] + '99', prev, false);
      }
      html += '</div>';
    }

    // 販管費内訳（金額大順・費用増=赤）
    const sgaBreak  = actData.sga?.breakdown ?? [];
    const prevSgaBk = prevData?.sga?.breakdown;
    if (sgaBreak.length) {
      const ytdSga = sgaBreak.reduce((s, i) => s + i.amount, 0);
      const prevYtdSga = prevSgaBk ? prevSgaBk.reduce((s, i) => s + i.amount, 0) : null;
      const sorted = [...sgaBreak].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      html += `<div class="cd-section">
        <div class="cd-section-hdr">
          <span class="cd-section-title">販管費内訳（YTD累計）</span>
          <div class="cd-section-right">
            <span class="cd-section-total">${d(fmtYen(ytdSga))}</span>
            ${momBadge(ytdSga, prevYtdSga, true)}
          </div>
        </div>`;
      for (const it of sorted) {
        const prev = findPrev(prevSgaBk, it.item);
        html += barItem(it.item, it.amount, ytdSga, '#B4530988', prev, true);
      }
      html += '</div>';
    }

    // 売上原価内訳
    const cogsBreak  = actData.cogs?.breakdown ?? [];
    const prevCogsBk = prevData?.cogs?.breakdown;
    if (cogsBreak.length) {
      const ytdCogs = cogsBreak.reduce((s, i) => s + i.amount, 0);
      html += `<div class="cd-section">
        <div class="cd-section-hdr">
          <span class="cd-section-title">売上原価内訳（YTD累計）</span>
          <div class="cd-section-right">
            <span class="cd-section-total">${d(fmtYen(ytdCogs))}</span>
          </div>
        </div>`;
      for (const it of cogsBreak) {
        const prev = findPrev(prevCogsBk, it.item);
        html += barItem(it.item, it.amount, ytdCogs, '#e74c3c88', prev, true);
      }
      html += '</div>';
    }

    // 営業外収益
    const noiBreak  = actData.non_op_income?.breakdown ?? [];
    const prevNoiBk = prevData?.non_op_income?.breakdown;
    if (noiBreak.length) {
      const ytdNoi = noiBreak.reduce((s, i) => s + i.amount, 0);
      const prevYtdNoi = prevNoiBk ? prevNoiBk.reduce((s, i) => s + i.amount, 0) : null;
      const sorted = [...noiBreak].sort((a, b) => b.amount - a.amount);
      html += `<div class="cd-section">
        <div class="cd-section-hdr">
          <span class="cd-section-title">営業外収益内訳（YTD累計）</span>
          <div class="cd-section-right">
            <span class="cd-section-total">${d(fmtYen(ytdNoi))}</span>
            ${momBadge(ytdNoi, prevYtdNoi)}
          </div>
        </div>`;
      for (const it of sorted) {
        const prev = findPrev(prevNoiBk, it.item);
        html += barItem(it.item, it.amount, ytdNoi, '#05966999', prev, false);
      }
      html += '</div>';
    }

    // 営業外費用
    const noeBreak  = actData.non_op_expense?.breakdown ?? [];
    const prevNoeBk = prevData?.non_op_expense?.breakdown;
    if (noeBreak.length) {
      const ytdNoe = noeBreak.reduce((s, i) => s + i.amount, 0);
      const prevYtdNoe = prevNoeBk ? prevNoeBk.reduce((s, i) => s + i.amount, 0) : null;
      const sorted = [...noeBreak].sort((a, b) => b.amount - a.amount);
      html += `<div class="cd-section">
        <div class="cd-section-hdr">
          <span class="cd-section-title">営業外費用内訳（YTD累計）</span>
          <div class="cd-section-right">
            <span class="cd-section-total">${d(fmtYen(ytdNoe))}</span>
            ${momBadge(ytdNoe, prevYtdNoe, true)}
          </div>
        </div>`;
      for (const it of sorted) {
        const prev = findPrev(prevNoeBk, it.item);
        html += barItem(it.item, it.amount, ytdNoe, '#e74c3c88', prev, true);
      }
      html += '</div>';
    }

    // サマリー（S8期間設定の合計値）
    const valCls = v => v === null ? '' : v < 0 ? ' neg' : v > 0 ? ' pos' : '';
    html += `<div class="cd-summary">
      <div class="cd-summary-row">
        <span class="cd-summary-lbl">粗利（${period === 'ytd' ? 'YTD' : '当月'}）</span>
        <span>${summaryMom(gp, prGp)}</span>
        <span class="cd-summary-val${valCls(gp)}">${d(fmtYen(gp))}</span>
      </div>
      <div class="cd-summary-row">
        <span class="cd-summary-lbl">営業利益（${period === 'ytd' ? 'YTD' : '当月'}）</span>
        <span>${summaryMom(op, prOp)}</span>
        <span class="cd-summary-val${valCls(op)}">${d(fmtYen(op))}</span>
      </div>
      <div class="cd-summary-row">
        <span class="cd-summary-lbl">経常利益（${period === 'ytd' ? 'YTD' : '当月'}）</span>
        <span>${summaryMom(ord, prOrd)}</span>
        <span class="cd-summary-val${valCls(ord)}">${d(fmtYen(ord))}</span>
      </div>
    </div>`;
  }

  body.innerHTML = html;
  drawer.hidden  = false;
}

function closeCostDrawer() {
  const drawer = document.getElementById('cost-drawer');
  if (drawer) drawer.hidden = true;
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
  if (screenId === 's8') renderS8();
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

  // S4: ユニット切替
  document.querySelectorAll('#s4-unit-tabs .co-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#s4-unit-tabs .co-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.s4Unit = btn.dataset.unit;
      resetS4Exp();
      renderS4();
    });
  });

  // S4: 期間切替
  document.querySelectorAll('#s4-period-toggle .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#s4-period-toggle .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.s4Period = btn.dataset.period;
      resetS4Exp();
      renderS4();
    });
  });

  // S8: 期間切替
  document.getElementById('s8-period-toggle')?.addEventListener('click', e => {
    const btn = e.target.closest('.period-btn');
    if (!btn) return;
    state.s8Period = btn.dataset.period;
    document.querySelectorAll('#s8-period-toggle .period-btn')
      .forEach(b => b.classList.toggle('active', b === btn));
    renderS8();
  });

  // S8: 費用明細ドロワーを開く
  document.getElementById('s8-cards')?.addEventListener('click', e => {
    const btn = e.target.closest('.s8-detail-btn');
    if (!btn) return;
    openCostDrawer(btn.dataset.co);
  });

  // ドロワーを閉じる
  document.getElementById('cd-close')?.addEventListener('click', closeCostDrawer);
  document.getElementById('cd-overlay')?.addEventListener('click', closeCostDrawer);

  // S4: ウォーターフォール展開/折畳み（イベント委譲）
  document.getElementById('screen-s4')?.addEventListener('click', e => {
    const target = e.target.closest('.wf-main[data-expand], .wf-cat-main[data-expand]');
    if (!target?.dataset?.expand) return;
    const key = target.dataset.expand;
    s4Exp[key] = !s4Exp[key];
    renderS4Waterfall();
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

  const [snapshot, budget, actualsRaw, actualsPrevRaw, actualsMonthStartRaw, mapping, portals, hrRaw] = await Promise.all([
    tryFetch(SNAPSHOT_FILE),
    tryFetch(BUDGET_FILE),
    tryFetch(ACTUALS_FILE),
    tryFetch(ACTUALS_PREV_FILE),
    tryFetch(ACTUALS_MONTH_START_FILE),
    tryFetch(MAPPING_FILE),
    tryFetch(PORTALS_FILE),
    tryFetch(HR_FILE),
  ]);

  state.current          = snapshot;
  state.budget           = budget;
  state.actuals          = actualsRaw?.data          ?? null;
  state.actualsPrev      = actualsPrevRaw?.data      ?? null;
  state.actualsMonthStart= actualsMonthStartRaw?.data ?? null;
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
