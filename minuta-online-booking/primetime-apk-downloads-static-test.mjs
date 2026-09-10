import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const provider = read('./provider.html');
const styles = read('./styles.css');
const clientManifest = read('../android/primetime-client/app/src/main/AndroidManifest.xml');
const clientPolicy = read('../android/primetime-client/app/src/main/java/ru/primetime/client/NavigationPolicy.java');
const proManifest = read('../android/primetime-calls/app/src/main/AndroidManifest.xml');

assert.match(provider, /releases\/latest\/download\/PrimeTime-Pro\.apk/u);
assert.match(provider, /class="install-app-secondary-actions"/u);
assert.match(provider, />APK для Android</u);
assert.match(styles, /\.auth-footer-actions \.provider-apk-download \{ color:var\(--muted\);/u);
assert.match(styles, /\.install-app-content \{ display:grid; grid-column:2;/u);
assert.match(styles, /\.install-app-button \{ display:inline-flex; width:auto; min-width:190px;/u);
assert.match(clientManifest, /android\.permission\.INTERNET/u);
assert.doesNotMatch(clientManifest, /READ_CALL_LOG/u);
assert.match(clientPolicy, /https:\/\/primetime-booking\.primetime-booking-ru\.workers\.dev\//u);
assert.match(proManifest, /android\.permission\.READ_CALL_LOG/u);

console.log('PrimeTime Android download contracts: OK');
