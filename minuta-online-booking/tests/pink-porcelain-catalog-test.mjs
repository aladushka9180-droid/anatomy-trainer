import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('theme-catalog.js', root), 'utf8');
const css = readFileSync(new URL('client-themes.css', root), 'utf8');
const context = { window:{}, URLSearchParams };
vm.createContext(context);
vm.runInContext(source, context);
const catalog = context.window.MinutaThemeCatalog;

const rose = catalog.theme('rose');
assert.equal(rose.label, 'Rose Smoke');
assert.equal(rose.palette.accent, '#946477', 'Existing Rose Smoke palette must not change');
assert.equal(catalog.clientThemes.filter(item => item.key === 'pink-porcelain').length, 1);
assert.deepEqual(Object.keys(catalog.normalizeSettings({ theme_key:'rose', porcelain:{ shade:'pink-accent' } })).sort(), ['headline_key','theme_key']);

const defaults = catalog.normalizeSettings({ theme_key:'pink-porcelain' });
assert.equal(defaults.porcelain.shade, 'gentle-pink');
assert.equal(defaults.porcelain.character, 'petal');
assert.equal(catalog.porcelainShades.length, 5);
assert.equal(catalog.porcelainCharacters.length, 3);

const luminance = hex => {
  const linear = hex.slice(1).match(/../g).map(part => Number.parseInt(part,16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
};
const contrast = (a,b) => {
  const values = [luminance(a),luminance(b)].sort((x,y) => y-x);
  return (values[0]+.05)/(values[1]+.05);
};

const tokens = new Map();
const element = { dataset:{}, style:{ setProperty:(key,value) => tokens.set(key,value) } };
let themeColor = '';
context.document = { querySelector:() => ({ setAttribute:(name,value) => { if (name === 'content') themeColor=value; } }) };
for (const shade of catalog.porcelainShades) {
  for (const character of catalog.porcelainCharacters) {
    const settings = catalog.normalizeSettings({ theme_key:'pink-porcelain', porcelain:{ shade:shade.key, character:character.key } });
    const palette = catalog.paletteForSettings(settings);
    assert.ok(contrast(palette.ink,palette.bg) >= 4.5, `${shade.key}: body contrast`);
    assert.ok(contrast(palette.muted,palette.surface) >= 4.5, `${shade.key}: secondary contrast`);
    assert.ok(contrast(palette.contrast,palette.accent) >= 4.5, `${shade.key}: button contrast`);
    catalog.applyClientTheme(element, settings.theme_key, settings);
    assert.equal(element.dataset.clientTheme, 'pink-porcelain');
    assert.equal(element.dataset.clientPorcelainCharacter, character.key);
    assert.equal(tokens.get('--client-accent'), palette.accent);
    assert.equal(tokens.get('--client-bg'), palette.bg);
    assert.equal(themeColor, palette.themeColor);
  }
}
catalog.applyClientTheme(element, 'rose');
assert.equal(element.dataset.clientPorcelainCharacter, undefined, 'Character motif must not leak into other themes');
assert.equal(tokens.get('--client-accent'), rose.palette.accent);

const direct = catalog.settingsFromSearch('?theme=pink-porcelain&porcelain_shade=petal-pink&porcelain_character=silk');
assert.equal(direct.porcelain.shade, 'petal-pink');
assert.equal(direct.porcelain.character, 'silk');
assert.match(css, /porcelain-character-list/);
assert.match(css, /porcelain-shade-list/);
assert.match(css, /data-client-porcelain-character="silk"/);
assert.doesNotMatch(css, /url\(https?:/i, 'Theme decoration must use no external images');

console.log('Pink Porcelain catalog: 5 shades × 3 characters, contrasts, isolation and local decoration PASS');
