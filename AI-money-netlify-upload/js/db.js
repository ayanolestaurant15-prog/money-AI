const KakeiboDB = (() => {
  const DB_NAME = "ai-kakeibo";
  const DB_VERSION = 1;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("transactions")) {
          const store = db.createObjectStore("transactions", { keyPath: "id" });
          store.createIndex("byDate", "date");
        }
        if (!db.objectStoreNames.contains("images")) {
          db.createObjectStore("images", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(name, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const store = tx.objectStore(name);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    async getAllTransactions() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("transactions", "readonly");
        const req = tx.objectStore("transactions").getAll();
        req.onsuccess = () => {
          const rows = req.result.sort((a, b) => (a.date < b.date ? 1 : -1));
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      });
    },
    async putTransaction(row) {
      await withStore("transactions", "readwrite", (store) => store.put(row));
    },
    async deleteTransaction(id) {
      await withStore("transactions", "readwrite", (store) => store.delete(id));
    },
    async putImage(id, blob) {
      await withStore("images", "readwrite", (store) => store.put({ id, blob }));
    },
    async getImage(id) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readonly");
        const req = tx.objectStore("images").get(id);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
      });
    },
    async clearAll() {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["transactions", "images"], "readwrite");
        tx.objectStore("transactions").clear();
        tx.objectStore("images").clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
})();
