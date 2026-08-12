// 初期費用見積書 作成フォーム — 画面制御
(function () {
  "use strict";

  const yen = (n) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

  let propertyMaster = {}; // property_id -> propertyData

  const propertySelect = document.getElementById("property");
  const propertyPreview = document.getElementById("property-preview");
  const form = document.getElementById("estimate-form");
  const resultBox = document.getElementById("result");
  const submitBtn = document.getElementById("submit-btn");

  // ---- 物件マスタ読み込み ----
  fetch("property_master.json")
    .then((r) => r.json())
    .then((data) => {
      propertyMaster = {};
      for (const p of data.properties) {
        propertyMaster[p.property_id] = p;
        const opt = document.createElement("option");
        opt.value = p.property_id;
        opt.textContent = `${p.property_name}　${p.room_no}号室`;
        propertySelect.appendChild(opt);
      }
      if (data.properties.length) renderPropertyPreview(data.properties[0]);
    })
    .catch((err) => {
      showResult("error", "物件マスタ（property_master.json）の読み込みに失敗しました。" + err.message);
    });

  propertySelect.addEventListener("change", () => {
    const p = propertyMaster[propertySelect.value];
    if (p) renderPropertyPreview(p);
  });

  function renderPropertyPreview(p) {
    propertyPreview.innerHTML = `
      <div class="pp-row">所在地：<b>${p.address || "―"}</b></div>
      <div class="pp-row">家賃：<b>${yen(p.rent)}</b>　共益費：<b>${yen(p.kyoueki || 0)}</b></div>
      <div class="pp-row">敷金：<b>${p.shikikin_months || 0}ヶ月</b>　礼金：<b>${p.reikin_months || 0}ヶ月</b></div>
      <div class="pp-row">保証会社：<b>${p.hoshou_gaisha || "―"}</b>（初回保証料率：${p.hoshou_ryou_rate ? p.hoshou_ryou_rate * 100 + "%" : "―"}）</div>
    `;
    propertyPreview.classList.add("show");
  }

  // ---- 初期費用の追加項目（動的行） ----
  const lineItemTpl = document.getElementById("line-item-tpl");
  const lineItemsContainer = document.getElementById("extra-line-items");
  document.getElementById("add-line-item").addEventListener("click", () => {
    const node = lineItemTpl.content.cloneNode(true);
    node.querySelector(".btn-remove").addEventListener("click", (e) => e.target.closest(".dyn-row").remove());
    lineItemsContainer.appendChild(node);
  });

  // ---- 月額費用（動的行） ----
  const monthlyItemTpl = document.getElementById("monthly-item-tpl");
  const monthlyItemsContainer = document.getElementById("monthly-items");
  document.getElementById("add-monthly-item").addEventListener("click", () => {
    const node = monthlyItemTpl.content.cloneNode(true);
    node.querySelector(".btn-remove").addEventListener("click", (e) => e.target.closest(".dyn-row").remove());
    monthlyItemsContainer.appendChild(node);
  });

  function collectLineItems() {
    return Array.from(lineItemsContainer.querySelectorAll(".dyn-row"))
      .map((row) => ({
        category: row.querySelector(".li-category").value,
        name: row.querySelector(".li-name").value.trim(),
        amount: Number(row.querySelector(".li-amount").value || 0),
        note: row.querySelector(".li-note").value.trim(),
      }))
      .filter((li) => li.name && li.amount);
  }

  function collectMonthlyItems() {
    return Array.from(monthlyItemsContainer.querySelectorAll(".dyn-row"))
      .map((row) => ({
        name: row.querySelector(".mi-name").value.trim(),
        amount: Number(row.querySelector(".mi-amount").value || 0),
        note: row.querySelector(".mi-note").value.trim(),
      }))
      .filter((mi) => mi.name && mi.amount);
  }

  function parseDateInput(value) {
    // value: "YYYY-MM-DD"
    const [year, month, day] = value.split("-").map(Number);
    return { year, month, day };
  }

  function defaultZenyachinUntilYm(moveinDate) {
    // 未入力なら入居月と同月まで（＝前家賃なし）
    return `${String(moveinDate.year).padStart(4, "0")}-${String(moveinDate.month).padStart(2, "0")}`;
  }

  function showResult(type, html) {
    resultBox.className = `result show ${type}`;
    resultBox.innerHTML = html;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = "作成中…";

    try {
      const propertyId = propertySelect.value;
      const propertyData = propertyMaster[propertyId];
      if (!propertyData) throw new Error("物件を選択してください。");

      const customerName = document.getElementById("customerName").value.trim();
      if (!customerName) throw new Error("お客様名を入力してください。");

      const moveinDateValue = document.getElementById("moveinDate").value;
      if (!moveinDateValue) throw new Error("ご入居日を指定してください。");
      const moveinDate = parseDateInput(moveinDateValue);

      const zenyachinUntilRaw = document.getElementById("zenyachinUntil").value; // "YYYY-MM" or ""
      const zenyachinUntilYm = zenyachinUntilRaw || defaultZenyachinUntilYm(moveinDate);

      const prorationMethod = document.getElementById("prorationMethod").value;
      const chukaiOverrideRaw = document.getElementById("chukaiOverride").value;
      const chukaiOverride = chukaiOverrideRaw ? Number(chukaiOverrideRaw) : null;
      const staffName = document.getElementById("staffName").value.trim();
      const biko = document.getElementById("biko").value.trim();

      const caseData = EstimateGenerator.buildCase({
        propertyData,
        customerName,
        moveinDate,
        zenyachinUntilYm,
        prorationMethod,
        chukaiOverride,
        staffName,
        biko,
      });

      // 担当者による追加項目を反映
      for (const li of collectLineItems()) caseData.lineItems.push(li);
      caseData.total = caseData.lineItems.reduce((s, li) => s + li.amount, 0);
      for (const mi of collectMonthlyItems()) caseData.monthlyItems.push(mi);

      // ロゴ読み込み
      let logoBuffer = null;
      try {
        const logoResp = await fetch("assets/blue_estate_logo.png");
        if (logoResp.ok) logoBuffer = await logoResp.arrayBuffer();
      } catch (_) {
        /* ロゴが読み込めなくても見積書自体は生成する */
      }

      const wb = EstimateGenerator.renderWorkbook(ExcelJS, caseData, {
        companyName: "BLUE ESTATE",
        logoBuffer,
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const fileName = `${caseData.caseId}_初期費用見積書_${customerName}様.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const monthlyTotal = caseData.monthlyItems.reduce((s, mi) => s + mi.amount, 0);
      showResult(
        "success",
        `<div class="result-row">✅ 見積書を作成しました（ダウンロードフォルダをご確認ください）</div>
         <div class="result-row">案件番号：${caseData.caseId}</div>
         <div class="result-row">初期費用合計：${yen(caseData.total)}</div>
         ${caseData.monthlyItems.length ? `<div class="result-row">月額費用（参考）：${yen(monthlyTotal)}／月</div>` : ""}
         <div class="result-row">ファイル名：${fileName}</div>`
      );
    } catch (err) {
      showResult("error", `⚠️ ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "見積書を作成（Excelダウンロード）";
    }
  });
})();
