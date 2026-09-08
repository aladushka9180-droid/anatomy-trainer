import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = path.dirname(fileURLToPath(import.meta.url));
const [baseCss, signatureCss, provider, catalogSource, calmCss, wildlifeCss, noirSafariCss, pearlZebraAsset, snowLeopardMobileAsset] = await Promise.all([
  readFile(path.join(directory, 'styles.css'), 'utf8'),
  readFile(path.join(directory, 'provider-themes-signature.css'), 'utf8'),
  readFile(path.join(directory, 'provider.js'), 'utf8'),
  readFile(path.join(directory, 'theme-catalog.js'), 'utf8'),
  readFile(path.join(directory, 'provider-themes-calm.css'), 'utf8'),
  readFile(path.join(directory, 'provider-themes-wildlife.css'), 'utf8'),
  readFile(path.join(directory, 'provider-theme-noir-safari.css'), 'utf8'),
  readFile(path.join(directory, 'provider-pearl-zebra-smooth-4k-v4.webp')),
  readFile(path.join(directory, 'provider-snow-leopard-mobile-v1.png')),
]);
const css = `${baseCss}\n${signatureCss}\n${wildlifeCss}\n${noirSafariCss}`;

function sourceArray(name) {
  const source = provider.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))?.[1] || '';
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
}

const catalogContext = { window:{} };
vm.createContext(catalogContext);
vm.runInContext(catalogSource, catalogContext);
const themes = [...catalogContext.window.MinutaThemeCatalog.themeKeys];
const layouts = sourceArray('PROVIDER_LAYOUT_KEYS');

assert.deepEqual(themes, ['sage', 'nordic', 'warm', 'graphite', 'lavender', 'luxury', 'loft', 'eco', 'hitech', 'japandi', 'midnight', 'mono', 'desert', 'rose', 'botanical', 'burgundy', 'coastal', 'pearl', 'butter', 'celadon', 'snow-leopard', 'apricot-tiger', 'pearl-zebra', 'noir-safari']);
assert.deepEqual(layouts, ['linear', 'soft', 'capsule', 'editorial', 'bento', 'split']);
assert.equal(themes.length * layouts.length, 144, 'the supported appearance matrix must contain 144 combinations');

function parseColor(value) {
  const color = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return [...color.slice(1)].map(part => Number.parseInt(part + part, 16)).concat(1);
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color.slice(1).match(/.{2}/g).map(part => Number.parseInt(part, 16)).concat(1);
  }
  const match = color.match(/^rgba?\(([^)]+)\)$/i);
  assert.ok(match, `unsupported theme color: ${color}`);
  const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function blend(foreground, background) {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  return [0, 1, 2].map(index => (
    foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])
  ) / alpha).concat(alpha);
}

function mix(first, firstWeight, second) {
  return [0, 1, 2].map(index => first[index] * firstWeight + second[index] * (1 - firstWeight)).concat(1);
}

function luminance(color) {
  const channels = color.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

function finalThemeVariables(theme) {
  const blocks = [...css.matchAll(new RegExp(`\\.provider-body\\[data-provider-theme="${theme}"\\]\\s*\\{([^}]*)\\}`, 'g'))];
  assert.ok(blocks.length, `missing CSS theme: ${theme}`);
  const variables = {};
  for (const block of blocks) {
    for (const declaration of block[1].matchAll(/--(theme-(?:bg|surface|surface-alt|ink|muted|line|accent|accent-soft|accent-contrast))\s*:\s*([^;]+);/g)) {
      variables[declaration[1]] = declaration[2].trim();
    }
  }
  for (const name of ['theme-bg', 'theme-surface', 'theme-surface-alt', 'theme-ink', 'theme-muted', 'theme-line', 'theme-accent', 'theme-accent-soft', 'theme-accent-contrast']) {
    assert.ok(variables[name], `${theme} is missing --${name}`);
  }
  return variables;
}

for (const theme of themes) {
  const vars = finalThemeVariables(theme);
  const background = parseColor(vars['theme-bg']);
  const surface = blend(parseColor(vars['theme-surface']), background);
  const surfaceAlt = blend(parseColor(vars['theme-surface-alt']), background);
  const ink = parseColor(vars['theme-ink']);
  const muted = parseColor(vars['theme-muted']);
  const accent = parseColor(vars['theme-accent']);
  const accentContrast = parseColor(vars['theme-accent-contrast']);
  const secondaryText = mix(muted, 0.78, ink);

  assert.ok(contrast(secondaryText, surface) >= 4.5, `${theme} mobile navigation contrast is below 4.5:1`);
  assert.ok(contrast(secondaryText, surfaceAlt) >= 4.5, `${theme} notification secondary text contrast is below 4.5:1`);
  assert.ok(contrast(accentContrast, accent) >= 4.5, `${theme} active report control contrast is below 4.5:1`);

  if (!['luxury', 'loft', 'eco', 'hitech'].includes(theme)) {
    const activeText = mix(parseColor(vars['theme-accent']), 0.72, ink);
    const activeBackground = blend(parseColor(vars['theme-accent-soft']), background);
    assert.ok(contrast(activeText, activeBackground) >= 4.5, `${theme} active mobile navigation contrast is below 4.5:1`);
  }
}

const specialActiveColors = {
  luxury: ['#e2b158', '#2b2112'],
  loft: ['#afa8ff', '#34334f'],
  eco: ['#536b45', '#e6e8d7'],
  hitech: ['#075d89', '#d4f2ff'],
};

for (const [theme, [foreground, background]] of Object.entries(specialActiveColors)) {
  assert.match(css, new RegExp(`data-provider-theme="${theme}"[^}]*\\.provider-mobile-nav button\\.active\\s*\\{[^}]*color:${foreground}`, 'i'));
  assert.ok(contrast(parseColor(foreground), parseColor(background)) >= 4.5, `${theme} active mobile navigation contrast is below 4.5:1`);
}

for (const layout of layouts) {
  assert.match(css, new RegExp(`data-provider-layout="${layout}"`), `missing CSS layout: ${layout}`);
}

assert.match(css, /\.unified-channel-card input\s*\{[^}]*width:20px!important[^}]*height:20px!important[^}]*\}/s);
assert.match(css, /\.provider-body\[data-provider-theme\] \.provider-mobile-nav :is\(button,a\):not\(\.active\)/);
assert.match(css, /\.provider-view\[data-provider-panel="notifications"\] \.view-title-actions\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) 44px/s);

