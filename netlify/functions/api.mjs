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

function envVal(name) {
  return String(process.env[name] || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

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
  const forwarded = header(event, "x-forwarded-uri") || header(event, "x-original-uri");
  if (forwarded) list.push(String(forwarded).split("?")[0]);
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
  const need = envVal("ACCESS_PIN");
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

function blobs() {
  return getStore("kakeibo");
}

async function loadRows(store) {
  const rows = await store.get("transactions", { type: "json" });
  return Array.isArray(rows) ? rows : [];
}

async function saveRows(store, rows) {
  await store.setJSON("transactions", rows);
}

async function loadList(store, key) {
  const rows = await store.get(key, { type: "json" });
  return Array.isArray(rows) ? rows : [];
}

async function saveList(store, key, rows) {
  await store.setJSON(key, rows);
}

function upsertRow(rows, row) {
  let replaced = false;
  const next = rows.map((item) => {
    if (sameId(item.id, row.id)) {
      replaced = true;
      return row;
    }
    return item;
  });
  if (!replaced) next.push(row);
  return next;
}

async function loadSettings(store) {
  const s = await store.get("settings", { type: "json" });
  return s && typeof s === "object" ? s : { model: "gpt-4o-mini", apiKey: "" };
}

function parseModelJson(content) {
  const text = String(content || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (err) {}
  }
  return null;
}

function openaiErrorMessage(payload, status) {
  const raw = payload && payload.error && payload.error.message ? payload.error.message : "";
  const s = String(raw).toLowerCase();
  if (status === 401 || s.indexOf("invalid api key") >= 0 || s.indexOf("incorrect api key") >= 0) {
    return "OpenAI の API キーが無効です。Netlify の環境変数 OPENAI_API_KEY を確認し、再デプロイしてください。";
  }
  if (status === 429 || s.indexOf("quota") >= 0 || s.indexOf("insufficient") >= 0) {
    return "OpenAI の利用枠または支払い設定を確認してください。";
  }
  if (raw) return raw;
  return "OpenAI API error";
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {});
  }

  const path = apiPath(event);
  const method = (event.httpMethod || "GET").toUpperCase();

  if (!pinOk(event)) {
    return json(401, { error: "暗証番号が違います", pinRequired: true });
  }

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
        hasApiKey: Boolean(envVal("OPENAI_API_KEY")),
      });
    }

    const store = blobs();

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
      const envKey = envVal("OPENAI_API_KEY");
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
      const envKey = envVal("OPENAI_API_KEY");
      return json(200, { ok: true, hasApiKey: Boolean(envKey || s.apiKey) });
    }

    if (path === "/api/recurring" && method === "GET") {
      return json(200, await loadList(store, "recurring"));
    }

    if (path === "/api/recurring" && method === "PUT") {
      const row = JSON.parse(readBody(event).toString("utf8") || "{}");
      if (!row.id) return json(400, { error: "id required" });
      const next = upsertRow(await loadList(store, "recurring"), row);
      await saveList(store, "recurring", next);
      return json(200, { ok: true });
    }

    if (path.startsWith("/api/recurring/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/api/recurring/".length));
      const kept = (await loadList(store, "recurring")).filter((item) => !sameId(item.id, id));
      await saveList(store, "recurring", kept);
      return json(200, { ok: true });
    }

    if (path === "/api/planned" && method === "GET") {
      return json(200, await loadList(store, "planned"));
    }

    if (path === "/api/planned" && method === "PUT") {
      const row = JSON.parse(readBody(event).toString("utf8") || "{}");
      if (!row.id) return json(400, { error: "id required" });
      const next = upsertRow(await loadList(store, "planned"), row);
      await saveList(store, "planned", next);
      return json(200, { ok: true });
    }

    if (path.startsWith("/api/planned/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/api/planned/".length));
      const kept = (await loadList(store, "planned")).filter((item) => !sameId(item.id, id));
      await saveList(store, "planned", kept);
      return json(200, { ok: true });
    }

    if (path === "/api/clear" && method === "POST") {
      await saveRows(store, []);
      await saveList(store, "recurring", []);
      await saveList(store, "planned", []);
      return json(200, { ok: true });
    }

    if (path === "/api/parse" && method === "POST") {
      let s = { model: "gpt-4o-mini", apiKey: "" };
      try {
        s = await loadSettings(store);
      } catch (err) {}
      const apiKey = envVal("OPENAI_API_KEY") || String(s.apiKey || "").trim();
      if (!apiKey) {
        return json(400, {
          error: "OpenAI の API キーが見つかりません。Netlify の環境変数 OPENAI_API_KEY を入れ、再デプロイしてください。",
        });
      }
      const incoming = JSON.parse(readBody(event).toString("utf8") || "{}");
      const dataUrl = String(incoming.image || "");
      if (!dataUrl) return json(400, { error: "画像がありません" });
      if (dataUrl.length > 3500000) {
        return json(413, { error: "画像が大きすぎます。もう少し遠くから明るく撮ってください。" });
      }
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
        return json(502, { error: openaiErrorMessage(payload, resp.status) });
      }
      const content =
        payload.choices && payload.choices[0] && payload.choices[0].message
          ? payload.choices[0].message.content
          : "{}";
      const parsed = parseModelJson(content);
      if (!parsed || typeof parsed !== "object") {
        return json(502, { error: "解析結果をJSONとして読めませんでした" });
      }
      return json(200, parsed);
    }

    return json(404, { error: "not found", path: path });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    if (/timed? ?out|aborted|deadline/i.test(message)) {
      return json(504, { error: "読み取りが時間切れになりました。明るい場所で、文字が大きく写るように撮ってください。" });
    }
    return json(500, { error: message || "server error" });
  }
}
