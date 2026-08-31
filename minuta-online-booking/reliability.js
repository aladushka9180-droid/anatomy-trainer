(function () {
  'use strict';

  const DATABASE = 'minuta-reliability-v1';
  const STORE = 'snapshots';
  const VERSION = 1;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('indexeddb_unavailable'));
        return;
      }
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
    });
  }

  async function withStore(mode, action) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        let result;
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error('indexeddb_transaction_failed'));
        transaction.onabort = () => reject(transaction.error || new Error('indexeddb_transaction_aborted'));
        result = action(store);
      });
    } finally {
      database.close();
    }
  }

  async function put(key, data) {
    const value = { savedAt: new Date().toISOString(), data };
    await withStore('readwrite', store => store.put(value, key));
    return value;
  }

  async function get(key) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readonly');
        const request = transaction.objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('indexeddb_read_failed'));
      });
    } finally {
      database.close();
    }
  }

  async function removePrefix(prefix) {
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite');
        const request = transaction.objectStore(STORE).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (String(cursor.key).startsWith(prefix)) cursor.delete();
          cursor.continue();
        };
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('indexeddb_delete_failed'));
      });
    } finally {
      database.close();
    }
  }

  function savedAtLabel(value) {
    if (!value) return 'время неизвестно';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'время неизвестно';
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function operationId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  window.MinutaReliability = { get, put, removePrefix, savedAtLabel, operationId };
})();
