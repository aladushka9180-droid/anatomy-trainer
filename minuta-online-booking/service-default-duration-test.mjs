import assert from 'node:assert/strict';
import fs from 'node:fs';

const provider = fs.readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(html, /id="serviceDefaultDurationField" hidden/, 'new service form contains a hidden default-duration field');
assert.match(html, /id="serviceDefaultDuration"[^>]+min="1" max="480" step="1" value="60"/, 'default duration accepts every exact minute');
assert.match(provider, /provider_service_duration_defaults:snapshot/, 'defaults synchronize with the provider account');
assert.match(provider, /restoreServiceDurationDefaults\(currentUser\)/, 'account defaults are restored at sign-in');
assert.match(provider, /duration === 1 && createdService\?\.id[^\n]+saveServiceDefaultDuration/, 'a new per-minute service saves its default duration');
assert.match(provider, /if \(duration === 1\) await saveServiceDefaultDuration\(id, defaultDuration\)/, 'editing a per-minute service updates its default duration');
assert.match(provider, /preset\.durationMinutes \|\| draft\?\.durationMinutes \|\| serviceDefaultDuration\(selectedService\?\.id\)/, 'manual booking is prefilled from the service default');
assert.match(provider, /if \(reset\) input\.value = String\(serviceDefaultDuration\(service\.id\)\)/, 'changing the selected service immediately applies its default');
assert.match(styles, /\.service-default-duration\[hidden\] \{ display:none; \}/, 'the field only appears for per-minute services');

console.log('service default duration test passed');
