import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('./provider-theme-loft-modern.css', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

for (const token of [
  '--theme-bg:#151817',
  '--theme-surface:#1d211f',
  '--theme-ink:#f3f1ec',
  '--theme-muted:#abb2ac',
  '--theme-accent:#c48765',
  '--material-radius:16px',
]) {
  assert.ok(css.includes(token), `Missing Modern Mineral token: ${token}`);
}

for (const selector of [
  '.provider-sidebar',
  '.provider-nav button.active',
  '.provider-topbar',
  '.date-strip button.active',
  '.timeline-view .timeline-booking',
  '.provider-mobile-nav button.active',
  '.booking-sheet-panel',
]) {
  assert.ok(css.includes(selector), `Missing unified Loft selector: ${selector}`);
}

assert.doesNotMatch(css, /repeating-linear-gradient|#8077e8|#7773c7|Arial Narrow|Roboto Condensed/i);
assert.match(css, /\.provider-body\[data-provider-theme="loft"\] :is\(\*,button,input,select,textarea\) \{[\s\S]*?text-shadow:none!important/);
assert.match(css, /\.provider-body\[data-provider-theme="loft"\] \.provider-nav button\.active \{[\s\S]*?border-left:3px solid var\(--theme-accent\)!important;[\s\S]*?background:#272c29!important/);
assert.match(css, /\.provider-body\[data-provider-theme="loft"\] \.date-strip button\.active \{[\s\S]*?background:#c48765!important;[\s\S]*?color:#1f1510!important/);
assert.match(provider, /provider-theme-loft-modern\.css\?v=441/);
assert.match(worker, /\.\/provider-theme-loft-modern\.css\?v=441/);

console.log('Modern Loft v441: OK');
