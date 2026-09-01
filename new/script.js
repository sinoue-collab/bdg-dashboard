const COLORS = {
  'BLUE ESTATE': '#0d2957',
  'BLUE DESIGN': '#2f7fd1',
  'BLUE LIFE':   '#1c8a53',
  '青天堂':      '#b25b1e',
  accent: '#0090BA',
  sell: '#1a56db',
  rent_brokerage: '#0891b2',
  rent_mgmt: '#059669',
  sga: '#7c3aed',
};

const UNIT_KEYS = ['unit_blue_estate', 'unit_blue_design', 'unit_blue_life', 'unit_seitendo'];
const UNIT_NAMES = {
  unit_blue_estate: 'BLUE ESTATE',
  unit_blue_design: 'BLUE DESIGN',
  unit_blue_life:   'BLUE LIFE',
  unit_seitendo:    '青天堂',
};

let appData = {};
let currentScreen = 's-top';
let bizPeriod = 'month';
let selectedBizLine = null;

function fmtYen(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '▲' : '';
  if (abs >= 10_000) return sign + Math.floor(abs / 10_000).toLocaleString() + '万円';
  return sign + abs.toLocaleString() + '円';
}

function fmtPct(n) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function fmtDiffPct(a, b) {
  if (!b) return '—';
  return fmtPct(((a - b) / Math.abs(b)) * 100);
}

function getConfirmed(unitData) {
  if (unitData && unitData.revenue && unitData.revenue.total > 0) {
    return { data: unitData, period: unitData.period };
  }
  return { data: unitData?.previous_month, period: unitData?.previous_month?.period };
}

