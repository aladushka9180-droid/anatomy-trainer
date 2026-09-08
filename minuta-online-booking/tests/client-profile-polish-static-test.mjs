import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('provider.html', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const css = readFileSync(new URL('provider-clients-premium.css', root), 'utf8');

assert.match(provider, /newBookingClientPhoneLabel\(client\.phone, client\.displayPhone\)/, 'Client phone reuses the existing formatter');
assert.match(provider, /milestoneCard\.classList\.toggle\('is-max-level', facts\.level === 4\)/, 'Maximum relationship level has a compact state');
assert.match(provider, /`Записей: \$\{history\.length\}`/, 'History total is labelled as bookings, not completed visits');
assert.match(css, /\.client-milestone-card\.is-max-level\s*\{/, 'Maximum level compact styling exists');
assert.equal((html.match(/data-client-profile-jump=/g) || []).length, 4, 'Profile exposes four familiar navigation sections');
assert.equal((html.match(/class="client-summary-icon"/g) || []).length, 4, 'Every client fact has a restrained visual icon');
assert.match(html, /class="client-orbit-jewel"/, 'Premium relationship frame has a small crown marker');
assert.match(provider, /function activateClientProfileJump\(/, 'Profile navigation reuses the existing client sections');
assert.match(provider, /profileOrbit\.classList\.toggle\('is-max-level', facts\.level === 4\)/, 'Maximum level enables the premium frame');
assert.doesNotMatch(css, /repeating-conic-gradient/, 'Relationship ring no longer resembles a segmented loader');

console.log('Client profile polish static checks: PASS');
