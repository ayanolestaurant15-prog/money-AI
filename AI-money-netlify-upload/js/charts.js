const Charts = (() => {
  function yen(n) {
    return "¥" + Math.round(Number(n) || 0).toLocaleString("ja-JP");
  }

  function categoryBars(el, rows, categories) {
    const totals = {};
    categories.forEach((c) => {
      totals[c] = 0;
    });
    rows.forEach((row) => {
      const key = categories.includes(row.category) ? row.category : "その他";
      totals[key] += Number(row.amount) || 0;
    });
    const max = Math.max(...Object.values(totals), 1);
    const spent = Object.entries(totals).filter(([, v]) => v > 0);
    if (!spent.length) {
      el.innerHTML = '<p class="empty">この月の支出はまだありません</p>';
      return;
    }
    el.innerHTML = spent
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => {
        const pct = Math.round((value / max) * 100);
        return `<div class="cat-row"><span>${name}</span><div class="bar"><span style="width:${pct}%"></span></div><span class="yen">${yen(value)}</span></div>`;
      })
      .join("");
  }

  function dailyBars(el, rows, year, month) {
    const days = new Date(year, month, 0).getDate();
    const sums = Array(days).fill(0);
    rows.forEach((row) => {
      const d = new Date(row.date + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() + 1 === month) {
        sums[d.getDate() - 1] += Number(row.amount) || 0;
      }
    });
    const max = Math.max(...sums, 1);
    el.innerHTML = `<div class="day-bars">${sums
      .map((v, i) => `<div class="col" title="${month}/${i + 1} ${yen(v)}" style="height:${Math.max(2, (v / max) * 100)}%"></div>`)
      .join("")}</div>`;
  }

  function merchantList(el, rows) {
    const map = {};
    rows.forEach((row) => {
      const name = row.merchant || "（店名なし）";
      map[name] = (map[name] || 0) + (Number(row.amount) || 0);
    });
    const items = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!items.length) {
      el.innerHTML = '<p class="empty">まだ集計できる店がありません</p>';
      return;
    }
    el.innerHTML = items
      .map(([name, value]) => `<div class="merchant-row"><span>${name}</span><span class="yen">${yen(value)}</span></div>`)
      .join("");
  }

  return { yen, categoryBars, dailyBars, merchantList };
})();
