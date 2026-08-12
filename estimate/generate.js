// 初期費用見積書 生成（generate_estimate.py のJS移植版・ブラウザ/Node両対応）
//
// 構成方針（Python版と同じ）:
//   1. buildCase()     : 入力(物件マスタ+顧客+入居日+前家賃指定+仲介手数料)から
//                        「案件データ」(構造化データ) を組み立てる。これがsource of truth。
//   2. renderWorkbook() : 案件データを受け取り、ExcelJSのWorkbookへ描画する。
//
// 依存: calc.js（prorateFirstMonth / calcZenyachin / calcChukaiTesuryou）
//       ExcelJS（ブラウザではCDN、Nodeではnpm）

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./calc.js"));
  } else {
    root.EstimateGenerator = factory(root); // ブラウザではcalc.jsをグローバルに読み込んでおく
  }
})(typeof self !== "undefined" ? self : this, function (calcMod) {
  const prorateFirstMonth = calcMod.prorateFirstMonth || (typeof prorateFirstMonth !== "undefined" ? prorateFirstMonth : null);
  const calcZenyachin = calcMod.calcZenyachin || (typeof calcZenyachin !== "undefined" ? calcZenyachin : null);
  const calcChukaiTesuryou = calcMod.calcChukaiTesuryou || (typeof calcChukaiTesuryou !== "undefined" ? calcChukaiTesuryou : null);

  const DEFAULT_DISCLAIMER =
    "本お見積りは概算金額です。実際のご契約時には、正式な計算に基づく請求書を" +
    "改めてお渡しいたします。あらかじめご了承ください。";

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function genCaseId(now) {
    const ymd = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
    const rand = Math.random().toString(16).slice(2, 8).toUpperCase();
    return `EST-${ymd}-${rand}`;
  }

  /**
   * 案件データ（見積を構成する構造化データ）を組み立てる。
   *
   * opts:
   *   propertyData, customerName, moveinDate({year,month,day}), zenyachinUntilYm,
   *   prorationMethod, chukaiOverride, staffName, biko, disclaimer
   */
  function buildCase(opts) {
    const {
      propertyData,
      customerName,
      moveinDate,
      zenyachinUntilYm,
      prorationMethod = "fixed30",
      chukaiOverride = null,
      staffName = "",
      biko = "",
      disclaimer = null,
    } = opts;

    const rent = propertyData.rent;
    const kyoueki = propertyData.kyoueki || 0;
    const monthlyItems = [];
    const lineItems = [];

    const rentProrate = prorateFirstMonth(rent, moveinDate, prorationMethod);
    const kyouekiProrate = kyoueki ? prorateFirstMonth(kyoueki, moveinDate, prorationMethod) : null;
    const moveinMonthLabel = `${moveinDate.month}月分`;

    if (rentProrate.isFullMonth) {
      lineItems.push({ category: "賃料", name: `${moveinMonthLabel}家賃`, amount: rentProrate.amount, note: "" });
    } else {
      lineItems.push({
        category: "賃料",
        name: `${moveinMonthLabel}家賃（日割 ${rentProrate.days}日分）`,
        amount: rentProrate.amount,
        note: `${prorationMethod}`,
      });
    }

    if (kyouekiProrate !== null) {
      if (kyouekiProrate.isFullMonth) {
        lineItems.push({ category: "共益費", name: `${moveinMonthLabel}共益費・管理費`, amount: kyouekiProrate.amount, note: "" });
      } else {
        lineItems.push({
          category: "共益費",
          name: `${moveinMonthLabel}共益費・管理費（日割 ${kyouekiProrate.days}日分）`,
          amount: kyouekiProrate.amount,
          note: "",
        });
      }
    }

    for (const item of calcZenyachin(rent, moveinDate, zenyachinUntilYm, "前家賃")) {
      lineItems.push({ category: "前家賃", name: item.label, amount: item.amount, note: "" });
    }
    if (kyoueki) {
      for (const item of calcZenyachin(kyoueki, moveinDate, zenyachinUntilYm, "前家共益費")) {
        lineItems.push({ category: "前家賃", name: item.label, amount: item.amount, note: "" });
      }
    }

    if (propertyData.shikikin_months) {
      lineItems.push({
        category: "敷金・礼金",
        name: "敷金",
        amount: Math.round(rent * propertyData.shikikin_months),
        note: `賃料${propertyData.shikikin_months}ヶ月分`,
      });
    }
    if (propertyData.reikin_months) {
      lineItems.push({
        category: "敷金・礼金",
        name: "礼金",
        amount: Math.round(rent * propertyData.reikin_months),
        note: `賃料${propertyData.reikin_months}ヶ月分`,
      });
    }

    if (propertyData.hoshou_ryou_rate) {
      const hoshouBase = rent + kyoueki;
      const hoshouAmount = Math.round(hoshouBase * propertyData.hoshou_ryou_rate);
      lineItems.push({
        category: "保証料",
        name: `保証委託料（${propertyData.hoshou_gaisha || ""}）`,
        amount: hoshouAmount,
        note: propertyData.hoshou_ryou_note || "",
      });
    }
    if (propertyData.hoshou_getsugaku) {
      monthlyItems.push({
        name: `月額保証料（${propertyData.hoshou_gaisha || ""}）`,
        amount: propertyData.hoshou_getsugaku,
        note: propertyData.hoshou_getsugaku_note || "",
      });
    }

    if (propertyData.kagi_koukan_hiyou) {
      lineItems.push({ category: "諸費用", name: "鍵交換費用", amount: propertyData.kagi_koukan_hiyou, note: "" });
    }

    for (const extra of propertyData.sonota_hiyou || []) {
      if (extra.billing === "monthly") {
        monthlyItems.push({ name: `${extra.name}（月額）`, amount: extra.amount, note: extra.note || "" });
      } else {
        lineItems.push({ category: "諸費用", name: extra.name, amount: extra.amount, note: extra.note || "" });
      }
    }

    const chukai = calcChukaiTesuryou(rent, 1.0, 0.1, chukaiOverride);
    const chukaiNote = chukai.overridden ? "上書き" : "賃料1ヶ月分+消費税";
    lineItems.push({ category: "仲介手数料", name: "仲介手数料", amount: chukai.amount, note: chukaiNote });

    const total = lineItems.reduce((s, li) => s + li.amount, 0);
    const now = new Date();

    return {
      caseId: genCaseId(now),
      createdAt: now.toISOString(),
      staffName,
      customerName,
      property: {
        propertyId: propertyData.property_id,
        propertyName: propertyData.property_name,
        roomNo: propertyData.room_no,
        address: propertyData.address || "",
      },
      moveinDate,
      zenyachinUntilYm,
      prorationMethod,
      lineItems,
      monthlyItems,
      total,
      biko,
      disclaimer: disclaimer !== null && disclaimer !== undefined ? disclaimer : DEFAULT_DISCLAIMER,
    };
  }

  // ---------------------------------------------------------------------
  // Excel描画（見た目レイヤー）。ExcelJS版。Python版 render_excel() と同じ設計。
  // ---------------------------------------------------------------------

  const FONT_NAME = "Yu Gothic";
  const ACCENT = "FF0090BA";
  const ACCENT_DARK = "FF006D8F";
  const INK = "FF1A1A1A";
  const SUB = "FF808080";
  const HAIR = "FFE6E6E6";
  const TINT = "FFEAF5FA";
  const YEN_FMT = '"¥"#,##0';

  const GROUP_ORDER = ["賃料・共益費", "前家賃", "敷金・礼金", "保証料", "諸費用", "仲介手数料"];
  const CATEGORY_TO_GROUP = {
    賃料: "賃料・共益費",
    共益費: "賃料・共益費",
    前家賃: "前家賃",
    "敷金・礼金": "敷金・礼金",
    保証料: "保証料",
    諸費用: "諸費用",
    仲介手数料: "仲介手数料",
  };

  function f(size, bold, color, italic) {
    return { name: FONT_NAME, size: size || 10, bold: !!bold, color: { argb: color || INK }, italic: !!italic };
  }

  function fmtDate(d) {
    // d: {year, month, day} または ISOな Date
    const dt = d instanceof Date ? d : new Date(d.year, d.month - 1, d.day);
    return `${dt.getFullYear()}年${pad2(dt.getMonth() + 1)}月${pad2(dt.getDate())}日`;
  }

  function rowText(ws, r, text, colStart, colEnd, font, align, fillArgb) {
    ws.mergeCells(r, colStart, r, colEnd);
    const cell = ws.getCell(r, colStart);
    if (text !== null && text !== undefined) cell.value = text;
    cell.font = font || f();
    cell.alignment = align || { vertical: "middle", indent: 1 };
    if (fillArgb) {
      for (let c = colStart; c <= colEnd; c++) {
        ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
      }
    }
    return cell;
  }

  function borderEdge(ws, r, colStart, colEnd, opts) {
    for (let c = colStart; c <= colEnd; c++) {
      const cell = ws.getCell(r, c);
      const b = cell.border || {};
      cell.border = {
        left: b.left,
        right: b.right,
        top: opts.top || b.top,
        bottom: opts.bottom || b.bottom,
      };
    }
  }

  /**
   * 案件データからExcelJS Workbookを構築する。
   * logoBuffer: ロゴ画像のArrayBuffer/Buffer（省略可）
   */
  function renderWorkbook(ExcelJS, caseData, opts) {
    opts = opts || {};
    const companyName = opts.companyName || "BLUE ESTATE";
    const logoBuffer = opts.logoBuffer || null;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("初期費用見積書", { views: [{ showGridLines: false }] });

    const widths = [3, 30, 15, 16, 16, 6];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

    // --- ヘッダー：ロゴ + 発行者情報 ---
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 14;
    ws.getRow(4).height = 14;
    if (logoBuffer) {
      const imgId = wb.addImage({ buffer: logoBuffer, extension: "png" });
      ws.addImage(imgId, { tl: { col: 1, row: 1 }, ext: { width: 150, height: 41 } });
    } else {
      const c = ws.getCell(2, 2);
      c.value = companyName;
      c.font = f(14, true, ACCENT_DARK);
    }

    const createdAt = new Date(caseData.createdAt);
    rowText(ws, 2, `発行日：${fmtDate(createdAt)}`, 4, 6, f(9, false, SUB), { horizontal: "right", vertical: "middle" });
    rowText(ws, 3, `見積番号：${caseData.caseId}`, 4, 6, f(9, false, SUB), { horizontal: "right", vertical: "middle" });
    rowText(ws, 4, "有効期限：発行日より30日間", 4, 6, f(9, false, SUB), { horizontal: "right", vertical: "middle" });

    // --- タイトル ---
    ws.getRow(5).height = 8;
    ws.getRow(6).height = 25;
    rowText(ws, 6, "御 見 積 書", 2, 6, f(19, true, INK), { horizontal: "left", vertical: "middle", indent: 1 });
    ws.getRow(7).height = 3;
    borderEdge(ws, 7, 2, 6, { top: { style: "thin", color: { argb: ACCENT } } });

    // --- 顧客名 → 物件名 → 入居日 ---
    ws.getRow(8).height = 8;
    ws.getRow(9).height = 24;
    rowText(ws, 9, `${caseData.customerName} 様`, 2, 6, f(18, true, INK), { vertical: "middle", indent: 1 });

    ws.getRow(10).height = 6;
    ws.getRow(11).height = 19;
    const prop = caseData.property;
    rowText(ws, 11, `${prop.propertyName}　${prop.roomNo}号室`, 2, 6, f(13, true, INK), { vertical: "middle", indent: 1 });
    ws.getRow(12).height = 15;
    rowText(ws, 12, prop.address || "", 2, 6, f(10, false, SUB), { vertical: "middle", indent: 1 });
    ws.getRow(13).height = 19;
    rowText(
      ws, 13, `ご入居日：${fmtDate(caseData.moveinDate)}`, 2, 6,
      f(11, true, ACCENT_DARK), { vertical: "middle", indent: 1 }
    );

    // --- 初期費用合計（ヒーローパネル） ---
    ws.getRow(14).height = 6;
    ws.getRow(15).height = 3;
    ws.getRow(16).height = 15;
    ws.getRow(17).height = 32;
    ws.getRow(18).height = 15;
    for (const row of [15, 16, 17, 18]) {
      for (let c = 2; c <= 6; c++) {
        ws.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } };
      }
    }
    borderEdge(ws, 15, 2, 6, { top: { style: "thin", color: { argb: ACCENT } } });
    borderEdge(ws, 18, 2, 6, { bottom: { style: "thin", color: { argb: ACCENT } } });

    rowText(ws, 16, "初期費用　お見積り合計", 2, 6, f(9, false, SUB), { vertical: "middle", indent: 1 });
    const amountCell = rowText(ws, 17, null, 2, 6, f(25, true, ACCENT_DARK), { vertical: "middle", indent: 1 });
    amountCell.value = caseData.total;
    amountCell.numFmt = YEN_FMT;
    rowText(ws, 18, "※仲介手数料には消費税を含みます", 2, 6, f(8, false, SUB), { vertical: "middle", indent: 1 });

    // --- 明細テーブル ヘッダー ---
    ws.getRow(19).height = 6;
    const headerRow = 20;
    ws.getRow(headerRow).height = 15;
    ws.getCell(headerRow, 2).value = "項目";
    ws.getCell(headerRow, 2).font = f(9, true, SUB);
    ws.getCell(headerRow, 2).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getCell(headerRow, 3).value = "金額";
    ws.getCell(headerRow, 3).font = f(9, true, SUB);
    ws.getCell(headerRow, 3).alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    ws.mergeCells(headerRow, 4, headerRow, 6);
    ws.getCell(headerRow, 4).value = "備考";
    ws.getCell(headerRow, 4).font = f(9, true, SUB);
    ws.getCell(headerRow, 4).alignment = { vertical: "middle", indent: 1 };
    borderEdge(ws, headerRow, 2, 6, { bottom: { style: "thin", color: { argb: ACCENT_DARK } } });

    // --- グループ分け ---
    const grouped = {};
    GROUP_ORDER.forEach((g) => (grouped[g] = []));
    const others = [];
    for (const item of caseData.lineItems) {
      const g = CATEGORY_TO_GROUP[item.category];
      (g ? grouped[g] : others).push(item);
    }
    const groupOrder = [...GROUP_ORDER];
    if (others.length) {
      grouped["その他"] = others;
      groupOrder.push("その他");
    }

    let r = headerRow + 1;
    let firstGroup = true;
    for (const groupName of groupOrder) {
      const items = grouped[groupName] || [];
      if (!items.length) continue;

      ws.getRow(r).height = firstGroup ? 5 : 6;
      r += 1;
      firstGroup = false;

      ws.getRow(r).height = 14;
      const catCell = ws.getCell(r, 2);
      catCell.value = groupName;
      catCell.font = f(9, true, ACCENT_DARK);
      catCell.alignment = { vertical: "middle", indent: 1 };
      catCell.border = { left: { style: "medium", color: { argb: ACCENT } } };
      r += 1;

      let groupTotal = 0;
      for (const item of items) {
        ws.getRow(r).height = 13;
        ws.getCell(r, 2).value = item.name;
        ws.getCell(r, 2).font = f(10, false, INK);
        ws.getCell(r, 2).alignment = { vertical: "middle", indent: 2 };

        ws.getCell(r, 3).value = item.amount;
        ws.getCell(r, 3).numFmt = YEN_FMT;
        ws.getCell(r, 3).font = f(10, false, INK);
        ws.getCell(r, 3).alignment = { horizontal: "right", vertical: "middle", indent: 1 };

        ws.mergeCells(r, 4, r, 6);
        ws.getCell(r, 4).value = item.note || "";
        ws.getCell(r, 4).font = f(8.5, false, SUB);
        ws.getCell(r, 4).alignment = { vertical: "middle", indent: 1, wrapText: false };

        borderEdge(ws, r, 2, 6, { bottom: { style: "hair", color: { argb: HAIR } } });
        groupTotal += item.amount;
        r += 1;
      }

      ws.getRow(r).height = 12;
      ws.getCell(r, 2).value = `${groupName} 小計`;
      ws.getCell(r, 2).font = f(8, false, SUB, true);
      ws.getCell(r, 2).alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      ws.getCell(r, 3).value = groupTotal;
      ws.getCell(r, 3).numFmt = YEN_FMT;
      ws.getCell(r, 3).font = f(8, false, SUB, true);
      ws.getCell(r, 3).alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      r += 1;
    }

    // --- ご参考：入居後の月額費用 ---
    const monthlyItems = caseData.monthlyItems || [];
    if (monthlyItems.length) {
      r += 1;
      ws.getRow(r).height = 7;
      r += 1;
      ws.getRow(r).height = 14;
      ws.getCell(r, 2).value = "ご参考：入居後の月額費用（初期費用合計には含まれません）";
      ws.getCell(r, 2).font = f(8.5, true, SUB);
      r += 1;
      for (const item of monthlyItems) {
        ws.getRow(r).height = 14;
        ws.getCell(r, 2).value = item.name;
        ws.getCell(r, 2).font = f(9, false, SUB);
        ws.getCell(r, 2).alignment = { vertical: "middle", indent: 2 };

        ws.getCell(r, 3).value = item.amount;
        ws.getCell(r, 3).numFmt = YEN_FMT + '"／月"';
        ws.getCell(r, 3).font = f(9, false, SUB);
        ws.getCell(r, 3).alignment = { horizontal: "right", vertical: "middle", indent: 1 };

        ws.mergeCells(r, 4, r, 6);
        ws.getCell(r, 4).value = item.note || "";
        ws.getCell(r, 4).font = f(8.5, false, SUB);
        ws.getCell(r, 4).alignment = { vertical: "middle", indent: 1 };
        r += 1;
      }
    }

    // --- 備考 ---
    r += 1;
    ws.getRow(r).height = 12;
    ws.getCell(r, 2).value = "備考";
    ws.getCell(r, 2).font = f(9, true, SUB);
    r += 1;

    const bikoRow = r;
    ws.getRow(bikoRow).height = 20;
    ws.mergeCells(bikoRow, 2, bikoRow, 6);
    const bikoCell = ws.getCell(bikoRow, 2);
    bikoCell.value = caseData.biko || "";
    bikoCell.font = f(9, false, INK);
    bikoCell.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    borderEdge(ws, bikoRow, 2, 6, { top: { style: "hair", color: { argb: HAIR } } });
    r += 1;

    // --- ご注意 ---
    const disclaimer = caseData.disclaimer || "";
    if (disclaimer) {
      r += 1;
      ws.getRow(r).height = 11;
      ws.getCell(r, 2).value = "ご注意";
      ws.getCell(r, 2).font = f(8.5, true, SUB);
      r += 1;
      const noteRow = r;
      ws.getRow(noteRow).height = 26;
      ws.mergeCells(noteRow, 2, noteRow, 6);
      const noteCell = ws.getCell(noteRow, 2);
      noteCell.value = disclaimer;
      noteCell.font = f(8, false, SUB, true);
      noteCell.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
      r += 1;
    }

    // --- フッター ---
    ws.getRow(r).height = 4;
    r += 1;
    const footerRow = r;
    ws.getRow(footerRow).height = 11;
    rowText(
      ws, footerRow, "ご不明な点がございましたら、お気軽に担当までお問い合わせください。", 2, 6,
      f(8, false, SUB), { horizontal: "center", vertical: "middle" }
    );

    ws.getRow(footerRow + 1).height = 4;
    ws.getRow(footerRow + 2).height = 11;
    ws.mergeCells(footerRow + 2, 2, footerRow + 2, 6);
    const companyCell = ws.getCell(footerRow + 2, 2);
    companyCell.value = `${companyName}　　担当：${caseData.staffName || ""}`;
    companyCell.font = f(8, false, SUB);
    companyCell.alignment = { horizontal: "center" };

    const lastRow = footerRow + 3;

    // --- 印刷設定 ---
    ws.pageSetup = {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.7, right: 0.7, top: 0.25, bottom: 0.25, header: 0.05, footer: 0.05 },
      printArea: `A1:F${lastRow}`,
      printTitlesRow: `${headerRow}:${headerRow}`,
      horizontalCentered: true,
    };

    return wb;
  }

  return { buildCase, renderWorkbook, DEFAULT_DISCLAIMER };
});
