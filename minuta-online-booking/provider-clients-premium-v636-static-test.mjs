import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = file => readFile(path.join(directory, file), 'utf8');
const [html, provider, css, worker] = await Promise.all([
  read('provider.html'), read('provider.js'), read('provider-clients-premium.css'), read('sw.js')
]);

assert.match(html, /provider-schedule-minimal\.css\?v=687[\s\S]*provider-clients-premium\.css\?v=687/, 'Client layer must load after all provider appearance layers');
assert.match(html, /client-results\.js\?v=687[\s\S]*client-relationship\.js\?v=687[\s\S]*provider\.js\?v=687/, 'Relationship rules must load before provider rendering');
for (const id of [
  'clientProfileOrbit', 'clientRelationshipTitle', 'clientRelationshipLevel', 'clientMilestoneCard',
  'clientMilestoneProgress', 'clientReliabilityCard', 'clientReliabilityTitle', 'clientReliabilityText', 'clientVisits',
  'clientSpent', 'clientLastVisit', 'clientNext', 'clientNextDetails'
]) assert.match(html, new RegExp(`id=["']${id}["']`), `Missing client profile element: ${id}`);

assert.match(html, /id="clientMilestoneProgress" role="progressbar"[^>]+aria-valuenow="0"/);
assert.match(provider, /cancellation_reason/);
assert.match(provider, /facts\.reliability\?\.needsAttention/);
assert.match(provider, /reliabilityCard\.dataset\.severity/);
assert.match(provider, /const knownCount = facts\.visits;/, 'The visible visit total must use the same completed-visit relationship count');
assert.match(provider, /completedVisits\.length - importedRows \+ Math\.max\(importedRows,/);
assert.match(provider, /queryAllProviderBookings\(userId, '[^']*cancellation_reason/);
assert.match(provider, /queryAllProviderBookings\(userId, 'id,booking_code[^']*status,created_at/, 'An old-schema read fallback must remain available');

assert.match(css, /--client-level-tone:var\(--theme-accent\)/);
assert.match(css, /background:conic-gradient/);
assert.match(css, /data-client-level="4"/);
assert.match(css, /\.client-list-avatar-orbit\.has-photo[\s\S]*--client-level-tone/);
assert.match(css, /@media \(max-width:760px\)/);
assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);

assert.match(worker, /CACHE_PREFIX}v687/);
assert.match(worker, /assetResponse\(request\)[\s\S]*caches\.open\(CACHE\)\)\.put\(request, response\.clone\(\)\)/, 'Secondary client assets must enter the runtime cache after their first online load');

const relationshipCard = html.slice(html.indexOf('id="clientMilestoneCard"'), html.indexOf('id="clientBirthdayInfo"'));
assert.ok(!/Скидка\s*\d|бесплатн(?:ый|ая)\s+(?:сеанс|услуг)/i.test(relationshipCard), 'The relationship UI must not promise rewards that were not configured');

console.log('Provider clients premium v687 static checks: PASS');