async function loadHistory(date) {
  const d = date.toISOString().slice(0, 10);
  try {
    const r = await fetch(`../data/actuals/daily_history/${d}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function buildBizMap(budgetDetail) {
  const map = {};
  for (const [section, items] of Object.entries(budgetDetail.categories)) {
    if (section === '販売管理費') continue;
    for (const [name, val] of Object.entries(items)) {
      if (val.business_line) map[name] = val.business_line;
    }
  }
  return map;
}

async function loadAllData() {
  const [actualsRes, budgetRes, budgetDetailRes, snapshotRes] = await Promise.all([
    fetch('../data/actuals/actuals_latest.json').catch(() => null),
    fetch('../data/budget/budget_FY2026.json').catch(() => null),
    fetch('../data/budget/budget_detail_BLUE_ESTATE.json').catch(() => null),
    fetch('../data/dashboard_snapshots/snapshot_latest.json').catch(() => null),
  ]);

  const actuals     = actualsRes?.ok     ? await actualsRes.json()     : null;
  const budget      = budgetRes?.ok      ? await budgetRes.json()      : null;
  const budgetDetail= budgetDetailRes?.ok? await budgetDetailRes.json(): null;
  const snapshot    = snapshotRes?.ok    ? await snapshotRes.json()    : null;

  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const lastWeek  = new Date(today); lastWeek.setDate(today.getDate() - 7);

  const [todayHist, yesterdayHist, lastWeekHist] = await Promise.all([
    loadHistory(today),
    loadHistory(yesterday),
    loadHistory(lastWeek),
  ]);

  appData = { actuals, budget, budgetDetail, snapshot, todayHist, yesterdayHist, lastWeekHist };
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) screen.classList.add('active');
  const btn = document.querySelector(`[data-screen="${id}"]`);
  if (btn) btn.classList.add('active');
  currentScreen = id;

  if (id === 's-top')    renderTop();
  if (id === 's-biz')    renderBiz();
  if (id === 's-budget') renderBudget();
  if (id === 's-goals')  renderGoals();
  if (id === 's-trend')  renderTrend();
}

// ─────────────────────────────────────────────
// 画面1: 経営TOP
// ─────────────────────────────────────────────
function renderTop() {
  const el = document.getElementById('s-top');
  if (!el) return;

  const { actuals, todayHist, yesterdayHist, lastWeekHist } = appData;

  if (!actuals) {
    el.innerHTML = '<p class="error-msg">データ読み込みエラー</p>';
    return;
  }

  const data = actuals.data;

  // Group YTD totals
  let ytdRev = 0, ytdOp = 0, ytdOrdinary = 0;
  for (const key of UNIT_KEYS) {
    const u = data[key];
    if (!u?.ytd) continue;
    ytdRev      += u.ytd.revenue?._total ?? u.ytd.revenue?.total ?? 0;
    ytdOp       += u.ytd._summary?.op_profit ?? 0;
    ytdOrdinary += u.ytd._summary?.ordinary_profit ?? 0;
  }

  // Hero KPI row
  const heroHtml = `
    <div class="hero-kpis">
      <div class="hero-kpi">
        <div class="hero-kpi-label">グループYTD売上</div>
        <div class="hero-kpi-value">${fmtYen(ytdRev)}</div>
      </div>
      <div class="hero-kpi">
        <div class="hero-kpi-label">グループYTD営業利益</div>
        <div class="hero-kpi-value ${ytdOp < 0 ? 'negative' : ''}">${fmtYen(ytdOp)}</div>
      </div>
      <div class="hero-kpi">
        <div class="hero-kpi-label">グループYTD経常利益</div>
        <div class="hero-kpi-value ${ytdOrdinary < 0 ? 'negative' : ''}">${fmtYen(ytdOrdinary)}</div>
      </div>
    </div>
  `;

  // Company cards
  const cardHtml = UNIT_KEYS.map(key => {
    const unit = data[key];
    const name = UNIT_NAMES[key];
    const color = COLORS[name] || COLORS.accent;
    const confirmed = getConfirmed(unit);
    const cd = confirmed.data;
    const period = confirmed.period ?? '—';

    const rev = cd?.revenue?.total ?? 0;
    const gp  = cd?._summary?.gross_profit ?? 0;
    const op  = cd?._summary?.op_profit ?? 0;
    const prevRev = unit?.previous_month?.revenue?.total ?? 0;

    const mom = (cd === unit?.previous_month)
      ? '—'
      : (prevRev ? fmtDiffPct(rev, prevRev) : '—');

    // day-over-day / week-over-week from daily_history
    const getUnitRev = (hist) => {
      if (!hist?.data) return null;
      const u = hist.data[key];
      return u?.revenue?.total ?? null;
    };
    const todayRev    = getUnitRev(todayHist);
    const yesterdayRev= getUnitRev(yesterdayHist);
    const lastWeekRev = getUnitRev(lastWeekHist);

    const dod = (todayRev != null && yesterdayRev != null) ? fmtDiffPct(todayRev, yesterdayRev) : '—';
    const wow = (todayRev != null && lastWeekRev != null)  ? fmtDiffPct(todayRev, lastWeekRev)  : '—';

    return `
      <div class="company-card" style="border-top: 4px solid ${color}">
        <div class="company-card-header">
          <span class="company-name" style="color:${color}">${name}</span>
          <span class="company-period">${period}</span>
        </div>
        <div class="company-metrics">
          <div class="metric"><span class="metric-label">売上</span><span class="metric-value">${fmtYen(rev)}</span></div>
          <div class="metric"><span class="metric-label">粗利</span><span class="metric-value">${fmtYen(gp)}</span></div>
          <div class="metric"><span class="metric-label">営業利益</span><span class="metric-value ${op < 0 ? 'negative' : ''}">${fmtYen(op)}</span></div>
        </div>
        <div class="company-diffs">
          <div class="diff-item"><span class="diff-label">前月比</span><span class="diff-value">${mom}</span></div>
          <div class="diff-item"><span class="diff-label">前週比</span><span class="diff-value">${wow}</span></div>
          <div class="diff-item"><span class="diff-label">前日比</span><span class="diff-value">${dod}</span></div>
        </div>
      </div>
    `;
  }).join('');

  const goalsHtml = `
    <div class="goals-placeholder">
      <div class="goals-placeholder-title">経営目標（すごい会議）連携準備中</div>
      <div class="goals-placeholder-body">データ連携未定</div>
    </div>
  `;

  el.innerHTML = heroHtml + `<div class="company-cards">${cardHtml}</div>` + goalsHtml;
}

// ─────────────────────────────────────────────
// 画面2: 事業構造マップ
// ─────────────────────────────────────────────
function renderBiz() {
  const el = document.getElementById('s-biz');
  if (!el) return;

  const { actuals, budgetDetail } = appData;

  if (!actuals || !budgetDetail) {
    el.innerHTML = '<p class="error-msg">データ読み込みエラー</p>';
    return;
  }

  const companiesHtml = `
    <div class="biz-tabs">
      <button class="biz-tab active" data-company="BLUE ESTATE">BLUE ESTATE</button>
      <button class="biz-tab disabled" disabled>BLUE DESIGN<span class="badge-wip">準備中</span></button>
      <button class="biz-tab disabled" disabled>BLUE LIFE<span class="badge-wip">準備中</span></button>
      <button class="biz-tab disabled" disabled>青天堂<span class="badge-wip">準備中</span></button>
    </div>
    <div class="biz-note">事業ラインの区分は暫定的な分類です（freeeセグメント運用の検討中）</div>
  `;

  el.innerHTML = companiesHtml + `
    <div class="biz-period-selector">
      <button class="period-btn ${bizPeriod === 'month' ? 'active' : ''}" data-period="month">直近確定月</button>
      <button class="period-btn ${bizPeriod === 'ytd'   ? 'active' : ''}" data-period="ytd">年度累計</button>
    </div>
    <div id="biz-content"></div>
  `;

  el.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      bizPeriod = btn.dataset.period;
      el.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderBizContent();
    });
  });

  renderBizContent();
}

function renderBizContent() {
  const el = document.getElementById('biz-content');
  if (!el) return;

  const { actuals, budgetDetail } = appData;
  const unit = actuals.data.unit_blue_estate;
  const bizMap = buildBizMap(budgetDetail);

  const isYtd = bizPeriod === 'ytd';
  const confirmed = getConfirmed(unit);
  const targetData = isYtd ? unit.ytd : confirmed.data;

  if (!targetData) {
    el.innerHTML = '<p class="error-msg">データがありません</p>';
    return;
  }

  // Build biz line breakdown from revenue
  const lines = { '売買': { rev: [], cogs: [] }, '賃貸仲介': { rev: [], cogs: [] }, '賃貸管理': { rev: [], cogs: [] } };

  for (const item of (targetData.revenue?.breakdown ?? [])) {
    const line = bizMap[item.item];
    if (line && lines[line]) {
      lines[line].rev.push(item);
    }
  }
  for (const item of (targetData.cogs?.breakdown ?? [])) {
    const line = bizMap[item.item];
    if (line && lines[line]) {
      lines[line].cogs.push(item);
    } else {
      // fallback: assign cogs by item name matching
      for (const l of Object.keys(lines)) {
        if (item.item.includes(l === '売買' ? '売買' : l === '賃貸仲介' ? '賃貸仲介' : '賃貸管理')) {
          lines[l].cogs.push(item);
          break;
        }
      }
    }
  }

  const sgaTotal = targetData.sga?.total ?? 0;
  const sgaBreakdown = targetData.sga?.breakdown ?? [];

  const lineColors = { '売買': COLORS.sell, '賃貸仲介': COLORS.rent_brokerage, '賃貸管理': COLORS.rent_mgmt };

  // Left panel tiles
  const tilesHtml = Object.entries(lines).map(([lineName, lineData]) => {
    const rev  = lineData.rev.reduce((s, i) => s + i.amount, 0);
    const cogs = lineData.cogs.reduce((s, i) => s + i.amount, 0);
    const gp   = rev - cogs;
    const gpRate = rev ? ((gp / rev) * 100).toFixed(1) : '—';
    const color = lineColors[lineName];
    const isSelected = selectedBizLine === lineName;
    return `
      <div class="biz-tile ${isSelected ? 'selected' : ''}" data-line="${lineName}" style="border-left: 4px solid ${color}">
        <div class="biz-tile-name" style="color:${color}">${lineName}</div>
        <div class="biz-tile-row"><span>売上</span><span>${fmtYen(rev)}</span></div>
        <div class="biz-tile-row"><span>粗利</span><span>${fmtYen(gp)}</span></div>
        <div class="biz-tile-row"><span>粗利率</span><span>${rev ? gpRate + '%' : '—'}</span></div>
      </div>
    `;
  }).join('');

  const sgaTileSelected = selectedBizLine === 'sga';
  const sgaTileHtml = `
    <div class="biz-tile ${sgaTileSelected ? 'selected' : ''}" data-line="sga" style="border-left: 4px solid ${COLORS.sga}">
      <div class="biz-tile-name" style="color:${COLORS.sga}">共通経費（販管費）</div>
      <div class="biz-tile-row"><span>販管費合計</span><span>${fmtYen(sgaTotal)}</span></div>
      <div class="biz-tile-note">事業ライン配分なし</div>
    </div>
  `;

  el.innerHTML = `
    <div class="biz-layout">
      <div class="biz-left">
        ${tilesHtml}
        ${sgaTileHtml}
      </div>
      <div class="biz-right" id="biz-detail">
        ${selectedBizLine ? renderBizDetail(selectedBizLine, lines, sgaBreakdown) : '<p class="biz-hint">左の事業ラインをクリックしてください</p>'}
      </div>
    </div>
  `;

  el.querySelectorAll('.biz-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      selectedBizLine = tile.dataset.line;
      renderBizContent();
    });
  });

  // accordion handlers
  el.querySelectorAll('.acc-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const body = trigger.nextElementSibling;
      if (body) body.classList.toggle('open');
      trigger.classList.toggle('open');
    });
  });
}

function renderBizDetail(lineName, lines, sgaBreakdown) {
  if (lineName === 'sga') {
    const rows = sgaBreakdown.map(item => `
      <tr class="acc-trigger">
        <td class="acc-td">${item.item}</td>
        <td class="td-right">${fmtYen(item.amount)}</td>
        <td></td>
      </tr>
      ${item.by_item ? `<tr class="acc-body"><td colspan="3"><ul class="by-item-list">${item.by_item.map(b => `<li><span>${b.name}</span><span>${fmtYen(b.amount)}</span></li>`).join('')}</ul></td></tr>` : ''}
    `).join('');
    return `
      <div class="biz-detail-title" style="color:${COLORS.sga}">共通経費（販管費）詳細</div>
      <table class="detail-table">
        <thead><tr><th>科目</th><th class="td-right">金額</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  const lineData = lines[lineName];
  if (!lineData) return '';
  const color = { '売買': COLORS.sell, '賃貸仲介': COLORS.rent_brokerage, '賃貸管理': COLORS.rent_mgmt }[lineName];

  const revRows = lineData.rev.map(item => `
    <tr class="acc-trigger">
      <td class="acc-td">${item.item}</td>
      <td class="td-right">${fmtYen(item.amount)}</td>
      <td class="acc-icon">▶</td>
    </tr>
    ${item.by_item ? `<tr class="acc-body"><td colspan="3"><ul class="by-item-list">${item.by_item.map(b => `<li><span>${b.name}</span><span>${fmtYen(b.amount)}</span></li>`).join('')}</ul></td></tr>` : ''}
  `).join('');

  const cogsRows = lineData.cogs.map(item => `
    <tr class="acc-trigger">
      <td class="acc-td">${item.item}</td>
      <td class="td-right">${fmtYen(item.amount)}</td>
      <td class="acc-icon">▶</td>
    </tr>
    ${item.by_item ? `<tr class="acc-body"><td colspan="3"><ul class="by-item-list">${item.by_item.map(b => `<li><span>${b.name}</span><span>${fmtYen(b.amount)}</span></li>`).join('')}</ul></td></tr>` : ''}
  `).join('');

  const rev  = lineData.rev.reduce((s, i) => s + i.amount, 0);
  const cogs = lineData.cogs.reduce((s, i) => s + i.amount, 0);
  const gp   = rev - cogs;

  return `
    <div class="biz-detail-title" style="color:${color}">${lineName} 詳細</div>
    <div class="detail-section-title">売上内訳</div>
    <table class="detail-table">
      <thead><tr><th>科目</th><th class="td-right">金額</th><th></th></tr></thead>
      <tbody>${revRows}</tbody>
      <tfoot><tr class="total-row"><td>売上合計</td><td class="td-right">${fmtYen(rev)}</td><td></td></tr></tfoot>
    </table>
    ${lineData.cogs.length > 0 ? `
    <div class="detail-section-title">原価内訳</div>
    <table class="detail-table">
      <thead><tr><th>科目</th><th class="td-right">金額</th><th></th></tr></thead>
      <tbody>${cogsRows}</tbody>
      <tfoot><tr class="total-row"><td>原価合計</td><td class="td-right">${fmtYen(cogs)}</td><td></td></tr></tfoot>
    </table>
    ` : ''}
    <div class="gp-summary">粗利 = ${fmtYen(rev)} - ${fmtYen(cogs)} = <strong>${fmtYen(gp)}</strong></div>
  `;
}

// ─────────────────────────────────────────────
// 画面3: 予実管理
// ─────────────────────────────────────────────
function renderBudget() {
  const el = document.getElementById('s-budget');
  if (!el) return;

  const { actuals, budgetDetail } = appData;

  if (!actuals || !budgetDetail) {
    el.innerHTML = '<p class="error-msg">データ読み込みエラー</p>';
    return;
  }

  const unit = actuals.data.unit_blue_estate;
  const confirmed = getConfirmed(unit);
  const actualData = confirmed.data;
  const targetMonth = confirmed.period;

  const sections = [
    { key: '売上高',   dataKey: 'revenue', label: '売上高' },
    { key: '売上原価', dataKey: 'cogs',    label: '売上原価' },
    { key: '販売管理費', dataKey: 'sga',   label: '販管費' },
  ];

  let sectionsHtml = '';
  for (const section of sections) {
    const cats = budgetDetail.categories[section.key];
    if (!cats) continue;

    const actualBreakdown = actualData?.[section.dataKey]?.breakdown ?? [];
    const getActual = (name) => {
      const found = actualBreakdown.find(b => b.item === name);
      return found?.amount ?? 0;
    };

    const rows = Object.entries(cats).map(([acctName, acctVal]) => {
      const budgetAmt = acctVal.monthly_budget?.[targetMonth] ?? null;
      const actualAmt = getActual(acctName);
      const diff = budgetAmt != null ? budgetAmt - actualAmt : null;
      const rate = (budgetAmt && actualAmt) ? ((actualAmt / budgetAmt) * 100).toFixed(1) : '—';

      // by_item from actual
      const actualItem = actualBreakdown.find(b => b.item === acctName);
      const byItems = actualItem?.by_item ?? [];

      const byItemsHtml = byItems.length > 0 ? `
        <tr class="acc-body">
          <td colspan="5">
            <ul class="by-item-list">
              ${byItems.map(b => `<li><span>${b.name}</span><span>${fmtYen(b.amount)}</span></li>`).join('')}
            </ul>
          </td>
        </tr>
      ` : '';

      return `
        <tr class="acc-trigger budget-row">
          <td class="acc-td">${acctName}</td>
          <td class="td-right">${budgetAmt != null ? fmtYen(budgetAmt) : '—'}</td>
          <td class="td-right">${fmtYen(actualAmt || null)}</td>
          <td class="td-right ${diff != null && diff < 0 ? 'negative' : ''}">${diff != null ? fmtYen(diff) : '—'}</td>
          <td class="td-right">${rate !== '—' ? rate + '%' : '—'}</td>
          ${byItems.length > 0 ? '<td class="acc-icon">▶</td>' : '<td></td>'}
        </tr>
        ${byItemsHtml}
      `;
    }).join('');

    // Section total
    const budgetTotal = Object.values(cats).reduce((s, v) => s + (v.monthly_budget?.[targetMonth] ?? 0), 0);
    const actualTotal = actualData?.[section.dataKey]?.total ?? 0;
    const totalDiff = budgetTotal - actualTotal;

    sectionsHtml += `
      <div class="budget-section">
        <div class="budget-section-title">${section.label}</div>
        <table class="detail-table budget-table">
          <thead>
            <tr>
              <th>科目</th>
              <th class="td-right">予算</th>
              <th class="td-right">実績</th>
              <th class="td-right">差額</th>
              <th class="td-right">達成率</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="total-row">
              <td>${section.label}合計</td>
              <td class="td-right">${fmtYen(budgetTotal)}</td>
              <td class="td-right">${fmtYen(actualTotal)}</td>
              <td class="td-right ${totalDiff < 0 ? 'negative' : ''}">${fmtYen(totalDiff)}</td>
              <td></td><td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="budget-tabs">
      <button class="biz-tab active">BLUE ESTATE</button>
      <button class="biz-tab disabled" disabled>BLUE DESIGN<span class="badge-wip">準備中</span></button>
      <button class="biz-tab disabled" disabled>BLUE LIFE<span class="badge-wip">準備中</span></button>
      <button class="biz-tab disabled" disabled>青天堂<span class="badge-wip">準備中</span></button>
    </div>
    <div class="budget-header">
      <span class="budget-period-label">対象月: ${targetMonth}</span>
    </div>
    ${sectionsHtml}
  `;

  el.querySelectorAll('.acc-trigger.budget-row').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const body = trigger.nextElementSibling;
      if (body && body.classList.contains('acc-body')) {
        body.classList.toggle('open');
        const icon = trigger.querySelector('.acc-icon');
        if (icon) icon.textContent = body.classList.contains('open') ? '▼' : '▶';
      }
    });
  });
}

