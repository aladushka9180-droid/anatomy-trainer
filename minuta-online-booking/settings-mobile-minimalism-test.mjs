import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const provider = read('provider.html');
const sw = read('sw.js');
const nav = read('settings-nav-scroll.css');
const polish = read('settings-mobile-minimalism.css');

assert.match(provider, /settings-mobile-minimalism\.css\?v=\d+/);
assert.match(sw, /settings-mobile-minimalism\.css\?v=\d+/);
assert.match(nav, /grid-template-columns:190px minmax\(0,960px\)/);
assert.match(nav, /settings-section-picker select/);
assert.match(nav, /settings-nav-scroll-shell>\.provider-section-nav \{ display:none!important/);
assert.match(polish, /\[data-provider-panel="settings"\] \.settings-search-field/);
assert.match(polish, /subscription-settings-head \.settings-heading h3/);
assert.match(polish, /data-provider-theme="snow-leopard"[\s\S]*background:rgba\(255,255,255,\.42\)/);
assert.match(polish, /\.provider-view>\.view-title,[\s\S]*\.provider-view>\.view-description[\s\S]*padding-inline:14px/);

console.log('settings mobile minimalism checks passed');
