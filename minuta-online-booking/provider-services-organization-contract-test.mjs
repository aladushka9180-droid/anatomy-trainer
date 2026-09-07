import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const provider = read('./provider.js');
const html = read('./provider.html');
const ux = read('./provider-ux.css');

assert.match(provider, /const duration = button\.dataset\.serviceDefaultDuration \?\? button\.dataset\.editServiceDefaultDuration;/, 'Пресеты редактора должны читать собственный data-атрибут');
assert.match(provider, /#editServiceActive'\)\.addEventListener\('change', updateEditServiceVisibilityHint\)/, 'Подсказка видимости должна обновляться вместе с checkbox');
assert.match(provider, /async function toggleServiceVisibility[\s\S]*button\.disabled = true;[\s\S]*aria-busy[\s\S]*\.eq\('id', id\)\.eq\('performer_id', userId\)\.select\('id,active'\)\.maybeSingle\(\)/, 'Переключение видимости должно блокировать повторный клик и иметь tenant guard');
assert.match(provider, /if \(error \|\| !data\) \{[\s\S]*Не удалось изменить видимость услуги[\s\S]*return false;[\s\S]*Услуга доступна клиентам[\s\S]*await refreshAfterWrite\(\)/, 'Ошибка видимости не должна выглядеть как успешное сохранение');

assert.match(html, /id="organizationSectionSelect" data-provider-section-selector="organizationSectionNav"/, 'У мобильного выбора организации нет связи с desktop-навигацией');
assert.match(html, /class="provider-section-nav" aria-label="Разделы организации" id="organizationSectionNav"/, 'Desktop-навигация организации должна сохраняться');
assert.match(html, /id="paymentProviderUnavailable" role="status" aria-live="polite" hidden/, 'Ошибка платёжного модуля должна объявляться скринридеру');
for (const target of ['organizationOverviewSection','organizationPeopleSection','resourcesPanel','shiftsPanel','payrollPanel','paymentProviderPanel','benefitsPanel','loyaltyPanel','retentionPanel','inventoryPanel']) {
  assert.match(html, new RegExp(`<option value="${target}">`), `В мобильном выборе отсутствует ${target}`);
  assert.match(html, new RegExp(`data-section-target="${target}"`), `В desktop-навигации отсутствует ${target}`);
}
assert.match(provider, /function syncProviderSectionSelector[\s\S]*option\.disabled = !button \|\| button\.hidden;[\s\S]*selector\.value = current\.dataset\.sectionTarget;/, 'Скрытые и выбранный подразделы не синхронизируются с select');
assert.match(provider, /data-provider-section-selector[\s\S]*scrollToProviderSection\(button\)/, 'Выбор select не использует единый путь сохранения и раскрытия подраздела');

assert.match(ux, /@media\(max-width:760px\)[\s\S]*organization-section-selector[\s\S]*min-height:44px[\s\S]*organization-workspace>.provider-section-nav \{ display:none!important; \}/, 'На 760px select должен заменить горизонтальные вкладки');
assert.match(ux, /@media\(max-width:480px\)[\s\S]*service-visibility-toggle span \{ display:inline; \}/, 'На 390px подпись видимости нельзя скрывать');
assert.match(ux, /managed-service \.service-info :is\(strong,small\)[\s\S]*overflow-wrap:anywhere/, 'Длинное название услуги должно переноситься');
assert.match(ux, /#payrollPanel,#loyaltyPanel,#retentionPanel[\s\S]*details>summary\)[\s\S]*min-height:44px/, 'Мобильные действия финансовых и CRM-разделов должны иметь цель 44px');
assert.match(ux, /#retentionPanel :is\([^}]*retention-consent-field>span[^}]*\)[^}]*font-size:11px/, 'Мобильные подписи возврата клиентов должны оставаться читаемыми');

const normalizeStart = provider.indexOf('function normalizePerMinuteDuration');
const normalizeEnd = provider.indexOf('\nfunction selectedNewBookingService', normalizeStart);
const presetsStart = provider.indexOf('function bindServiceDefaultDurationPresets');
const presetsEnd = provider.indexOf('\nasync function applyPerMinuteBookingTerms', presetsStart);
const presetButtons = [30,45,60,90].map(value => ({ dataset:{ editServiceDefaultDuration:String(value) }, addEventListener(_type, callback) { this.click = callback; } }));
const presetInput = { value:'' };
const bindPresets = new Function('$','$$','PER_MINUTE_BOOKING_MIN','PER_MINUTE_BOOKING_MAX', `${provider.slice(normalizeStart, normalizeEnd)}\n${provider.slice(presetsStart, presetsEnd)}; return bindServiceDefaultDurationPresets;`)(() => presetInput, () => presetButtons, 1, 480);
bindPresets('[data-edit-service-default-duration]', '#editServiceDefaultDuration');
for (const [index, expected] of [30,45,60,90].entries()) {
  presetButtons[index].click();
  assert.equal(presetInput.value, String(expected), `Пресет ${expected} минут выбрал другое значение`);
}

const toggleStart = provider.indexOf('async function toggleServiceVisibility');
const toggleEnd = provider.indexOf('\nfunction refreshSettingsQuickStart', toggleStart);
const makeToggle = ({ result, messages, refreshes, queryCalls }) => {
  const query = {
    eq(column, value) { queryCalls.push(['eq', column, value]); return this; },
    select(columns) { queryCalls.push(['select', columns]); return this; },
    async maybeSingle() { return result; }
  };
  const db = { from(table) { queryCalls.push(['from', table]); return { update(values) { queryCalls.push(['update', values]); return query; } }; } };
  return new Function('db','currentUser','notify','refreshAfterWrite', `${provider.slice(toggleStart, toggleEnd)}; return toggleServiceVisibility;`)(db, { id:'provider-a' }, message => messages.push(message), async () => refreshes.push('refresh'));
};
const button = () => {
  const label = { textContent:'Доступна' };
  return { dataset:{ toggleService:'service-a', active:'true' }, disabled:false, isConnected:true, querySelector:() => label, setAttribute(){}, removeAttribute(){}, label };
};
{
  const messages = [], refreshes = [], queryCalls = [];
  const toggle = makeToggle({ result:{ data:{ id:'service-a', active:false }, error:null }, messages, refreshes, queryCalls });
  const target = button();
  assert.equal(await toggle(target), true);
  assert.equal(target.disabled, false);
  assert.equal(target.label.textContent, 'Доступна');
  assert.deepEqual(queryCalls.slice(0,4), [['from','services'],['update',{ active:false }],['eq','id','service-a'],['eq','performer_id','provider-a']]);
  assert.deepEqual(refreshes, ['refresh']);
  assert.deepEqual(messages, ['Услуга скрыта от клиентов']);
}
{
  const messages = [], refreshes = [], queryCalls = [];
  const toggle = makeToggle({ result:{ data:null, error:{ message:'denied' } }, messages, refreshes, queryCalls });
  const target = button();
  assert.equal(await toggle(target), false);
  assert.equal(target.disabled, false);
  assert.equal(target.label.textContent, 'Доступна');
  assert.deepEqual(refreshes, []);
  assert.deepEqual(messages, ['Не удалось изменить видимость услуги']);
}

console.log('provider services + organization contract test passed');
