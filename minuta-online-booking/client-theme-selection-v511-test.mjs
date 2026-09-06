import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const storage = new Map();
const body = { dataset:{}, style:{ values:new Map(), setProperty(key, value) { this.values.set(key, value); } } };
const themeMeta = { value:'', setAttribute(_name, value) { this.value = value; } };
const context = {
  window:{},
  localStorage:{ getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value) },
  URLSearchParams,
  document:{ querySelector:selector => selector === 'meta[name="theme-color"]' ? themeMeta : null }
};
vm.createContext(context);
vm.runInContext(read('./theme-catalog.js'), context);
const catalog = context.window.MinutaThemeCatalog;
const expected = ['sage','nordic','warm','graphite','lavender','luxury','loft','eco','hitech','japandi','midnight','mono','desert','rose','botanical','burgundy','coastal','pearl','butter','celadon','snow-leopard','apricot-tiger','golden-cheetah','pearl-zebra','noir-safari'];
assert.deepEqual([...catalog.themeKeys], expected);
assert.equal(new Set(catalog.themeKeys).size, 25);
for (const theme of catalog.themes) {
  assert.ok(theme.label && theme.description && theme.groups.length);
  for (const key of ['bg','surface','surfaceAlt','ink','muted','line','accent','accentSoft','contrast','shadow','pattern','themeColor']) assert.ok(theme.palette[key], `${theme.key}: ${key}`);
}
assert.deepEqual({ ...catalog.settingsFromSearch('?theme=noir-safari&headline=care') }, { theme_key:'noir-safari', headline_key:'care' });
assert.deepEqual({ ...catalog.settingsFromSearch('?theme=invalid&headline=invalid') }, { theme_key:'sage', headline_key:'massage-time' });
assert.equal(catalog.readClientOverride('alpha'), 'follow');
catalog.writeClientOverride('alpha', 'midnight');
catalog.writeClientOverride('beta', 'warm');
assert.equal(catalog.readClientOverride('alpha'), 'midnight');
assert.equal(catalog.readClientOverride('beta'), 'warm');
catalog.applyClientTheme(body, 'graphite');
assert.equal(body.dataset.clientTheme, 'graphite');
assert.equal(body.style.colorScheme, 'dark');
assert.equal(themeMeta.value, catalog.theme('graphite').palette.themeColor);

const providerHtml = read('./provider.html');
const indexHtml = read('./index.html');
const providerJs = read('./provider.js');
const appJs = read('./app.js');
const sw = read('./sw.js');
const providerThemeKeys = [...providerHtml.matchAll(/name="providerTheme" value="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(providerThemeKeys, expected, 'Каталог должен совпадать с 25 темами кабинета');
assert.match(providerHtml, /id="clientAppearanceSettingsCard"/);
assert.match(providerHtml, /theme-catalog\.js\?v=510/);
assert.match(indexHtml, /id="clientThemeDialog"/);
assert.match(indexHtml, /client-themes\.css\?v=510/);
assert.match(indexHtml, /theme-catalog\.js\?v=510/);
assert.match(providerJs, /current_role !== 'owner'/);
assert.match(providerJs, /provider_client_page_settings_v1/);
assert.match(providerJs, /url\.searchParams\.set\('theme'/);
assert.match(providerJs, /url\.searchParams\.set\('headline'/);
assert.match(appJs, /readClientOverride\(requestedOrganizationSlug\)/);
assert.doesNotMatch(appJs, /get_public_minuta_catalog_v5/);
assert.match(sw, /const CACHE = `\$\{CACHE_PREFIX\}v510`/);
assert.match(sw, /theme-catalog\.js\?v=510/);
assert.match(providerHtml, /voice-assistant\.js\?v=510/);

console.log('client theme selection v511 tests passed');
