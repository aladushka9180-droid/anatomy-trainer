import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('./provider-themes-signature.css', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

const themes = [
  ['japandi', 'Japandi / Wabi-Sabi'],
  ['midnight', 'Midnight Navy'],
  ['mono', 'Editorial Mono'],
  ['desert', 'Desert Clay'],
  ['rose', 'Rose Smoke'],
];

for (const [key, label] of themes) {
  assert.match(provider, new RegExp(`name="providerTheme" value="${key}"[\\s\\S]*?<strong>${label}`), `Нет карточки темы ${label}`);
  assert.match(css, new RegExp(`\\.provider-body\\[data-provider-theme="${key}"\\] \\{[\\s\\S]*?--theme-bg:`), `Нет палитры темы ${label}`);
  assert.match(css, new RegExp(`\\.theme-${key} \\{[^}]*--theme-preview-bg:`), `Нет превью темы ${label}`);
}

for (const selector of [
  '.provider-sidebar',
  '.provider-nav button.active',
  '.provider-topbar',
  '.date-strip button.active',
  '.timeline-view .timeline-booking',
  '.provider-mobile-nav button.active',
  '.booking-sheet-panel',
  '.notification-template-dialog',
]) {
  assert.ok(css.includes(selector), `Единая система тем не охватывает ${selector}`);
}

assert.match(css, /--material-radius:12px[\s\S]*--material-radius:18px[\s\S]*--material-radius:2px[\s\S]*--material-radius:20px[\s\S]*--material-radius:18px/, 'Темы не имеют собственной современной геометрии');
assert.match(css, /data-provider-theme="midnight"[\s\S]*?color-scheme:dark/, 'Midnight Navy не включает тёмную системную палитру');
assert.match(css, /data-provider-theme="mono"[\s\S]*?--material-control-radius:0px/, 'Editorial Mono потерял строгую прямоугольную геометрию');
assert.match(css, /@media \(max-width:760px\)[\s\S]*?background:var\(--theme-bg\)!important/, 'Мобильный фон не упрощается');
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/, 'Нет режима уменьшенного движения');
assert.doesNotMatch(css, /repeating-linear-gradient|filter:drop-shadow|text-shadow:[^n]/i, 'В новых темах остался тяжёлый декоративный эффект');

assert.match(script, /japandi:'#f1eee6'|japandi:'#f3efe7'/, 'Нет системного theme-color Japandi');
assert.match(script, /midnight:'#0b1420'|midnight:'#08111f'/, 'Нет системного theme-color Midnight Navy');
assert.match(script, /mono:'#f3f3f0'/, 'Нет системного theme-color Editorial Mono');
assert.match(script, /desert:'#f3e8dc'|desert:'#f5e9db'/, 'Нет системного theme-color Desert Clay');
assert.match(script, /rose:'#f2e9ec'|rose:'#f2eaed'/, 'Нет системного theme-color Rose Smoke');
assert.match(provider, /provider-themes-signature\.css\?v=404/, 'Кабинет не подключает Signature Collection v404');
assert.match(worker, /\.\/provider-themes-signature\.css\?v=404/, 'Service Worker не кэширует Signature Collection v404');

console.log('Signature themes v404: 5 unified themes OK');