// ─────────────────────────────────────────────
// 画面4: 経営目標
// ─────────────────────────────────────────────
function renderGoals() {
  const el = document.getElementById('s-goals');
  if (!el) return;

  el.innerHTML = `
    <div class="goals-screen">
      <div class="goals-screen-title">経営目標</div>
      <div class="goals-sample-badge">サンプル表示</div>
      <div class="goals-cards grayed-out">
        <div class="goals-card">
          <div class="goals-card-label">営業利益目標</div>
          <div class="goals-card-target">1.5億円</div>
          <div class="goals-card-row"><span>現在地</span><span class="goals-unlinked">未連携</span></div>
          <div class="goals-card-row"><span>達成率</span><span>—</span></div>
        </div>
        <div class="goals-card">
          <div class="goals-card-label">1人当たり付加価値</div>
          <div class="goals-card-target">2,500万円</div>
          <div class="goals-card-row"><span>現在地</span><span class="goals-unlinked">未連携</span></div>
        </div>
        <div class="goals-card">
          <div class="goals-card-label">1時間当たり付加価値</div>
          <div class="goals-card-target">10,000円</div>
          <div class="goals-card-row"><span>現在地</span><span class="goals-unlinked">未連携</span></div>
        </div>
      </div>
      <div class="goals-note">「すごい会議」との連携設計が確定次第、実データに切り替わります。</div>
    </div>
  `;
}

