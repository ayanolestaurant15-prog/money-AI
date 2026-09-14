const CATEGORIES = [
  "食費",
  "日用品",
  "交通",
  "趣味・娯楽",
  "衣服",
  "医療",
  "光熱費",
  "通信",
  "教育",
  "交際費",
  "住宅",
  "その他",
];

const TITLES = {
  dashboard: ["今月の流れ", "概要"],
  capture: ["写真から記帳", "レシート取込"],
  ledger: ["すべての記録", "明細"],
  reports: ["使い方の傾向", "レポート"],
  settings: ["APIキーと保存先", "設定"],
};

const App = (() => {
  const state = {
    view: "dashboard",
    month: startOfMonth(new Date()),
    transactions: [],
    pendingImage: null,
    editingId: null,
    busy: false,
  };

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "t" + Date.now().toString(16) + Math.random().toString(16).slice(2);
  }

  function yen(n) {
    return Charts.yen(n);
  }

  function formatMonth(date) {
    return date.getFullYear() + "年" + (date.getMonth() + 1) + "月";
  }

  function toDateInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function parseIsoDate(value) {
    if (!value) return null;
    const d = new Date(String(value).slice(0, 10) + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  function normalizeReceiptDate(value) {
    const now = new Date();
    const parsed = parseIsoDate(value);
    if (!parsed) return toDateInput(now);
    if (parsed.getFullYear() === now.getFullYear()) return toDateInput(parsed);
    const sameMd = new Date(now.getFullYear(), parsed.getMonth(), parsed.getDate());
    if (sameMd.getTime() - now.getTime() > 2 * 86400000) return toDateInput(now);
    return toDateInput(sameMd);
  }

  function goToMonthOf(dateValue) {
    const d = parseIsoDate(dateValue);
    if (d) state.month = startOfMonth(d);
  }

  function otherMonthHint() {
    const currentKey = toDateInput(state.month).slice(0, 7);
    const counts = {};
    state.transactions.forEach((row) => {
      if (!row.date) return;
      const key = String(row.date).slice(0, 7);
      if (key === currentKey) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    const keys = Object.keys(counts).sort().reverse();
    if (!keys.length) return "";
    return (
      '<p class="empty-hint">別の月に記録があります：' +
      keys
        .map((key) => {
          const parts = key.split("-");
          const label = Number(parts[0]) + "年" + Number(parts[1]) + "月（" + counts[key] + "件）";
          return '<button type="button" class="text-btn" data-month="' + key + '">' + label + "</button>";
        })
        .join("　") +
      "</p>"
    );
  }

  function inSelectedMonth(row) {
    return row.date && row.date.startsWith(toDateInput(state.month).slice(0, 7));
  }

  function monthRows() {
    return state.transactions.filter(inSelectedMonth);
  }

  function previousMonthRows() {
    const prev = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    const key = toDateInput(prev).slice(0, 7);
    return state.transactions.filter((row) => row.date && row.date.startsWith(key));
  }

  function toast(message) {
    const el = document.getElementById("toast");
    el.hidden = false;
    el.textContent = message;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 2800);
  }

  async function settings() {
    return Store.getSettings();
  }

  function fillCategorySelect(select, selected) {
    select.innerHTML =
      '<option value="">（未入力）</option>' +
      CATEGORIES.map((c) => `<option${c === selected ? " selected" : ""}>${c}</option>`).join("");
  }

  function itemRow(item) {
    const name = item && item.name ? item.name : "";
    const qty = item && item.quantity != null ? item.quantity : 1;
    const amount = item && item.amount != null ? item.amount : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${escapeAttr(name)}" data-k="name" placeholder="品名"></td>
      <td><input type="number" step="1" min="0" value="${escapeAttr(qty)}" data-k="quantity"></td>
      <td><input type="number" step="1" value="${escapeAttr(amount)}" data-k="amount"></td>
      <td><button type="button" class="icon-btn" data-remove>&times;</button></td>
    `;
    tr.querySelector("[data-remove]").addEventListener("click", () => tr.remove());
    return tr;
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function readItems() {
    return Array.from(document.querySelectorAll("#item-body tr")).map((tr) => {
      const get = (k) => tr.querySelector('[data-k="' + k + '"]').value;
      return {
        name: get("name"),
        quantity: Number(get("quantity") || 0),
        amount: Number(get("amount") || 0),
      };
    });
  }

  function setView(name) {
    state.view = name;
    document.querySelectorAll(".view").forEach((el) => {
      const active = el.id === "view-" + name;
      el.classList.toggle("is-active", active);
      el.hidden = !active;
    });
    document.querySelectorAll(".nav-btn").forEach((el) => el.classList.toggle("is-active", el.dataset.view === name));
    const [eyebrow, title] = TITLES[name];
    document.getElementById("view-eyebrow").textContent = eyebrow;
    document.getElementById("view-title").textContent = title;
    render();
  }

  function renderShell() {
    document.getElementById("month-label").textContent = formatMonth(state.month);
    const total = monthRows().reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    document.getElementById("rail-expense").textContent = yen(total);
  }

  function renderDashboard() {
    const rows = monthRows();
    const prev = previousMonthRows();
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const prevTotal = prev.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const daysPassed = Math.min(
      new Date().getFullYear() === state.month.getFullYear() && new Date().getMonth() === state.month.getMonth()
        ? new Date().getDate()
        : new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0).getDate(),
      new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0).getDate()
    );
    const avg = daysPassed ? total / daysPassed : 0;
    const count = rows.length;
    const diff = total - prevTotal;
    const diffLabel = prevTotal === 0 ? "先月のデータなし" : (diff >= 0 ? "先月より " + yen(diff) + " 増" : "先月より " + yen(-diff) + " 減");

    document.getElementById("stat-grid").innerHTML = [
      ["支出合計", yen(total), diffLabel],
      ["件数", count + " 件", "レシートと手入力"],
      ["1日あたり", yen(avg), daysPassed + " 日で平均"],
      ["最多費目", topCategory(rows), "この月の内訳"],
    ]
      .map(
        ([label, value, note]) =>
          `<article class="stat"><p class="muted">${label}</p><p class="stat-value">${value}</p><p class="stat-note">${note}</p></article>`
      )
      .join("");

    Charts.categoryBars(document.getElementById("dash-categories"), rows, CATEGORIES);
    const recent = rows.slice(0, 6);
    document.getElementById("dash-recent").innerHTML = recent.length
      ? recent.map(transactionRow).join("")
      : '<p class="empty">この月の記録はまだありません。</p>' + otherMonthHint();
  }

  function topCategory(rows) {
    const map = {};
    rows.forEach((row) => {
      map[row.category] = (map[row.category] || 0) + (Number(row.amount) || 0);
    });
    const top = Object.entries(map).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : "—";
  }

  function transactionRow(row) {
    return `<div class="tx">
      <div class="tx-main">
        <p class="tx-title">${escapeAttr(row.merchant || "（店名なし）")}</p>
        <p class="tx-meta"><span class="badge">${escapeAttr(row.category || "その他")}</span>${escapeAttr(row.date)}　${escapeAttr(row.paymentMethod || "")}</p>
      </div>
      <div class="yen">${yen(row.amount)}</div>
    </div>`;
  }

  function renderLedger() {
    const q = document.getElementById("search").value.trim();
    const cat = document.getElementById("filter-category").value;
    const rows = monthRows().filter((row) => {
      const hay = (row.merchant + " " + row.category + " " + (row.notes || "") + " " + (row.items || []).map((i) => i.name).join(" ")).toLowerCase();
      const okQ = !q || hay.includes(q.toLowerCase());
      const okC = !cat || row.category === cat;
      return okQ && okC;
    });
    if (!rows.length) {
      document.getElementById("ledger-table").innerHTML =
        '<p class="empty">この月の明細はありません。</p>' + otherMonthHint();
      return;
    }
    document.getElementById("ledger-table").innerHTML = `
      <table>
        <thead>
          <tr><th>日付</th><th>店名</th><th>費目</th><th>支払い</th><th>金額</th><th></th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
                <td>${escapeAttr(row.date)}</td>
                <td>${escapeAttr(row.merchant || "")}</td>
                <td>${escapeAttr(row.category || "")}</td>
                <td>${escapeAttr(row.paymentMethod || "")}</td>
                <td class="yen">${yen(row.amount)}</td>
                <td>
                  <button class="text-btn" data-open="${row.id}">詳細</button>
                  <button class="text-btn" data-del="${row.id}">削除</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  function renderReports() {
    const rows = monthRows();
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const prevTotal = previousMonthRows().reduce((s, r) => s + (Number(r.amount) || 0), 0);
    document.getElementById("report-stats").innerHTML = [
      ["今月", yen(total), rows.length + " 件"],
      ["先月", yen(prevTotal), "比較用"],
      ["差額", yen(total - prevTotal), total >= prevTotal ? "増加" : "減少"],
      ["平均単価", yen(rows.length ? total / rows.length : 0), "1件あたり"],
    ]
      .map(
        ([label, value, note]) =>
          `<article class="stat"><p class="muted">${label}</p><p class="stat-value">${value}</p><p class="stat-note">${note}</p></article>`
      )
      .join("");
    Charts.dailyBars(
      document.getElementById("daily-chart"),
      rows,
      state.month.getFullYear(),
      state.month.getMonth() + 1
    );
    Charts.merchantList(document.getElementById("merchant-list"), rows);
  }

  async function renderSettings() {
    const s = await settings();
    const keyInput = document.getElementById("api-key");
    keyInput.value = "";
    keyInput.placeholder = s.hasApiKey ? "保存済み（変えるときだけ入力）" : "sk-...";
    document.getElementById("model").value = s.model || "gpt-4o-mini";
    const hint = document.getElementById("settings-hint");
    const info = Store.info() || {};
    const hosted = Boolean(info.hosted);
    if (hosted) {
      hint.textContent = "Netlify の環境変数 OPENAI_API_KEY を使うか、下の欄にキーを保存します。パソコンの起動は不要です。";
    } else if (Store.isServer()) {
      hint.textContent = "キーはこのパソコンの data フォルダに保存し、スマホからも同じ家計簿を使えます。";
    } else {
      hint.textContent = "サーバー未起動のため、このブラウザ内だけに保存されます。start.bat で起動するか、Netlify に公開してください。";
    }
    const dataHint = document.getElementById("data-hint");
    if (dataHint) {
      dataHint.textContent = hosted
        ? "記録はネット上（Netlify）に保存され、パソコンとスマホで共有されます。"
        : "記録はパソコンの data フォルダに保存され、スマホと共有されます。";
    }
    const phone = document.getElementById("phone-card");
    const urls = info.lanUrls ? [].concat(info.lanUrls).filter(Boolean) : [];
    if (!Store.isServer()) {
      phone.hidden = true;
      return;
    }
    phone.hidden = false;
    document.getElementById("phone-card-title").textContent = hosted ? "公開URL" : "スマホで開く";
    document.getElementById("phone-card-copy").textContent = hosted
      ? "このURLをスマホのブラウザで開いてください。パソコンの電源は切っていて構いません。"
      : "同じ Wi-Fi に繋いだスマホで、このQRを読むか URL を開きます。パソコン側で start.bat を起動したままにしてください。";
    const url = urls[0] || (location.origin + "/");
    document.getElementById("phone-url").textContent = url;
    const qr = document.getElementById("phone-qr");
    qr.src = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=" + encodeURIComponent(url);
    qr.alt = url;
  }

  function render() {
    renderShell();
    if (state.view === "dashboard") renderDashboard();
    if (state.view === "ledger") renderLedger();
    if (state.view === "reports") renderReports();
    if (state.view === "settings") renderSettings();
  }

  function resetReview() {
    state.pendingImage = null;
    state.editingId = null;
    document.getElementById("capture-home").classList.remove("is-hidden");
    document.getElementById("capture-review").classList.add("is-hidden");
    document.getElementById("entry-form").reset();
    document.getElementById("item-body").innerHTML = "";
    document.getElementById("receipt-preview").removeAttribute("src");
  }

  function showReview() {
    document.getElementById("capture-home").classList.add("is-hidden");
    document.getElementById("capture-review").classList.remove("is-hidden");
  }

  function fillForm(data) {
    const parsed = ReceiptAI.sanitizeParsed(data);
    const form = document.getElementById("entry-form");
    form.merchant.value = parsed.merchant;
    if (parsed.date) {
      const normalizedDate = normalizeReceiptDate(parsed.date);
      form.date.value = normalizedDate;
      if (parsed.date !== normalizedDate) {
        toast("日付の年を今年に直しました。違ったら修正してください");
      }
    } else {
      form.date.value = "";
    }
    fillCategorySelect(form.category, parsed.category || "");
    form.paymentMethod.value = parsed.payment_method || "";
    form.subtotal.value = parsed.subtotal === "" ? "" : parsed.subtotal;
    form.tax.value = parsed.tax === "" ? "" : parsed.tax;
    form.amount.value = parsed.total === "" ? "" : parsed.total;
    form.notes.value = parsed.notes;
    const body = document.getElementById("item-body");
    body.innerHTML = "";
    const items = parsed.items && parsed.items.length ? parsed.items : [{ name: "", quantity: 1, amount: "" }];
    items.forEach((item) => body.appendChild(itemRow(item)));
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      toast("画像ファイルを選んでください");
      return;
    }
    const s = await settings();
    if (!s.hasApiKey && !s.apiKey) {
      toast(Store.isServer() ? "パソコンの設定で OpenAI API キーを保存してください" : "先に設定で OpenAI API キーを保存してください");
      setView("settings");
      return;
    }
    setView("capture");
    showReview();
    const localUrl = URL.createObjectURL(file);
    document.getElementById("receipt-preview").src = localUrl;
    document.getElementById("scan-veil").classList.remove("is-hidden");
    document.getElementById("parse-status").textContent = "OpenAI が内容を読み取っています";
    fillForm({ date: toDateInput(new Date()), category: "その他", payment_method: "現金" });
    try {
      const blob = await ReceiptAI.compressImage(file);
      const result = await Store.parseReceipt(blob);
      state.pendingImage = result.blob;
      document.getElementById("receipt-preview").src = URL.createObjectURL(result.blob);
      fillForm(result.parsed);
      const unclear = !result.parsed.merchant || (result.parsed.items || []).some((item) => !item.name);
      document.getElementById("parse-status").textContent = unclear
        ? "読めなかった項目は空欄にしました。確認して保存してください"
        : "内容を確認して保存してください";
      toast(unclear ? "一部は読めなかったので空欄にしました" : "読み取りました。金額と費目を確認してください");
    } catch (err) {
      document.getElementById("parse-status").textContent = "自動読み取りに失敗したので、手入力できます";
      toast(err.message || "読み取りに失敗しました");
      state.pendingImage = file;
    } finally {
      document.getElementById("scan-veil").classList.add("is-hidden");
    }
  }

  async function saveEntry(event) {
    event.preventDefault();
    const form = event.target;
    const id = state.editingId || uid();
    const row = {
      id,
      date: form.date.value,
      merchant: form.merchant.value.trim(),
      category: form.category.value,
      paymentMethod: form.paymentMethod.value,
      subtotal: Number(form.subtotal.value || 0),
      tax: Number(form.tax.value || 0),
      amount: Number(form.amount.value || 0),
      notes: form.notes.value.trim(),
      items: readItems(),
      source: state.pendingImage ? "receipt" : "manual",
      imageId: state.pendingImage ? id : null,
      createdAt: new Date().toISOString(),
    };
    try {
      if (state.pendingImage) {
        try {
          await Store.putImage(id, state.pendingImage);
        } catch (err) {
          row.imageId = null;
        }
      }
      await Store.putTransaction(row);
      goToMonthOf(row.date);
      await reload();
      resetReview();
      setView("ledger");
      toast("家計簿に保存しました");
    } catch (err) {
      toast(err.message || "保存に失敗しました");
    }
  }

  async function openDetail(id) {
    const row = state.transactions.find((item) => item.id === id);
    if (!row) return;
    const modal = document.getElementById("modal");
    const card = document.getElementById("modal-card");
    let imgHtml = "";
    if (row.imageId) {
      const blob = await Store.getImage(row.imageId);
      if (blob) {
        imgHtml = `<img src="${URL.createObjectURL(blob)}" alt="レシート" style="width:100%;border-radius:16px;margin-bottom:16px;max-height:320px;object-fit:contain;background:#1b1714">`;
      }
    }
    const items = (row.items || [])
      .map((item) => `<div class="merchant-row"><span>${escapeAttr(item.name)} × ${item.quantity || 1}</span><span>${yen(item.amount)}</span></div>`)
      .join("");
    card.innerHTML = `
      ${imgHtml}
      <h3>${escapeAttr(row.merchant || "")}</h3>
      <p class="muted">${escapeAttr(row.date)}　${escapeAttr(row.category)}　${escapeAttr(row.paymentMethod || "")}</p>
      <p class="stat-value" style="margin:12px 0">${yen(row.amount)}</p>
      ${items || ""}
      <p class="muted" style="margin-top:12px">${escapeAttr(row.notes || "")}</p>
      <div class="form-actions" style="margin-top:18px">
        <button class="secondary" id="close-modal">閉じる</button>
        <button class="danger" id="modal-del">削除</button>
      </div>
    `;
    modal.hidden = false;
    card.querySelector("#close-modal").onclick = () => {
      modal.hidden = true;
    };
    card.querySelector("#modal-del").onclick = async () => {
      modal.hidden = true;
      await removeTransaction(id);
    };
  }

  function exportCsv() {
    const rows = monthRows();
    const header = ["日付", "店名", "費目", "支払い", "金額", "税", "品目", "メモ"];
    const lines = [header.join(",")].concat(
      rows.map((row) =>
        [
          row.date,
          row.merchant,
          row.category,
          row.paymentMethod,
          row.amount,
          row.tax,
          (row.items || []).map((i) => i.name).join(" / "),
          row.notes || "",
        ]
          .map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`)
          .join(",")
      )
    );
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kakeibo-" + toDateInput(state.month).slice(0, 7) + ".csv";
    a.click();
  }

  async function loadSample() {
    const today = toDateInput(new Date());
    const y = today.slice(0, 8);
    const samples = [
      { merchant: "ファミリーマート", category: "食費", amount: 428, paymentMethod: "電子マネー", notes: "サンプル" },
      { merchant: "ドラッグストア", category: "日用品", amount: 1860, paymentMethod: "クレジットカード", notes: "サンプル" },
      { merchant: "JR", category: "交通", amount: 294, paymentMethod: "電子マネー", notes: "サンプル" },
      { merchant: "書店", category: "趣味・娯楽", amount: 1540, paymentMethod: "現金", notes: "サンプル" },
    ];
    for (let i = 0; i < samples.length; i += 1) {
      const row = Object.assign(
        {
          id: uid(),
          date: y + String(Math.max(1, new Date().getDate() - i)).padStart(2, "0"),
          tax: 0,
          subtotal: samples[i].amount,
          items: [{ name: samples[i].merchant, quantity: 1, amount: samples[i].amount }],
          source: "manual",
          imageId: null,
          createdAt: new Date().toISOString(),
        },
        samples[i]
      );
      await Store.putTransaction(row);
    }
    await reload();
    setView("dashboard");
    toast("サンプルを追加しました");
  }

  function openManual() {
    state.pendingImage = null;
    state.editingId = null;
    setView("capture");
    showReview();
    document.getElementById("scan-veil").classList.add("is-hidden");
    document.getElementById("receipt-preview").removeAttribute("src");
    document.getElementById("parse-status").textContent = "手入力で記帳します";
    fillForm({ date: toDateInput(new Date()), category: "食費", payment_method: "現金" });
  }

  function askConfirm(message) {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal");
      const card = document.getElementById("modal-card");
      card.innerHTML =
        "<p>" +
        escapeAttr(message) +
        "</p><div class=\"form-actions\" style=\"margin-top:18px\"><button type=\"button\" class=\"secondary\" id=\"confirm-no\">やめる</button><button type=\"button\" class=\"danger\" id=\"confirm-yes\">削除する</button></div>";
      modal.hidden = false;
      const finish = (ok) => {
        modal.hidden = true;
        resolve(ok);
      };
      card.querySelector("#confirm-no").onclick = () => finish(false);
      card.querySelector("#confirm-yes").onclick = () => finish(true);
    });
  }

  async function removeTransaction(id) {
    if (!id) return;
    state.busy = true;
    try {
      await Store.deleteTransaction(id);
      state.transactions = state.transactions.filter((row) => String(row.id) !== String(id));
      render();
      toast("削除しました");
    } catch (err) {
      toast(err.message || "削除に失敗しました");
      await reload();
    } finally {
      state.busy = false;
    }
  }

  async function reload() {
    state.transactions = await Store.getAllTransactions();
    render();
  }

  function bind() {
    document.getElementById("nav").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-view]");
      if (btn) setView(btn.dataset.view);
    });
    document.getElementById("quick-capture").addEventListener("click", () => setView("capture"));
    document.body.addEventListener("click", (e) => {
      const jump = e.target.closest(".text-btn[data-view]");
      if (jump) setView(jump.dataset.view);
      const monthBtn = e.target.closest("[data-month]");
      if (monthBtn) {
        const parts = monthBtn.dataset.month.split("-");
        state.month = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
        render();
      }
    });
    document.getElementById("prev-month").addEventListener("click", () => {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
      render();
    });
    document.getElementById("next-month").addEventListener("click", () => {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
      render();
    });

    const drop = document.getElementById("dropzone");
    const fileInput = document.getElementById("file-input");
    const cameraInput = document.getElementById("camera-input");
    document.getElementById("pick-file").addEventListener("click", () => fileInput.click());
    document.getElementById("pick-camera").addEventListener("click", () => cameraInput.click());
    fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
    cameraInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
      handleFile(e.dataTransfer.files[0]);
    });

    document.getElementById("add-item").addEventListener("click", () => {
      document.getElementById("item-body").appendChild(itemRow({ name: "", quantity: 1, amount: "" }));
    });
    document.getElementById("reset-capture").addEventListener("click", resetReview);
    document.getElementById("cancel-review").addEventListener("click", resetReview);
    document.getElementById("entry-form").addEventListener("submit", saveEntry);

    document.getElementById("search").addEventListener("input", renderLedger);
    const filter = document.getElementById("filter-category");
    filter.innerHTML = '<option value="">すべての費目</option>' + CATEGORIES.map((c) => `<option>${c}</option>`).join("");
    filter.addEventListener("change", renderLedger);
    document.getElementById("manual-entry").addEventListener("click", openManual);
    document.getElementById("export-csv").addEventListener("click", exportCsv);
    document.getElementById("ledger-table").addEventListener("click", async (e) => {
      const open = e.target.closest("[data-open]");
      const del = e.target.closest("[data-del]");
      if (open) {
        openDetail(open.dataset.open);
        return;
      }
      if (del) {
        const ok = await askConfirm("この明細を削除しますか？");
        if (ok) await removeTransaction(del.dataset.del);
      }
    });

    document.getElementById("save-settings").addEventListener("click", async () => {
      const apiKey = document.getElementById("api-key").value.trim();
      const model = document.getElementById("model").value;
      await Store.saveSettings({ apiKey: apiKey, model: model });
      toast("設定を保存しました");
      renderSettings();
    });
    document.getElementById("copy-phone-url").addEventListener("click", async () => {
      const url = document.getElementById("phone-url").textContent.trim();
      try {
        await navigator.clipboard.writeText(url);
        toast("URLをコピーしました");
      } catch (err) {
        toast(url);
      }
    });
    document.getElementById("pin-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      Store.setPin(document.getElementById("pin-input").value.trim());
      document.getElementById("pin-gate").hidden = true;
      await Store.init();
      if (Store.needPin()) {
        document.getElementById("pin-gate").hidden = false;
        toast("暗証番号が違います");
        return;
      }
      document.body.classList.toggle("is-server", Store.isServer());
      await reload();
    });
    document.getElementById("load-sample").addEventListener("click", loadSample);
    document.getElementById("clear-data").addEventListener("click", async () => {
      if (!confirm("すべての家計簿データを削除します。よろしいですか？")) return;
      await Store.clearAll();
      await reload();
      toast("削除しました");
    });
    document.getElementById("modal").addEventListener("click", (e) => {
      if (e.target.id !== "modal") return;
      const no = document.getElementById("confirm-no");
      if (no) no.click();
      else e.target.hidden = true;
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.view !== "capture" && !state.busy) reload();
    });
    setInterval(() => {
      if (!document.hidden && state.view !== "capture" && !state.busy) reload();
    }, 12000);
  }

  async function init() {
    fillCategorySelect(document.querySelector("#entry-form [name=category]"), "食費");
    bind();
    await Store.init();
    document.body.classList.toggle("is-server", Store.isServer());
    if (Store.needPin()) {
      document.getElementById("pin-gate").hidden = false;
      return;
    }
    await reload();
    if (!monthRows().length && state.transactions.length) {
      const latest = state.transactions.slice().sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0];
      goToMonthOf(latest.date);
      render();
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => App.init());
