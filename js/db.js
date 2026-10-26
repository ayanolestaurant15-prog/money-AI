const KakeiboDB = (() => {
  const DB_NAME = "ai-kakeibo";
  const DB_VERSION = 2;

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
        if (!db.objectStoreNames.contains("recurring")) {
          db.createObjectStore("recurring", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("planned")) {
          db.createObjectStore("planned", { keyPath: "id" });
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
    async getAllRecurring() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("recurring", "readonly");
        const req = tx.objectStore("recurring").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async putRecurring(row) {
      await withStore("recurring", "readwrite", (store) => store.put(row));
    },
    async deleteRecurring(id) {
      await withStore("recurring", "readwrite", (store) => store.delete(id));
    },
    async getAllPlanned() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("planned", "readonly");
        const req = tx.objectStore("planned").getAll();
        req.onsuccess = () => {
          const rows = (req.result || []).sort((a, b) => (a.date < b.date ? 1 : -1));
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      });
    },
    async putPlanned(row) {
      await withStore("planned", "readwrite", (store) => store.put(row));
    },
    async deletePlanned(id) {
      await withStore("planned", "readwrite", (store) => store.delete(id));
    },
    async clearAll() {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const names = ["transactions", "images", "recurring", "planned"].filter((name) =>
          db.objectStoreNames.contains(name)
        );
        const tx = db.transaction(names, "readwrite");
        names.forEach((name) => tx.objectStore(name).clear());
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
})();
