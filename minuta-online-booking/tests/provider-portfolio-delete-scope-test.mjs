import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(process.argv[2] || new URL('../provider.js', import.meta.url), 'utf8');
const matches = [...source.matchAll(/^async function deletePortfolioItem\([^]*?^\}/gm)];
assert.equal(matches.length, 1, 'One actual portfolio deletion function');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(readResult = { data: null, error: null }, waitForCleanup = false) {
  const write = deferred(), cleanup = deferred(), events = { reads: 0, cleanups: 0, notices: [], loads: 0, filters: [] };
  const context = {
    currentUser: { id: 'synthetic-user-A' }, sessionGeneration: 1,
    portfolioItems: [{ id: 'synthetic-item', photos: [{ storage_path: 'synthetic-user-A/synthetic-item/photo' }] }],
    requireWrites: () => true, confirm: () => true,
    notify: text => events.notices.push(text),
    loadPortfolio: async () => { events.loads++; },
    removePortfolioStorage: async paths => { assert.equal(paths.length, 1); events.cleanups++; return waitForCleanup ? cleanup.promise : true; },
    db: { from(table) {
      assert.equal(table, 'portfolio_items'); let deleting = false;
      const query = {
        delete() { deleting = true; return this; },
        select(columns) { assert.equal(columns, 'id'); if (deleting) return write.promise; events.reads++; return this; },
        eq(key, value) { events.filters.push([deleting ? 'write' : 'read', key, value]); return this; },
        maybeSingle() { return Promise.resolve(readResult); }
      }; return query;
    } }
  };
  context.sessionIsCurrent = (user, generation) => context.currentUser?.id === user && context.sessionGeneration === generation;
  vm.createContext(context, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(matches[0][0], context, { timeout: 1000 });
  return {
    events, write, cleanup,
    start: () => vm.runInContext("deletePortfolioItem('synthetic-item')", context, { timeout: 1000 }),
    rotate(user = 'synthetic-user-B') { context.currentUser = { id: user }; context.sessionGeneration++; }
  };
}
test('confirmed deletion in the current session retains normal cleanup and result', async () => {
  const f = fixture(), pending = f.start();
  f.write.resolve({ data: [{ id: 'synthetic-item' }], error: null });
  assert.equal(await pending, true); assert.equal(f.events.cleanups, 1);
  assert.equal(f.events.notices.length, 1); assert.equal(f.events.loads, 1);
});
test('late confirmed deletion does not clean or notify in a new session', async () => {
  const f = fixture(), pending = f.start(); f.rotate();
  f.write.resolve({ data: [{ id: 'synthetic-item' }], error: null });
  assert.equal(await pending, false); assert.equal(f.events.cleanups, 0);
  assert.equal(f.events.notices.length, 0); assert.equal(f.events.loads, 0);
});
test('late uncertain result cannot verify absence under another account', async () => {
  const f = fixture(), pending = f.start(); f.rotate();
  f.write.resolve({ data: null, error: { code: 'SYNTHETIC_NETWORK_ERROR' } });
  assert.equal(await pending, false); assert.equal(f.events.reads, 0);
  assert.equal(f.events.cleanups, 0); assert.equal(f.events.notices.length, 0);
});
test('session change during cleanup suppresses subsequent UI continuation', async () => {
  const f = fixture(undefined, true), pending = f.start();
  f.write.resolve({ data: [{ id: 'synthetic-item' }], error: null });
  for (let i = 0; i < 8 && !f.events.cleanups; i++) await Promise.resolve();
  assert.equal(f.events.cleanups, 1); f.rotate(); f.cleanup.resolve(true);
  assert.equal(await pending, false); assert.equal(f.events.notices.length, 0); assert.equal(f.events.loads, 0);
});
test('same user in a new session cannot revive the previous deletion continuation', async () => {
  const f = fixture(), pending = f.start(); f.rotate('synthetic-user-A');
  f.write.resolve({ data: [{ id: 'synthetic-item' }], error: null });
  assert.equal(await pending, false); assert.equal(f.events.cleanups, 0); assert.equal(f.events.notices.length, 0);
});
test('a current confirmed rejection keeps photos and reports an unconfirmed deletion', async () => {
  const f = fixture({ data: { id: 'synthetic-item' }, error: null }), pending = f.start();
  f.write.resolve({ data: null, error: { code: '42501' } });
  assert.equal(await pending, false); assert.equal(f.events.reads, 1);
  assert.equal(f.events.cleanups, 0); assert.equal(f.events.notices.length, 1);
});
test('current absence verification uses the initiating account', async () => {
  const f = fixture(), pending = f.start();
  f.write.resolve({ data: null, error: { code: 'SYNTHETIC_NETWORK_ERROR' } });
  assert.equal(await pending, true); assert.equal(f.events.reads, 1); assert.equal(f.events.cleanups, 1);
  assert.equal(f.events.filters.some(([kind, key, value]) => kind === 'read' && key === 'performer_id' && value === 'synthetic-user-A'), true);
});
