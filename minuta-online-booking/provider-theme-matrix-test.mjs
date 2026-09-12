import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = path.dirname(fileURLToPath(import.meta.url));
const [baseCss, signatureCss, distinctCss, provider, catalogSource, calmCss, wildlifeCss, noirSafariCss] = await Promise.all([
  readFile(path.join(directory, 'styles.css'), 'utf8'),
  readFile(path.join(directory, 'provider-themes-signature.css'), 'utf8'),
  readFile(path.join(directory, 'provider-themes-distinct.css'), 'utf8'),
  readFile(path.join(directory, 'provider.js'), 'utf8'),
  readFile(path.join(directory, 'theme-catalog.js'), 'utf8'),
  readFile(path.join(directory, 'provider-themes-calm.css'), 'utf8'),
  readFile(path.join(directory, 'provider-themes-wildlife.css'), 'utf8'),
  readFile(path.join(directory, 'provider-theme-noir-safari.css'), 'utf8'),
]);
const [providerHtml, providerUiRefinementsCss] = await Promise.all([
  readFile(path.join(directory, 'provider.html'), 'utf8'),
  readFile(path.join(directory, 'provider-ui-refinements.css'), 'utf8'),
]);
const css = `${baseCss}\n${signatureCss}\n${wildlifeCss}\n${noirSafariCss}\n${distinctCss}`;

function sourceArray(name) {
  const source = provider.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))?.[1] || '';
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
}

const catalogContext = { window:{} };
vm.createContext(catalogContext);
vm.runInContext(catalogSource, catalogContext);
const themes = [...catalogContext.window.MinutaThemeCatalog.themeKeys];
const layouts = sourceArray('PROVIDER_LAYOUT_KEYS');

assert.deepEqual(themes, ['sage', 'nordic', 'warm', 'graphite', 'lavender', 'luxury', 'loft', 'eco', 'hitech', 'japandi', 'midnight', 'mono', 'desert', 'rose', 'botanical', 'burgundy', 'coastal', 'pearl', 'butter', 'celadon', 'snow-leopard', 'apricot-tiger', 'pearl-zebra', 'blue-hydrangea', 'peach-silk', 'moonlit-lilac', 'carbon-ember', 'petrol-steel', 'carbon-crimson', 'mocha-pastel', 'oled-mono', 'cobalt-forge', 'volt-graphite', 'concrete-signal', 'azure-lagoon', 'noir-safari']);
assert.deepEqual(layouts, ['linear', 'soft', 'capsule', 'editorial', 'bento', 'split']);
assert.equal(themes.length * layouts.length, 216, 'the supported appearance matrix must contain 216 combinations');

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
assert.match(distinctCss, /\.provider-body\[data-provider-theme\]\[data-provider-layout\] \.provider-theme-option\s*\{[^}]*border-radius:13px!important;/s, 'The active theme must not reshape theme chooser cards');
assert.match(distinctCss, /\.provider-theme-option \.theme-swatch\s*\{[^}]*var\(--theme-preview-radius,12px\)!important;/s, 'Theme swatches must keep their own preview geometry');
assert.match(distinctCss, /\.provider-theme-option \.theme-swatch i\s*\{[^}]*var\(--theme-preview-item-radius,6px\)!important;/s, 'Theme swatch details must keep their own preview geometry');
assert.match(css, /\.provider-view\[data-provider-panel="notifications"\] \.view-title-actions\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) 44px/s);
assert.match(providerHtml, /id="waitlistCount" hidden>0<\/span>/, 'An empty waitlist must not repeat a zero counter');
assert.match(providerHtml, /Заявки клиентов на занятые даты\./, 'The waitlist introduction must stay concise');
assert.doesNotMatch(providerHtml, /data-provider-panel="waitlist"[\s\S]{0,220}Свободные окна/, 'The waitlist title must not repeat a decorative eyebrow');
assert.match(provider, /waitlist-empty-state[^`]+Открыть страницу клиента/, 'The empty waitlist must keep one clear action');
assert.doesNotMatch(provider, /Заявок пока нет[^`]+Проверить расписание/, 'The empty waitlist must not duplicate the persistent Bookings navigation');
assert.match(provider, /count\.hidden = !active\.length/, 'The waitlist counter must appear only when it carries information');
assert.match(providerUiRefinementsCss, /\[data-provider-panel="waitlist"\] > :is\(\.view-title,\.view-description\)[\s\S]*?border:0!important[\s\S]*?background:transparent!important/, 'The waitlist heading must not be wrapped in decorative cards');
assert.match(providerUiRefinementsCss, /\[data-provider-panel="waitlist"\] \.waitlist-empty-state[\s\S]*?width:min\(520px,100%\)[\s\S]*?border:0!important[\s\S]*?text-align:left/, 'The empty state must stay compact and use a single surface');

