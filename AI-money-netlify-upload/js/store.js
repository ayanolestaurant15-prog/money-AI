const Store = (() => {
  const state = {
    mode: "local",
    info: null,
    needPin: false,
  };

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    const pin = sessionStorage.getItem("kakeibo.pin") || "";
    if (pin) headers["X-Access-Pin"] = pin;
    return headers;
  }

  async function apiFetch(url, options) {
    const opts = options || {};
    const res = await fetch(
      url,
      Object.assign({}, opts, {
        headers: authHeaders(opts.headers),
        cache: "no-store",
      })
    );
    if (res.status === 401) {
      state.needPin = true;
      const err = new Error("pin required");
      err.pinRequired = true;
      throw err;
    }
    return res;
  }

  async function init() {
    state.needPin = false;
    try {
      const res = await apiFetch("/api/info");
      if (!res.ok) throw new Error("no api");
      state.info = await res.json();
      state.mode = "server";
      await migrateLocalIfNeeded();
    } catch (err) {
      if (err.pinRequired) {
        state.mode = "server";
        state.info = { hosted: true, lanUrls: [location.origin + "/"] };
        return state;
      }
      state.mode = "local";
      state.info = null;
    }
    return state;
  }

  async function migrateLocalIfNeeded() {
    if (localStorage.getItem("kakeibo.migrated") === "1") return;
    let rows = [];
    try {
      rows = await KakeiboDB.getAllTransactions();
    } catch (err) {
      rows = [];
    }
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      await putTransaction(row);
      if (row.imageId) {
        const blob = await KakeiboDB.getImage(row.imageId);
        if (blob) await putImage(row.imageId, blob);
      }
    }
    const apiKey = localStorage.getItem("kakeibo.apiKey") || "";
    const model = localStorage.getItem("kakeibo.model") || "gpt-4o-mini";
    if (apiKey) await saveSettings({ apiKey: apiKey, model: model });
    localStorage.setItem("kakeibo.migrated", "1");
  }

  async function getAllTransactions() {
    if (state.mode !== "server") return KakeiboDB.getAllTransactions();
    const res = await apiFetch("/api/transactions");
    if (!res.ok) throw new Error("明細の取得に失敗しました");
    const rows = await res.json();
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  async function putTransaction(row) {
    if (state.mode !== "server") return KakeiboDB.putTransaction(row);
    const res = await apiFetch("/api/transactions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error("保存に失敗しました");
  }

  async function deleteTransaction(id) {
    if (state.mode !== "server") return KakeiboDB.deleteTransaction(id);
    const res = await apiFetch("/api/transactions/" + encodeURIComponent(id), { method: "DELETE" });
    if (!res.ok) throw new Error("削除に失敗しました");
  }

  async function putImage(id, blob) {
    if (state.mode !== "server") return KakeiboDB.putImage(id, blob);
    const res = await apiFetch("/api/images/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "Content-Type": blob.type || "image/jpeg" },
      body: blob,
    });
    if (!res.ok) throw new Error("画像の保存に失敗しました");
  }

  async function getImage(id) {
    if (state.mode !== "server") return KakeiboDB.getImage(id);
    const res = await apiFetch("/api/images/" + encodeURIComponent(id));
    if (!res.ok) return null;
    return res.blob();
  }

  async function clearAll() {
    if (state.mode !== "server") return KakeiboDB.clearAll();
    const res = await apiFetch("/api/clear", { method: "POST" });
    if (!res.ok) throw new Error("削除に失敗しました");
  }

  async function getSettings() {
    if (state.mode !== "server") {
      const apiKey = localStorage.getItem("kakeibo.apiKey") || "";
      return {
        apiKey: apiKey,
        model: localStorage.getItem("kakeibo.model") || "gpt-4o-mini",
        hasApiKey: Boolean(apiKey),
      };
    }
    const res = await apiFetch("/api/settings");
    if (!res.ok) throw new Error("設定の取得に失敗しました");
    return res.json();
  }

  async function saveSettings(payload) {
    if (state.mode !== "server") {
      if (payload.apiKey) localStorage.setItem("kakeibo.apiKey", payload.apiKey);
      if (payload.model) localStorage.setItem("kakeibo.model", payload.model);
      return;
    }
    const res = await apiFetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("設定の保存に失敗しました");
  }

  async function parseReceipt(blob) {
    const dataUrl = await ReceiptAI.blobToDataUrl(blob);
    if (state.mode !== "server") {
      const s = await getSettings();
      return ReceiptAI.parseWithOpenAI(s.apiKey, s.model, dataUrl, blob);
    }
    const res = await apiFetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || "読み取りに失敗しました");
    }
    return { parsed: ReceiptAI.sanitizeParsed(payload), blob: blob };
  }

  return {
    init: init,
    isServer: function () {
      return state.mode === "server";
    },
    needPin: function () {
      return state.needPin;
    },
    setPin: function (pin) {
      sessionStorage.setItem("kakeibo.pin", pin);
      state.needPin = false;
    },
    info: function () {
      return state.info;
    },
    getAllTransactions: getAllTransactions,
    putTransaction: putTransaction,
    deleteTransaction: deleteTransaction,
    putImage: putImage,
    getImage: getImage,
    clearAll: clearAll,
    getSettings: getSettings,
    saveSettings: saveSettings,
    parseReceipt: parseReceipt,
  };
})();
