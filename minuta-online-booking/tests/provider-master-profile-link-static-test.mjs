import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('provider.html', root), 'utf8');
const worker = readFileSync(new URL('sw.js', root), 'utf8');
const update = readFileSync(new URL('site-update.js', root), 'utf8');
const version = worker.match(/CACHE_PREFIX}v(\d+)/)?.[1];

assert.ok(version, 'PWA cache version is present');
assert.match(html, /<a class="provider-master-profile-link" href="https:\/\/primetime-booking\.primetime-booking-ru\.workers\.dev\/for-masters" target="_blank" rel="noopener noreferrer">[\s\S]*?<span>Профили мастеров<\/span><\/a>/);
assert.match(html, /<a class="provider-client-link" href="index\.html" target="_blank" rel="noopener noreferrer">[\s\S]*?<span>Страница клиента<\/span><\/a>/);
assert.ok(html.includes(`site-update.js?v=${version}`));
assert.ok(html.includes(`provider.js?v=${version}`));
assert.ok(html.includes(`provider-reference-screens.css?v=${version}`));
assert.ok(worker.includes(`site-update.js?v=${version}`));
assert.ok(worker.includes(`provider.js?v=${version}`));
assert.ok(worker.includes(`provider-reference-screens.css?v=${version}`));
assert.ok(update.includes(`sw.js?v=${version}`));

console.log('PrimeTime Pro master-profile entry and PWA version: OK');
