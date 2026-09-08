import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const css = readFileSync(new URL('provider-clients-premium.css', root), 'utf8');

assert.match(provider, /newBookingClientPhoneLabel\(client\.phone, client\.displayPhone\)/, 'Client phone reuses the existing formatter');
assert.match(provider, /milestoneCard\.classList\.toggle\('is-max-level', facts\.level === 4\)/, 'Maximum relationship level has a compact state');
assert.match(provider, /`Записей: \$\{history\.length\}`/, 'History total is labelled as bookings, not completed visits');
assert.match(css, /\.client-milestone-card\.is-max-level\s*\{/, 'Maximum level compact styling exists');
assert.doesNotMatch(css, /repeating-conic-gradient/, 'Relationship ring no longer resembles a segmented loader');

console.log('Client profile polish static checks: PASS');