// ─────────────────────────────────────────────
// 画面5: 年度比較
// ─────────────────────────────────────────────
function renderTrend() {
  const el = document.getElementById('s-trend');
  if (!el) return;

  const { snapshot } = appData;
  const history = snapshot?.history;

  let historyHtml = '';
  if (history && Array.isArray(history) && history.length > 0) {
    const rows = history.map(h => `
      <tr>
        <td>${h.period ?? '—'}</td>
        <td class="td-right">${fmtYen(h.revenue ?? null)}</td>
        <td class="td-right">${fmtYen(h.op_profit ?? null)}</td>
        <td class="td-right">${fmtYen(h.ordinary_profit ?? null)}</td>
      </tr>
    `).join('');
    historyHtml = `
      <div class="trend-sample-badge">サンプル表示</div>
      <div class="grayed-out">
        <table class="detail-table">
          <thead><tr><th>期間</th><th class="td-right">売上</th><th class="td-right">営業利益</th><th class="td-right">経常利益</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="trend-screen">
      <div class="trend-title">年度比較</div>
      <div class="trend-placeholder">前年度データ取得方法の整備後に実装予定</div>
      ${historyHtml}
    </div>
  `;
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
async function init() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });

  try {
    await loadAllData();
  } catch (e) {
    console.error('Data load failed:', e);
  }

  showScreen('s-top');
}

document.addEventListener('DOMContentLoaded', init);
