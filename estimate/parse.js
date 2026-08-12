// 物件資料テキストからの項目抽出（正規表現ベース・AI不使用・費用ゼロ）
//
// 方針：
//   ・「はっきり書いてある数値」（賃料/管理費/敷金/礼金）だけを狙って拾う。
//   ・読み取れなかった項目は 0 / 空文字のままにし、絶対に推測で埋めない。
//   ・保証会社・その他経費（鍵交換費用、町内会費など）は書き方が資料ごとに
//     バラバラで機械的に安全に分解できないため、自動入力の対象にしない。
//     代わりに、それらが含まれていそうな本文の一部を「参考テキスト」として
//     切り出し、担当者が読んで③④に手入力する材料として提示する。
//   ・対応済みの資料パターン：
//       (a) 3nosuke.jp系の物件詳細ページ（表形式：家賃|管理費/共益費|礼金|敷金/保証金）
//       (b) マイソク/物件確認書系のPDF（インライン形式：「賃料 49,500円」等）
//     未知の書式では何も自動入力されないことがある（安全側に倒す設計）。

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PropertyParser = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  function toYenFromManEn(str) {
    const n = parseFloat(str);
    return Math.round(n * 10000);
  }
  function toYenFromEn(str) {
    return Number(String(str).replace(/,/g, ""));
  }
  function toMonths(str) {
    return parseFloat(str);
  }

  // "4.8万円" / "49,500円" / "-" などの1個の金額表現を円に変換する。無ければnull。
  function parseMoneyToken(tok) {
    if (!tok) return null;
    tok = tok.trim();
    if (tok === "-" || tok === "―" || tok === "無" || tok === "") return 0;
    let m = tok.match(/^(\d+(?:\.\d+)?)\s*万円$/);
    if (m) return toYenFromManEn(m[1]);
    m = tok.match(/^([\d,]+)\s*円$/);
    if (m) return toYenFromEn(m[1]);
    return null;
  }
  // "1ヶ月" / "-" などの月数表現をヶ月に変換する。無ければnull。
  function parseMonthsToken(tok) {
    if (!tok) return null;
    tok = tok.trim();
    if (tok === "-" || tok === "―" || tok === "無" || tok === "") return 0;
    const m = tok.match(/^(\d+(?:\.\d+)?)\s*ヶ月$/);
    if (m) return toMonths(m[1]);
    return null;
  }

  // 単独の "-"（未設定を表す）のみ許可し、区切り線の "----" 等は誤検出しないようにする
  const VALUE_TOKEN = "(?:\\d+(?:\\.\\d+)?\\s*万円|[\\d,]+\\s*円|\\d+(?:\\.\\d+)?\\s*ヶ月|(?<!-)-(?!-)|―)";

  // Markdownの表区切り線（| --- | --- |）やパイプ記号を取り除く。
  // 生HTMLをタグ除去した本文には通常出てこないが、資料の取得経路によって
  // 似た記法が混ざる可能性があるための安全策。
  function preprocess(text) {
    return text
      .split("\n")
      .filter((line) => !/^[\s|:\-]+$/.test(line))
      .join("\n")
      .replace(/\|/g, " ");
  }

  function extractInline(text, result) {
    // (b) マイソク/物件確認書系：ラベルの直後に値が来る形式
    let m;
    if (result.rent === null) {
      m = text.match(/(?:賃料|家賃)\s*[:：]?\s*(\d+(?:\.\d+)?\s*万円|[\d,]+\s*円)/);
      if (m) result.rent = parseMoneyToken(m[1]);
    }
    if (result.kyoueki === null) {
      m = text.match(/(?:管理費|共益費)\s*[:：]?\s*(\d+(?:\.\d+)?\s*万円|[\d,]+\s*円)/);
      if (m) result.kyoueki = parseMoneyToken(m[1]);
    }
    // 「礼金 0 ヶ月 ・ 敷金 0 円」のような並び（PDF系でよく見る形）
    m = text.match(/礼金\s*(\d+(?:\.\d+)?)\s*ヶ月[\s・]{0,12}敷金\s*([\d,]+)\s*円/);
    if (m) {
      if (result.reikinMonths === null) result.reikinMonths = toMonths(m[1]);
      if (result.shikikinYen === null) result.shikikinYen = toYenFromEn(m[2]);
    }
    if (result.reikinMonths === null) {
      m = text.match(/礼金\s*[:：]?\s*(\d+(?:\.\d+)?)\s*ヶ月/);
      if (m) result.reikinMonths = toMonths(m[1]);
    }
    if (result.shikikinMonths === null && result.shikikinYen === null) {
      m = text.match(/敷金\s*[:：]?\s*(\d+(?:\.\d+)?)\s*ヶ月/);
      if (m) result.shikikinMonths = toMonths(m[1]);
    }
    if (result.kagiKoukan === null) {
      m = text.match(/鍵交換(?:費用|代)\s*[:：]?\s*(\d+(?:\.\d+)?\s*万円|[\d,]+\s*円)/);
      if (m) result.kagiKoukan = parseMoneyToken(m[1]);
    }
    if (result.address === null) {
      m = text.match(/所在\s+([^\s]{4,30}?)(?=\s|間取|$)/);
      if (m) result.address = m[1];
    }
  }

  function extractTableBlock(text, result) {
    // (a) 3nosuke.jp系：ヘッダー行の直後に値がまとまって並ぶ表形式
    const headerPattern =
      /家賃\s*\|?\s*管理費\s*\/\s*共益費\s*\|?\s*礼金\s*\|?\s*敷金\s*\/\s*保証金\s*\|?\s*間取り\s*\|?\s*専有面積/;
    const hm = text.match(headerPattern);
    if (!hm) return;
    const rest = text.slice(hm.index + hm[0].length);
    const valueRe = new RegExp(VALUE_TOKEN, "g");
    const values = [];
    let vm;
    while ((vm = valueRe.exec(rest)) && values.length < 4) {
      values.push(vm[0]);
    }
    if (values.length === 4) {
      if (result.rent === null) result.rent = parseMoneyToken(values[0]);
      if (result.kyoueki === null) result.kyoueki = parseMoneyToken(values[1]);
      if (result.reikinMonths === null) result.reikinMonths = parseMonthsToken(values[2]);
      if (result.shikikinMonths === null) result.shikikinMonths = parseMonthsToken(values[3]);
    }
    if (result.address === null) {
      const am = text.match(/所在地\s*\|?\s*([^\n|]{4,30}?)(?=\s*\||\n|$)/);
      if (am) result.address = am[1].trim();
    }
  }

  // その他経費・特記事項・保証会社の記載を、担当者が読む用の参考テキストとして切り出す。
  // 数値としては使わず、そのまま画面に表示するだけ（自動入力はしない）。
  function extractReferenceNotes(text) {
    const labels = ["保証会社", "その他経費", "その他費用", "特記事項"];
    const stopLabels = ["周辺環境", "設備", "備考", "契約期間", "駐車場"];
    const boundaries = []; // {idx, isStart}
    for (const label of labels) {
      const idx = text.indexOf(label);
      if (idx !== -1) boundaries.push(idx);
    }
    for (const stop of stopLabels) {
      const idx = text.indexOf(stop);
      if (idx !== -1) boundaries.push(idx);
    }
    boundaries.sort((a, b) => a - b);

    const chunks = [];
    for (const label of labels) {
      const idx = text.indexOf(label);
      if (idx === -1) continue;
      const nextBoundary = boundaries.find((b) => b > idx);
      const end = Math.min(nextBoundary !== undefined ? nextBoundary : text.length, idx + 500);
      const chunk = text.slice(idx, end).trim();
      if (chunk) chunks.push(chunk);
    }
    return chunks.join("\n");
  }

  /**
   * @param {string} text 資料から取得した生テキスト（HTMLタグ除去済み、またはPDFのテキスト抽出結果）
   * @returns {{rent:number|null, kyoueki:number|null, shikikinMonths:number|null, reikinMonths:number|null,
   *            shikikinYen:number|null, kagiKoukan:number|null, address:string|null, referenceNotes:string}}
   */
  function extractPropertyFields(rawText) {
    const text = preprocess(rawText);
    const result = {
      rent: null,
      kyoueki: null,
      shikikinMonths: null,
      reikinMonths: null,
      shikikinYen: null,
      kagiKoukan: null,
      address: null,
    };
    extractInline(text, result);
    extractTableBlock(text, result);

    // 敷金が円額でしか分からず、賃料も判明している場合のみ、参考としてヶ月に換算する
    if (result.shikikinMonths === null && result.shikikinYen !== null && result.rent) {
      result.shikikinMonths = Math.round((result.shikikinYen / result.rent) * 2) / 2;
    }

    result.referenceNotes = extractReferenceNotes(text);
    return result;
  }

  return { extractPropertyFields };
});