const pearlZebraBackground = wildlifeCss.match(/\.provider-body\[data-provider-theme="pearl-zebra"\]\[data-provider-layout\]\s*\{([^}]*)\}/)?.[1] || '';
assert.match(pearlZebraBackground, /background-image:var\(--atmosphere-background\)!important/);
assert.match(pearlZebraBackground, /background-size:100% 100%!important/);
assert.match(pearlZebraBackground, /background-repeat:no-repeat!important/);
assert.match(pearlZebraBackground, /background-attachment:scroll!important/);
assert.doesNotMatch(pearlZebraBackground, /340px 340px/, 'Pearl Zebra must not split into repeated background tiles');
assert.doesNotMatch(wildlifeCss, /provider-pearl-zebra-smooth-4k-v4\.webp/, 'Pearl Zebra must use calm CSS satin ribbons rather than the former artwork');
assert.doesNotMatch(wildlifeCss.match(/--atmosphere-background:([^;]+);/)?.[1] || '', /repeating-/, 'Pearl Zebra ribbons must not repeat');

const noirSafariBackground = noirSafariCss.match(/\.provider-body\[data-provider-theme="noir-safari"\]\[data-provider-layout\]\s*\{([^}]*)\}/)?.[1] || '';
assert.match(noirSafariBackground, /background-image:linear-gradient\(rgba\(5,4,3,\.08\),rgba\(5,4,3,\.08\)\),var\(--atmosphere-background\)!important/);
assert.doesNotMatch(noirSafariBackground, /linear-gradient\(90deg/, 'Noir Safari must preserve the approved leopard artwork without directional recoloring');
assert.match(noirSafariCss, /\.provider-body\[data-provider-theme="noir-safari"\] \.ambient\s*\{[^}]*display:none!important/s, 'Noir Safari must hide the generic green and amber ambient lights');
assert.match(noirSafariCss, /:is\(\s*\.provider-main,\.provider-app,\.provider-workspace,\.provider-view,\.schedule-card\s*\)\s*\{[^}]*background:transparent!important/s, 'Noir Safari must continue the same wallpaper behind the interface instead of exposing a white stage');
assert.doesNotMatch(signatureCss, /provider-snow-leopard-(?:continuous|mobile|natural)[^"')]*\.(?:webp|png)/, 'Snow Leopard must no longer use spotted bitmap artwork');
assert.doesNotMatch(signatureCss, /provider-apricot-tiger(?:-mobile)?\.svg/, 'Apricot Tiger must no longer use repeated stripe assets');
for (const theme of ['snow-leopard', 'apricot-tiger']) {
  const canvas = signatureCss.match(new RegExp(`\\.provider-body\\[data-provider-theme="${theme}"\\]\\[data-provider-layout\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
  assert.match(canvas, /background-image:var\(--atmosphere-background\)!important/);
  assert.match(canvas, /background-size:100% 100%!important/);
  assert.match(canvas, /background-repeat:no-repeat!important/);
}

// The modal lives outside the themed panels: both foreground and background
// must be assigned together, otherwise dark themes inherit the light base.
assert.match(calmCss, /\.provider-body\[data-provider-theme\] \.connection-log-dialog\s*\{[^}]*background:var\(--theme-surface\)!important;[^}]*color:var\(--theme-ink\)!important;/s);
assert.match(calmCss, /\.connection-log-entry\s*\{[^}]*background:var\(--theme-surface-alt\)!important;[^}]*color:var\(--theme-ink\)!important;/s);
assert.match(calmCss, /\.connection-log-actions \.primary\s*\{[^}]*background:var\(--theme-accent\)!important;[^}]*color:var\(--theme-accent-contrast\)!important;/s);
assert.match(calmCss, /\.connection-log-dialog :is\(\.connection-log-head small,\.connection-log-lead,\.connection-log-entry small\)\s*\{[^}]*var\(--theme-muted\) 82%,var\(--theme-ink\)/s);

console.log('Provider theme matrix checks passed: 36 themes × 6 layouts.');
