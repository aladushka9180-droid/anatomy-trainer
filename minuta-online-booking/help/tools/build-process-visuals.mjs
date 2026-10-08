import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Source-native process diagrams. This tool never launches a browser or contacts a service.
// These labels describe phases; they are deliberately not a truncated copy of article steps.
const phases = {
  'first-booking': ['Услуга', 'Рабочие часы', 'Проверка онлайн-записи'],
  'block-time-in-schedule': ['Тип занятого времени', 'Дата и интервал', 'Сохранение в графике'],
  'confirm-or-delete-booking': ['Карточка визита', 'Действие и область серии', 'Подтверждение', 'Проверка расписания'],
  'record-visit-result-and-payment': ['Правила автоучёта', 'Результат и оплата', 'Исключения', 'Описание и фотографии'],
  'find-and-filter-bookings': ['Период', 'Вид расписания', 'Поиск визита'],
  'set-regular-workweek': ['Шаблон недели', 'Дни и часы', 'Сохранение графика'],
  'customize-workdays-and-booking-step': ['Рабочие дни', 'Часы работы', 'Шаг записи'],
  'add-service': ['Название услуги', 'Цена и длительность', 'Сохранение'],
  'organization-name': ['Нужная организация', 'Название', 'Сохранение'],
  'add-branch': ['Название и адрес', 'Проверка адреса', 'Сохранение', 'Клиентская страница'],
  'add-staff-shift': ['Сотрудник и филиал', 'Дата и рабочие часы', 'Создание смены'],
  'payroll-plan': ['Сотрудник и план', 'Правила и ступени', 'Проверка правила'],
  'yookassa-refund': ['Платёж и сумма', 'Причина и подтверждение', 'Проверка статуса', 'При сбое — без повтора'],
  'adjust-redeem-loyalty': ['Клиент и текущий цикл', 'Корректировка или награда', 'Действие и подтверждение', 'Проверка истории'],
  'notification-queue': ['Сообщение и получатель', 'Отправка', 'Фактический результат', 'Проверка очереди'],
  'notification-templates': ['Событие', 'Текст сообщения', 'Сохранение шаблона'],
  'business-goals': ['Цели бизнеса', 'Ориентиры', 'Сохранение'],
  'publish-reviews': ['Отзыв клиента', 'Выбор отзыва', 'Видимость на странице'],
  'settings-quick-start': ['Услуги и часы', 'Правила записи', 'Сообщения', 'Проверка глазами клиента'],
  'booking-rules': ['Сроки и переносы', 'Предоплата и перерыв', 'Автоучёт', 'Проверка результата'],
  'visitor-alerts': ['Включение функции', 'Разрешение браузера', 'Проверка уведомления', 'Устранение блокировки'],
  'settings-batch-bookings': ['Включение функции', 'Клиент', 'Проверка всех дат', 'Создание пакета'],
  'settings-group-sessions': ['Включение функции', 'Событие и места', 'Публикация', 'Контроль вместимости'],
  'account-security': ['Личный аккаунт', 'Пароль и телефон', 'Проверка входа', 'Восстановление и защита'],
  'cabinet-layout-theme': ['Структура кабинета', 'Тема', 'Проверка отображения'],
  'booking-card-appearance': ['Размер карточки', 'Видимые данные', 'Проверка сохранения'],
  'mobile-navigation': ['Роль пользователя', 'Четыре быстрые вкладки', 'Остальные разделы', 'Проверка на телефоне'],
  'voice-assistant': ['Вопрос помощнику', 'Текст или голос', 'Отправка вопроса'],
  'voice-assistant-actions': ['Запрос', 'Выбор действия', 'Открытие формы', 'Проверка и подтверждение'],
  'reschedule': ['Нужный визит', 'Подтверждение визита', 'Перенос или отмена', 'Проверка результата'],
  'repeat-client-booking': ['Карточка клиента', 'Услуга', 'Дата и время', 'Сохранение визита'],
  'employee-rights': ['Минимальная роль', 'Приём и доступ', 'Сохранение прав', 'Проверка входа'],
  'statistics-filters': ['Период', 'Применение дат', 'Сотрудник'],
  'statistics-sections': ['Деньги', 'Клиенты', 'Команда']
};

