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
  dashboard: ["今月のカレンダー", "概要"],
  capture: ["写真から記帳", "レシート取込"],
  ledger: ["すべての記録", "明細"],
  settings: ["APIキーと保存先", "設定"],
};

const ICONS = {
  plus:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
  pen:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>',
  trash:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"></path></svg>',
};

const App = (() => {
  const state = {
    view: "dashboard",
    month: startOfMonth(new Date()),
    transactions: [],
    recurring: [],
    planned: [],
    pendingImage: null,
    editingId: null,
    editingRecurringId: null,
    editingPlannedId: null,
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

  function monthKeyOf(date) {
    return toDateInput(date).slice(0, 7);
  }

  function clampDay(day, monthDate) {
    const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    return Math.min(Math.max(Number(day) || 1, 1), last);
  }

  function recurringRowsFor(monthDate) {
    return state.recurring.map((rec) => {
      const day = clampDay(rec.day, monthDate);
      const date = toDateInput(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
      const amount = Number(rec.amount) || 0;
      return {
        id: "recurring:" + rec.id,
        recurringId: rec.id,
        date,
        merchant: rec.name || "定額支出",
        category: rec.category || "その他",
        paymentMethod: "定額",
        amount,
        tax: 0,
        subtotal: amount,
        notes: "毎月の定額支出",
        items: [{ name: rec.name || "定額支出", quantity: 1, amount: amount }],
        source: "recurring",
        imageId: null,
      };
    });
  }

  function rowsForMonth(monthDate) {
    const key = monthKeyOf(monthDate);
    const txs = state.transactions.filter((row) => row.date && row.date.startsWith(key));
    return txs.concat(recurringRowsFor(monthDate)).sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1));
  }

  function monthRows() {
    return rowsForMonth(state.month);
  }

  function previousMonthRows() {
    return rowsForMonth(new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1));
  }

  function monthPlanned() {
    return state.planned
      .filter(inSelectedMonth)
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function otherMonthPlannedHint() {
    const currentKey = toDateInput(state.month).slice(0, 7);
    const counts = {};
    state.planned.forEach((row) => {
      if (!row.date) return;
      const key = String(row.date).slice(0, 7);
      if (key === currentKey) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    const keys = Object.keys(counts).sort().reverse();
    if (!keys.length) return "";
    return (
      '<p class="empty-hint">別の月の予定：' +
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
    const titles = TITLES[name];
    if (titles) {
      document.getElementById("view-eyebrow").textContent = titles[0];
      document.getElementById("view-title").textContent = titles[1];
    }
    render();
  }

  function renderShell() {
    document.getElementById("month-label").textContent = formatMonth(state.month);
    const total = monthRows().reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    document.getElementById("rail-expense").textContent = yen(total);
    const titles = TITLES[state.view];
    if (titles) {
      document.getElementById("view-eyebrow").textContent = titles[0];
      document.getElementById("view-title").textContent = titles[1];
    }
  }

  function renderDashboard() {
    const rows = monthRows();
    const prev = previousMonthRows();
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const prevTotal = prev.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const diff = total - prevTotal;
    const diffLabel = prevTotal === 0 ? "先月のデータなし" : (diff >= 0 ? "先月より " + yen(diff) + " 増" : "先月より " + yen(-diff) + " 減");
    const recurringTotal = state.recurring.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const plannedRows = monthPlanned();
    const plannedTotal = plannedRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    document.getElementById("stat-grid").innerHTML = [
      ["支出合計", yen(total), diffLabel, ""],
      ["定額支出", yen(recurringTotal), state.recurring.length ? "毎月 " + state.recurring.length + " 件" : "未設定", "stat-recurring"],
      ["予定の支出", yen(plannedTotal), plannedRows.length ? plannedRows.length + " 件" : "この月はなし", "stat-planned"],
    ]
      .map(
        ([label, value, note, extra]) =>
          `<article class="stat ${extra}"><p class="muted">${label}</p><p class="stat-value">${value}</p><p class="stat-note">${note}</p></article>`
      )
      .join("");

    renderCalendar();
    renderRecurringList();
    renderPlannedList();
  }

  function renderCalendar() {
    const el = document.getElementById("dash-calendar");
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const today = toDateInput(new Date());
    const byDate = {};
    monthRows().forEach((row) => {
      if (!row.date) return;
      if (!byDate[row.date]) byDate[row.date] = { expenses: [], planned: [] };
      byDate[row.date].expenses.push(row);
    });
    monthPlanned().forEach((row) => {
      if (!row.date) return;
      if (!byDate[row.date]) byDate[row.date] = { expenses: [], planned: [] };
      byDate[row.date].planned.push(row);
    });

    const cells = [];
    for (let i = 0; i < startWeekday; i += 1) {
      const day = prevDays - startWeekday + 1 + i;
      cells.push({ out: true, day: day, date: toDateInput(new Date(year, month - 1, day)) });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ out: false, day: day, date: toDateInput(new Date(year, month, day)) });
    }
    while (cells.length % 7 !== 0) {
      const day = cells.length - startWeekday - daysInMonth + 1;
      cells.push({ out: true, day: day, date: toDateInput(new Date(year, month + 1, day)) });
    }

    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    el.innerHTML =
      '<div class="cal-weekdays">' +
      weekdays.map((w) => "<span>" + w + "</span>").join("") +
      "</div><div class=\"cal-grid\">" +
      cells
        .map((cell) => {
          const bucket = byDate[cell.date] || { expenses: [], planned: [] };
          const chips = bucket.expenses
            .map((row) => {
              const kind = row.source === "recurring" ? "recurring" : "expense";
              return `<div class="cal-chip is-${kind}">${escapeAttr(row.merchant || "")} ${yen(row.amount)}</div>`;
            })
            .concat(
              bucket.planned.map(
                (row) => `<div class="cal-chip is-planned">${escapeAttr(row.name || "")} ${yen(row.amount)}</div>`
              )
            )
            .join("");
          const spent = bucket.expenses.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
          const cls =
            "cal-cell" +
            (cell.out ? " is-out" : "") +
            (cell.date === today ? " is-today" : "");
          return `<button type="button" class="${cls}" data-cal-date="${cell.date}">
            <span class="cal-num">${cell.day}</span>
            <div class="cal-chips">${cell.out ? "" : chips}</div>
            ${!cell.out && spent ? `<span class="cal-sum">${yen(spent)}</span>` : ""}
          </button>`;
        })
        .join("") +
      "</div>";
  }

  function planItemRow(row, kind) {
    const meta =
      kind === "recurring"
        ? '<span class="badge">' +
          escapeAttr(row.category || "その他") +
          "</span>毎月" +
          clampDay(row.day, state.month) +
          "日"
        : escapeAttr(row.date) + (isPastDate(row.date) ? "　過ぎ" : "");
    return `<div class="tx is-${kind}">
      <div class="tx-main">
        <p class="tx-title">${escapeAttr(row.name || "（内容なし）")}</p>
        <p class="tx-meta">${meta}</p>
      </div>
      <div class="tx-side">
        <div class="yen">${yen(row.amount)}</div>
        <div class="tx-actions">
          <button type="button" class="mark-btn" data-edit-${kind}="${row.id}" aria-label="編集" title="編集">${ICONS.pen}</button>
          <button type="button" class="mark-btn is-danger" data-del-${kind}="${row.id}" aria-label="削除" title="削除">${ICONS.trash}</button>
        </div>
      </div>
    </div>`;
  }

  function isPastDate(value) {
    const d = parseIsoDate(value);
    if (!d) return false;
    const today = parseIsoDate(toDateInput(new Date()));
    return d.getTime() < today.getTime();
  }

  function renderRecurringList() {
    const el = document.getElementById("recurring-list");
    const rows = state.recurring.slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
    el.innerHTML = rows.length
      ? rows.map((row) => planItemRow(row, "recurring")).join("")
      : '<p class="empty">毎月の定額支出はまだありません。</p>';
  }

  function renderPlannedList() {
    const el = document.getElementById("planned-list");
    const rows = monthPlanned();
    el.innerHTML = rows.length
      ? rows.map((row) => planItemRow(row, "planned")).join("")
      : '<p class="empty">この月の予定はありません。</p>' + otherMonthPlannedHint();
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
              (row) => `<tr class="${row.source === "recurring" ? "is-recurring" : ""}">
                <td>${escapeAttr(row.date)}</td>
                <td>${escapeAttr(row.merchant || "")}</td>
                <td>${escapeAttr(row.category || "")}</td>
                <td>${escapeAttr(row.paymentMethod || "")}</td>
                <td class="yen">${yen(row.amount)}</td>
                <td>
                  <button class="mark-btn" data-open="${row.id}" aria-label="編集" title="編集">${ICONS.pen}</button>
                  <button class="mark-btn is-danger" data-del="${row.id}" aria-label="削除" title="削除">${ICONS.trash}</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
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

  function fillForm(data, options) {
    const parsed = ReceiptAI.sanitizeParsed(data);
    const form = document.getElementById("entry-form");
    const keepDate = options && options.keepDate;
    form.merchant.value = parsed.merchant;
    if (parsed.date) {
      if (keepDate) {
        form.date.value = parsed.date;
      } else {
        const normalizedDate = normalizeReceiptDate(parsed.date);
        form.date.value = normalizedDate;
        if (parsed.date !== normalizedDate) {
          toast("日付の年を今年に直しました。違ったら修正してください");
        }
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
      toast(
        Store.isServer()
          ? "Netlify の環境変数 OPENAI_API_KEY を確認し、再デプロイしてください"
          : "先に設定で OpenAI API キーを保存してください"
      );
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
    const existing = state.transactions.find((item) => String(item.id) === String(id));
    const wasEdit = Boolean(existing);
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
      source: state.pendingImage ? "receipt" : existing && existing.source ? existing.source : "manual",
      imageId: state.pendingImage ? id : existing && existing.imageId ? existing.imageId : null,
      createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
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
      toast(wasEdit ? "明細を更新しました" : "家計簿に保存しました");
    } catch (err) {
      toast(err.message || "保存に失敗しました");
    }
  }

  function findExpenseRow(id) {
    return monthRows().find((item) => String(item.id) === String(id)) ||
      state.transactions.find((item) => String(item.id) === String(id));
  }

  function formatDayLabel(dateValue) {
    const d = parseIsoDate(dateValue);
    if (!d) return dateValue;
    const week = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日（" + week + "）";
  }

  async function openEditTransaction(id) {
    const row = findExpenseRow(id);
    if (!row) return;
    if (row.source === "recurring") {
      setView("dashboard");
      startEditRecurring(row.recurringId);
      const form = document.getElementById("recurring-form");
      if (form) form.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const existing = state.transactions.find((item) => String(item.id) === String(id));
    if (!existing) return;
    state.pendingImage = null;
    state.editingId = existing.id;
    setView("capture");
    showReview();
    document.getElementById("scan-veil").classList.add("is-hidden");
    document.getElementById("parse-status").textContent = "内容を編集して保存してください";
    fillForm(
      {
        merchant: existing.merchant,
        date: existing.date,
        category: existing.category,
        payment_method: existing.paymentMethod,
        subtotal: existing.subtotal,
        tax: existing.tax,
        total: existing.amount,
        notes: existing.notes,
        items: existing.items,
      },
      { keepDate: true }
    );
    const preview = document.getElementById("receipt-preview");
    if (existing.imageId) {
      const blob = await Store.getImage(existing.imageId);
      if (blob) preview.src = URL.createObjectURL(blob);
      else preview.removeAttribute("src");
    } else {
      preview.removeAttribute("src");
    }
  }

  function openDayModal(date) {
    const expenses = monthRows().filter((row) => row.date === date);
    const planned = state.planned.filter((row) => row.date === date);
    const spent = expenses.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const modal = document.getElementById("modal");
    const card = document.getElementById("modal-card");
    const expenseHtml = expenses.length
      ? expenses
          .map((row) => {
            const kind = row.source === "recurring" ? "recurring" : "expense";
            return `<div class="tx ${kind === "recurring" ? "is-recurring" : ""}">
              <div class="tx-main">
                <p class="tx-title">${escapeAttr(row.merchant || "（店名なし）")}</p>
                <p class="tx-meta"><span class="badge">${escapeAttr(row.category || "その他")}</span>${escapeAttr(row.paymentMethod || "")}</p>
              </div>
              <div class="tx-side">
                <div class="yen">${yen(row.amount)}</div>
                <div class="tx-actions">
                  <button type="button" class="mark-btn" data-day-edit="${row.id}" aria-label="編集" title="編集">${ICONS.pen}</button>
                  <button type="button" class="mark-btn is-danger" data-day-del="${row.id}" aria-label="削除" title="削除">${ICONS.trash}</button>
                </div>
              </div>
            </div>`;
          })
          .join("")
      : '<p class="empty">この日の支出はありません。</p>';
    const plannedHtml = planned.length
      ? planned
          .map(
            (row) => `<div class="tx is-planned">
              <div class="tx-main">
                <p class="tx-title">${escapeAttr(row.name || "（内容なし）")}</p>
                <p class="tx-meta">予定</p>
              </div>
              <div class="tx-side">
                <div class="yen">${yen(row.amount)}</div>
                <div class="tx-actions">
                  <button type="button" class="mark-btn" data-day-edit-planned="${row.id}" aria-label="編集" title="編集">${ICONS.pen}</button>
                  <button type="button" class="mark-btn is-danger" data-day-del-planned="${row.id}" aria-label="削除" title="削除">${ICONS.trash}</button>
                </div>
              </div>
            </div>`
          )
          .join("")
      : '<p class="empty">この日の予定はありません。</p>';
    card.innerHTML = `
      <h3>${escapeAttr(formatDayLabel(date))}</h3>
      <p class="muted">この日の支出</p>
      <p class="stat-value" style="margin:4px 0 16px">${yen(spent)}</p>
      <h4 class="day-section-title">支出</h4>
      ${expenseHtml}
      <h4 class="day-section-title is-planned">予定</h4>
      ${plannedHtml}
      <div class="form-actions day-actions">
        <button type="button" class="secondary" id="close-modal">閉じる</button>
        <button type="button" class="secondary btn-with-icon is-planned" id="day-add-planned">${ICONS.plus} 予定</button>
        <button type="button" class="primary btn-with-icon" id="day-add-expense">${ICONS.plus} 支出</button>
      </div>
    `;
    modal.hidden = false;
    card.querySelector("#close-modal").onclick = () => {
      modal.hidden = true;
    };
    card.querySelector("#day-add-expense").onclick = () => {
      modal.hidden = true;
      openManual(date);
    };
    card.querySelector("#day-add-planned").onclick = () => {
      modal.hidden = true;
      setView("dashboard");
      resetPlannedForm();
      const form = document.getElementById("planned-form");
      form.date.value = date;
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.name.focus();
    };
    card.querySelectorAll("[data-day-edit]").forEach((btn) => {
      btn.onclick = () => {
        modal.hidden = true;
        openEditTransaction(btn.dataset.dayEdit);
      };
    });
    card.querySelectorAll("[data-day-del]").forEach((btn) => {
      btn.onclick = async () => {
        const row = findExpenseRow(btn.dataset.dayDel);
        modal.hidden = true;
        const ok = await askConfirm(row && row.source === "recurring" ? "この定額支出を削除しますか？" : "この明細を削除しますか？");
        if (ok) {
          if (row && row.source === "recurring") await removeRecurring(row.recurringId);
          else await removeTransaction(btn.dataset.dayDel);
        }
        openDayModal(date);
      };
    });
    card.querySelectorAll("[data-day-edit-planned]").forEach((btn) => {
      btn.onclick = () => {
        modal.hidden = true;
        setView("dashboard");
        startEditPlanned(btn.dataset.dayEditPlanned);
        const form = document.getElementById("planned-form");
        if (form) form.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });
    card.querySelectorAll("[data-day-del-planned]").forEach((btn) => {
      btn.onclick = async () => {
        modal.hidden = true;
        const ok = await askConfirm("この予定を削除しますか？");
        if (ok) await removePlanned(btn.dataset.dayDelPlanned);
        openDayModal(date);
      };
    });
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

  function openManual(dateValue) {
    state.pendingImage = null;
    state.editingId = null;
    setView("capture");
    showReview();
    document.getElementById("scan-veil").classList.add("is-hidden");
    document.getElementById("receipt-preview").removeAttribute("src");
    document.getElementById("parse-status").textContent = "手入力で記帳します";
    fillForm(
      { date: dateValue || toDateInput(new Date()), category: "食費", payment_method: "現金" },
      { keepDate: true }
    );
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

  function setSaveMark(id, isEdit) {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (isEdit) {
      btn.classList.remove("is-mark");
      btn.innerHTML = "更新";
      btn.setAttribute("aria-label", "更新");
    } else {
      btn.classList.add("is-mark");
      btn.innerHTML = ICONS.plus;
      btn.setAttribute("aria-label", "追加");
    }
  }

  function resetRecurringForm() {
    state.editingRecurringId = null;
    const form = document.getElementById("recurring-form");
    form.reset();
    fillCategorySelect(form.category, "");
    form.day.value = 1;
    setSaveMark("save-recurring", false);
    document.getElementById("cancel-recurring").hidden = true;
  }

  function resetPlannedForm() {
    state.editingPlannedId = null;
    const form = document.getElementById("planned-form");
    form.reset();
    form.date.value = toDateInput(new Date());
    setSaveMark("save-planned", false);
    document.getElementById("cancel-planned").hidden = true;
  }

  function startEditRecurring(id) {
    const row = state.recurring.find((item) => String(item.id) === String(id));
    if (!row) return;
    state.editingRecurringId = row.id;
    const form = document.getElementById("recurring-form");
    form.name.value = row.name || "";
    form.amount.value = row.amount == null ? "" : row.amount;
    fillCategorySelect(form.category, row.category || "");
    form.day.value = row.day || 1;
    setSaveMark("save-recurring", true);
    document.getElementById("cancel-recurring").hidden = false;
    form.name.focus();
  }

  function startEditPlanned(id) {
    const row = state.planned.find((item) => String(item.id) === String(id));
    if (!row) return;
    state.editingPlannedId = row.id;
    const form = document.getElementById("planned-form");
    form.date.value = row.date || toDateInput(new Date());
    form.name.value = row.name || "";
    form.amount.value = row.amount == null ? "" : row.amount;
    setSaveMark("save-planned", true);
    document.getElementById("cancel-planned").hidden = false;
    form.name.focus();
  }

  async function saveRecurring(event) {
    event.preventDefault();
    const form = event.target;
    const id = state.editingRecurringId || uid();
    const existing = state.recurring.find((item) => String(item.id) === String(id));
    const row = {
      id,
      name: form.name.value.trim(),
      amount: Number(form.amount.value || 0),
      category: form.category.value,
      day: clampDay(form.day.value, state.month),
      createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
    };
    try {
      await Store.putRecurring(row);
      const idx = state.recurring.findIndex((item) => String(item.id) === String(id));
      if (idx >= 0) state.recurring[idx] = row;
      else state.recurring.push(row);
      resetRecurringForm();
      render();
      toast("定額支出を保存しました");
    } catch (err) {
      toast(err.message || "保存に失敗しました");
    }
  }

  async function savePlanned(event) {
    event.preventDefault();
    const form = event.target;
    const id = state.editingPlannedId || uid();
    const existing = state.planned.find((item) => String(item.id) === String(id));
    const row = {
      id,
      date: form.date.value,
      name: form.name.value.trim(),
      amount: Number(form.amount.value || 0),
      createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
    };
    try {
      await Store.putPlanned(row);
      const idx = state.planned.findIndex((item) => String(item.id) === String(id));
      if (idx >= 0) state.planned[idx] = row;
      else state.planned.push(row);
      goToMonthOf(row.date);
      resetPlannedForm();
      render();
      toast("予定を保存しました");
    } catch (err) {
      toast(err.message || "保存に失敗しました");
    }
  }

  async function removeRecurring(id) {
    if (!id) return;
    state.busy = true;
    try {
      await Store.deleteRecurring(id);
      state.recurring = state.recurring.filter((row) => String(row.id) !== String(id));
      if (String(state.editingRecurringId) === String(id)) resetRecurringForm();
      render();
      toast("削除しました");
    } catch (err) {
      toast(err.message || "削除に失敗しました");
      await reload();
    } finally {
      state.busy = false;
    }
  }

  async function removePlanned(id) {
    if (!id) return;
    state.busy = true;
    try {
      await Store.deletePlanned(id);
      state.planned = state.planned.filter((row) => String(row.id) !== String(id));
      if (String(state.editingPlannedId) === String(id)) resetPlannedForm();
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
    try {
      state.recurring = await Store.getAllRecurring();
    } catch (err) {
      state.recurring = state.recurring || [];
    }
    try {
      state.planned = await Store.getAllPlanned();
    } catch (err) {
      state.planned = state.planned || [];
    }
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
    document.getElementById("manual-entry").addEventListener("click", () => openManual());
    document.getElementById("export-csv").addEventListener("click", exportCsv);
    document.getElementById("ledger-table").addEventListener("click", async (e) => {
      const open = e.target.closest("[data-open]");
      const del = e.target.closest("[data-del]");
      if (open) {
        openEditTransaction(open.dataset.open);
        return;
      }
      if (del) {
        const row = findExpenseRow(del.dataset.del);
        const ok = await askConfirm(row && row.source === "recurring" ? "この定額支出を削除しますか？" : "この明細を削除しますか？");
        if (!ok) return;
        if (row && row.source === "recurring") await removeRecurring(row.recurringId);
        else await removeTransaction(del.dataset.del);
      }
    });

    document.getElementById("dash-calendar").addEventListener("click", (e) => {
      const cell = e.target.closest("[data-cal-date]");
      if (!cell) return;
      const date = cell.dataset.calDate;
      const d = parseIsoDate(date);
      if (d && monthKeyOf(d) !== monthKeyOf(state.month)) {
        goToMonthOf(date);
        render();
      }
      openDayModal(date);
    });
    document.getElementById("recurring-form").addEventListener("submit", saveRecurring);
    document.getElementById("planned-form").addEventListener("submit", savePlanned);
    document.getElementById("cancel-recurring").addEventListener("click", resetRecurringForm);
    document.getElementById("cancel-planned").addEventListener("click", resetPlannedForm);
    document.getElementById("recurring-list").addEventListener("click", async (e) => {
      const edit = e.target.closest("[data-edit-recurring]");
      const del = e.target.closest("[data-del-recurring]");
      if (edit) {
        startEditRecurring(edit.dataset.editRecurring);
        return;
      }
      if (del) {
        const ok = await askConfirm("この定額支出を削除しますか？");
        if (ok) await removeRecurring(del.dataset.delRecurring);
      }
    });
    document.getElementById("planned-list").addEventListener("click", async (e) => {
      const edit = e.target.closest("[data-edit-planned]");
      const del = e.target.closest("[data-del-planned]");
      if (edit) {
        startEditPlanned(edit.dataset.editPlanned);
        return;
      }
      if (del) {
        const ok = await askConfirm("この予定を削除しますか？");
        if (ok) await removePlanned(del.dataset.delPlanned);
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
    fillCategorySelect(document.querySelector("#recurring-form [name=category]"), "");
    bind();
    resetPlannedForm();
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
