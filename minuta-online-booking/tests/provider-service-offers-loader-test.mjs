import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('provider.js', root), 'utf8');
const html = await readFile(new URL('provider.html', root), 'utf8');
const worker = await readFile(new URL('sw.js', root), 'utf8');
const updates = await readFile(new URL('site-update.js', root), 'utf8');
const cacheVersion = worker.match(/CACHE = `\$\{CACHE_PREFIX\}v(\d+)`/)?.[1];
assert.ok(cacheVersion);
for (const asset of ['provider-ux.css', 'site-update.js', 'provider.js']) {
  assert.ok(html.includes(`${asset}?v=${cacheVersion}`));
  assert.ok(worker.includes(`${asset}?v=${cacheVersion}`));
}
for (const extension of ['css', 'js']) assert.ok(worker.includes(`team-schedule-ui.${extension}?v=${cacheVersion}`));
assert.ok(updates.includes(`sw.js?v=${cacheVersion}`));
const loader = source.match(/\$\('#openServiceOffers'\)\.addEventListener\('click', async event => \{[\s\S]*?\n\}\);/)?.[0];
assert.ok(loader);
assert.match(html, /id="openServiceOffers"/);
assert.match(html, /<template data-provider-feature="service-offers">[\s\S]*?provider-service-offers\.js\?v=2[\s\S]*?<\/template>/);
for (const extension of ['css', 'js']) assert.ok(worker.includes(`provider-service-offers.${extension}?v=2`));
assert.doesNotMatch(worker.match(/const ASSETS = \[([\s\S]*?)\];/)[1], /provider-service-offers/);
assert.match(worker.match(/const OPTIONAL_ASSETS = \[([\s\S]*?)\];/)[1], /provider-service-offers/);
function fixture() {
  let handler, resolveLoad, options;
  const entry = { disabled: false, removed: false, remove() { this.removed = true; } };
  const state = { created: 0, opened: 0, notices: [], loads: 0, reject: false, pending: false };
  const context = vm.createContext({
    currentUser: { id: 'owner' }, sessionGeneration: 1, serviceOffersController: null,
    db: {}, $: () => ({ addEventListener: (_, value) => { handler = value; } }),
    escapeHtml: String, notify: value => state.notices.push(value), requireWrites() {},
    sessionIsCurrent: (actor, generation) => actor === context.currentUser?.id && generation === context.sessionGeneration,
    ownServices: [{ id: 'service', name: 'Услуга' }, { id: 'block', name: 'block' }],
    SCHEDULE_BLOCK_SERVICE_NAME: 'block', serviceDefaultDuration: () => 60,
    window: {
      MinutaProviderFeatureAssets: { ensure: async name => {
        assert.equal(name, 'service-offers'); state.loads++;
        if (state.reject) throw Error('offline');
        if (state.pending) await new Promise(resolve => { resolveLoad = resolve; });
      } },
      MinutaServiceOffers: { createController: value => {
        state.created++; options = value;
        return { open: async () => { state.opened++; } };
      } },
    },
  });
  vm.runInContext(loader, context);
  return { entry, state, context, click: () => handler({ currentTarget: entry }), resolve: () => resolveLoad(), options: () => options };
}
const ready = fixture(); ready.state.pending = true;
const first = ready.click(); await ready.click();
assert.equal(ready.state.loads, 1); assert.equal(ready.entry.disabled, true);
ready.resolve(); await first;
assert.equal(ready.state.created, 1); assert.equal(ready.state.opened, 1); assert.equal(ready.entry.removed, true);
assert.deepEqual(Array.from(ready.options().getServices(), row => row.id), ['service']);
ready.context.ownServices = [{ id: 'fresh', name: 'Новая' }];
assert.equal(ready.options().getServices()[0].id, 'fresh');
const retry = fixture(); retry.state.reject = true; await retry.click();
assert.equal(retry.state.created, 0); assert.equal(retry.entry.removed, false); assert.equal(retry.entry.disabled, false);
assert.equal(retry.state.notices.length, 1);
retry.state.reject = false; await retry.click(); assert.equal(retry.state.opened, 1);
const stale = fixture(); stale.state.pending = true; const loading = stale.click();
stale.context.currentUser = { id: 'another' }; stale.context.sessionGeneration++;
stale.resolve(); await loading;
assert.equal(stale.state.created, 0); assert.equal(stale.state.opened, 0); assert.equal(stale.entry.removed, false);
console.log('Offers loader: optional assets, lazy open, retry, duplicate click and session change PASS');
