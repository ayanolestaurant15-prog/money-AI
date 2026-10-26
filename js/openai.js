const ReceiptAI = (() => {
  const SYSTEM_PROMPT = `あなたは日本のレシート・領収書を家計簿用に正確に読み取る会計士です。
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

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function compressImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      const max = 1200;
      let { width, height } = img;
      if (width > max || height > max) {
        const ratio = Math.min(max / width, max / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function parseWithOpenAI(apiKey, model, dataUrl, blob) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "このレシート画像を解析し、指定のJSONだけを返してください。" },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error && payload.error.message ? payload.error.message : "OpenAI API の呼び出しに失敗しました";
      throw new Error(message);
    }

    const content = payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : "{}";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error("解析結果のJSONを読めませんでした");
    }
    return { parsed: sanitizeParsed(parsed), blob: blob };
  }

  function isGarbledText(value) {
    const s = String(value == null ? "" : value).trim();
    if (!s) return false;
    if (s.indexOf("\uFFFD") !== -1) return true;
    if (/[繧繝]/.test(s)) return true;
    if (/[\u00C0-\u00FF]{2,}/.test(s)) return true;
    if (/[\uE000-\uF8FF]/.test(s)) return true;
    if (/[□■◆?]{2,}/.test(s)) return true;
    const ok = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uff9fa-zA-Z0-9\s・ーｰ.,、。()（）\-/%&+']/g;
    const cleaned = s.replace(ok, "");
    if (s.length >= 2 && cleaned.length / s.length >= 0.3) return true;
    if (/^[A-Z]{5,}$/.test(s) && !/[AEIOU]/.test(s)) return true;
    return false;
  }

  function cleanText(value) {
    const s = String(value == null ? "" : value).trim();
    if (!s || isGarbledText(s)) return "";
    return s;
  }

  function cleanDate(value) {
    const s = String(value == null ? "" : value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    const d = new Date(s + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    return s;
  }

  function cleanNumber(value) {
    if (value === "" || value == null) return "";
    const n = Number(value);
    if (!isFinite(n)) return "";
    return n;
  }

  function sanitizeParsed(data) {
    const src = data || {};
    const methods = ["現金", "クレジットカード", "電子マネー", "QRコード決済", "その他"];
    const categories = ["食費", "日用品", "交通", "趣味・娯楽", "衣服", "医療", "光熱費", "通信", "教育", "交際費", "住宅", "その他"];
    const pay = cleanText(src.payment_method || src.paymentMethod);
    const category = cleanText(src.category);
    const items = Array.isArray(src.items) ? src.items : [];
    return {
      merchant: cleanText(src.merchant),
      date: cleanDate(src.date),
      time: cleanText(src.time),
      items: items.map(function (item) {
        return {
          name: cleanText(item && item.name),
          quantity: item && item.quantity != null ? item.quantity : 1,
          amount: cleanNumber(item && item.amount),
        };
      }),
      subtotal: cleanNumber(src.subtotal),
      tax: cleanNumber(src.tax),
      total: cleanNumber(src.total != null ? src.total : src.amount),
      payment_method: methods.indexOf(pay) >= 0 ? pay : "",
      category: categories.indexOf(category) >= 0 ? category : "",
      notes: cleanText(src.notes),
    };
  }

  async function parseReceipt(apiKey, model, file) {
    const blob = await compressImage(file);
    const dataUrl = await blobToDataUrl(blob);
    return parseWithOpenAI(apiKey, model, dataUrl, blob);
  }

  return {
    parseReceipt: parseReceipt,
    compressImage: compressImage,
    blobToDataUrl: blobToDataUrl,
    parseWithOpenAI: parseWithOpenAI,
    sanitizeParsed: sanitizeParsed,
  };
})();
