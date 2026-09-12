import assert from 'node:assert/strict';
import fs from 'node:fs';

const catalog = fs.readFileSync(new URL('./theme-catalog.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./provider-theme-families.css', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

const themes = [...catalog.matchAll(/defineTheme\('([^']+)'/g)].map(match => match[1]);
const families = {
  editorial:['sage', 'nordic', 'mono'],
  digital:['graphite', 'hitech', 'carbon-crimson', 'oled-mono', 'volt-graphite'],
  natural:['eco', 'japandi', 'desert', 'celadon'],
  materials:['luxury', 'loft', 'carbon-ember', 'petrol-steel', 'cobalt-forge', 'concrete-signal', 'obsidian-champagne'],
  mist:['warm', 'lavender', 'rose', 'burgundy', 'butter', 'mocha-pastel', 'noir-rose'],
  textile:['pearl', 'peach-silk', 'cocoa-pearl', 'plum-cashmere'],
  water:['midnight', 'coastal', 'azure-lagoon', 'moonlit-lilac'],
  botanical:['botanical', 'blue-hydrangea'],
  organic:['snow-leopard', 'apricot-tiger', 'pearl-zebra', 'noir-safari'],
};
const mappedThemes = Object.values(families).flat();

assert.equal(themes.length, 40, 'Каталог должен содержать 40 тем');
assert.deepEqual([...mappedThemes].sort(), [...themes].sort(), 'Каждая тема должна входить ровно в одно визуальное семейство');
assert.equal(new Set(mappedThemes).size, mappedThemes.length, 'В семействах не должно быть дублей');

assert.match(css, /\[data-provider-layout\]:not\(:is\([^)]*snow-leopard[^)]*pearl-zebra[^)]*apricot-tiger[^)]*\)\)::before\s*\{[\s\S]*?pointer-events:none;[\s\S]*?background-image:var\(--theme-canvas-texture\)/);
assert.match(css, /> \.provider-main\s*\{[\s\S]*?z-index:1;/);
assert.match(css, /> \.ambient\s*\{[\s\S]*?display:none!important;/);
assert.match(css, /:is\([\s\S]*?\.provider-sidebar[\s\S]*?\.booking-sheet-panel[\s\S]*?\)\s*\{[\s\S]*?background-image:none!important;/);
assert.match(css, /:is\(input,select,textarea\)\s*\{[\s\S]*?background-image:none!important;/);
assert.doesNotMatch(css, /booking-client-page|client-pattern|\.client-app/, 'Новый слой не должен затрагивать публичный PrimeTime');
assert.match(css, /\.provider-theme-option\[class\*="theme-"\]:not\(:is\(\.theme-snow-leopard,\.theme-pearl-zebra,\.theme-apricot-tiger\)\) \.theme-swatch/);

for (const theme of themes) {
  const block = css.match(new RegExp(`\\.provider-body\\[data-provider-theme="${theme}"\\],\\.provider-theme-option\\.theme-${theme}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))?.[1] || '';
  assert.match(block, /--theme-canvas-texture:/, `${theme}: нет фонового мотива`);
  const opacity = Number(block.match(/--theme-canvas-opacity:([.\d]+);/)?.[1]);
  assert.ok(opacity >= .02 && opacity <= .06, `${theme}: контраст должен быть в диапазоне 2–6%, получено ${opacity}`);
}
const textures = themes.map(theme => css.match(new RegExp(`\\.provider-body\\[data-provider-theme="${theme}"\\],\\.provider-theme-option\\.theme-${theme}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))?.[1].match(/--theme-canvas-texture:([^;]+);/)?.[1]);
assert.equal(new Set(textures).size, 40, 'У каждой темы должен быть собственный мотив');
assert.doesNotMatch(css, /url\(/, 'Фактурный слой должен оставаться лёгким CSS без растровых обоев');

assert.match(css, /data-provider-theme="oled-mono"[\s\S]*?radial-gradient\(circle at 1px 1px/);
assert.doesNotMatch(css.match(/data-provider-theme="oled-mono"[\s\S]*?\n\}/)?.[0] || '', /repeating-linear-gradient/);
assert.match(css, /data-provider-theme="volt-graphite"[\s\S]*?--theme-canvas-size:64px 64px/);
assert.match(css, /data-provider-theme="botanical"[\s\S]*?radial-gradient\(ellipse 18% 46%/);
assert.ok((css.match(/data-provider-theme="blue-hydrangea"[\s\S]*?\n\}/)?.[0].match(/radial-gradient/g) || []).length >= 6);
assert.match(css, /data-provider-theme="snow-leopard"[\s\S]*?--theme-canvas-size:124px 92px/);
assert.match(css, /data-provider-theme="luxury"[\s\S]*?repeating-radial-gradient\(ellipse 130% 70%/);
assert.match(css, /data-provider-theme="warm"[\s\S]*?radial-gradient\(circle at 16% 4%/);

assert.match(provider, /provider-theme-families\.css\?v=731[\s\S]*?provider-theme-backgrounds-tema1\.css\?v=731/);
assert.match(worker, /\.\/provider-theme-families\.css\?v=731/);
assert.match(worker, /\.\/provider-theme-backgrounds-tema1\.css\?v=731/);

console.log('Provider theme families v731: PASS (40 themes, 9 families).');
