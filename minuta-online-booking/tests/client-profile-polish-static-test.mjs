import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('provider.html', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const css = readFileSync(new URL('provider-clients-premium.css', root), 'utf8');

assert.match(provider, /newBookingClientPhoneLabel\(client\.phone, client\.displayPhone\)/, 'Client phone reuses the existing formatter');
assert.match(provider, /milestoneCard\.classList\.toggle\('is-max-level', facts\.level === 4\)/, 'Maximum relationship level has a compact state');
assert.match(css, /\.client-milestone-card\.is-max-level\s*\{/, 'Maximum level compact styling exists');
assert.equal((html.match(/data-client-profile-jump=/g) || []).length, 4, 'Profile exposes four familiar navigation sections');
assert.equal((html.match(/data-client-profile-panel=/g) || []).length, 4, 'Profile navigation owns four true content panels');
assert.equal((html.match(/role="tab"/g) || []).length, 4, 'Profile navigation uses accessible tab semantics');
assert.equal((html.match(/class="client-summary-icon"/g) || []).length, 4, 'Every client fact has a restrained visual icon');
assert.match(html, /class="client-orbit-jewel"/, 'Premium relationship frame has a small crown marker');
assert.match(provider, /function activateClientProfileJump\(/, 'Profile navigation reuses the existing client sections');
assert.match(provider, /panel\.hidden = panel !== target/, 'Only the selected profile section remains visible');
assert.match(provider, /target\.append\(records\)/, 'Private records move safely between selected panels without duplication');
assert.match(provider, /clientRecordsController\?\.setView\(targetName\)/, 'Selected profile tab exposes only its records view');
assert.match(provider, /\['ArrowLeft','ArrowRight','Home','End'\]/, 'Profile tabs support keyboard navigation');
assert.doesNotMatch(html, /id="clientHistoryDisclosure"/, 'History does not repeat a nested history disclosure');
assert.ok(html.indexOf('id="clientResultsDisclosure"') > html.indexOf('id="clientProfilePanelFiles"'), 'Visit results live inside Files instead of floating above History');
assert.match(provider, /profileOrbit\.classList\.toggle\('is-max-level', facts\.level === 4\)/, 'Maximum level enables the premium frame');
assert.ok(html.indexOf('client-records.js') < html.indexOf('provider.js'), 'Client files controller loads before the provider initializes it');
assert.match(provider, /matchMedia\('\(max-width:980px\)'\).*window\.scrollTo\(\{ top:0/, 'Mobile client profile opens from its beginning');
assert.doesNotMatch(css, /repeating-conic-gradient/, 'Relationship ring no longer resembles a segmented loader');
assert.match(css, /data-client-level="4"/, 'Relationship levels have distinct visual tones');

console.log('Client profile polish static checks: PASS');
