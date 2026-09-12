import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = file => readFileSync(resolve(root, file), 'utf8');
const provider = read('provider.js');
const html = read('provider.html');
const worker = read('sw.js');
const updates = read('site-update.js');

assert.match(provider, /const cachedBookings = await hydrateCachedBookings\(userId\)/,
  'The verified user cache must render on online reloads too');
assert.match(provider, /if \(!userId \|\| !cachedBookings\) return false;/,
  'Cached booking inputs must hydrate before the network refresh');
assert.match(provider, /startLiveUpdates\(\{ catchUpOnSubscribe = true \} = \{\}\)/,
  'Realtime startup must distinguish initial subscription from reconnect');
assert.match(provider, /startLiveUpdates\(\{ catchUpOnSubscribe:false \}\);\s*await synchronizeProvider\(\);/,
  'The initial subscription must be armed before the single full synchronization');
assert.match(provider, /if \(catchUpOnSubscribe\) scheduleBookingsReload\(\);/,
  'Reconnects must retain their missed-event catch-up');
assert.match(provider, /const name = 'исполнитель';[\s\S]{0,500}void loadProviderDisplayName\(userId, generation\);/,
  'The display name request must not delay the provider shell');
assert.match(provider, /async function loadProviderDisplayName\(userId, generation\)[\s\S]{0,700}!sessionIsCurrent\(userId, generation\)/,
  'A late display name response must not overwrite a newer session');
const optionalFailureSource = provider.match(/function optionalSyncFailureIsDegraded\(result\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(optionalFailureSource, 'Optional sync status classifier must exist');
const optionalSyncFailureIsDegraded = Function(`${optionalFailureSource}; return optionalSyncFailureIsDegraded;`)();
assert.equal(optionalSyncFailureIsDegraded({ optional:true, ok:false }), true,
  'A real optional data failure must keep the partial sync warning');
for (const neutral of [{ optional:true, ok:false, forbidden:true }, { optional:true, ok:false, unsupported:true }, { optional:true, ok:false, stale:true }]) {
  assert.equal(optionalSyncFailureIsDegraded(neutral), false,
    'Unavailable or superseded optional data must not create a false global sync warning');
}
assert.match(provider, /\['PGRST205', '42P01'\][\s\S]{0,180}client_labels/,
  'A missing optional client-label table must be classified as unsupported');

const startupSecondary = provider.match(/const secondaryResults = \(await Promise\.allSettled\(\[([\s\S]*?)\]\)\)/)?.[1] || '';
for (const forbidden of ['loadClientAvatars()', 'synchronizePortfolio(', 'loadWaitlist()']) {
  assert.ok(!startupSecondary.includes(forbidden), `${forbidden} must not run during startup`);
}
assert.match(provider, /view === 'clients'[\s\S]{0,160}!clientAvatarsLoaded[\s\S]{0,80}loadClientAvatars\(\)/,
  'Client avatars must load when Clients opens');
assert.match(provider, /view === 'waitlist'[\s\S]{0,220}!waitlistLoaded[\s\S]{0,80}loadWaitlist\(\)/,
  'Waitlist data must load when Waitlist opens');
assert.match(provider, /organizationFeatureDefinitions/,
  'Heavy organization workspaces must have an on-demand registry');

const lazyScripts = [
  'voice-assistant.js', 'help/help-data.js', 'contextual-help.js', 'settings-nav-scroll.js', 'settings-smart-search.js',
  'resource-management.js', 'shift-management.js', 'payroll-management.js', 'benefit-management.js',
  'loyalty-management.js', 'inventory-management.js', 'retention-management.js'
];
for (const script of lazyScripts) {
  assert.ok(!new RegExp(`<script[^>]+src=["']${script.replaceAll('.', '\\.')}(?:\\?[^"']*)?["']`).test(html),
    `${script} must not block the provider shell`);
}

const assetBlock = worker.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1] || '';
const assets = [...assetBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.ok(assets.length > 0 && assets.length <= 72, `Unexpected core precache size: ${assets.length}`);
for (const asset of assets) {
  assert.ok(!asset.startsWith('./help/images/'), 'Help screenshots must be runtime-cached');
  assert.ok(!lazyScripts.some(script => asset.split('?')[0] === `./${script}`), `${asset} must be runtime-cached`);
  assert.ok(!asset.includes('xlsx-'), 'The XLSX exporter must not block service-worker installation');
}
const precacheBytes = assets.reduce((total, asset) => {
  const relative = asset.split('?')[0].replace(/^\.\//, '');
  return total + statSync(resolve(root, relative)).size;
}, 0);
assert.ok(precacheBytes <= 3.5 * 1024 * 1024, `Core precache is too large: ${precacheBytes} bytes`);
assert.match(worker, /event\.waitUntil\(update\.catch\(\(\) => \{\}\)\);\s*return cached;/,
  'Cached navigation must render while the network refresh continues in the background');
assert.match(worker, /await caches\.delete\(CACHE\);\s*throw error;/,
  'A failed install must remove only its incomplete cache');

assert.match(updates, /let checkPromise = null;/, 'Update checks must be coalesced');
assert.match(updates, /const CHECK_INTERVAL_MS = 15 \* 60 \* 1000;/, 'Update interval must be 15 minutes');
assert.ok(!updates.includes("addEventListener('focus'"), 'Focus must not trigger update storms');
assert.ok(!updates.includes("addEventListener('pageshow'"), 'Pageshow must not trigger update storms');

console.log(`Provider startup performance v709: PASS (${assets.length} core files, ${precacheBytes} bytes)`);
