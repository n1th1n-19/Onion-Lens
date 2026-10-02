// Tiny IndexedDB key/value store. Background and extension pages share one origin,
// so screenshots (often >10 MB) are handed to editor.html through here.
const OnionDB = {
  open: () => new Promise((resolve, reject) => {
    const req = indexedDB.open('onion-lens', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }),
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode), req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  },
  get(key) { return this.run('readonly', s => s.get(key)); },
  put(key, value) { return this.run('readwrite', s => s.put(value, key)); },
};
globalThis.OnionDB = OnionDB;
