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
assert.equal(catalog.version, 1);
assert.equal(catalog.locale, 'ru-RU');
assert.equal(catalog.professions.length, 12);
assert.equal(new Set(catalog.professions.map(item => item.id)).size, 12);
assert.ok(catalog.professions.every(item => item.services.length >= 6 && item.services.length <= 8));
const services = catalog.professions.flatMap(item => item.services);
assert.equal(new Set(services.map(item => item.id)).size, services.length);
assert.ok(services.every(item => item.professionId && item.name && Number.isInteger(item.defaultDuration) && !('price' in item)));
assert.equal(catalog.normalizeName('  Массаж\u00a0  Лица '), 'массаж лица');
assert.ok(catalog.search('окрашивание', ['hair_stylist']).length >= 2);

for (const unsafe of ['лечение', 'омоложение', 'детокс', 'похудение', 'реабилитац']) {
  assert.doesNotMatch(services.map(item => item.name).join(' ').toLowerCase(), new RegExp(unsafe));
}

assert.match(provider, /data-open-service-presets[\s\S]*Шаблоны/);
assert.match(provider, /data-open-service-creator[\s\S]*Добавить услугу/);
assert.match(provider, /service-presets-catalog\.js\?v=\d+[\s\S]*onboarding\.js\?v=\d+/);
assert.match(provider, /provider\.js\?v=\d+[\s\S]*service-presets\.js\?v=\d+/);
const cacheVersion = worker.match(/CACHE_PREFIX\}v(\d+)/)?.[1];
assert.ok(cacheVersion, 'Service worker cache version missing');
assert.deepEqual([...new Set([...provider.matchAll(/\?v=(\d+)/g)].map(match => match[1]))], [cacheVersion], 'Provider resources must match the cache version');
assert.deepEqual([...new Set([...worker.matchAll(/\?v=(\d+)/g)].map(match => match[1]))], [cacheVersion], 'Precached resources must match the cache version');
for (const file of ['service-presets.css', 'service-presets-catalog.js', 'service-presets.js']) {
  assert.match(worker, new RegExp(`${file.replace('.', '\\.')}\\?v=${cacheVersion}`));
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
