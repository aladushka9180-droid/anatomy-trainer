import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('./provider-themes-signature.css', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const subscription = fs.readFileSync(new URL('./subscription-pricing.css', import.meta.url), 'utf8');

const themes = [
  ['japandi', 'Japandi / Wabi-Sabi'],
  ['midnight', 'Midnight Navy'],
  ['mono', 'Editorial Mono'],
  ['desert', 'Desert Clay'],
  ['rose', 'Rose Smoke'],
  ['botanical', 'Botanical Night'],
  ['burgundy', 'Burgundy Atelier'],
  ['coastal', 'Coastal Porcelain'],
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
assert.doesNotMatch(subscription, /background:\s*#(?:fffdfb|faf6f1|f5f0ea|fffaf6)\s*!important/i, 'Тарифы принудительно используют светлый фон поверх темы');
assert.match(subscription, /\.subscription-plan-card[\s\S]*?border:\s*1px solid var\(--theme-line/, 'Карточки тарифов не используют границы активной темы');
assert.match(subscription, /\.subscription-plan-card[\s\S]*?border-radius:\s*var\(--material-radius/, 'Карточки тарифов не наследуют геометрию активного стиля');
assert.match(subscription, /\.subscription-plan-label[\s\S]*?color:var\(--theme-accent-contrast/, 'Метка рекомендуемого тарифа не гарантирует контраст темы');

assert.match(script, /japandi:'#f1eee6'|japandi:'#f3efe7'/, 'Нет системного theme-color Japandi');
assert.match(script, /midnight:'#0b1420'|midnight:'#08111f'/, 'Нет системного theme-color Midnight Navy');
assert.match(script, /mono:'#f3f3f0'/, 'Нет системного theme-color Editorial Mono');
assert.match(script, /desert:'#f3e8dc'|desert:'#f5e9db'/, 'Нет системного theme-color Desert Clay');
assert.match(script, /rose:'#f2e9ec'|rose:'#f2eaed'/, 'Нет системного theme-color Rose Smoke');
for (const [key, color, group] of [
  ['botanical', '#101c18', 'dark natural'],
  ['burgundy', '#21131c', 'dark'],
  ['coastal', '#f1f6f7', 'light'],
]) {
  assert.ok(script.includes(`${key}:'${color}'`), `Нет системного цвета ${key}`);
  assert.match(provider, new RegExp(`theme-${key}" data-theme-groups="${group}"`), `Неверная категория ${key}`);
}
assert.match(provider, /provider-themes-signature\.css\?v=427/, 'Кабинет не подключает Signature Collection v428');
assert.match(worker, /\.\/provider-themes-signature\.css\?v=427/, 'Service Worker не кэширует Signature Collection v428');

console.log('Signature themes v428: 8 unified themes OK');
