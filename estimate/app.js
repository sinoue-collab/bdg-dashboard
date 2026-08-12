// 初期費用見積書 作成フォーム — 画面制御
(function () {
  "use strict";

  const yen = (n) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }

  const form = document.getElementById("estimate-form");
  const resultBox = document.getElementById("result");
  const submitBtn = document.getElementById("submit-btn");

  // ---- 物件情報：ITANDI BB / 賃貸革命の画面を見ながら都度入力する ----
  // （物件数が膨大かつ賃料が変動するため、固定の物件マスタは持たない方針）
  function collectPropertyData() {
    const propertyName = document.getElementById("propertyName").value.trim();
    const roomNo = document.getElementById("roomNo").value.trim();
    if (!propertyName) throw new Error("物件名を入力してください。");
    if (!roomNo) throw new Error("部屋番号を入力してください。");

    const rent = Number(document.getElementById("rent").value || 0);
    if (!rent) throw new Error("賃料を入力してください。");

    const hoshouRateRaw = document.getElementById("hoshouRate").value;

    return {
      property_id: "",
      property_name: propertyName,
      room_no: roomNo,
      address: document.getElementById("address").value.trim(),
      rent,
      kyoueki: Number(document.getElementById("kyoueki").value || 0),
      shikikin_months: Number(document.getElementById("shikikinMonths").value || 0),
      reikin_months: Number(document.getElementById("reikinMonths").value || 0),
      hoshou_gaisha: document.getElementById("hoshouGaisha").value.trim(),
      hoshou_ryou_rate: hoshouRateRaw ? Number(hoshouRateRaw) / 100 : 0,
      hoshou_ryou_note: document.getElementById("hoshouNote").value.trim(),
      kagi_koukan_hiyou: Number(document.getElementById("kagiKoukan").value || 0),
      sonota_hiyou: [],
    };
  }

  // ---- 物件情報の自動読み込み（PDF / 貼り付けテキスト） ----
  // このツールはGitHub Pages（サーバー機能を持たない静的ホスティング）で
  // 公開されているため、外部サイトのURLをブラウザから直接取得することは
  // ブラウザの制約（CORS）上できない。そのため「URLを入力すると自動取得」
  // という機能は成立せず、PDFアップロードとテキスト貼り付けの2方式のみに
  // している（どちらもブラウザ内で完結し、サーバーを必要としない）。
  // AIは使わず、正規表現による抽出のみ（費用ゼロ）。
  // 賃料・管理費・敷金礼金・住所のみ自動入力し、保証会社・その他経費は
  // 「参考テキスト」として表示するだけに留め、担当者が③④へ手動で追加する。
  const autofillTabs = document.querySelectorAll(".autofill-tab");
  const autofillPanes = document.querySelectorAll(".autofill-pane");
  autofillTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      autofillTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      autofillPanes.forEach((p) => (p.hidden = p.dataset.pane !== target));
    });
  });

  function setAutofillStatus(type, msg) {
    const box = document.getElementById("autofill-status");
    box.textContent = msg;
    box.className = `hint ${type === "ok" ? "autofill-status-ok" : type === "err" ? "autofill-status-err" : ""}`;
  }

  function setIfEmpty(id, value) {
    const el = document.getElementById(id);
    if (value !== undefined && value !== null && value !== "" && value !== 0) el.value = value;
  }

  async function extractTextFromPdfFile(file) {
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return text;
  }

  function applyExtractedFields(r) {
    setIfEmpty("address", r.address);
    setIfEmpty("rent", r.rent);
    setIfEmpty("kyoueki", r.kyoueki);
    setIfEmpty("shikikinMonths", r.shikikinMonths);
    setIfEmpty("reikinMonths", r.reikinMonths);
    setIfEmpty("kagiKoukan", r.kagiKoukan);

    const foundCount = ["rent", "kyoueki", "shikikinMonths", "reikinMonths", "kagiKoukan", "address"]
      .filter((k) => r[k] !== null && r[k] !== undefined && r[k] !== "").length;

    const refBox = document.getElementById("autofill-reference");
    const refText = document.getElementById("autofill-reference-text");
    if (r.referenceNotes) {
      refText.textContent = r.referenceNotes;
      refBox.hidden = false;
    } else {
      refBox.hidden = true;
    }

    setAutofillStatus(
      "ok",
      `✅ ${foundCount}項目を自動入力しました。物件名・部屋番号・保証会社などは引き続き手入力してください。内容は必ずご確認ください。`
    );
  }

  document.getElementById("autofill-run").addEventListener("click", async () => {
    const activeTab = document.querySelector(".autofill-tab.active").dataset.tab;
    const btn = document.getElementById("autofill-run");
    btn.disabled = true;
    setAutofillStatus("", "読み込み中…");

    try {
      let text;
      if (activeTab === "pdf") {
        const fileInput = document.getElementById("autofillPdf");
        const file = fileInput.files[0];
        if (!file) throw new Error("PDFファイルを選択してください。");
        text = await extractTextFromPdfFile(file);
      } else {
        text = document.getElementById("autofillText").value.trim();
        if (!text) throw new Error("テキストを貼り付けてください。");
      }

      const r = PropertyParser.extractPropertyFields(text);
      applyExtractedFields(r);
    } catch (err) {
      setAutofillStatus("err", `⚠️ ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

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

  // ---- 作成履歴（このパソコンのブラウザ内のみ・localStorage・最大20件） ----
  // サーバーやDBを持たない静的サイトのため、チーム共有の履歴は持てない。
  // 「直近作ったものを呼び戻して微調整したい」というニーズに絞った軽量版。
  const HISTORY_KEY = "bdgEstimateHistory_v1";
  const HISTORY_MAX = 20;

  function getHistory() {
    try {
      return JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function setHistory(list) {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    } catch (_) {
      /* localStorageが使えない環境でも本体機能は動かす */
    }
  }

  function formatHistoryDate(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function buildFormSnapshot(caseId, total) {
    return {
      caseId,
      total,
      savedAt: new Date().toISOString(),
      fields: {
        propertyName: document.getElementById("propertyName").value,
        roomNo: document.getElementById("roomNo").value,
        address: document.getElementById("address").value,
        rent: document.getElementById("rent").value,
        kyoueki: document.getElementById("kyoueki").value,
        shikikinMonths: document.getElementById("shikikinMonths").value,
        reikinMonths: document.getElementById("reikinMonths").value,
        hoshouGaisha: document.getElementById("hoshouGaisha").value,
        hoshouRate: document.getElementById("hoshouRate").value,
        hoshouNote: document.getElementById("hoshouNote").value,
        kagiKoukan: document.getElementById("kagiKoukan").value,
        customerName: document.getElementById("customerName").value,
        staffName: document.getElementById("staffName").value,
        moveinDate: document.getElementById("moveinDate").value,
        zenyachinUntil: document.getElementById("zenyachinUntil").value,
        prorationMethod: document.getElementById("prorationMethod").value,
        chukaiOverride: document.getElementById("chukaiOverride").value,
        biko: document.getElementById("biko").value,
        lineItems: collectLineItems(),
        monthlyItems: collectMonthlyItems(),
      },
    };
  }

  function applyFormSnapshot(snapshot) {
    const f = snapshot.fields;
    document.getElementById("propertyName").value = f.propertyName || "";
    document.getElementById("roomNo").value = f.roomNo || "";
    document.getElementById("address").value = f.address || "";
    document.getElementById("rent").value = f.rent || "";
    document.getElementById("kyoueki").value = f.kyoueki || "";
    document.getElementById("shikikinMonths").value = f.shikikinMonths || "";
    document.getElementById("reikinMonths").value = f.reikinMonths || "";
    document.getElementById("hoshouGaisha").value = f.hoshouGaisha || "";
    document.getElementById("hoshouRate").value = f.hoshouRate || "";
    document.getElementById("hoshouNote").value = f.hoshouNote || "";
    document.getElementById("kagiKoukan").value = f.kagiKoukan || "";
    document.getElementById("customerName").value = f.customerName || "";
    document.getElementById("staffName").value = f.staffName || "";
    document.getElementById("moveinDate").value = f.moveinDate || "";
    document.getElementById("zenyachinUntil").value = f.zenyachinUntil || "";
    document.getElementById("prorationMethod").value = f.prorationMethod || "fixed30";
    document.getElementById("chukaiOverride").value = f.chukaiOverride || "";
    document.getElementById("biko").value = f.biko || "";

    lineItemsContainer.innerHTML = "";
    for (const li of f.lineItems || []) {
      document.getElementById("add-line-item").click();
      const row = lineItemsContainer.querySelector(".dyn-row:last-child");
      row.querySelector(".li-category").value = li.category || "諸費用";
      row.querySelector(".li-name").value = li.name || "";
      row.querySelector(".li-amount").value = li.amount || "";
      row.querySelector(".li-note").value = li.note || "";
    }
    monthlyItemsContainer.innerHTML = "";
    for (const mi of f.monthlyItems || []) {
      document.getElementById("add-monthly-item").click();
      const row = monthlyItemsContainer.querySelector(".dyn-row:last-child");
      row.querySelector(".mi-name").value = mi.name || "";
      row.querySelector(".mi-amount").value = mi.amount || "";
      row.querySelector(".mi-note").value = mi.note || "";
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
    showResult("success", `<div class="result-row">📜 履歴（${snapshot.caseId}）を呼び出しました。内容を確認・修正のうえ、再度作成してください。</div>`);
  }

  function renderHistoryList() {
    const listEl = document.getElementById("history-list");
    const emptyEl = document.getElementById("history-empty");
    const history = getHistory();
    listEl.innerHTML = "";
    if (!history.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    history.forEach((snapshot, idx) => {
      const row = document.createElement("div");
      row.className = "history-item";
      const f = snapshot.fields;
      row.innerHTML = `
        <div class="hi-date">${formatHistoryDate(snapshot.savedAt)}</div>
        <div class="hi-main"><b>${f.propertyName || "（物件名未入力）"}</b> ${f.roomNo || ""}　${f.customerName || ""}様　${snapshot.total ? yen(snapshot.total) : ""}</div>
        <div class="hi-actions">
          <button type="button" class="btn-add hi-load">呼び出す</button>
          <button type="button" class="btn-remove hi-delete">削除</button>
        </div>`;
      row.querySelector(".hi-load").addEventListener("click", () => applyFormSnapshot(snapshot));
      row.querySelector(".hi-delete").addEventListener("click", () => {
        const h = getHistory();
        h.splice(idx, 1);
        setHistory(h);
        renderHistoryList();
      });
      listEl.appendChild(row);
    });
  }

  renderHistoryList();

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
      const propertyData = collectPropertyData();

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

      // 作成履歴（このブラウザ内のみ）に保存
      const snapshot = buildFormSnapshot(caseData.caseId, caseData.total);
      const history = getHistory();
      history.unshift(snapshot);
      setHistory(history);
      renderHistoryList();

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
