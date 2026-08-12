// 初期費用見積 計算ロジック（calc.py のJS移植版）
//
// 設計方針は Python版と同じ:
// - 日割り家賃・前家賃・仲介手数料の計算は、それぞれ独立した関数として持つ。
// - どの関数も「自動計算した値」を返すが、呼び出し側（案件データ）で
//   金額を人が上書きできることを前提とする。
// - 計算方式は method 引数で切替可能にする。

function lastDayOfMonth(year, month) {
  // month: 1-12
  return new Date(year, month, 0).getDate();
}

function addMonth(year, month, n) {
  const total = year * 12 + (month - 1) + n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function ymKey(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/**
 * 入居月の日割り金額を計算する。
 * moveinDate: {year, month, day}
 * method: "fixed30"（30日固定計算） | "actual_days"（実日数按分）
 */
function prorateFirstMonth(monthlyAmount, moveinDate, method = "fixed30") {
  const { year, month, day } = moveinDate;
  const lastDay = lastDayOfMonth(year, month);

  if (day === 1) {
    return { isFullMonth: true, days: lastDay, amount: Math.round(monthlyAmount), method };
  }

  const days = lastDay - day + 1;
  let denom;
  if (method === "actual_days") denom = lastDay;
  else if (method === "fixed30") denom = 30;
  else throw new Error(`unknown method: ${method}`);

  const raw = (monthlyAmount / denom) * days;
  // 1円未満切り上げ
  const amount = Number.isInteger(raw) ? raw : Math.floor(raw) + 1;

  return { isFullMonth: false, days, amount, method };
}

/**
 * 前家賃（入居月の翌月以降、満額請求する月）を計算する。
 * includeUntilYm: "YYYY-MM" 形式で、前家賃として計上する最終月を指定。
 */
function calcZenyachin(monthlyAmount, moveinDate, includeUntilYm, itemLabel = "前家賃") {
  const [untilYear, untilMonth] = includeUntilYm.split("-").map(Number);
  let { year, month } = addMonth(moveinDate.year, moveinDate.month, 1);

  const items = [];
  for (let i = 0; i < 24; i++) {
    if (year > untilYear || (year === untilYear && month > untilMonth)) break;
    items.push({
      yearMonth: ymKey(year, month),
      label: `${month}月分${itemLabel}`,
      amount: Math.round(monthlyAmount),
    });
    ({ year, month } = addMonth(year, month, 1));
  }
  return items;
}

/**
 * 仲介手数料を計算する。デフォルトは家賃1ヶ月分+消費税。
 * overrideAmount が指定された場合はそれを優先する（担当者による上書き）。
 */
function calcChukaiTesuryou(monthlyRent, months = 1.0, taxRate = 0.1, overrideAmount = null) {
  if (overrideAmount !== null && overrideAmount !== undefined && overrideAmount !== "") {
    return { base: null, tax: null, amount: Math.round(overrideAmount), overridden: true };
  }
  const base = monthlyRent * months;
  const tax = base * taxRate;
  return { base: Math.round(base), tax: Math.round(tax), amount: Math.round(base + tax), overridden: false };
}

if (typeof module === "object" && module.exports) {
  module.exports = { prorateFirstMonth, calcZenyachin, calcChukaiTesuryou };
}
