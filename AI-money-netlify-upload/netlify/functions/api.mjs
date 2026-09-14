import { getStore } from "@netlify/blobs";

const PROMPT = `あなたは日本のレシート・領収書を家計簿用に正確に読み取る会計士です。
画像から次のJSONだけを返してください。推測で埋めず、読めない項目は空文字または0にしてください。

{
  "merchant": "店名",
  "date": "YYYY-MM-DD",
  "time": "HH:MM または空文字",
  "items": [{"name": "品名", "quantity": 1, "amount": 0}],
  "subtotal": 0,
  "tax": 0,
  "total": 0,
  "payment_method": "現金 | クレジットカード | 電子マネー | QRコード決済 | その他",
  "category": "食費 | 日用品 | 交通 | 趣味・娯楽 | 衣服 | 医療 | 光熱費 | 通信 | 教育 | 交際費 | 住宅 | その他",
  "notes": "補足があれば"
}

ルール:
- 金額は円の整数。カンマや円記号は付けない。
- total は支払い合計。税込合計が分かる場合はそれを使う。
- 費目は品目全体から最も適切な1つ。確信がなければ空文字。
- 日付が西暦でない（令和など）場合は西暦に変換する。日付が読めない・文字化けなら空文字。
- 文字が潰れている、一部しか読めない、文字化けしそうな店名・品名・メモは推測せず空文字。
- レシートでない画像なら merchant を空、total を 0、notes は空文字。`;

function json(status, obj, extraHeaders) {
  return {
    statusCode: status,
    headers: Object.assign(
      {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Access-Pin",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      },
      extraHeaders || {}
    ),
    body: JSON.stringify(obj),
  };
}

function apiPath(event) {
  const list = [event.path, event.rawPath];
  if (event.rawUrl) {
    try {
      list.push(new URL(event.rawUrl).pathname);
    } catch (err) {}
  }
  for (let i = 0; i < list.length; i += 1) {
    let p = list[i];
    if (!p) continue;
    p = p.split("?")[0].replace(/^\/\.netlify\/functions\/api/, "");
    if (!p.startsWith("/")) p = "/" + p;
    if (p === "/") continue;
    if (p.startsWith("/api/")) return p;
    return "/api" + p;
  }
  return "/api/info";
}

function header(event, name) {
  const headers = event.headers || {};
  const want = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === want) return headers[keys[i]];
  }
  return "";
}

function pinOk(event) {
  const need = (process.env.ACCESS_PIN || "").trim();
  if (!need) return true;
  const got = (header(event, "x-access-pin") || "").trim();
  return got === need;
}

function readBody(event) {
  if (!event.body) return Buffer.alloc(0);
  return event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body, "utf8");
}

function sameId(a, b) {
  return String(a || "").trim() === String(b || "").trim();
}

async function loadRows(store) {
  const rows = await store.get("transactions", { type: "json" });
  return Array.isArray(rows) ? rows : [];
}

async function saveRows(store, rows) {
  await store.setJSON("transactions", rows);
}

async function loadSettings(store) {
  const s = await store.get("settings", { type: "json" });
  return s && typeof s === "object" ? s : { model: "gpt-4o-mini", apiKey: "" };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }

  const path = apiPath(event);
  const method = (event.httpMethod || "GET").toUpperCase();

  if (!pinOk(event)) {
    return json(401, { error: "pin required", pinRequired: true });
  }

  const store = getStore("kakeibo");

  try {
    if (path === "/api/info" && method === "GET") {
      const host = header(event, "x-forwarded-host") || header(event, "host") || "";
      const proto = header(event, "x-forwarded-proto") || "https";
      const origin = host ? proto + "://" + host + "/" : "";
      return json(200, {
        ok: true,
        hosted: true,
        port: 443,
        lanUrls: origin ? [origin] : [],
      });
    }

    if (path === "/api/transactions" && method === "GET") {
      return json(200, await loadRows(store));
    }

    if (path === "/api/transactions" && method === "PUT") {
      const row = JSON.parse(readBody(event).toString("utf8") || "{}");
      if (!row.id) return json(400, { error: "id required" });
      const rows = await loadRows(store);
      let replaced = false;
      const next = rows.map((item) => {
        if (sameId(item.id, row.id)) {
          replaced = true;
          return row;
        }
        return item;
      });
      if (!replaced) next.push(row);
      await saveRows(store, next);
      return json(200, { ok: true });
    }

    if (path.startsWith("/api/transactions/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/api/transactions/".length));
      const rows = await loadRows(store);
      const kept = rows.filter((item) => !sameId(item.id, id));
      await saveRows(store, kept);
      const safe = id.replace(/[^a-zA-Z0-9._-]/g, "");
      if (safe) {
        try {
          await store.delete("image:" + safe);
        } catch (err) {}
      }
      return json(200, { ok: true, remaining: kept.length });
    }

    if (path.startsWith("/api/images/") && method === "GET") {
      const id = decodeURIComponent(path.slice("/api/images/".length)).replace(/[^a-zA-Z0-9._-]/g, "");
      const file = await store.get("image:" + id, { type: "arrayBuffer" });
      if (!file) return { statusCode: 404, body: "missing" };
      return {
        statusCode: 200,
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
        body: Buffer.from(file).toString("base64"),
        isBase64Encoded: true,
      };
    }

    if (path.startsWith("/api/images/") && method === "PUT") {
      const id = decodeURIComponent(path.slice("/api/images/".length)).replace(/[^a-zA-Z0-9._-]/g, "");
      if (!id) return json(400, { error: "bad id" });
      await store.set("image:" + id, readBody(event), { metadata: { contentType: "image/jpeg" } });
      return json(200, { ok: true });
    }

    if (path === "/api/settings" && method === "GET") {
      const s = await loadSettings(store);
      const envKey = (process.env.OPENAI_API_KEY || "").trim();
      return json(200, {
        hasApiKey: Boolean(envKey || (s.apiKey && String(s.apiKey).trim())),
        model: s.model || "gpt-4o-mini",
      });
    }

    if (path === "/api/settings" && method === "PUT") {
      const incoming = JSON.parse(readBody(event).toString("utf8") || "{}");
      const s = await loadSettings(store);
      if (incoming.model) s.model = String(incoming.model);
      if (incoming.apiKey && String(incoming.apiKey).trim()) s.apiKey = String(incoming.apiKey).trim();
      await store.setJSON("settings", s);
      const envKey = (process.env.OPENAI_API_KEY || "").trim();
      return json(200, { ok: true, hasApiKey: Boolean(envKey || s.apiKey) });
    }

    if (path === "/api/clear" && method === "POST") {
      await saveRows(store, []);
      return json(200, { ok: true });
    }

    if (path === "/api/parse" && method === "POST") {
      const s = await loadSettings(store);
      const apiKey = (process.env.OPENAI_API_KEY || "").trim() || String(s.apiKey || "").trim();
      if (!apiKey) return json(400, { error: "OpenAI API key is not set" });
      const incoming = JSON.parse(readBody(event).toString("utf8") || "{}");
      const dataUrl = String(incoming.image || "");
      if (!dataUrl) return json(400, { error: "image is required" });
      const model = s.model || "gpt-4o-mini";
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Parse this receipt and return the specified JSON only." },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const message = payload.error && payload.error.message ? payload.error.message : "OpenAI API error";
        return json(502, { error: message });
      }
      const content =
        payload.choices && payload.choices[0] && payload.choices[0].message
          ? payload.choices[0].message.content
          : "{}";
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: content,
      };
    }

    return json(404, { error: "not found", path: path });
  } catch (err) {
    return json(500, { error: err.message || "server error" });
  }
}