const pearlZebraBackground = wildlifeCss.match(/\.provider-body\[data-provider-theme="pearl-zebra"\]\[data-provider-layout\]\s*\{([^}]*)\}/)?.[1] || '';
assert.match(pearlZebraBackground, /url\("provider-pearl-zebra-smooth-4k-v4\.webp\?v=618"\)/);
assert.match(pearlZebraBackground, /background-size:100% 100%,100% 100%!important/);
assert.match(pearlZebraBackground, /background-repeat:no-repeat!important/);
assert.match(pearlZebraBackground, /background-attachment:scroll!important/);
assert.doesNotMatch(pearlZebraBackground, /340px 340px/, 'Pearl Zebra must not split into repeated background tiles');
assert.doesNotMatch(pearlZebraBackground, /repeating-radial-gradient/, 'Pearl Zebra must use the approved natural stripe artwork');

const noirSafariBackground = noirSafariCss.match(/\.provider-body\[data-provider-theme="noir-safari"\]\[data-provider-layout\]\s*\{([^}]*)\}/)?.[1] || '';
assert.match(noirSafariBackground, /background-image:linear-gradient\(rgba\(5,4,3,\.08\),rgba\(5,4,3,\.08\)\),var\(--atmosphere-background\)!important/);
assert.doesNotMatch(noirSafariBackground, /linear-gradient\(90deg/, 'Noir Safari must preserve the approved leopard artwork without directional recoloring');
assert.match(noirSafariCss, /:is\(\s*\.provider-main,\.provider-app,\.provider-workspace,\.provider-view,\.schedule-card\s*\)\s*\{[^}]*background:transparent!important/s, 'Noir Safari must continue the same wallpaper behind the interface instead of exposing a white stage');
assert.equal(pearlZebraAsset.toString('ascii', 0, 4), 'RIFF', 'Pearl Zebra must remain a WebP asset');
assert.equal(pearlZebraAsset.readUInt16LE(26) & 0x3fff, 3840, 'Pearl Zebra must retain its 4K width');
assert.equal(pearlZebraAsset.readUInt16LE(28) & 0x3fff, 2160, 'Pearl Zebra must retain its 4K height');
assert.equal(snowLeopardMobileAsset.toString('ascii', 1, 4), 'PNG', 'Snow Leopard mobile artwork must remain a PNG asset');
assert.equal(snowLeopardMobileAsset.readUInt32BE(16), 941, 'Snow Leopard mobile artwork width must stay high-resolution');
assert.equal(snowLeopardMobileAsset.readUInt32BE(20), 1672, 'Snow Leopard mobile artwork height must stay portrait');
assert.match(signatureCss, /@media \(max-width:760px\)[\s\S]*?provider-snow-leopard-mobile-v1\.png\?v=618/);
assert.match(signatureCss, /provider-snow-leopard-mobile-v1\.png\?v=618"\)!important;\s*background-size:100% 100%,100% 100%!important;\s*background-repeat:no-repeat!important;\s*background-position:center top!important;\s*background-attachment:scroll!important/s);

// The modal lives outside the themed panels: both foreground and background
// must be assigned together, otherwise dark themes inherit the light base.
assert.match(calmCss, /\.provider-body\[data-provider-theme\] \.connection-log-dialog\s*\{[^}]*background:var\(--theme-surface\)!important;[^}]*color:var\(--theme-ink\)!important;/s);
assert.match(calmCss, /\.connection-log-entry\s*\{[^}]*background:var\(--theme-surface-alt\)!important;[^}]*color:var\(--theme-ink\)!important;/s);
assert.match(calmCss, /\.connection-log-actions \.primary\s*\{[^}]*background:var\(--theme-accent\)!important;[^}]*color:var\(--theme-accent-contrast\)!important;/s);
assert.match(calmCss, /\.connection-log-dialog :is\(\.connection-log-head small,\.connection-log-lead,\.connection-log-entry small\)\s*\{[^}]*var\(--theme-muted\) 82%,var\(--theme-ink\)/s);

console.log('Provider theme matrix checks passed: 24 themes × 6 layouts.');
