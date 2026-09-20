import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('provider.html', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const css = readFileSync(new URL('provider-clients-premium.css', root), 'utf8');
const relationship = readFileSync(new URL('client-relationship.js', root), 'utf8');
const loyalty = readFileSync(new URL('loyalty-program-v166.js', root), 'utf8');

assert.match(provider, /newBookingClientPhoneLabel\(client\.phone, client\.displayPhone\)/, 'Client phone reuses the existing formatter');
for (const status of ['\u041d\u043e\u0432\u044b\u0439', '\u0412\u0435\u0440\u043d\u0443\u043b\u0441\u044f', '\u041f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u044b\u0439', '\u041b\u043e\u044f\u043b\u044c\u043d\u044b\u0439']) {
  assert.match(relationship, new RegExp(`title:'${status}'`), `Relationship status ${status} is available`);
}
assert.match(provider, /clientRelationshipTitle'\)\.textContent = facts\.title/, 'Client profile shows a plain relationship status');
assert.equal((html.match(/data-client-profile-jump=/g) || []).length, 4, 'Profile exposes four familiar navigation sections');
assert.equal((html.match(/data-client-profile-panel=/g) || []).length, 4, 'Profile navigation owns four true content panels');
assert.equal((html.match(/role="tab"[^>]*data-client-profile-jump=/g) || []).length, 4, 'Profile navigation uses accessible tab semantics');
assert.equal((html.match(/class="client-summary-icon"/g) || []).length, 4, 'Every client fact has a restrained visual icon');
assert.doesNotMatch(html, /client-orbit-jewel/, 'Client status does not add a crown marker');
assert.match(provider, /function activateClientProfileJump\(/, 'Profile navigation reuses the existing client sections');
assert.match(provider, /panel\.hidden = panel !== target/, 'Only the selected profile section remains visible');
assert.match(provider, /target\.append\(records\)/, 'Private records move safely between selected panels without duplication');
assert.match(provider, /clientRecordsController\?\.setView\(targetName\)/, 'Selected profile tab exposes only its records view');
assert.match(provider, /\['ArrowLeft','ArrowRight','Home','End'\]/, 'Profile tabs support keyboard navigation');
assert.doesNotMatch(html, /id="clientHistoryDisclosure"/, 'History does not repeat a nested history disclosure');
assert.ok(html.indexOf('id="clientResultsDisclosure"') > html.indexOf('id="clientProfilePanelFiles"'), 'Visit results live inside Files instead of floating above History');
assert.match(loyalty, /orbit\.classList\.toggle\('has-loyalty-progress', enabled\)/, 'The profile ring is reserved for real loyalty progress');
assert.doesNotMatch(css, /is-max-level|client-orbit-jewel|data-client-level=/, 'Legacy level and crown styling is absent');
assert.ok(html.indexOf('client-records.js') < html.indexOf('provider.js'), 'Client files controller loads before the provider initializes it');
assert.match(provider, /matchMedia\('\(max-width:980px\)'\).*window\.scrollTo\(\{ top:0/, 'Mobile client profile opens from its beginning');
assert.doesNotMatch(css, /repeating-conic-gradient/, 'Relationship ring no longer resembles a segmented loader');
assert.match(html, /id="clientMilestoneCard"[^>]*hidden/, 'Loyalty progress stays hidden until server data is available');

console.log('Client profile polish static checks: PASS');
