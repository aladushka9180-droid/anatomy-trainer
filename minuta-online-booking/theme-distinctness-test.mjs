import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const catalogSource = fs.readFileSync(new URL('./theme-catalog.js', import.meta.url), 'utf8');
const css = [
  fs.readFileSync(new URL('./provider-themes-signature.css', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('./provider-themes-distinct.css', import.meta.url), 'utf8'),
].join('\n');
const provider = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const context = { window:{} };
vm.createContext(context);
vm.runInContext(catalogSource, context);

const themes = new Map(context.window.MinutaThemeCatalog.themes.map(theme => [theme.key, theme]));
const changedThemes = [
  'sage', 'nordic', 'hitech', 'coastal', 'blue-hydrangea', 'eco', 'celadon',
  'japandi', 'desert', 'apricot-tiger', 'peach-silk', 'pearl', 'snow-leopard',
  'mono', 'pearl-zebra', 'graphite', 'midnight', 'carbon-ember', 'carbon-crimson',
  'luxury', 'azure-lagoon', 'noir-safari', 'noir-rose', 'cocoa-pearl',
  'plum-cashmere', 'obsidian-champagne',
];

function rgb(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `Unsupported color ${hex}`);
  return hex.slice(1).match(/../g).map(value => Number.parseInt(value, 16));
}

function luminance(hex) {
  const values = rgb(hex).map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

function lab(hex) {
  const linear = rgb(hex).map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * .4124 + linear[1] * .3576 + linear[2] * .1805) / .95047;
  const y = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  const z = (linear[0] * .0193 + linear[1] * .1192 + linear[2] * .9505) / 1.08883;
  const transform = value => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const [fx, fy, fz] = [x, y, z].map(transform);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function delta(first, second) {
  const a = lab(first);
  const b = lab(second);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function signatureDistance(first, second) {
  const a = themes.get(first).palette;
  const b = themes.get(second).palette;
  return ['bg', 'surface', 'surfaceAlt', 'accent'].reduce((sum, key) => sum + delta(a[key], b[key]), 0) / 4;
}

for (const key of changedThemes) {
  const theme = themes.get(key);
  assert.ok(theme, `Theme ${key} is missing from the catalog`);
  assert.match(css, new RegExp(`data-provider-theme="${key}"`), `Theme ${key} has no final provider override`);
  assert.match(css, new RegExp(`\\.theme-${key} \\{`), `Theme ${key} has no distinct preview`);
  assert.match(css, new RegExp(`data-provider-theme="${key}"[^}]*--theme-booking-radius:`), `Theme ${key} has no schedule geometry`);
  assert.ok(contrast(theme.palette.ink, theme.palette.surface) >= 4.5, `${key} primary contrast is below 4.5:1`);
  assert.ok(contrast(theme.palette.contrast, theme.palette.accent) >= 4.5, `${key} accent contrast is below 4.5:1`);
  assert.ok(contrast(theme.palette.muted, theme.palette.surfaceAlt) >= 4.5, `${key} secondary contrast is below 4.5:1`);
  assert.ok(contrast(theme.palette.accent, theme.palette.accentSoft) >= 4.5, `${key} active-state contrast is below 4.5:1`);
  assert.ok(contrast(theme.palette.line, theme.palette.surface) >= 3, `${key} control boundary contrast is below 3:1`);
}

const themeKeys = [...themes.keys()];
for (let index = 0; index < themeKeys.length; index += 1) {
  for (let peer = index + 1; peer < themeKeys.length; peer += 1) {
    const distance = signatureDistance(themeKeys[index], themeKeys[peer]);
    assert.ok(distance >= 5, `${themeKeys[index]} and ${themeKeys[peer]} are too similar (${distance.toFixed(2)})`);
  }
}

const cacheVersion = worker.match(/const CACHE = `\$\{CACHE_PREFIX\}(v\d+)`/)?.[1];
assert.ok(cacheVersion, 'Service worker cache version is missing');
const assetVersion = `v=${cacheVersion.slice(1)}`;
assert.match(provider, new RegExp(`provider-themes-distinct\\.css\\?${assetVersion}`), 'Provider does not load the distinct theme layer');
assert.match(worker, new RegExp(`\\./provider-themes-distinct\\.css\\?${assetVersion}`), 'Service worker does not cache the distinct theme layer');
assert.match(css, /\.provider-body\[data-provider-theme="mono"\] \{ --theme-booking-radius:0; --theme-client-radius:0; \}/, 'Editorial Mono geometry must stay square');

console.log(`Distinct theme checks passed: ${changedThemes.length} differentiated themes.`);
