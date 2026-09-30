import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('.', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const catalogSource = read('service-presets-catalog.js');
const controller = read('service-presets.js');
const onboarding = read('onboarding.js');
const provider = read('provider.html');
const styles = read('service-presets.css');
const worker = read('sw.js');

const sandbox = { window:{} };
vm.runInNewContext(catalogSource, sandbox);
const catalog = sandbox.window.MinutaServicePresetCatalog;
assert.equal(catalog.version, 2);
assert.equal(catalog.locale, 'ru-RU');
assert.equal(catalog.professions.length, 20);
assert.equal(new Set(catalog.professions.map(item => item.id)).size, 20);
assert.ok(catalog.professions.every(item => item.services.length >= 10));
const services = catalog.professions.flatMap(item => item.services);
assert.equal(new Set(services.map(item => item.id)).size, services.length);
assert.ok(services.every(item => item.professionId && item.name && Number.isInteger(item.defaultDuration) && !('price' in item)));
assert.equal(catalog.normalizeName('  Массаж\u00a0  Лица '), 'массаж лица');
assert.ok(catalog.search('окрашивание', ['hair_stylist']).length >= 2);
assert.equal(catalog.searchProfessions('резина')[0]?.id, 'tire_fitter');
assert.equal(catalog.searchProfessions('лешмейкер')[0]?.id, 'lash_artist');
assert.equal(catalog.search('подкачка', ['tire_fitter']).length, 1);
for (const profession of catalog.professions) assert.equal(new Set(profession.services.map(item => catalog.normalizeName(item.name))).size, profession.services.length);

for (const unsafe of ['лечение', 'омоложение', 'детокс', 'похудение', 'реабилитац']) {
  assert.doesNotMatch(services.map(item => item.name).join(' ').toLowerCase(), new RegExp(unsafe));
}

assert.doesNotMatch(provider, /data-service-catalog-tab|id="serviceCreatorDialog"/);
assert.match(provider, /id="serviceCreatorContent" hidden/);
assert.match(provider, /data-open-service-creator[\s\S]*Добавить услугу/);
assert.match(provider, /service-presets-catalog\.js\?v=\d+[\s\S]*onboarding\.js\?v=\d+/);
assert.match(provider, /provider\.js\?v=\d+[\s\S]*service-presets\.js\?v=\d+/);
const cacheVersion = worker.match(/CACHE_PREFIX\}v(\d+)/)?.[1];
assert.ok(cacheVersion, 'Service worker cache version missing');
// Unchanged assets keep their own version in the current release process.
// Enforce matching URLs between the page and precache for each affected asset.
for (const file of ['service-presets.css', 'service-presets-catalog.js', 'service-presets.js']) {
  const resource = provider.match(new RegExp(`${file.replaceAll('.', '\\.')}\\?v=\\d+`))?.[0];
  assert.ok(resource, `Missing page resource: ${file}`);
  assert.ok(worker.includes(`'./${resource}'`), `Page/precache mismatch: ${resource}`);
}
assert.match(controller, /create_provider_services_from_presets_v160/);
assert.match(controller, /p_request:state\.requestId/);
assert.match(controller, /p_catalog_version:catalog\.version/);
assert.match(controller, /preset_id:item\.presetId/);
assert.match(controller, /price === ''/);
assert.doesNotMatch(controller, /price[^\n]{0,20}(2500|3000|1800)/);
assert.match(onboarding, /professionIds:\[\]/);
assert.match(onboarding, /type="checkbox" data-onboarding-profession/);
assert.match(onboarding, /create_provider_services_from_presets_v160/);
assert.match(onboarding, /minuta_onboarding_version:VERSION/);
assert.match(styles, /min-height:44px/);
assert.equal([...styles.matchAll(/var\(--theme-surface-strong,var\(--theme-surface,#fff\)\)/g)].length, 5);
assert.doesNotMatch(styles, /var\(--theme-surface-strong,#fff\)/);
assert.match(styles, /@media \(max-width:760px\)/);
assert.match(styles, /@media \(max-width:480px\)/);

console.log(`Service presets UI static checks passed: ${catalog.professions.length} professions, ${services.length} presets.`);
