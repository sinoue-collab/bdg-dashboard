const COLORS = {
  'BLUE ESTATE': '#0c2b4d',
  'BLUE DESIGN': '#1f6fb2',
  'BLUE LIFE':   '#1f8a76',
  '青天堂':      '#a8632a',
  accent: '#009ee1',
  sell: '#1f6fb2',
  rent_brokerage: '#009ee1',
  rent_mgmt: '#1f8a76',
  wash_blue: '#0284c7',
  blue_hotels: '#6d28d9',
  sga: '#55708c',
};

// WASH BLUE・BLUE HOTELS は freee 上は営業外収益だが管理会計上は事業売上として集計
const NON_OP_BIZ_LINES = {
  income:  { 'WASH BLUE売上': 'WASH BLUE', 'BLUE HOTELS 売上': 'BLUE HOTELS' },
  expense: { 'WASH BLUE経費': 'WASH BLUE', 'BLUE HOTELS 経費': 'BLUE HOTELS' },
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
let budgetPeriod = 'month';
let selectedBizLine = null;
let selectedBizCompany = 'BLUE ESTATE';
let selectedBudgetCompany = 'BLUE ESTATE';

function fmtYen(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '▲' : '';
  return sign + Math.round(abs).toLocaleString() + '円';
}

function fmtPct(n) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function fmtDiffPct(a, b) {
  if (!b) return '—';
  return fmtPct(((a - b) / Math.abs(b)) * 100);
}

// 対象月の翌月25日を過ぎていれば「確定」、それ以前は「速報」
function getDataStatus(period) {
  if (!period) return null;
  const [year, month] = period.split('-').map(Number);
  const cutoff = new Date(year, month, 25); // monthは0-indexed → month番目 = 翌月25日
  return new Date() >= cutoff ? '確定' : '速報';
}
function statusBadge(period) {
  const s = getDataStatus(period);
  if (!s) return '';
  return `<span class="badge-${s === '確定' ? 'kakutei' : 'sokuho'}">${s}</span>`;
}

function getConfirmed(unitData) {
  const curRev = unitData?.revenue?.total ?? 0;
  const prvRev = unitData?.previous_month?.revenue?.total ?? 0;
  // 前月の10%以上売上がある場合のみ現在月を「確定月」とみなす
  // （月初1〜2日で少額だけ入力されたケースを除外するため）
  if (curRev > 0 && (prvRev === 0 || curRev >= prvRev * 0.1)) {
    return { data: unitData, period: unitData.period };
  }
  return { data: unitData?.previous_month, period: unitData?.previous_month?.period };
}

async function loadHistory(date) {
  const d = date.toISOString().slice(0, 10);
  try {
    const r = await fetch(`data/actuals/daily_history/${d}.json`);
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
    fetch('data/actuals/actuals_latest.json').catch(() => null),
    fetch('data/budget/budget_FY2026.json').catch(() => null),
    fetch('data/budget/budget_detail_BLUE_ESTATE.json').catch(() => null),
    fetch('data/dashboard_snapshots/snapshot_latest.json').catch(() => null),
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
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) screen.classList.add('active');
  const btn = document.querySelector(`[data-screen="${id}"]`);
  if (btn) btn.classList.add('active');
  currentScreen = id;

  if (id === 's-top')    renderTop();
  if (id === 's-biz')    renderBiz();
  if (id === 's-budget') renderBudget();
  if (id === 's-cash')   renderCash();
  if (id === 's-goals')  renderGoals();
  if (id === 's-trend')  renderTrend();
}

// ─────────────────────────────────────────────
// データ品質アラート（フェーズ1: freee内データのみ）
// ─────────────────────────────────────────────
const GP_RANGE_ALERTS = {
  unit_blue_design: { min: 0.10, max: 0.40 },
  unit_seitendo:    { min: 0.50, max: 0.75 },
  // BLUE ESTATE・BLUE LIFE は事業ライン混在のため対象外
};

// R1（原価未計上の疑い）の除外会社
// 介護報酬請求モデル等、構造的に売上原価が発生しない業態はここに追加する
const R1_EXCLUDE_KEYS = ['unit_blue_life'];

function computeDataQualityAlerts(actuals) {
  const alerts = [];
  const now = new Date();
  const nowYM = now.getFullYear() * 12 + (now.getMonth() + 1);

  for (const key of UNIT_KEYS) {
    const unit = actuals.data[key];
    const name = UNIT_NAMES[key];
    const confirmed = getConfirmed(unit);
    const cd = confirmed.data;
    const period = confirmed.period;
    if (!cd) continue;

    const rev  = cd.revenue?.total ?? 0;
    const cogs = cd.cogs?.total ?? 0;
    const gp   = cd._summary?.gross_profit ?? 0;
    const gpr  = rev > 0 ? gp / rev : null;

    // ルール1: 原価未計上の疑い（構造的に原価が発生しない業態は除外）
    if (!R1_EXCLUDE_KEYS.includes(key) && rev > 0 && cogs === 0) {
      alerts.push({ company: name, rule: 'cogs_missing', severity: 'warning',
        message: `${name}（${period}）：売上 ${fmtYen(rev)} に対して原価が0円です。原価が未計上の可能性があります。` });
    }

    // ルール2: 赤字原価（重度）
    if (gp < 0) {
      alerts.push({ company: name, rule: 'negative_gp', severity: 'critical',
        message: `${name}（${period}）：粗利がマイナス（${fmtYen(gp)}）です。原価が売上を超えています。` });
    }

    // ルール3: 原価計上漏れの疑い（ルール1と排他）
    if (cogs > 0 && gpr !== null && gpr > 0.95) {
      alerts.push({ company: name, rule: 'cogs_underreported', severity: 'warning',
        message: `${name}（${period}）：粗利率が${(gpr * 100).toFixed(1)}%と異常に高い値です。原価の計上漏れの可能性があります。` });
    }

    // ルール4: 会社別粗利率レンジ外れ（対象会社のみ）
    const range = GP_RANGE_ALERTS[key];
    if (range && rev > 0 && gpr !== null && (gpr < range.min || gpr > range.max)) {
      const pct      = (gpr * 100).toFixed(1);
      const rangeStr = `${(range.min * 100).toFixed(0)}%〜${(range.max * 100).toFixed(0)}%`;
      alerts.push({ company: name, rule: 'gp_out_of_range', severity: 'warning',
        message: `${name}（${period}）：粗利率${pct}%が想定レンジ（${rangeStr}）を外れています。` });
    }

    // ルール5: freee同期停止の疑い（生の最新同期月が2ヶ月以上前）
    // confirmed.period ではなく unit.period（フォールバック前の実際の同期月）を使う。
    // confirmed.period は月初の確定月ロジックで前月にフォールバックするため誤検知しやすい。
    const rawPeriod = unit?.period;
    if (rawPeriod) {
      const [rpy, rpm] = rawPeriod.split('-').map(Number);
      if (nowYM - (rpy * 12 + rpm) >= 2) {
        alerts.push({ company: name, rule: 'sync_stale', severity: 'warning',
          message: `${name}：freeeの最新データ（${rawPeriod}）が2ヶ月以上前のままです。同期が停止している可能性があります。` });
      }
    }
  }

  return alerts;
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

    const ytd    = unit?.ytd;
    const ytdRev = ytd?.revenue?._total ?? ytd?.revenue?.total ?? 0;
    const ytdGp  = ytd?._summary?.gross_profit ?? 0;
    const ytdOp  = ytd?._summary?.op_profit ?? 0;
    const ytdPeriod = ytd?.period ?? '—';

    return `
      <div class="company-card">
        <div class="company-card-header" style="background:${color}">
          <div class="company-name">${name}</div>
          <div class="company-period">${period}${statusBadge(period)}</div>
        </div>
        <div class="company-card-body">
          <div class="company-section-label">直近確定月</div>
          <div class="company-metrics">
            <div class="metric"><span class="metric-label">売上</span><span class="metric-value">${fmtYen(rev)}</span></div>
            <div class="metric"><span class="metric-label">粗利</span><span class="metric-value">${fmtYen(gp)}</span></div>
            <div class="metric"><span class="metric-label">営業利益</span><span class="metric-value ${op < 0 ? 'negative' : ''}">${fmtYen(op)}</span></div>
          </div>
          <div class="company-section-label" style="margin-top:10px">年度累計（${ytdPeriod}）</div>
          <div class="company-metrics">
            <div class="metric"><span class="metric-label">売上</span><span class="metric-value">${fmtYen(ytdRev)}</span></div>
            <div class="metric"><span class="metric-label">粗利</span><span class="metric-value">${fmtYen(ytdGp)}</span></div>
            <div class="metric"><span class="metric-label">営業利益</span><span class="metric-value ${ytdOp < 0 ? 'negative' : ''}">${fmtYen(ytdOp)}</span></div>
          </div>
          <div class="company-diffs">
            <div class="diff-item"><span class="diff-label">前月比</span><span class="diff-value">${mom}</span></div>
            <div class="diff-item"><span class="diff-label">前週比</span><span class="diff-value">${wow}</span></div>
            <div class="diff-item"><span class="diff-label">前日比</span><span class="diff-value">${dod}</span></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const navCardsHtml = `
    <div class="nav-section-label">くわしく見る</div>
    <div class="nav-cards">
      <div class="nav-card" data-nav="s-biz">
        <div class="nav-card-icon">🏗️</div>
        <div class="nav-card-title">事業構造マップ</div>
        <div class="nav-card-sub">事業ライン別の売上・粗利</div>
      </div>
      <div class="nav-card" data-nav="s-budget">
        <div class="nav-card-icon">📊</div>
        <div class="nav-card-title">予実管理</div>
        <div class="nav-card-sub">予算vs実績・品目ドリルダウン</div>
      </div>
      <div class="nav-card" data-nav="s-cash">
        <div class="nav-card-icon">🏦</div>
        <div class="nav-card-title">CASH</div>
        <div class="nav-card-sub">預金残高・口座別内訳</div>
      </div>
      <div class="nav-card disabled" data-nav="s-goals">
        <div class="nav-card-icon">🎯</div>
        <div class="nav-card-title">経営目標</div>
        <div class="nav-card-sub">すごい会議連携準備中</div>
      </div>
    </div>
  `;

  const alerts = computeDataQualityAlerts(actuals);
  const alertHtml = alerts.length > 0
    ? `<div class="alert-section">
        <div class="alert-section-label">データ品質アラート（${alerts.length}件）</div>
        <div class="alert-list">
          ${alerts.map(a => `
            <div class="alert-item ${a.severity}">
              <span class="alert-icon">${a.severity === 'critical' ? '🔴' : '⚠️'}</span>
              <span>${a.message}</span>
            </div>`).join('')}
        </div>
      </div>`
    : `<div class="alert-section"><span class="alert-ok">✓ データ品質アラートなし</span></div>`;

  el.innerHTML = heroHtml + `<div class="company-cards">${cardHtml}</div>` + alertHtml + navCardsHtml;

  el.querySelectorAll('.nav-card:not(.disabled)').forEach(card => {
    card.addEventListener('click', () => showScreen(card.dataset.nav));
  });
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

  el.innerHTML = `
    <div class="biz-tabs">
      <button class="biz-tab ${selectedBizCompany === 'BLUE ESTATE' ? 'active' : ''}" data-company="BLUE ESTATE">BLUE ESTATE</button>
      <button class="biz-tab ${selectedBizCompany === 'BLUE DESIGN' ? 'active' : ''}" data-company="BLUE DESIGN">BLUE DESIGN</button>
      <button class="biz-tab ${selectedBizCompany === 'BLUE LIFE'   ? 'active' : ''}" data-company="BLUE LIFE">BLUE LIFE</button>
      <button class="biz-tab ${selectedBizCompany === '青天堂'      ? 'active' : ''}" data-company="青天堂">青天堂</button>
    </div>
    <div class="biz-note">事業ラインの区分は暫定的な分類です（freeeセグメント運用の検討中）<br><span class="biz-note-sub">WASH BLUE・BLUE HOTELSの売上はfreee上は営業外収益に計上されていますが、管理会計上は事業売上として集計しています</span></div>
    <div class="biz-period-selector">
      <button class="period-btn ${bizPeriod === 'month' ? 'active' : ''}" data-period="month">直近確定月</button>
      <button class="period-btn ${bizPeriod === 'ytd'   ? 'active' : ''}" data-period="ytd">年度累計</button>
    </div>
    <div id="biz-content"></div>
  `;

  el.querySelectorAll('.biz-tab:not(.disabled)').forEach(tab => {
    tab.addEventListener('click', () => {
      if (selectedBizCompany === tab.dataset.company) return;
      selectedBizCompany = tab.dataset.company;
      selectedBizLine = null;
      el.querySelectorAll('.biz-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderBizContent();
    });
  });

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
  const isYtd = bizPeriod === 'ytd';

  let lines, sgaTotal, sgaBreakdown, detailColorFn;

  if (selectedBizCompany === 'BLUE ESTATE') {
    // ── BLUE ESTATE: BIZ_MAP 駆動（6事業ライン）──────────────────────
    const unit = actuals.data.unit_blue_estate;
    const bizMap = buildBizMap(budgetDetail);
    const confirmed = getConfirmed(unit);
    const targetData = isYtd ? unit.ytd : confirmed.data;

    if (!targetData) { el.innerHTML = '<p class="error-msg">データがありません</p>'; return; }

    lines = {
      '売買':        { rev: [], cogs: [] },
      '賃貸仲介':    { rev: [], cogs: [] },
      '賃貸管理':    { rev: [], cogs: [] },
      'WASH BLUE':   { rev: [], cogs: [] },
      'BLUE HOTELS': { rev: [], cogs: [] },
    };
    for (const item of (targetData.revenue?.breakdown ?? [])) {
      const line = bizMap[item.item];
      if (line && lines[line]) lines[line].rev.push(item);
    }
    for (const item of (targetData.cogs?.breakdown ?? [])) {
      const line = bizMap[item.item] ?? Object.keys(lines).find(l => item.item.includes(l));
      if (line && lines[line]) lines[line].cogs.push(item);
    }
    for (const item of (targetData.non_op_income?.breakdown ?? [])) {
      const line = NON_OP_BIZ_LINES.income[item.item];
      if (line && lines[line]) lines[line].rev.push(item);
    }
    for (const item of (targetData.non_op_expense?.breakdown ?? [])) {
      const line = NON_OP_BIZ_LINES.expense[item.item];
      if (line && lines[line]) lines[line].cogs.push(item);
    }
    sgaTotal = targetData.sga?.total ?? 0;
    sgaBreakdown = targetData.sga?.breakdown ?? [];

    const lineColors = {
      '売買': COLORS.sell, '賃貸仲介': COLORS.rent_brokerage,
      '賃貸管理': COLORS.rent_mgmt, 'WASH BLUE': COLORS.wash_blue,
      'BLUE HOTELS': COLORS.blue_hotels,
    };
    detailColorFn = (name) => lineColors[name];

  } else if (selectedBizCompany === '青天堂') {
    // ── 青天堂: by_item（【青天堂】飲食／物販／チケット）から3事業ライン構築 ──
    const unit = actuals.data.unit_seitendo;
    const confirmed = getConfirmed(unit);
    const targetData = isYtd ? unit?.ytd : confirmed?.data;

    if (!targetData) { el.innerHTML = '<p class="error-msg">データがありません</p>'; return; }

    const SEITENDO_PALETTE = { '飲食売上': '#a8632a', '物販売上': '#c4793a', 'チケット売上': '#7a4520' };
    const LINE_NAMES = ['飲食売上', '物販売上', 'チケット売上'];
    // freee 品目名 → 事業ライン名の対応
    const ITEM_TO_LINE = {
      '【青天堂】飲食':    '飲食売上',
      '【青天堂】物販':    '物販売上',
      '【青天堂】チケット': 'チケット売上',
    };

    sgaTotal     = targetData.sga?.total     ?? 0;
    sgaBreakdown = targetData.sga?.breakdown ?? [];

    const lineColorMap = {};
    lines = Object.fromEntries(LINE_NAMES.map(name => {
      lineColorMap[name] = SEITENDO_PALETTE[name];
      return [name, { rev: [], cogs: [] }];
    }));

    // 売上：各勘定科目行を by_item でライン別にフィルタして実データとして保持
    for (const acctRow of (targetData.revenue?.breakdown ?? [])) {
      for (const lineName of LINE_NAMES) {
        const filtered = (acctRow.by_item ?? []).filter(bi => ITEM_TO_LINE[bi.name] === lineName);
        if (filtered.length === 0) continue;
        const lineAmt = filtered.reduce((s, bi) => s + bi.amount, 0);
        lines[lineName].rev.push({ item: acctRow.item, amount: lineAmt, by_item: filtered });
      }
    }

    const lineRevMap = Object.fromEntries(LINE_NAMES.map(n => [
      n, lines[n].rev.reduce((s, r) => s + r.amount, 0),
    ]));

    // COGS: 食材・飲料の実額比率を算出（ライン別には紐付けられないため按分）
    let shokuzaiAmt = 0, inryoAmt = 0;
    for (const row of (targetData.cogs?.breakdown ?? [])) {
      for (const bi of (row.by_item ?? [])) {
        if (bi.name === '食材') shokuzaiAmt += bi.amount;
        if (bi.name === '飲料') inryoAmt   += bi.amount;
      }
    }
    // by_item が取れない場合は全額を食材として扱う（fallback）
    if (shokuzaiAmt === 0 && inryoAmt === 0) shokuzaiAmt = targetData.cogs?.total ?? 0;
    const cogsByItemTotal = shokuzaiAmt + inryoAmt;

    // COGS を売上構成比で按分し、食材（按分）・飲料（按分）の内訳を by_item で保持
    const totalCogsAmt = targetData.cogs?.total ?? 0;
    const totalRevAmt  = LINE_NAMES.reduce((s, n) => s + Math.max(lineRevMap[n], 0), 0);
    if (totalCogsAmt > 0 && totalRevAmt > 0) {
      for (const name of LINE_NAMES) {
        const lineRev = Math.max(lineRevMap[name], 0);
        if (lineRev > 0) {
          const allocated = Math.round(totalCogsAmt * lineRev / totalRevAmt);
          // 食材・飲料の実額比率で按分内訳を生成（推計値）
          const byItem = [];
          if (cogsByItemTotal > 0) {
            const s = Math.round(allocated * shokuzaiAmt / cogsByItemTotal);
            const d = allocated - s;
            if (s > 0) byItem.push({ name: '食材（按分）', amount: s });
            if (d > 0) byItem.push({ name: '飲料（按分）', amount: d });
          }
          lines[name].cogs.push({ item: '売上原価（按分）', amount: allocated, by_item: byItem });
        }
      }
    }

    detailColorFn = (name) => lineColorMap[name];

    if (totalRevAmt === 0) {
      el.innerHTML = '<p class="biz-hint">データがありません（月中に更新されます）</p>';
      return;
    }

  } else {
    // ── BLUE DESIGN / BLUE LIFE: 売上内訳をそのまま事業ラインとして表示 ──
    const unitKey = { 'BLUE DESIGN': 'unit_blue_design', 'BLUE LIFE': 'unit_blue_life' }[selectedBizCompany];
    const unit = actuals.data[unitKey];
    const confirmed = getConfirmed(unit);
    const targetData = isYtd ? unit?.ytd : confirmed?.data;

    if (!targetData) { el.innerHTML = '<p class="error-msg">データがありません</p>'; return; }

    const PALETTES = {
      'BLUE DESIGN': ['#1f6fb2', '#0284c7', '#0369a1', '#1585d0', '#075985'],
      'BLUE LIFE':   ['#1f8a76', '#0d7a61', '#16a085', '#1aab8a', '#0a5a4a'],
    };
    const palette = PALETTES[selectedBizCompany];

    const revItems  = targetData.revenue?.breakdown ?? [];
    const cogsItems = targetData.cogs?.breakdown    ?? [];
    sgaTotal     = targetData.sga?.total     ?? 0;
    sgaBreakdown = targetData.sga?.breakdown ?? [];

    const lineColorMap = {};
    lines = Object.fromEntries(revItems.map((item, i) => {
      const color = palette[i % palette.length];
      lineColorMap[item.item] = color;
      return [item.item, { rev: [item], cogs: [], color }];
    }));

    // COGS を売上構成比で按分（Phase 2: 各原価科目の by_item を保持して案件ドリルダウンを可能に）
    const totalCogsAmt = cogsItems.reduce((s, i) => s + i.amount, 0);
    const totalRevAmt  = revItems.reduce((s, i)  => s + i.amount, 0);
    if (totalCogsAmt > 0 && totalRevAmt > 0) {
      for (const [, ld] of Object.entries(lines)) {
        const lineRev = ld.rev.reduce((s, i) => s + i.amount, 0);
        if (lineRev > 0) {
          for (const cogsItem of cogsItems) {
            const allocated = Math.round(cogsItem.amount * lineRev / totalRevAmt);
            if (allocated > 0) {
              // by_item は会社全体の案件別実額（按分後の lineAmount との差は仕様）
              ld.cogs.push({ item: cogsItem.item, amount: allocated, by_item: cogsItem.by_item });
            }
          }
        }
      }
    }

    detailColorFn = (name) => lineColorMap[name];

    if (revItems.length === 0) {
      el.innerHTML = '<p class="biz-hint">データがありません（月中に更新されます）</p>';
      return;
    }
  }

  // ── 共通: タイル描画 ──────────────────────────────────────────────
  const totalLineRev = Object.values(lines).reduce((s, l) => s + l.rev.reduce((a, i) => a + i.amount, 0), 0);

  const tilesHtml = Object.entries(lines).map(([name, ld]) => {
    const rev  = ld.rev.reduce((s, i) => s + i.amount, 0);
    const cogs = ld.cogs.reduce((s, i) => s + i.amount, 0);
    const gp   = rev - cogs;
    const color = detailColorFn(name) ?? COLORS.accent;
    const isSelected = selectedBizLine === name;
    const share = (totalLineRev > 0 && rev > 0) ? ((rev / totalLineRev) * 100).toFixed(1) : '0.0';
    return `
      <div class="biz-tile ${isSelected ? 'selected' : ''}" data-line="${name}" style="border-left: 4px solid ${color}">
        <div class="biz-tile-name" style="color:${color}">${name}</div>
        <div class="biz-tile-row"><span>売上</span><span>${fmtYen(rev)}</span></div>
        <div class="biz-tile-row"><span>粗利</span><span>${fmtYen(gp)}</span></div>
        <div class="biz-tile-row"><span>粗利率</span><span>${rev ? ((gp / rev) * 100).toFixed(1) + '%' : '—'}</span></div>
        <div class="biz-share-bar-wrap"><div class="biz-share-bar" style="width:${share}%; background:${color}"></div></div>
        <div class="biz-share-pct">構成比 ${share}%</div>
      </div>
    `;
  }).join('');

  const honbuSelected = selectedBizLine === '本部';
  const honbuTileHtml = `
    <div class="biz-tile ${honbuSelected ? 'selected' : ''}" data-line="本部" style="border-left: 4px solid ${COLORS.sga}">
      <div class="biz-tile-name" style="color:${COLORS.sga}">本部（共通費）</div>
      <div class="biz-tile-row"><span>販管費合計</span><span>${fmtYen(sgaTotal)}</span></div>
      <div class="biz-tile-note">事業ライン配分なし</div>
    </div>
  `;

  const detailHtml = selectedBizLine
    ? renderBizDetail(selectedBizLine, lines, sgaBreakdown, detailColorFn(selectedBizLine))
    : '<p class="biz-hint">左の事業ラインをクリックしてください</p>';

  el.innerHTML = `
    <div class="biz-layout">
      <div class="biz-left">${tilesHtml}${honbuTileHtml}</div>
      <div class="biz-right" id="biz-detail">${detailHtml}</div>
    </div>
  `;

  el.querySelectorAll('.biz-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      selectedBizLine = tile.dataset.line;
      renderBizContent();
    });
  });
  el.querySelectorAll('.acc-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const body = trigger.nextElementSibling;
      if (body) body.classList.toggle('open');
      trigger.classList.toggle('open');
    });
  });
}

function renderBizDetail(lineName, lines, sgaBreakdown, colorOverride = null) {
  if (lineName === '本部') {
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
  const lineColors = {
    '売買':        COLORS.sell,
    '賃貸仲介':    COLORS.rent_brokerage,
    '賃貸管理':    COLORS.rent_mgmt,
    'WASH BLUE':   COLORS.wash_blue,
    'BLUE HOTELS': COLORS.blue_hotels,
  };
  const color = colorOverride ?? lineColors[lineName] ?? COLORS.accent;

  const revRows = lineData.rev.map(item => {
    const hasItems = item.by_item?.length > 0;
    return `
    <tr class="${hasItems ? 'acc-trigger' : ''}">
      <td class="acc-td">${item.item}</td>
      <td class="td-right">${fmtYen(item.amount)}</td>
      <td>${hasItems ? '<span class="acc-icon">▶</span>' : ''}</td>
    </tr>
    ${hasItems ? `<tr class="acc-body"><td colspan="3"><ul class="by-item-list">${item.by_item.map(b => `<li><span>${b.name}</span><span>${fmtYen(b.amount)}</span></li>`).join('')}</ul></td></tr>` : ''}
  `;}).join('');

  const cogsRows = lineData.cogs.map(item => {
    const hasItems = item.by_item?.length > 0;
    return `
    <tr class="${hasItems ? 'acc-trigger' : ''}">
      <td class="acc-td">${item.item}</td>
      <td class="td-right">${fmtYen(item.amount)}</td>
      <td>${hasItems ? '<span class="acc-icon">▶</span>' : ''}</td>
    </tr>
    ${hasItems ? `<tr class="acc-body"><td colspan="3"><ul class="by-item-list">${item.by_item.map(b => `<li><span>${b.name}</span><span>${fmtYen(b.amount)}</span></li>`).join('')}</ul></td></tr>` : ''}
  `;}).join('');

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

function buildByItemRows(budgetItems, actualItems, targetMonth, isYtd) {
  const allNames = new Set([
    ...Object.keys(budgetItems),
    ...actualItems.map(b => b.name),
  ]);
  return Array.from(allNames).map(name => {
    const bv = budgetItems[name];
    const budgetAmt = isYtd
      ? (bv?.annual_budget ?? null)
      : (bv?.monthly_budget?.[targetMonth] ?? null);
    const actualEntry = actualItems.find(b => b.name === name);
    const actualAmt = actualEntry?.amount ?? 0;
    const diff = budgetAmt != null ? budgetAmt - actualAmt : null;
    return `
      <tr>
        <td>${name}</td>
        <td class="td-right">${budgetAmt != null ? fmtYen(budgetAmt) : '—'}</td>
        <td class="td-right">${actualAmt ? fmtYen(actualAmt) : '—'}</td>
        <td class="td-right ${diff != null && diff < 0 ? 'negative' : ''}">${diff != null ? fmtYen(diff) : '—'}</td>
      </tr>
    `;
  }).join('');
}

// ─────────────────────────────────────────────
// 画面3: 予実管理
// ─────────────────────────────────────────────
function renderBudget() {
  const el = document.getElementById('s-budget');
  if (!el) return;

  const { actuals, budget, budgetDetail } = appData;

  if (!actuals) {
    el.innerHTML = '<p class="error-msg">データ読み込みエラー</p>';
    return;
  }

  const isYtd = budgetPeriod === 'ytd';

  // ── 会社選択タブ ─────────────────────────────────────────────────
  const tabsHtml = `
    <div class="budget-tabs">
      <button class="biz-tab ${selectedBudgetCompany === 'BLUE ESTATE' ? 'active' : ''}" data-company="BLUE ESTATE">BLUE ESTATE</button>
      <button class="biz-tab ${selectedBudgetCompany === 'BLUE DESIGN' ? 'active' : ''}" data-company="BLUE DESIGN">BLUE DESIGN</button>
      <button class="biz-tab ${selectedBudgetCompany === 'BLUE LIFE'   ? 'active' : ''}" data-company="BLUE LIFE">BLUE LIFE</button>
      <button class="biz-tab ${selectedBudgetCompany === '青天堂' ? 'active' : ''}" data-company="青天堂">青天堂</button>
    </div>
  `;

  const periodSelectorHtml = `
    <div class="budget-period-selector">
      <button class="period-btn ${!isYtd ? 'active' : ''}" data-period="month">直近確定月</button>
      <button class="period-btn ${ isYtd ? 'active' : ''}" data-period="ytd">年度累計</button>
    </div>
  `;

  let bodyHtml = '';

  // ── 青天堂: 事業ライン別予実 ──────────────────────────────────────
  if (selectedBudgetCompany === '青天堂') {
    const unit = actuals.data.unit_seitendo;
    const confirmed = getConfirmed(unit);
    const actualData  = isYtd ? unit?.ytd       : confirmed?.data;
    const targetMonth = isYtd ? unit?.ytd?.period : confirmed?.period;
    const periodLabel = isYtd
      ? `年度累計（${targetMonth ?? '—'}）`
      : `対象月: ${targetMonth ?? '—'}${statusBadge(targetMonth)}`;

    const budgetCo = budget?.companies?.['青天堂'];
    const lineBudgets = budgetCo?.line_budgets ?? {};
    const cogsItems   = budgetCo?.cogs_items   ?? {};
    const sgaItems    = budgetCo?.sga_items    ?? {};

    // YTD期間の月数を fy_start と ytd.period 末尾から算出
    let ytdMonths = 1;
    if (isYtd && budgetCo?.fy_start) {
      const ytdEnd = (unit?.ytd?.period ?? '').split('〜')[1] ?? '';
      if (ytdEnd) {
        const [fyY, fyM] = budgetCo.fy_start.split('-').map(Number);
        const [ytdY, ytdM] = ytdEnd.split('-').map(Number);
        ytdMonths = Math.max(1, (ytdY * 12 + ytdM) - (fyY * 12 + fyM) + 1);
      }
    }

    const monthlyToTarget = (monthly) => isYtd ? monthly * ytdMonths : monthly;
    const lineBudgetAmt = (name) => monthlyToTarget(lineBudgets[name] ?? 0);
    const itemBudgetAmt = (items, name) => monthlyToTarget(items[name] ?? 0);

    // ライン別実績を by_item から集計（renderBizContent と同じロジック）
    const ITEM_TO_LINE = {
      '【青天堂】飲食':    '飲食売上',
      '【青天堂】物販':    '物販売上',
      '【青天堂】チケット': 'チケット売上',
    };
    const LINE_NAMES = ['飲食売上', '物販売上', 'チケット売上'];
    const lineRevActuals = Object.fromEntries(LINE_NAMES.map(n => [n, 0]));
    for (const acctRow of (actualData?.revenue?.breakdown ?? [])) {
      for (const bi of (acctRow.by_item ?? [])) {
        const ln = ITEM_TO_LINE[bi.name];
        if (ln) lineRevActuals[ln] += bi.amount;
      }
    }
    const totalRevActual = LINE_NAMES.reduce((s, n) => s + lineRevActuals[n], 0);
    const totalRevBudget = LINE_NAMES.reduce((s, n) => s + lineBudgetAmt(n), 0);

    const makeRow = (label, bAmt, aAmt) => {
      const diff = bAmt != null ? bAmt - aAmt : null;
      const rate = (bAmt && aAmt) ? ((aAmt / bAmt) * 100).toFixed(1) : '—';
      return `
        <tr>
          <td>${label}</td>
          <td class="td-right">${bAmt != null ? fmtYen(bAmt) : '—'}</td>
          <td class="td-right">${fmtYen(aAmt || null)}</td>
          <td class="td-right ${diff != null && diff < 0 ? 'negative' : ''}">${diff != null ? fmtYen(diff) : '—'}</td>
          <td class="td-right">${rate !== '—' ? rate + '%' : '—'}</td>
        </tr>`;
    };
    const makeTotalRow = (label, bAmt, aAmt) => {
      const diff = bAmt - aAmt;
      const rate = (bAmt && aAmt) ? ((aAmt / bAmt) * 100).toFixed(1) : '—';
      return `
        <tr class="total-row">
          <td>${label}</td>
          <td class="td-right">${fmtYen(bAmt)}</td>
          <td class="td-right">${fmtYen(aAmt || null)}</td>
          <td class="td-right ${diff < 0 ? 'negative' : ''}">${fmtYen(diff)}</td>
          <td class="td-right">${rate !== '—' ? rate + '%' : '—'}</td>
        </tr>`;
    };
    const thead = `
      <thead><tr>
        <th>項目</th>
        <th class="td-right">${isYtd ? '年度累計予算' : '予算'}</th>
        <th class="td-right">実績</th>
        <th class="td-right">差額</th>
        <th class="td-right">達成率</th>
      </tr></thead>`;

    // ── 売上内訳 ──
    const revRows = LINE_NAMES.map(n => makeRow(n, lineBudgetAmt(n), lineRevActuals[n])).join('')
      + makeTotalRow('売上合計', totalRevBudget, totalRevActual);
    const revSection = `
      <div class="budget-section">
        <div class="budget-section-title">売上内訳（事業ライン別）</div>
        <table class="detail-table budget-table">${thead}<tbody>${revRows}</tbody></table>
      </div>`;

    // ── 原価内訳（食材・飲料 by_item から集計）──
    const cogsActualsMap = {};
    for (const row of (actualData?.cogs?.breakdown ?? [])) {
      for (const bi of (row.by_item ?? [])) {
        cogsActualsMap[bi.name] = (cogsActualsMap[bi.name] ?? 0) + bi.amount;
      }
    }
    const cogsItemNames = [...new Set([...Object.keys(cogsItems), ...Object.keys(cogsActualsMap)])];
    const cogsBudgetTotal = cogsItemNames.reduce((s, n) => s + itemBudgetAmt(cogsItems, n), 0);
    const cogsActualTotal = actualData?.cogs?.total ?? 0;
    const cogsItemRows = cogsItemNames.map(n => makeRow(n, itemBudgetAmt(cogsItems, n) || null, cogsActualsMap[n] ?? 0)).join('')
      + makeTotalRow('原価合計', cogsBudgetTotal, cogsActualTotal);
    const cogsSection = `
      <div class="budget-section">
        <div class="budget-section-title">原価内訳</div>
        <table class="detail-table budget-table">${thead}<tbody>${cogsItemRows}</tbody></table>
      </div>`;

    // ── 販管費内訳 ──
    const sgaActualsMap = Object.fromEntries((actualData?.sga?.breakdown ?? []).map(b => [b.item, b.amount]));
    const sgaItemNames  = [...new Set([...Object.keys(sgaItems), ...Object.keys(sgaActualsMap)])];
    const sgaBudgetTotal = sgaItemNames.reduce((s, n) => s + itemBudgetAmt(sgaItems, n), 0);
    const sgaActualTotal = actualData?.sga?.total ?? 0;
    const sgaItemRows = sgaItemNames.map(n => makeRow(n, itemBudgetAmt(sgaItems, n) || null, sgaActualsMap[n] ?? 0)).join('')
      + makeTotalRow('販管費合計', sgaBudgetTotal, sgaActualTotal);
    const sgaSection = `
      <div class="budget-section">
        <div class="budget-section-title">販管費内訳</div>
        <table class="detail-table budget-table">${thead}<tbody>${sgaItemRows}</tbody></table>
      </div>`;

    // ── 粗利・営業利益サマリー ──
    const gpBudget = totalRevBudget - cogsBudgetTotal;
    const gpActual = actualData?._summary?.gross_profit ?? 0;
    const opBudget = gpBudget - sgaBudgetTotal;
    const opActual = actualData?._summary?.op_profit ?? 0;
    const summarySection = `
      <div class="budget-section">
        <div class="budget-section-title">損益サマリー</div>
        <table class="detail-table budget-table">${thead}<tbody>
          ${makeRow('粗利',     gpBudget, gpActual)}
          ${makeRow('営業利益', opBudget, opActual)}
        </tbody></table>
      </div>`;

    bodyHtml = `
      <div class="budget-header"><span class="budget-period-label">${periodLabel}</span></div>
      ${revSection}${cogsSection}${sgaSection}${summarySection}
    `;

  // ── BLUE DESIGN / BLUE LIFE: サマリー予実 ─────────────────────────
  } else if (selectedBudgetCompany !== 'BLUE ESTATE') {
    const unitKey = { 'BLUE DESIGN': 'unit_blue_design', 'BLUE LIFE': 'unit_blue_life' }[selectedBudgetCompany];
    const unit = actuals.data[unitKey];
    const confirmed = getConfirmed(unit);
    const actualData  = isYtd ? unit?.ytd       : confirmed?.data;
    const targetMonth = isYtd ? unit?.ytd?.period : confirmed?.period;
    const periodLabel = isYtd
      ? `年度累計（${targetMonth ?? '—'}）`
      : `対象月: ${targetMonth ?? '—'}${statusBadge(targetMonth)}`;

    const budgetCo = budget?.companies?.[selectedBudgetCompany];
    let bRev, bGp, bSga, bOp, bOrd;
    if (budgetCo) {
      const src = isYtd
        ? (budgetCo.budget_ytd ?? {})
        : (budgetCo.monthly_plan?.[targetMonth] ?? budgetCo.budget_monthly ?? {});
      ({ revenue: bRev, gross_profit: bGp, sga_total: bSga, op_profit: bOp, ordinary_profit: bOrd } = src);
    }

    const aRev = actualData?.revenue?.total ?? 0;
    const aGp  = actualData?._summary?.gross_profit ?? 0;
    const aSga = actualData?.sga?.total ?? 0;
    const aOp  = actualData?._summary?.op_profit ?? 0;
    const aOrd = actualData?._summary?.ordinary_profit ?? 0;

    const summaryRows = [
      { label: '売上高',   budget: bRev, actual: aRev },
      { label: '粗利',     budget: bGp,  actual: aGp  },
      { label: '販管費',   budget: bSga, actual: aSga  },
      { label: '営業利益', budget: bOp,  actual: aOp  },
      { label: '経常利益', budget: bOrd, actual: aOrd  },
    ].map(r => {
      const diff = r.budget != null ? r.budget - r.actual : null;
      const rate = (r.budget && r.actual) ? ((r.actual / r.budget) * 100).toFixed(1) : '—';
      return `
        <tr>
          <td>${r.label}</td>
          <td class="td-right">${r.budget != null ? fmtYen(r.budget) : '—'}</td>
          <td class="td-right">${fmtYen(r.actual || null)}</td>
          <td class="td-right ${diff != null && diff < 0 ? 'negative' : ''}">${diff != null ? fmtYen(diff) : '—'}</td>
          <td class="td-right">${rate !== '—' ? rate + '%' : '—'}</td>
        </tr>
      `;
    }).join('');

    // ── BLUE LIFE: 販管費科目別内訳 ─────────────────────────────────
    let sgaDetailHtml = '<p class="budget-note">科目別詳細は準備中です</p>';
    if (selectedBudgetCompany === 'BLUE LIFE') {
      const sgaItemsMonthly = budgetCo?.sga_items_monthly ?? {};

      // 月次 or YTD合算で科目別予算を構築
      const sgaItemsBudget = {};
      if (isYtd) {
        // YTD期間文字列 "2026-06〜2026-08" から月リストを生成して合算
        const [ytdStart, ytdEnd] = (unit?.ytd?.period ?? '').split('〜');
        if (ytdStart && ytdEnd) {
          let [cy, cm] = ytdStart.split('-').map(Number);
          const [ey, em] = ytdEnd.split('-').map(Number);
          while (cy * 12 + cm <= ey * 12 + em) {
            const mKey = `${cy}-${String(cm).padStart(2, '0')}`;
            for (const [name, amt] of Object.entries(sgaItemsMonthly[mKey] ?? {})) {
              if (name === '_note') continue;
              sgaItemsBudget[name] = (sgaItemsBudget[name] ?? 0) + amt;
            }
            cm++; if (cm > 12) { cm = 1; cy++; }
          }
        }
      } else {
        Object.assign(sgaItemsBudget, sgaItemsMonthly[targetMonth] ?? {});
      }

      const sgaActualsMap = Object.fromEntries((actualData?.sga?.breakdown ?? []).map(b => [b.item, b.amount]));
      const allSgaNames = [...new Set([...Object.keys(sgaItemsBudget), ...Object.keys(sgaActualsMap)])];
      const sgaBudgetTotal = Object.values(sgaItemsBudget).reduce((s, v) => s + v, 0);
      const sgaActualTotal = actualData?.sga?.total ?? 0;
      const sgaTotalDiff   = sgaBudgetTotal - sgaActualTotal;
      const sgaTotalRate   = (sgaBudgetTotal && sgaActualTotal) ? ((sgaActualTotal / sgaBudgetTotal) * 100).toFixed(1) : '—';

      const sgaRows = allSgaNames.map(name => {
        const bAmt = sgaItemsBudget[name] > 0 ? sgaItemsBudget[name] : null;
        const aAmt = sgaActualsMap[name] ?? 0;
        const diff = bAmt != null ? bAmt - aAmt : null;
        const rate = (bAmt && aAmt) ? ((aAmt / bAmt) * 100).toFixed(1) : '—';
        const noBudgeTag = bAmt == null ? ' <span class="no-budget-tag">予算なし</span>' : '';
        return `
          <tr>
            <td>${name}${noBudgeTag}</td>
            <td class="td-right">${bAmt != null ? fmtYen(bAmt) : '—'}</td>
            <td class="td-right">${fmtYen(aAmt || null)}</td>
            <td class="td-right ${diff != null && diff < 0 ? 'negative' : ''}">${diff != null ? fmtYen(diff) : '—'}</td>
            <td class="td-right">${rate !== '—' ? rate + '%' : '—'}</td>
          </tr>`;
      }).join('');

      sgaDetailHtml = `
        <div class="budget-section">
          <div class="budget-section-title">販管費内訳</div>
          <table class="detail-table budget-table">
            <thead><tr>
              <th>科目</th>
              <th class="td-right">${isYtd ? '年度累計予算' : '予算'}</th>
              <th class="td-right">実績</th>
              <th class="td-right">差額</th>
              <th class="td-right">達成率</th>
            </tr></thead>
            <tbody>${sgaRows}</tbody>
            <tfoot><tr class="total-row">
              <td>販管費合計</td>
              <td class="td-right">${fmtYen(sgaBudgetTotal)}</td>
              <td class="td-right">${fmtYen(sgaActualTotal)}</td>
              <td class="td-right ${sgaTotalDiff < 0 ? 'negative' : ''}">${fmtYen(sgaTotalDiff)}</td>
              <td class="td-right">${sgaTotalRate !== '—' ? sgaTotalRate + '%' : '—'}</td>
            </tr></tfoot>
          </table>
        </div>`;
    }

    bodyHtml = `
      <div class="budget-header"><span class="budget-period-label">${periodLabel}</span></div>
      <div class="budget-section">
        <div class="budget-section-title">損益サマリー</div>
        <table class="detail-table budget-table">
          <thead>
            <tr>
              <th>項目</th>
              <th class="td-right">${isYtd ? '年度累計予算' : '予算'}</th>
              <th class="td-right">実績</th>
              <th class="td-right">差額</th>
              <th class="td-right">達成率</th>
            </tr>
          </thead>
          <tbody>${summaryRows}</tbody>
        </table>
      </div>
      ${sgaDetailHtml}
    `;

  } else {
    // ── BLUE ESTATE: 科目別詳細予実 ──────────────────────────────────
    if (!budgetDetail) {
      bodyHtml = '<p class="error-msg">予算データ読み込みエラー</p>';
    } else {
      const unit = actuals.data.unit_blue_estate;
      const confirmed = getConfirmed(unit);
      const actualData  = isYtd ? unit.ytd       : confirmed.data;
      const targetMonth = isYtd ? unit.ytd.period : confirmed.period;
      const periodLabel = isYtd
        ? `年度累計（${targetMonth}）`
        : `対象月: ${targetMonth}${statusBadge(targetMonth)}`;

      const sections = [
        { key: '売上高',     dataKey: 'revenue', label: '売上高' },
        { key: '売上原価',   dataKey: 'cogs',    label: '売上原価' },
        { key: '販売管理費', dataKey: 'sga',     label: '販管費' },
      ];

      let sectionsHtml = '';
      for (const section of sections) {
        const cats = budgetDetail.categories[section.key];
        if (!cats) continue;

        const actualBreakdown = actualData?.[section.dataKey]?.breakdown ?? [];
        const getActual = (name) => (actualBreakdown.find(b => b.item === name)?.amount ?? 0);

        const rows = Object.entries(cats).map(([acctName, acctVal]) => {
          const budgetAmt = isYtd
            ? (acctVal.annual_budget ?? null)
            : (acctVal.monthly_budget?.[targetMonth] ?? null);
          const actualAmt = getActual(acctName);
          const diff = budgetAmt != null ? budgetAmt - actualAmt : null;
          const rate = (budgetAmt && actualAmt) ? ((actualAmt / budgetAmt) * 100).toFixed(1) : '—';

          const actualItem  = actualBreakdown.find(b => b.item === acctName);
          const byItems     = actualItem?.by_item ?? [];
          const budgetItems = acctVal.items ?? {};
          const hasDetail   = byItems.length > 0 || Object.keys(budgetItems).length > 0;

          const byItemsHtml = hasDetail ? `
            <tr class="acc-body">
              <td colspan="6">
                <table class="by-item-budget-table">
                  <thead><tr><th>品目</th><th class="td-right">予算</th><th class="td-right">実績</th><th class="td-right">差額</th></tr></thead>
                  <tbody>${buildByItemRows(budgetItems, byItems, targetMonth, isYtd)}</tbody>
                </table>
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
              ${hasDetail ? '<td class="acc-icon">▶</td>' : '<td></td>'}
            </tr>
            ${byItemsHtml}
          `;
        }).join('');

        const budgetTotal = isYtd
          ? Object.values(cats).reduce((s, v) => s + (v.annual_budget ?? 0), 0)
          : Object.values(cats).reduce((s, v) => s + (v.monthly_budget?.[targetMonth] ?? 0), 0);
        const actualTotal = actualData?.[section.dataKey]?.total ?? 0;
        const totalDiff   = budgetTotal - actualTotal;

        sectionsHtml += `
          <div class="budget-section">
            <div class="budget-section-title">${section.label}</div>
            <table class="detail-table budget-table">
              <thead>
                <tr>
                  <th>科目</th>
                  <th class="td-right">${isYtd ? '年間予算' : '予算'}</th>
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

      bodyHtml = `
        <div class="budget-header"><span class="budget-period-label">${periodLabel}</span></div>
        ${sectionsHtml}
      `;
    }
  }

  el.innerHTML = tabsHtml + periodSelectorHtml + bodyHtml;

  el.querySelectorAll('.biz-tab:not(.disabled)').forEach(tab => {
    tab.addEventListener('click', () => {
      if (selectedBudgetCompany === tab.dataset.company) return;
      selectedBudgetCompany = tab.dataset.company;
      renderBudget();
    });
  });

  el.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      budgetPeriod = btn.dataset.period;
      renderBudget();
    });
  });

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
// 画面4: CASH（預金残高一覧）
// ─────────────────────────────────────────────
function renderCash() {
  const el = document.getElementById('s-cash');
  if (!el) return;

  const { actuals } = appData;
  if (!actuals) {
    el.innerHTML = '<p class="error-msg">データ読み込みエラー</p>';
    return;
  }

  const CASH_UNITS = [
    { key: 'unit_blue_estate', name: 'BLUE ESTATE' },
    { key: 'unit_blue_design', name: 'BLUE DESIGN' },
    { key: 'unit_blue_life',   name: 'BLUE LIFE'   },
  ];

  // グループ合計（同期残高 vs 前月末確定値）
  let groupLastBalance = 0, groupPrevTotal = 0;
  for (const { key } of CASH_UNITS) {
    const cash = actuals.data[key]?.cash;
    if (cash) {
      groupLastBalance += cash.last_balance_total ?? 0;
      groupPrevTotal   += cash.prev_total ?? 0;
    }
  }
  const groupDiff  = groupLastBalance - groupPrevTotal;
  const prevPeriod = actuals.data['unit_blue_estate']?.cash?.prev_period ?? '—';
  const syncDate   = actuals.data['unit_blue_estate']?.cash?.sync_date   ?? '';

  const heroHtml = `
    <div class="hero-kpis">
      <div class="hero-kpi">
        <div class="hero-kpi-label">グループ同期残高合計（同期日: ${syncDate}）</div>
        <div class="hero-kpi-value">${fmtYen(groupLastBalance)}</div>
      </div>
      <div class="hero-kpi">
        <div class="hero-kpi-label">前月末確定値（${prevPeriod}末）</div>
        <div class="hero-kpi-value">${fmtYen(groupPrevTotal)}</div>
      </div>
      <div class="hero-kpi">
        <div class="hero-kpi-label">前月末確定値比</div>
        <div class="hero-kpi-value ${groupDiff < 0 ? 'negative' : ''}">${groupDiff >= 0 ? '+' : ''}${fmtYen(groupDiff)}</div>
      </div>
    </div>
  `;

  // 各社カード（アコーディオン）
  const companiesHtml = CASH_UNITS.map(({ key, name }) => {
    const cash         = actuals.data[key]?.cash;
    const color        = COLORS[name] || COLORS.accent;
    const lastBalTotal = cash?.last_balance_total ?? 0;
    const prevTotal    = cash?.prev_total ?? 0;
    const bsTotal      = cash?.total ?? 0;
    const diff         = lastBalTotal - prevTotal;
    const accounts     = cash?.accounts ?? [];

    const diffCls = diff < 0 ? ' negative' : diff > 0 ? ' positive' : '';

    const detailRows = accounts.map(acc => {
      const staleHtml  = acc.stale
        ? ' <span class="cash-stale-warn" title="14日以上更新なし">⚠</span>'
        : '';
      const updateDate = acc.update_date || '—';
      return `
        <tr>
          <td>${acc.name}</td>
          <td class="td-right">${fmtYen(acc.last_balance)}</td>
          <td class="td-right cash-update-date">${updateDate}${staleHtml}</td>
          <td class="td-right">${fmtYen(acc.balance)}</td>
          <td class="td-right">${fmtYen(acc.prev_balance ?? null)}</td>
        </tr>`;
    }).join('');

    return `
      <div class="cash-company-card">
        <div class="cash-company-header" data-cash-key="${key}">
          <div class="cash-company-badge" style="background:${color}"></div>
          <div class="cash-company-name">${name}</div>
          <div class="cash-company-total">${fmtYen(lastBalTotal)}</div>
          <div class="cash-company-diff${diffCls}">${diff >= 0 ? '+' : ''}${fmtYen(diff)} vs 前月末</div>
          <div class="cash-expand-icon">▶</div>
        </div>
        <div class="cash-detail" id="cash-detail-${key}">
          <table class="detail-table cash-detail-table">
            <thead><tr>
              <th>口座名</th>
              <th class="td-right">同期残高</th>
              <th class="td-right">更新日</th>
              <th class="td-right">月末確定（${cash?.period ?? ''}）</th>
              <th class="td-right">月末確定（${cash?.prev_period ?? ''}）</th>
            </tr></thead>
            <tbody>${detailRows}</tbody>
            <tfoot><tr class="total-row">
              <td>合計</td>
              <td class="td-right">${fmtYen(lastBalTotal)}</td>
              <td></td>
              <td class="td-right">${fmtYen(bsTotal)}</td>
              <td class="td-right">${fmtYen(prevTotal)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;
  }).join('');

  const seitenHtml = `
    <div class="cash-company-card cash-seitendo">
      <div class="cash-company-header" style="cursor:default">
        <div class="cash-company-badge" style="background:${COLORS['青天堂']}"></div>
        <div class="cash-company-name" style="color:var(--ink-faint)">青天堂</div>
        <div class="cash-seitendo-note">freee対象外のため表示できません</div>
      </div>
    </div>`;

  el.innerHTML = heroHtml + `
    <div class="cash-period-note">同期残高: 銀行API連携の最新残高 • 月末確定値: freee試算表（trial_bs）の月末残高 • <span class="cash-stale-warn">⚠</span> 14日以上更新なし</div>
    <div class="cash-companies">
      ${companiesHtml}
      ${seitenHtml}
    </div>
  `;

  // アコーディオン
  el.querySelectorAll('.cash-company-header[data-cash-key]').forEach(header => {
    header.addEventListener('click', () => {
      const detail = document.getElementById(`cash-detail-${header.dataset.cashKey}`);
      const icon   = header.querySelector('.cash-expand-icon');
      if (detail) {
        detail.classList.toggle('open');
        if (icon) icon.textContent = detail.classList.contains('open') ? '▼' : '▶';
      }
    });
  });
}

// ─────────────────────────────────────────────
// 画面5: 経営目標
// ─────────────────────────────────────────────
function renderGoals() {
  const el = document.getElementById('s-goals');
  if (!el) return;

  el.innerHTML = `
    <div class="goals-screen">
      <div class="goals-screen-title">経営目標</div>
      <div class="goals-placeholder">
        <div class="goals-placeholder-icon">🎯</div>
        <div class="goals-placeholder-title">「すごい会議」との連携準備中</div>
        <div class="goals-placeholder-body">
          経営目標（KGI・KPI）は「すごい会議」で設定・管理しています。<br>
          連携設計が確定次第、目標値・現在地・達成率をここに表示します。
        </div>
      </div>
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
  document.querySelectorAll('.nav-item[data-screen]').forEach(btn => {
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
