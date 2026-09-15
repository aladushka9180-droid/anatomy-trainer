import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = read('./provider.html');
const provider = read('./provider.js');
const css = read('./finance-center.css');
const worker = read('./sw.js');
const version = worker.match(/CACHE_PREFIX\}v(\d+)/)?.[1];

assert.ok(version, 'provider cache version is missing');
assert.match(html, /id="financeCenterRoot" data-report-section="money" hidden/);
assert.match(html, new RegExp(`finance-center\\.css\\?v=${version}`));
assert.match(html, new RegExp(`finance-center\\.js\\?v=${version}[\\s\\S]*finance-center-provider\\.js\\?v=${version}[\\s\\S]*provider\\.js\\?v=${version}`));
assert.match(worker, new RegExp(`finance-center\\.css\\?v=${version}`));
assert.match(worker, new RegExp(`finance-center\\.js\\?v=${version}`));
assert.match(worker, new RegExp(`finance-center-provider\\.js\\?v=${version}`));
assert.match(css, /\[data-report-section="money"\]:not\(#financeCenterRoot\)/);
assert.match(css, /\[data-report-tab="money"\] \.report-filters/);
assert.match(provider, /MinutaFinanceProvider\?\.createController/);
assert.match(provider, /db, \$, notify, requireWrites/);
assert.doesNotMatch(provider, /financeController = window\.MinutaCommerce\?\.createFinanceController/);

console.log(`Finance center v163 provider/PWA integration contract passed for v${version}.`);
