import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('./provider-themes-signature.css', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('./theme-catalog.js', import.meta.url), 'utf8');
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
  ['pearl', 'Pearl Atelier'],
  ['butter', 'Butter Studio'],
  ['celadon', 'Celadon'],
  ['snow-leopard', 'Snow Leopard'],
  ['blue-hydrangea', 'Blue Hydrangea'],
  ['peach-silk', 'Peach Silk'],
  ['moonlit-lilac', 'Moonlit Lilac'],
  ['carbon-ember', 'Carbon Ember'],
  ['petrol-steel', 'Petrol Steel'],
  ['carbon-crimson', 'Carbon Crimson'],
  ['mocha-pastel', 'Mocha Pastel'],
  ['oled-mono', 'OLED Mono'],
  ['cobalt-forge', 'Cobalt Forge'],
  ['volt-graphite', 'Volt Graphite'],
  ['concrete-signal', 'Concrete Signal'],
  ['azure-lagoon', 'Azure Lagoon'],
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
assert.equal((css.match(/repeating-linear-gradient/g) || []).length, 4, 'Тонкие повторяющиеся полосы разрешены только для OLED Mono и Volt Graphite');
assert.doesNotMatch(css, /filter:drop-shadow|text-shadow:[^n]/i, 'В новых темах остался тяжёлый декоративный эффект');
assert.doesNotMatch(subscription, /background:\s*#(?:fffdfb|faf6f1|f5f0ea|fffaf6)\s*!important/i, 'Тарифы принудительно используют светлый фон поверх темы');
assert.match(subscription, /\.subscription-plan-card[\s\S]*?border:\s*1px solid var\(--theme-line/, 'Карточки тарифов не используют границы активной темы');
assert.match(subscription, /\.subscription-plan-card[\s\S]*?border-radius:\s*var\(--material-radius/, 'Карточки тарифов не наследуют геометрию активного стиля');
assert.match(subscription, /\.subscription-plan-label[\s\S]*?color:var\(--theme-accent-contrast/, 'Метка рекомендуемого тарифа не гарантирует контраст темы');

assert.match(script, /defineTheme\('japandi'[\s\S]*?themeColor:'#e9e5dc'/, 'Нет системного theme-color Japandi');
assert.match(script, /defineTheme\('midnight'[\s\S]*?themeColor:'#061426'/, 'Нет системного theme-color Midnight Navy');
assert.match(script, /defineTheme\('mono'[\s\S]*?themeColor:'#f7f6f1'/, 'Нет системного theme-color Editorial Mono');
assert.match(script, /defineTheme\('desert'[\s\S]*?themeColor:'#ead7c8'/, 'Нет системного theme-color Desert Clay');
assert.match(script, /defineTheme\('rose'[\s\S]*?themeColor:'#f2eaed'/, 'Нет системного theme-color Rose Smoke');
for (const [key, color, group] of [
  ['botanical', '#202623', 'dark natural'],
  ['burgundy', '#282326', 'dark'],
  ['coastal', '#f5eddd', 'light'],
  ['pearl', '#f1edf6', 'featured light'],
  ['butter', '#faf9f3', 'featured light'],
  ['celadon', '#ecf7f3', 'featured light natural'],
  ['snow-leopard', '#eaf1f4', 'featured light'],
  ['mocha-pastel', '#1a1817', 'dark'],
  ['oled-mono', '#000000', 'dark'],
  ['cobalt-forge', '#071226', 'dark'],
  ['volt-graphite', '#101317', 'dark'],
  ['concrete-signal', '#e9edef', 'light'],
  ['azure-lagoon', '#e5f4ff', 'light'],
]) {
  assert.match(script, new RegExp(`defineTheme\\('${key}'[\\s\\S]*?themeColor:'${color}'`), `Нет системного цвета ${key}`);
  assert.match(provider, new RegExp(`theme-${key}" data-theme-groups="${group}"`), `Неверная категория ${key}`);
}
assert.match(provider, /provider-themes-signature\.css\?v=736/, 'Кабинет не подключает Signature Collection v736');
assert.match(worker, /\.\/provider-themes-signature\.css\?v=736/, 'Service Worker не кэширует Signature Collection v736');

// Mobile Snow Leopard reveals the canvas without making booking cards translucent.
const mobileSnow = css.slice(css.lastIndexOf('@media (max-width:760px)'));
assert.match(mobileSnow, /background-image:var\(--atmosphere-background\)!important/);
assert.match(mobileSnow, /background-size:100% 100%!important/);
assert.match(mobileSnow, /data-provider-theme="snow-leopard"[^}]*:is\(\.provider-view,\.schedule-card\)\s*\{\s*background:transparent!important/);
assert.match(mobileSnow, /\.provider-view>\.view-title[^}]*background:var\(--theme-surface\)!important/);
assert.doesNotMatch(mobileSnow, /\.provider-booking\s*\{[^}]*background:transparent/);

const snowCanvas = css.match(/\.provider-body\[data-provider-theme="snow-leopard"\]\[data-provider-layout\]\s*\{([^}]*)\}/)?.[1] || '';
assert.match(snowCanvas, /background-image:var\(--atmosphere-background\)!important/);
assert.match(snowCanvas, /background-size:100% 100%!important/);
assert.match(snowCanvas, /background-repeat:no-repeat!important/);
assert.match(snowCanvas, /background-position:center top!important/);
assert.match(snowCanvas, /background-attachment:fixed!important/, 'Snow Leopard keeps one continuous desktop canvas');
assert.match(mobileSnow, /background-repeat:no-repeat!important/);
assert.doesNotMatch(css, /provider-snow-leopard-(?:continuous|mobile|natural)[^"')]*\.(?:webp|png)/, 'Snow Leopard must be frosted quartz without leopard spots');
assert.doesNotMatch(snowCanvas, /background-repeat:repeat|snow-print-size|natural-v2|unified-landscape-v5|crisp-seamless/);
assert.match(worker, /assetResponse[\s\S]*caches\.open\(CACHE\)\)\.put\(request, response\.clone\(\)\)/, 'Theme media is not cached after first use');
assert.match(css, /data-provider-theme="snow-leopard"[^}]*\.provider-sidebar\s*\{\s*background:#fff!important/, 'Snow Leopard keeps its desktop navigation opaque');
assert.match(css, /data-provider-theme="snow-leopard"[^}]*\.provider-view\s*\{\s*background:transparent!important/, 'Snow Leopard must continue the page canvas through unused desktop workspace');

console.log('Signature themes v736: Snow Leopard canvas OK');
