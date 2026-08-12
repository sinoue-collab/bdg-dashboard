// 物件ページURLの取得（Netlify Function・AI不使用・費用ゼロ）
//
// ブラウザから直接、他社ドメインの物件ページをfetchするとCORSで弾かれるため、
// ここではサーバー側で代わりに取得するだけの役割を持つ。
// 抽出（正規表現によるフィールド読み取り）はブラウザ側の parse.js が行う。
// AI（外部API）は一切呼び出さないため、追加コストは発生しない。

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json; charset=utf-8" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POSTのみ対応しています。" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "リクエスト形式が不正です。" }) };
  }

  const { url } = payload;
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "urlを指定してください。" }) };
  }

  try {
    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (BDG-estimate-tool)" } });
    if (!resp.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `URLの取得に失敗しました（HTTP ${resp.status}）` }) };
    }
    const html = await resp.text();
    const text = stripHtml(html);
    return { statusCode: 200, headers, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: `取得中にエラーが発生しました：${e.message}` }) };
  }
};
