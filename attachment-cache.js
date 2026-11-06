'use strict';
// Upload identifiers are immutable. Scope is a SHA-256 digest of the connection,
// never the access token itself. Cache failure must never prevent a download.
globalThis.C9AttachmentCache = (() => {
  function create({
    memoryLimit = 16 * 1024 * 1024,
    diskLimit = 64 * 1024 * 1024,
    maxEntries = 40,
    indexedDB = globalThis.indexedDB,
    dbName = 'c9-attachment-cache-v1',
  } = {}) {
    const memory = new Map(),
      pending = new Map();
    let memoryBytes = 0,
      database = null,
      writes = Promise.resolve(),
      sequence = 0;
    const counters = { network: 0, memoryHits: 0, diskHits: 0, joined: 0, storageErrors: 0 };
    function remember(key, blob) {
      if (blob.size > memoryLimit) return;
      const previous = memory.get(key);
      if (previous) memoryBytes -= previous.size;
      memory.delete(key);
      memory.set(key, blob);
      memoryBytes += blob.size;
      while (memoryBytes > memoryLimit || memory.size > maxEntries) {
        const oldest = memory.keys().next().value;
        memoryBytes -= memory.get(oldest).size;
        memory.delete(oldest);
      }
    }
    function open() {
      if (!indexedDB) return Promise.resolve(null);
      if (!database)
        database = new Promise((resolve) => {
          let request;
          try {
            request = indexedDB.open(dbName, 1);
          } catch {
            resolve(null);
            return;
          }
          request.onupgradeneeded = () => {
            for (const name of ['files', 'meta'])
              if (!request.result.objectStoreNames.contains(name))
                request.result.createObjectStore(name, { keyPath: 'key' });
          };
          request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
          };
          request.onerror = () => {
            counters.storageErrors++;
            resolve(null);
          };
          request.onblocked = () => resolve(null);
        });
      return database;
    }
    async function stored(key) {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve) => {
        let tx;
        try {
          tx = db.transaction('files', 'readonly');
        } catch {
          resolve(null);
          return;
        }
        const req = tx.objectStore('files').get(key);
        req.onsuccess = () => resolve(req.result?.blob || null);
        req.onerror = () => resolve(null);
      });
    }
    function enqueue(key, blob) {
      writes = writes
        .then(async () => {
          const db = await open();
          // A hit touches metadata only; there is no new blob in that case.
          if (!db || (blob && blob.size > diskLimit)) return;
          await new Promise((resolve, reject) => {
            // Reading the LRU and applying its eviction in one write transaction also
            // keeps the size bound valid when another tab writes to this database.
            const tx = db.transaction(['files', 'meta'], 'readwrite');
            const files = tx.objectStore('files'),
              meta = tx.objectStore('meta');
            const request = meta.getAll();
            request.onsuccess = () => {
              const all = request.result,
                old = all.find((x) => x.key === key);
              if (!blob && !old) return;
              const size = blob?.size ?? old.size;
              let bytes = all.reduce((n, x) => n + x.size, 0) - (old?.size || 0) + size;
              let count = all.length - (old ? 1 : 0) + 1;
              for (const entry of all
                .filter((x) => x.key !== key)
                .sort((a, b) => a.used - b.used)) {
                if (bytes <= diskLimit && count <= maxEntries) break;
                files.delete(entry.key);
                meta.delete(entry.key);
                bytes -= entry.size;
                count--;
              }
              if (blob) files.put({ key, blob });
              meta.put({ key, size, used: Date.now() * 1000 + (sequence++ % 1000) });
            };
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
        })
        .catch(() => {
          counters.storageErrors++;
        });
      return writes;
    }
    async function get(scope, id, load, onStatus = () => {}) {
      const key = JSON.stringify([scope, id]);
      if (memory.has(key)) {
        const blob = memory.get(key);
        memory.delete(key);
        memory.set(key, blob);
        counters.memoryHits++;
        onStatus('memory');
        enqueue(key, null);
        return blob;
      }
      if (pending.has(key)) {
        counters.joined++;
        onStatus('loading');
        return pending.get(key);
      }
      const promise = (async () => {
        const cached = await stored(key);
        if (cached) {
          counters.diskHits++;
          onStatus('disk');
          remember(key, cached);
          enqueue(key, null);
          return cached;
        }
        onStatus('network');
        counters.network++;
        const blob = await load();
        if (!(blob instanceof Blob) || !blob.size) throw Error('文件内容为空，未加入缓存');
        remember(key, blob);
        enqueue(key, blob);
        return blob;
      })();
      pending.set(key, promise);
      try {
        return await promise;
      } finally {
        if (pending.get(key) === promise) pending.delete(key);
      }
    }
    return {
      get,
      flush: () => writes,
      stats: () => ({
        ...counters,
        memoryBytes,
        memoryEntries: memory.size,
        pending: pending.size,
      }),
    };
  }
  return { create };
})();
