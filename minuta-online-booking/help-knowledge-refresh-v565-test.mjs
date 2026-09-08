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
  assert.equal(article.reviewedAt, '7 сентября 2026', `${slug}: нет даты проверки`);
}

const helpData = read('help/help-data.js');
assert.doesNotMatch(helpData, /пятый пункт «Разделы»/, 'Старое название пятой вкладки не удалено');
assert.doesNotMatch(helpData, /скрыта в командном режиме/, 'Старое ограничение листа ожидания не удалено');
assert.match(helpData, /Когда полный номер совпал с одним клиентом/, 'Нет точного описания автоподстановки клиента');
assert.match(helpData, /Статус «отправлено» означает ручную отметку/, 'Нет объяснения статуса WhatsApp');

const providerHtml = read('provider.html');
const providerJs = read('provider.js');
assert.doesNotMatch(providerJs, /client-phone-autofill/, 'Очевидная подсказка не должна перегружать форму записи');
assert.match(providerJs, /client-private-results/, 'В результате визита нет ссылки на приватность');
for (const slug of ['client-search-filters', 'client-card-notes-and-labels', 'notification-queue', 'client-retention', 'client-page-appearance', 'share-free-slots']) {
  assert.ok(providerHtml.includes(slug), `В интерфейсе нет контекстной ссылки ${slug}`);
}

assert.doesNotMatch(read('help/article.html'), /article-feedback/, 'Неподключённая форма обратной связи не должна вводить пользователя в заблуждение');
assert.match(read('contextual-help.js'), /'Первый шаг'/, 'Короткая подсказка должна объяснять первый шаг');
assert.match(read('contextual-help.js'), /'Важно'/, 'Короткая подсказка должна выделять ограничение');
assert.match(read('help/help.css'), /@media \(max-width: 900px\)[\s\S]*\.article-shell[^}]*display: block;/,
  'Статья должна переходить в одну колонку на контрольной ширине 760 px');

console.log(`Help knowledge refresh v609: PASS (${articles.length} articles)`);