const processOnly = new Set(['first-booking', 'settings-quick-start', 'voice-assistant-actions']);
const helpRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const context = { window: {} };
vm.runInNewContext(readFileSync(join(helpRoot, 'help-data.js'), 'utf8'), context);
const articles = context.window.MINUTA_HELP_ARTICLES;
// Frozen source references from c219d1a2: retain the backlog while article copy evolves.
const previousVisuals = JSON.parse(readFileSync(join(helpRoot, 'tools', 'previous-visuals.json'), 'utf8'));
const approvedCapturePath = join(helpRoot, 'tools', 'native-article-visuals.json');
const approvedCaptures = existsSync(approvedCapturePath) ? JSON.parse(readFileSync(approvedCapturePath, 'utf8')) : {};
const additionalPlan = JSON.parse(readFileSync(join(helpRoot, 'tools', 'additional-visual-plan.json'), 'utf8'));
const output = join(helpRoot, 'images', 'process');
mkdirSync(output, { recursive: true });

const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
function lines(label) {
  const words = label.split(' '), result = [''];
  for (const word of words) {
    const last = result.length - 1;
    if ((result[last] + ' ' + word).trim().length > 25) result.push(word);
    else result[last] = (result[last] + ' ' + word).trim();
  }
  if (result.length > 2) throw new Error(`Diagram label needs simplification: ${label}`);
  return result;
}
function diagram(article, labels, options) {
  const gap = options ? 16 : 28, inset = options ? 18 : 24;
  const height = inset * 2 + labels.length * 88 + (labels.length - 1) * gap;
  const nodes = labels.map((label, index) => {
    const y = inset + index * (88 + gap), text = lines(label), base = y + (text.length === 1 ? 54 : 37);
    const next = index < labels.length - 1 && !options?.parallel ? `<path d="M280 ${y + 94}v${gap - 12}" stroke="#a3446c" stroke-width="3" marker-end="url(#arrow)"/>` : '';
    return `<rect x="20" y="${y}" width="520" height="88" rx="16" fill="${index === labels.length - 1 && !options?.parallel ? '#fce7ef' : '#ffffff'}" stroke="#ead5df" stroke-width="2"/><text x="280" y="${base}" text-anchor="middle" fill="#352b31" font-size="30" font-weight="600">${text.map((part, n) => `<tspan x="280" dy="${n ? 36 : 0}">${escape(part)}</tspan>`).join('')}</text>${next}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${height}" viewBox="0 0 560 ${height}" role="img" aria-labelledby="title desc"><title id="title">${escape(article.title)} — схема процесса</title><desc id="desc">Схема этапов, не снимок интерфейса. ${escape(labels.join(options?.parallel ? '; ' : ' → '))}. Подробные действия описаны в статье.</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10" fill="none" stroke="#a3446c" stroke-width="2"/></marker></defs><rect width="560" height="${height}" rx="20" fill="#fff7fa"/><g font-family="Arial, Segoe UI, sans-serif">${nodes}</g></svg>\n`;
}

const manifest = {};
function detailFor(image) {
  if (!image.detail) return {};
  const { x, y, width, height } = image.detail;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 40 || height < 40
    || x + width > image.width || y + height > image.height) throw new Error(`Invalid screenshot detail: ${image.src}`);
  return { detail:{ x, y, width, height } };
}
for (const article of articles) {
  const additionalDiagram = additionalPlan.diagrams[article.slug];
  const labels = phases[article.slug] || additionalDiagram?.labels;
  const priorVisual = previousVisuals[article.slug];
  const images = [];
  const captures = approvedCaptures[article.slug] || [];
  for (const capture of captures) {
    const folder = article.audience === 'client' ? 'native-client' : 'native-local';
    const minimumHeight = article.slug === 'connect-telegram' && capture.component === 'telegram-connect' ? 44 : 100;
    if (!new RegExp(`^images/${folder}/[a-z0-9-]+\\.(webp|png)$`).test(capture.src)
      || capture.kind !== 'screenshot' || capture.coverageExact !== true
      || capture.environment !== 'isolated-local-native-fixture'
      || capture.domModified !== false || capture.rendererModified !== false || capture.liveVerified !== false
      || typeof capture.alt !== 'string' || !capture.alt.trim()
      || typeof capture.caption !== 'string' || !/учебные данные/i.test(capture.caption)
      || !Number.isInteger(capture.width) || !Number.isInteger(capture.height)
      || capture.width < 200 || capture.height < minimumHeight
      || (capture.step && (!Number.isInteger(capture.step) || capture.step < 1 || capture.step > article.steps.length))) {
      throw new Error(`Unapproved native capture: ${article.slug}`);
    }
    const digest = createHash('sha256').update(readFileSync(join(helpRoot, capture.src))).digest('hex');
    if (digest !== capture.sha256) throw new Error(`Native image changed since review: ${capture.src}`);
    const variants = (capture.variants || []).map(variant => {
      if (!new RegExp(`^images/${folder}/[a-z0-9-]+\\.(webp|png)$`).test(variant.src)
        || !Number.isInteger(variant.minWidth) || variant.minWidth < 0
        || !Number.isInteger(variant.width) || !Number.isInteger(variant.height)
        || variant.width < 200 || variant.height < minimumHeight
        || createHash('sha256').update(readFileSync(join(helpRoot, variant.src))).digest('hex') !== variant.sha256) {
        throw new Error(`Unapproved responsive capture: ${article.slug}`);
      }
      if (capture.detail && !variant.detail) throw new Error(`Missing responsive detail: ${variant.src}`);
      return { minWidth:variant.minWidth, src:variant.src, width:variant.width, height:variant.height, ...detailFor(variant) };
    });
    if (variants.some((variant, index) => index && variants[index - 1].minWidth <= variant.minWidth)) throw new Error(`Unordered image variants: ${article.slug}`);
    images.push({ src:capture.src, alt:capture.alt, caption:capture.caption, kind:'screenshot', width:capture.width, height:capture.height, ...detailFor(capture), ...(capture.step ? { step:capture.step } : {}), ...(variants.length ? { variants } : {}) });
  }
  if (labels && !captures.length) {
    writeFileSync(join(output, `${article.slug}.svg`), diagram(article, labels, additionalDiagram));
    images.push({
      src: `images/process/${article.slug}.svg`,
      alt: `Схема ${additionalDiagram?.parallel ? 'сравнения' : 'этапов'}: ${labels.join(additionalDiagram?.parallel ? '; ' : ' → ')}.`,
      caption: additionalDiagram ? `Схема, не снимок интерфейса. ${additionalDiagram.caption}` : 'Схема процесса, не снимок интерфейса. Подробные действия — в инструкции.',
      kind: 'diagram', width: 560, height: additionalDiagram ? 36 + labels.length * 88 + (labels.length - 1) * 16 : 48 + labels.length * 88 + (labels.length - 1) * 28,
      ...(additionalDiagram ? { step:additionalDiagram.step } : {})
    });
  }
  const entry = { images };
  if (captures.length) entry.capture = { status:'captured-local-native', liveVerified:false };
  if (priorVisual && !processOnly.has(article.slug) && !captures.length) entry.deferredCapture = {
    status: 'pending',
    reason: 'local_capture_pending',
    requirement: labels
      ? 'Нужен актуальный снимок текущего интерфейса с тестовыми данными. Схема объясняет этапы, но не расположение элементов.'
      : 'Нужен актуальный снимок текущего интерфейса с тестовыми данными. Прежний кадр с изменённым DOM не используется как актуальный.',
    sourceToReplace: priorVisual,
    targetArticle: article.title,
    widths: [390, 760, 1440]
  };
  if (!priorVisual && !images.length) entry.status = 'text-only';
  manifest[article.slug] = entry;
}
for (const slug of Object.keys(phases)) if (!articles.some(article => article.slug === slug)) throw new Error(`Unknown article: ${slug}`);
for (const slug of Object.keys(approvedCaptures)) if (!articles.some(article => article.slug === slug)) throw new Error(`Unknown captured article: ${slug}`);
writeFileSync(join(helpRoot, 'tools', 'process-visuals-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const browserManifest = `(function () {\n  'use strict';\n  // Generated by help/tools/build-process-visuals.mjs. Schemes never claim to be screenshots.\n  const manifest = ${JSON.stringify(manifest, null, 2)};\n  window.MINUTA_HELP_VISUAL_MANIFEST = manifest;\n  const articles = Array.isArray(window.MINUTA_HELP_ARTICLES) ? window.MINUTA_HELP_ARTICLES : [];\n  articles.forEach(article => {\n    const entry = manifest[article.slug];\n    if (!entry) return;\n    delete article.visual;\n    delete article.deferredCapture;\n    article.visuals = entry.images.map(image => ({ ...image }));\n    if (article.visuals.length) article.visual = article.visuals[0];\n    if (entry.deferredCapture) article.deferredCapture = { ...entry.deferredCapture };\n  });\n}());\n`;
writeFileSync(join(helpRoot, 'help-visuals.js'), browserManifest);
console.log(JSON.stringify({ articles: articles.length, diagrams: Object.values(manifest).reduce((count, entry) => count + entry.images.filter(image => image.kind === 'diagram').length, 0), pendingCaptures: Object.values(manifest).filter(entry => entry.deferredCapture).length, textOnly: Object.values(manifest).filter(entry => entry.status === 'text-only').length }));
