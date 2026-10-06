import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const read = file => readFileSync(resolve(root, file), 'utf8');
const context = { window: {} };
vm.runInNewContext(read('help/help-data.js'), context);

const articles = context.window.MINUTA_HELP_ARTICLES;
assert.ok(Array.isArray(articles) && articles.length >= 85, 'База знаний должна содержать полный набор статей');
assert.equal(new Set(articles.map(article => article.slug)).size, articles.length, 'Slug статей должны быть уникальными');

for (const article of articles) {
  assert.ok(article.title && article.excerpt && article.note, `${article.slug}: не заполнены основные поля`);
  assert.ok(Array.isArray(article.steps) && article.steps.length >= 3, `${article.slug}: слишком мало шагов`);
  assert.ok(article.steps.every(step => step.title && step.text), `${article.slug}: есть пустой шаг`);
}

const required = [
  'client-phone-autofill', 'client-search-filters', 'client-online-booking-block',
  'client-files-and-visit-notes', 'client-private-results', 'client-retention',
  'client-page-appearance', 'operation-result-uncertain'
];
for (const slug of required) {
  const article = articles.find(item => item.slug === slug);
  assert.ok(article, `Нет новой статьи ${slug}`);
  assert.equal(article.updatedAt, '5 октября 2026', `${slug}: нет даты редакции`);
  assert.equal(article.reviewedAt, undefined, `${slug}: редакция не должна подменять живую проверку`);
}

const categorySlugs = new Set(context.window.MINUTA_HELP_CATEGORIES.map(category => category.slug));
const articleSlugs = new Set(articles.map(article => article.slug));
for (const article of articles) {
  assert.ok(categorySlugs.has(article.categorySlug), `${article.slug}: неизвестный раздел`);
  assert.ok(article.prerequisites?.length && article.prerequisites.every(item => typeof item === 'string' && item.trim()), `${article.slug}: не описаны условия начала`);
  assert.ok(article.outcome?.trim(), `${article.slug}: не описана проверка результата`);
  assert.ok(article.troubleshooting?.length && article.troubleshooting.every(item => item.title?.trim() && item.text?.trim()), `${article.slug}: нет решения проблем`);
  assert.ok(article.related?.length && article.related.every(slug => articleSlugs.has(slug) && slug !== article.slug), `${article.slug}: неверные связанные инструкции`);
  assert.ok(article.related.every(slug => articles.find(item => item.slug === slug)?.audience === article.audience), `${article.slug}: смешаны инструкции для разных пользователей`);
}

const helpData = read('help/help-data.js');
assert.doesNotMatch(helpData, /скрыта в командном режиме/, 'Старое ограничение листа ожидания не удалено');
assert.match(helpData, /Когда полный номер совпал с одним клиентом/, 'Нет точного описания автоподстановки клиента');
assert.match(helpData, /Статус «отправлено» означает ручную отметку/, 'Нет объяснения статуса WhatsApp');

const providerHtml = read('provider.html');
const mobileMoreLabel = providerHtml.match(/data-provider-view="more"[\s\S]*?<span>([^<]+)<\/span>/)?.[1];
assert.ok(mobileMoreLabel, 'Не найдено название мобильного меню');
assert.ok(JSON.stringify(articles.find(article => article.slug === 'mobile-navigation')).includes(`«${mobileMoreLabel}»`), 'Инструкция должна использовать реальное название мобильного меню');
const providerJs = read('provider.js');
assert.doesNotMatch(providerJs, /client-phone-autofill/, 'Очевидная подсказка не должна перегружать форму записи');
assert.match(providerJs, /client-private-results/, 'В результате визита нет ссылки на приватность');
assert.match(providerJs, /\['clients', 'messages', 'notifications', 'settings', 'organization', 'more'\]\.includes\(view\).*loadProviderGuidance/, 'Контекстные подсказки не загружаются в разделах клиентов, сообщений и уведомлений');
for (const slug of ['client-search-filters', 'client-card-notes-and-labels', 'notification-queue', 'client-retention', 'client-page-appearance', 'share-free-slots']) {
  assert.ok(providerHtml.includes(slug), `В интерфейсе нет контекстной ссылки ${slug}`);
}

const contextualLabels = new Map([
  ['client-search-filters', 'Как найти клиента?'],
  ['client-card-notes-and-labels', 'Что есть в карточке?'],
  ['notification-queue', 'Как это работает?'],
  ['organization-structure', 'С чего начать?'],
  ['roles-access-safety', 'Роли и доступ'],
  ['service-resources', 'Как настроить ресурсы?'],
  ['setup-yookassa', 'Как подключить оплату?'],
  ['inventory-setup', 'Как настроить склад?'],
  ['client-retention', 'Кто попадёт в список?'],
  ['subscription-plans', 'Как выбрать тариф?'],
  ['cabinet-layout-theme', 'Как выбрать оформление?'],
  ['visitor-alerts', 'Какие данные видны?'],
  ['install-app', 'Как установить?'],
  ['account-security', 'Как защитить аккаунт?']
]);
for (const [slug, label] of contextualLabels) {
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    providerHtml,
    new RegExp(`data-contextual-help[^>]*data-help-label="${escapedLabel}"[^>]*data-help-slug="${escapedSlug}"`),
    `${slug}: контекстная подсказка названа слишком общо`
  );
}

assert.doesNotMatch(read('help/article.html'), /article-feedback/, 'Неподключённая форма обратной связи не должна вводить пользователя в заблуждение');
const contextualHelp = read('contextual-help.js');
assert.match(contextualHelp, /'Первый шаг'/, 'Короткая подсказка должна объяснять первый шаг');
assert.match(contextualHelp, /'Важно'/, 'Короткая подсказка должна выделять ограничение');
assert.match(contextualHelp, /danger \? 'Что произойдёт\?' : 'Как это работает\?'/, 'Запасные подписи подсказок не отражают контекст');
assert.doesNotMatch(contextualHelp, /Не совсем понятно\?/, 'Общая подпись «Не совсем понятно?» не должна возвращаться');
assert.match(read('help/help.css'), /@media \(max-width: 900px\)[\s\S]*\.article-shell[^}]*display: block;/,
  'Статья должна переходить в одну колонку на контрольной ширине 760 px');

console.log(`Help knowledge refresh v811: PASS (${articles.length} articles)`);
