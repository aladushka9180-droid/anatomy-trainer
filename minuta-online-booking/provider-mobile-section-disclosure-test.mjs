import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const [source, html] = await Promise.all([
  readFile(path.join(directory, 'provider.js'), 'utf8'),
  readFile(path.join(directory, 'provider.html'), 'utf8')
]);

function sourceFunction(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`\nfunction ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} должна присутствовать в provider.js`);
  return source.slice(start, end);
}

const preferredProviderSectionTarget = new Function(
  `${sourceFunction('preferredProviderSectionTarget', 'providerSectionElements')}; return preferredProviderSectionTarget;`
)();
const button = (target, { hidden = false, active = false } = {}) => ({
  hidden,
  dataset:{ sectionTarget:target },
  classList:{ contains:name => name === 'active' && active }
});

const buttons = [
  button('overview', { active:true }),
  button('people'),
  button('payments', { hidden:true })
];
assert.equal(preferredProviderSectionTarget(buttons, 'people').dataset.sectionTarget, 'people', 'сохранённый доступный подраздел должен восстанавливаться');
assert.equal(preferredProviderSectionTarget(buttons, 'payments').dataset.sectionTarget, 'overview', 'скрытый сервером подраздел не должен оставлять пустой экран');
assert.equal(preferredProviderSectionTarget([button('first'), button('second')]).dataset.sectionTarget, 'first', 'без сохранённого выбора должен открываться первый доступный подраздел');

for (const target of [
  'organizationOverviewSection', 'organizationPeopleSection', 'resourcesPanel', 'shiftsPanel',
  'payrollPanel', 'paymentProviderPanel', 'benefitsPanel', 'inventoryPanel',
  'appearanceSettingsCard', 'visitorAlertSettingsCard', 'installAppCard', 'bookingRulesCard', 'accountSettingsCard'
]) {
  assert.match(html, new RegExp(`data-section-target="${target}"`), `в интерфейсе должна оставаться кнопка возврата к ${target}`);
}

assert.match(source, /PROVIDER_SECTION_STORAGE_PREFIX = 'minuta-provider-subsection-v1'/, 'выбор подраздела должен сохраняться локально');
assert.match(source, /rememberProviderSection[\s\S]*localStorage\.setItem\(providerSectionStorageKey\(nav\), target\)/, 'нажатие на подраздел должно запоминаться');
assert.match(source, /providerSectionMobileQuery = window\.matchMedia\('\(max-width: 760px\)'\)/, 'скрытие должно включаться только на мобильной ширине');
assert.match(source, /organizationPeopleSection:\['invitationsPanel', 'organizationAuditPanel'\]/, 'приглашения и журнал должны оставаться в подразделе команды');
assert.match(source, /benefitsPanel:\['loyaltyPanel', 'retentionPanel'\]/, 'лояльность и возврат клиентов должны оставаться в клиентском подразделе');
assert.match(source, /bookingRulesCard:\['teamCalendarSettingsCard', 'groupBookingSettingsCard'\]/, 'настройки команды и групповые записи должны оставаться рядом с правилами записи');
assert.match(source, /element\.style\.display = 'none';[\s\S]*element\.setAttribute\('aria-hidden', 'true'\);[\s\S]*element\.setAttribute\('inert', ''\)/, 'неактивный мобильный подраздел должен быть скрыт и исключён из фокуса');
assert.match(source, /if \(!providerSectionMobileQuery\.matches\) \{[\s\S]*restoreProviderSectionDisclosure\(nav\)/, 'на компьютере исходная длинная раскладка должна полностью восстанавливаться');
assert.match(source, /if \(nav && providerSectionMobileQuery\.matches\) refreshProviderSectionDisclosure\(nav\)/, 'выбор кнопки должен сразу переключать мобильный подраздел');
assert.match(source, /if \(providerSectionMobileQuery\.matches\) return;[\s\S]*\$\$\('\.provider-section-nav'\)/, 'прокрутка не должна самопроизвольно менять выбранный мобильный подраздел');
assert.match(source, /providerSectionMobileQuery\.addEventListener\('change', refreshSectionNavigation\)/, 'смена ориентации должна переключать мобильный и компьютерный режимы');

const disclosureSource = source.slice(
  source.indexOf('function providerSectionViewKey'),
  source.indexOf('function canUseIosTransitions')
);
assert.doesNotMatch(disclosureSource, /\bdb\.|\.rpc\(|\bfetch\(/, 'упрощение интерфейса не должно обращаться к базе или API');

console.log('Provider mobile section disclosure checks passed.');
