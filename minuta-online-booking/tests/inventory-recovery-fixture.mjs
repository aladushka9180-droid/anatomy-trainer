// Explicit isolated browser storage/lock doubles. No production connections.
export function recoveryFixture() {
  const entries = new Map(), held = new Set();
  const storage = {
    entries, denyRead:false, denyWrite:false, denyRemove:false,
    getItem(key) { if (this.denyRead) throw new Error('storage denied'); return entries.get(key) ?? null; },
    setItem(key, value) { if (this.denyWrite) throw new Error('storage full'); entries.set(key, String(value)); },
    removeItem(key) { if (this.denyRemove) throw new Error('storage denied'); entries.delete(key); }
  };
  const locks = { held, async request(key, options, callback) {
    if (held.has(key)) return callback(null);
    held.add(key);
    try { return await callback({ name:key }); } finally { held.delete(key); }
  } };
  return { storage, locks };
}
