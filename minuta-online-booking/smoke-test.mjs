import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pages = ['index.html', 'provider.html', 'booking.html', 'my-bookings.html', 'waitlist.html', 'privacy.html'];
const version = '105';

for (const page of pages) {
  const html = readFileSync(join(root, page), 'utf8');
  assert.match(html, /Content-Security-Policy/, `${page}: нет политики безопасности`);
  assert.doesNotMatch(html, /v=(?:38|39|40|41|42|43|44)/, `${page}: осталась старая версия ресурсов`);
  for (const match of html.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"#]*)?"/g)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|tel:)/.test(reference)) continue;
    assert.ok(existsSync(join(root, reference)), `${page}: отсутствует ${reference}`);
  }
}

for (const page of ['index.html', 'provider.html', 'booking.html', 'my-bookings.html']) {
  const html = readFileSync(join(root, page), 'utf8');
  assert.match(html, /vendor\/supabase-2\.112\.4\.min\.js/, `${page}: SDK Supabase не закреплён локально`);
  assert.match(html, /integrity="sha384-/, `${page}: нет контроля целостности SDK`);
  assert.match(html, new RegExp(`reliability\\.js\\?v=${version}`), `${page}: не подключён слой надёжности`);
  assert.doesNotMatch(html, /https:\/\/\*\.supabase\.co/, `${page}: CSP разрешает любой проект Supabase`);
}

const waitlistPage = readFileSync(join(root, 'waitlist.html'), 'utf8');
assert.match(waitlistPage, /vendor\/supabase-2\.112\.4\.min\.js/, 'waitlist.html: SDK Supabase не закреплён локально');
assert.match(waitlistPage, /integrity="sha384-/, 'waitlist.html: нет контроля целостности SDK');

const sdk = readFileSync(join(root, 'vendor', 'supabase-2.112.4.min.js'));
assert.equal(createHash('sha384').update(sdk).digest('base64'), 'yiVMs0R/Jyz7OhoXa/DsEMUSBLjEhr/QJta2ONO+zB6I8/GmNg/7AUFrZmAJV7KV', 'Контрольная сумма локального SDK не совпадает');

const app = readFileSync(join(root, 'app.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const provider = readFileSync(join(root, 'provider.js'), 'utf8');
const providerHtml = readFileSync(join(root, 'provider.html'), 'utf8');
assert.match(indexHtml, /id="clientAccessDownload"[^>]*>Сохранить код в файл</, 'После записи нельзя сохранить личный код в файл');
assert.match(app, /downloadClientAccessFile\(result\.access_code, phone\)/, 'Личный код не сохраняется автоматически после записи');
assert.match(provider, /postgres_changes/, 'Кабинет не подписан на изменения записей');
assert.match(provider, /saveProviderCache\('bookings'/, 'Записи не сохраняются для офлайн-просмотра');
assert.match(provider, /setInterval\(\(\) =>/, 'Нет резервной периодической синхронизации');
assert.match(provider, /sessionIsCurrent/, 'Нет защиты от ответов старой пользовательской сессии');
assert.match(provider, /function bookingClientNote\(item\)/, 'Расписание не получает заметку клиента');
assert.match(provider, /class="provider-booking-open"[\s\S]*data-open-booking/, 'Компактная запись не открывает подробности по нажатию');
assert.doesNotMatch(provider.match(/function renderBookingList\(items\)[\s\S]*?\n\}/)?.[0] || '', /class="booking-actions"/, 'В компактном списке постоянно показаны вторичные действия');
assert.match(provider, /class="timeline-booking-client"[\s\S]*item\.client_phone/, 'Телефон клиента не показывается в ленте расписания');
assert.match(provider, /class="timeline-booking-note"[\s\S]*Заметка:/, 'Заметка клиента не показывается в ленте расписания');
assert.match(provider, /height < 58 \? ' compact'/, 'Короткие записи не получают компактную раскладку');
assert.match(provider, /requiredResults\.every\(result => result\?\.ok\)/, 'Запись разрешается без полной синхронизации');
assert.match(provider, /removePrefix\(`provider:\$\{userId\}:`\)/, 'Кэш клиента не очищается при выходе');
assert.match(provider, /bookings-v2/, 'Новый обезличенный кэш не отделён от старого PII-кэша');
assert.match(provider, /client_name: 'Клиент', client_phone: ''/, 'Офлайн-кэш записей содержит данные клиента');
assert.match(provider, /booking_policies/, 'Кабинет не загружает правила отмены и предоплаты');
assert.match(provider, /notification_templates/, 'Шаблоны уведомлений не синхронизируются с сервером');
assert.match(provider, /set_booking_payment_status/, 'Нет управления статусом предоплаты');
assert.match(provider, /\[1, 5, 10, 20, 30, 40, 60, 90, 120, 180/, 'Редактор услуги не поддерживает полный список длительностей');
assert.match(provider, /weekStartFor/, 'Лента дат не строит календарную неделю');
assert.match(provider, /dataDateShift|dataset\.dateShift/, 'Нет перехода между неделями');
assert.match(provider, /SCHEDULE_DATE_KEY/, 'Выбранная дата не сохраняется после обновления страницы');
assert.match(provider, /SCHEDULE_FOLLOW_TODAY_KEY/, 'Сохранённое «Сегодня» не следует за новым календарным днём');
assert.match(provider, /SCHEDULE_FILTER_KEY/, 'Фильтр расписания не сохраняется после обновления страницы');
assert.match(provider, /timeZone: 'Europe\/Samara'/, 'Расписание не использует часовой пояс места оказания услуг');
assert.match(provider, /scrollIntoView/, 'Активная дата не прокручивается в видимую область на мобильном');
assert.match(provider, /setAttribute\('aria-pressed'/, 'Состояние фильтров не передаётся средствам доступности');
assert.match(provider, /preparePortfolioImage/, 'Фотографии портфолио не обрабатываются перед загрузкой');
assert.match(provider, /canvas\.toBlob\(resolve, 'image\/webp'/, 'Фотографии портфолио не преобразуются в WebP без EXIF');
assert.match(provider, /reorder_portfolio_items/, 'Порядок портфолио не синхронизируется с сервером');
assert.match(provider, /data-portfolio-card/, 'Карточки портфолио нельзя перетаскивать на ПК');
assert.match(provider, /data-portfolio-move="up"/, 'Для мобильного нет кнопок изменения порядка портфолио');
assert.match(provider, /consent_confirmed_at/, 'Согласие клиента не сохраняется для портфолио');
assert.match(provider, /data-create-booking-at/, 'Клик по свободному месту расписания не создаёт запись');
assert.match(provider, /id="bookingSheetNoteForm"/, 'Заметка о клиенте недоступна из основной карточки записи');
assert.match(provider, /async function saveBookingSheetNote/, 'Заметку нельзя сохранить из основной карточки записи');
assert.match(provider, /class="booking-editor-heading"/, 'Навигация и заголовок редактора записи не разделены');
assert.match(provider, /id="editBookingNote"/, 'Заметка недоступна при редактировании записи или перерыва');
assert.match(provider, /id="bookingBlockNoteForm"/, 'Заметка к перерыву недоступна из основной карточки');
assert.match(provider, /blockDurationOptions/, 'При редактировании перерыва всё ещё показываются названия массажей вместо длительности');
assert.match(provider, /bookingNoteStorageKey\(userId\).*localStorage\.removeItem/s, 'Заметки к перерывам остаются на общем устройстве после выхода');
assert.match(provider, /Заметка сохранена на этом устройстве/, 'Интерфейс скрывает ошибку серверного сохранения заметки');
assert.match(provider, /pendingBookingNotes\.has\(item\.id\)/, 'Синхронизация может затереть локальную заметку после ошибки RPC');
assert.match(provider, /function clientBadgeMarkup/, 'В записях не отображаются метки клиента');
assert.match(provider, /function clientIsNew/, 'Новый клиент не определяется автоматически');
assert.match(providerHtml, /id="clientLabelsSaveStatus"/, 'В карточке клиента нет статуса автосохранения меток');
assert.match(provider, /function bookingClientLabelsMarkup/, 'В карточке записи нельзя открыть метки клиента');
assert.match(provider, /clientLabelVip'\)\.addEventListener\('change'/, 'VIP-метка не сохраняется сразу после выбора');
assert.match(provider, /data-booking-labels-status/, 'В карточке записи нет статуса автосохранения меток');
assert.match(providerHtml, /Что нравится клиенту<textarea id="clientFavoriteNote"/, 'У любимого клиента нет строки «Что нравится клиенту»');
assert.match(providerHtml, /id="clientVipNote"/, 'У VIP-клиента нельзя оставить пожелания');
assert.match(provider, /data-booking-favorite-note/, 'Комментарий любимого клиента недоступен из записи');
assert.match(provider, /data-booking-vip-note/, 'Комментарий VIP-клиента недоступен из записи');
assert.match(provider, /attention_reason\.length < 3/, 'Метка «Требует внимания» сохраняется без причины');
assert.match(provider, /client-vip/, 'VIP-записи не имеют отдельного минималистичного оформления');
assert.match(provider, /client-favorite/, 'Любимые клиенты не получают отдельного оформления');
assert.match(provider, /client-attention/, 'Клиенты с меткой «Внимание» не получают отдельного оформления');
assert.match(provider, /Метки клиента: \$\{escapeHtml\(fullText\)\}/, 'Компактные метки недоступны скринридеру');
assert.match(provider, /метки клиента: \$\{escapeHtml\(badgeDetails\)\}/, 'Метки не включены в доступное имя записи расписания');
assert.doesNotMatch(provider, /<span>Номер записи<\/span>/, 'Технический номер показывается в карточке исполнителя');
assert.match(provider, /class="booking-sheet-summary"/, 'Клиент и стоимость не собраны в компактное резюме');
assert.match(provider, /booking-note-disclosure/, 'Пустая заметка занимает слишком много места');
assert.match(provider, /booking-outcome-disclosure/, 'Раздел после визита нельзя свернуть');
assert.match(provider, /booking-cancel-action/, 'Отмена записи визуально конкурирует с основными действиями');
assert.match(provider, /timelineTimeFromClick/, 'Время клика по расписанию не вычисляется');
assert.match(provider, /Math\.floor\(rawMinute \/ 60\) \* 60/, 'Клик по расписанию не округляется вниз до начала часа');
const timelineFunctionSource = provider.match(/function timelineTimeFromClick\(stage, event\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(timelineFunctionSource, 'Не удалось извлечь расчёт времени клика для проверки');
const timelineTimeFromClick = Function(`${timelineFunctionSource}; return timelineTimeFromClick;`)();
const timelineStage = { dataset: { timelineStart: '600', timelineEnd: '1200' }, getBoundingClientRect: () => ({ top: 0, height: 600 }) };
assert.equal(timelineTimeFromClick(timelineStage, { clientY: 205 }), '13:00', 'Клик в 13:25 должен сначала выбирать 13:00');
assert.equal(timelineTimeFromClick(timelineStage, { clientY: 239 }), '13:00', 'Клик в конце часа должен выбирать его начало');
assert.equal(timelineTimeFromClick(timelineStage, { clientY: 240 }), '14:00', 'Клик ровно в начале часа не должен сдвигаться');
assert.match(provider, /SCHEDULE_BLOCK_PHONE = '0000000000'/, 'Нет безопасного маркера занятого времени');
assert.match(provider, /data-new-booking-mode="block"/, 'В ручной записи нет режима «Занять время»');
assert.match(provider, /if \(isScheduleBlock\(item\)\) return;/, 'Перерывы попадают в клиентские уведомления');

assert.match(providerHtml, /id="serviceDuration"[^>]*>[\s\S]*?<option value="20">20 мин<\/option>[\s\S]*?<option value="180">180 мин<\/option>/, 'В форме новой услуги нет длительности 20 и 180 минут');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');
assert.match(styles, /timeline-booking\.client-favorite/, 'Для любимого клиента не задан нежный акцент карточки');
assert.match(styles, /timeline-booking\.client-attention/, 'Для метки «Внимание» не задан заметный акцент карточки');
assert.match(styles, /\.service-creator-dialog select:focus\s*\{[^}]*box-shadow:none/, 'Выбор длительности сохраняет лишнее двойное выделение');
assert.match(styles, /text-size-adjust:100%/, 'Мобильное масштабирование текста не стабилизировано');
assert.match(styles, /button,a,summary\s*\{[^}]*touch-action:manipulation/, 'Двойное нажатие может случайно увеличить страницу');
assert.match(styles, /\.provider-body \.ambient-right\s*\{[^}]*display:none/, 'Декоративная жёлтая область остаётся на мобильном');
assert.match(styles, /input,select,textarea\s*\{[^}]*font-size:16px!important/, 'Мобильные поля могут вызывать автоматическое увеличение');
assert.match(providerHtml, /id="scheduleDatePicker"[^>]*type="date"/, 'В расписании нет выбора даты через календарь');
assert.match(providerHtml, /data-date-shift="-7"[\s\S]*data-date-shift="7"/, 'В расписании нет навигации по неделям');
assert.match(providerHtml, /data-provider-panel="portfolio"/, 'В кабинете нет раздела портфолио');
assert.match(providerHtml, /id="portfolioSessions"[^>]*min="1"[^>]*max="999"/, 'Нельзя указать количество проведённых сеансов');
assert.match(providerHtml, /id="portfolioBeforeFile"[^>]*accept="image\/jpeg,image\/png,image\/webp"/, 'Нет выбора фотографии «До»');
assert.match(providerHtml, /id="portfolioAfterFile"[^>]*accept="image\/jpeg,image\/png,image\/webp"/, 'Нет выбора фотографии «После»');
assert.match(providerHtml, /id="portfolioConsent"/, 'Публикация не требует подтверждения согласия клиента');
assert.match(providerHtml, /class="schedule-title-line"[\s\S]*class="dashboard-summary"/, 'Сводка расписания не собрана с заголовком');
assert.match(providerHtml, /class="policy-grid"[\s\S]*class="field-with-unit"/, 'Правила записи не собраны в компактную сетку с единицами');
assert.match(providerHtml, /id="autoCompleteVisits"/, 'В настройках нет автоматического учёта завершённых визитов');
assert.match(providerHtml, /id="reportUnpaid"/, 'Статистика не показывает неоплаченные визиты отдельно');
assert.match(provider, /function applyAutomaticVisitOutcomes/, 'Прошедшие визиты не отмечаются автоматически после рабочего дня');
assert.match(provider, /completion_source:'auto'/, 'Автоматическое завершение нельзя отличить от ручного');
assert.match(provider, /Будет учтён автоматически/, 'Карточка не объясняет автоматический учёт визита');
assert.match(provider, /payment_method:'unpaid', amount_rub:0, completion_source:'auto'/, 'Автоматический визит ошибочно считается оплаченным');
assert.match(provider, /function bookingSessionMarkup/, 'В карточке записи нет состава сеанса');
assert.match(provider, /const addons = items\.slice\(1\)/, 'Основная услуга повторно выводится в составе сеанса');
assert.match(provider, /booking-session-addons/, 'Дополнительные услуги не отделены от основной');
assert.match(provider, /data-edit-booking-session/, 'Состав конкретной записи нельзя изменить');
assert.match(provider, /addon \? `<label>Название<input data-session-title/, 'Произвольное название недоступно для дополнительной услуги');
assert.match(provider, /<input data-session-title type="hidden"/, 'Название основной услуги повторяется отдельным полем');
assert.match(provider, /Дополнительная услуга/, 'В состав нельзя добавить дополнительную услугу');
assert.match(provider, /function sessionConflict/, 'Дополнительная длительность не проверяется на пересечение');
assert.match(provider, /пересекаются со следующей записью/, 'Пользователь не получает понятного предупреждения о пересечении');
assert.match(provider, /function compactBookingColorPicker/, 'Большой выбор цвета не свёрнут в компактную строку');
assert.match(provider, /bookingSessionTotal\(item\)/, 'Итоговая сумма состава не используется в карточке и оплате');
assert.match(providerHtml, /id="reportCompletedValue"/, 'В статистике не показана стоимость состоявшихся визитов');
assert.match(provider, /const completedValue = completed\.reduce[\s\S]*bookingSessionTotal\(item\)/, 'Стоимость состоявшихся визитов считается без итогового состава сеанса');
assert.match(provider, /timeline-client-phone/, 'Телефон клиента нельзя независимо разместить в мобильной карточке');
assert.match(provider, /function timelineServiceNameMarkup/, 'Название услуги нельзя адаптировать для мобильной карточки');
assert.match(provider, /timeline-service-variant/, 'Уточнение услуги не отделено от основной части названия');
assert.match(styles, /timeline-booking-copy\s*\{\s*display:contents/, 'Мобильная карточка не отдаёт телефону всю доступную ширину');
assert.match(styles, /timeline-service-variant\s*\{\s*display:none/, 'На мобильном экране второстепенное уточнение продолжает сокращать основное название');
assert.match(styles, /-webkit-line-clamp:2/, 'Длинное основное название услуги не может занять две строки');
assert.match(styles, /timeline-client-duration\s*\{\s*display:none/, 'На мобильном экране второстепенная длительность продолжает занимать место телефона');
assert.match(providerHtml, /<details class="panel settings-card account-settings-card">/, 'Смена пароля не свёрнута в дополнительный раздел');
assert.match(provider, /class="service-more"/, 'Повторяющиеся действия услуги не убраны в компактное меню');
assert.match(styles, /timeline-booking\.status-confirmed \.timeline-booking-status[\s\S]*display:none/, 'Подтверждённые записи продолжают показывать повторяющийся статус');
assert.match(styles, /provider-body \.schedule-date-picker input \{ height:25px; margin:0;/, 'Поле календаря не выровнено с подписью и иконкой');
assert.match(styles, /timeline-booking\.status-needs-result \{ border-color:#c8d8ed; background:#eef4fb;/, 'Записи, ожидающие результата, не выделены цветом');
assert.match(styles, /provider-body \.timeline-booking-copy strong \{ font-size:14px;/, 'Название записи осталось слишком мелким');
assert.match(provider, /hourHeight = window\.matchMedia\('\(max-width: 760px\)'\)\.matches \? 60 : 76/, 'Высота часового интервала не соответствует мобильному журналу');
assert.match(styles, /timeline-booking-time \{ display:flex; align-self:stretch; align-items:center;/, 'Время записи не центрируется по высоте карточки');
assert.match(provider, /timeline-hour timeline-half-hour[\s\S]*:30/, 'На шкале расписания нет получасовых отметок');
assert.match(styles, /timeline-hour \{[^}]*font-size:12px;/, 'Полные часы на шкале остались слишком мелкими');
assert.match(styles, /timeline-hour\.timeline-half-hour[\s\S]*font-size:10px;/, 'Получасовые отметки остались слишком мелкими');
assert.match(styles, /top:var\(--half-hour-offset\)/, 'Получасовая линия не синхронизирована с масштабом расписания');
assert.match(provider, /bookingColorPicker\('newBookingColor'/, 'В новой записи нельзя выбрать цвет');
assert.match(provider, /bookingColorPicker\('editBookingColor'/, 'При изменении записи нельзя выбрать цвет');
assert.match(provider, /data-booking-color-id/, 'Цвет существующей записи нельзя изменить из карточки');
assert.match(styles, /color-lavender[\s\S]*background:#f2edfa/, 'Палитра нежных цветов не оформлена');
assert.match(provider, /timeline-booking-client-row[\s\S]*<\/span>\$\{block \? '' : clientBadgeMarkup/, 'Метки клиента снова растягивают строку и срезают заметку');
assert.match(styles, /timeline-booking \.client-badges \{ position:absolute;[^}]*transform:translateY\(-50%\)/, 'Метки клиента не вынесены из потока карточки');

const worker = readFileSync(join(root, 'sw.js'), 'utf8');
assert.match(worker, new RegExp(`CACHE_PREFIX.*massage-izhevsk-`), 'Service Worker не использует собственный префикс кэша');
assert.match(worker, new RegExp(`v${version}`), 'Версия Service Worker не совпадает');
for (const asset of ['styles.css', 'config.js', 'reliability.js', 'app.js', 'provider.js', 'booking.js', 'my-bookings.js', 'waitlist.js']) {
  assert.match(worker, new RegExp(`${asset.replace('.', '\\.')}\\?v=${version}`), `Service Worker не кэширует ${asset}`);
}
assert.match(worker, /\.\/ui-icons\.svg/, 'Service Worker не кэширует единый набор иконок');
assert.match(worker, /event\.request\.mode === 'navigate'/, 'Навигация не отделена от статических ресурсов');
assert.match(worker, /key\.startsWith\(CACHE_PREFIX\)/, 'Service Worker может удалить чужие кэши');
assert.match(worker, /!new URL\(request\.url\)\.search/, 'Навигация с секретными параметрами может попасть в кэш');

assert.doesNotMatch(app, /minuta-last-booking-url/, 'Секретная ссылка сохраняется в localStorage');
assert.match(app, /validateCurrentSelection/, 'Выбранное время не перепроверяется после восстановления связи');
assert.match(app, /p_request_id: attempt\.requestId/, 'Запись создаётся без идентификатора идемпотентности');
assert.match(app, /Проверить результат/, 'После неопределённого ответа нельзя безопасно проверить результат');
assert.match(app, /bookingFingerprint/, 'Изменение параметров не отделяет новую попытку записи от повтора');
assert.match(app, /sessionStorage\.setItem\(BOOKING_ATTEMPT_KEY/, 'Повтор после перезагрузки страницы теряет идентификатор запроса');
assert.doesNotMatch(app, /sessionStorage\.setItem\([^\n]*(?:clientName|clientPhone)/, 'Персональные данные попадают в sessionStorage');
assert.match(app, /loadPublicPortfolio/, 'Публичное портфолио не загружается');
assert.match(app, /createSignedUrl\(photo\.storage_path/, 'Публичные фотографии не используют временные ссылки');
assert.match(app, /После \$\{count\} \$\{word\}/, 'Количество сеансов не выводится на фотографии «После»');
assert.match(app, /function contactFormIsComplete\(\)/, 'Кнопка подтверждения не зависит от полноты контактов');
assert.match(app, /phoneDigits\.length === 11/, 'Номер телефона не проверяется полностью до активации кнопки');
assert.match(app, /Boolean\(\$\('#dataConsent'\)\?\.checked\)/, 'Кнопка подтверждения не учитывает согласие клиента');
assert.match(app, /availabilityServiceId === state\.serviceId/, 'При возврате к времени выбранный слот загружается заново и может потеряться');
assert.doesNotMatch(app, /firstAvailable/, 'Расписание всё ещё молча переключает клиента на другую дату');
assert.match(app, /data-suggested-date/, 'Нет однокнопочной подсказки ближайшего времени');
assert.match(app, /Сегодня мест нет/, 'Подсказка не объясняет отсутствие мест сегодня');
assert.match(app, /Показать это время/, 'Подсказка ближайшего времени не содержит понятного действия');
assert.match(app, /join_booking_waitlist/, 'Клиент не может оставить заявку в листе ожидания');
assert.doesNotMatch(app, /(?:^|\n)\s*loadPublicPortfolio\(\);/m, 'Портфолио отвлекает клиента во время записи');
assert.doesNotMatch(app, /· нельзя начать/, 'Серые интервалы перегружены повторяющейся подписью');
assert.match(app, /недоступно для начала: весь интервал должен быть свободен/, 'Недоступность интервала не объясняется средствам доступности');
assert.match(app, /весь интервал должен быть свободен/, 'Клиенту не объясняется правило для продолжительной услуги');
assert.match(app, /duration <= 60[\s\S]*?'занято'[\s\S]*?'нет окна'/, 'Недоступные часы не получают короткую подпись по длительности услуги');
assert.match(app, /requestAnimationFrame\(\(\) => bookingCard\?\.scrollIntoView/, 'Переход между шагами прокручивается только после загрузки данных');
assert.match(app, /function successDetailsMarkup\(service, performer, dateLabel, range\)/, 'Экран успеха не использует структурированную сводку записи');
const clientHtml = readFileSync(join(root, 'index.html'), 'utf8');
assert.match(clientHtml, /class="success-appointment"/, 'Детали успешной записи не собраны в компактный блок');
assert.match(clientHtml, /class="success-actions"/, 'Действия успешной записи не собраны по приоритету');
assert.match(clientHtml, /id="saveSuccessCalendar"[\s\S]*Сохранить в календарь/, 'После создания записи нет кнопки сохранения в календарь');
assert.match(app, /function androidCalendarIntent\(event\)/, 'Экран успешной записи не открывает календарь Android');
assert.match(app, /function openCalendarFile\(file = successCalendarFile\(\)\)/, 'Экран успешной записи не открывает календарный файл на iPhone');
assert.match(clientHtml, />Управлять записью</, 'Ссылка на управление записью названа непонятно');
assert.doesNotMatch(clientHtml, /copyManageBooking|Скопировать ссылку/, 'На экране успеха осталось лишнее действие копирования ссылки');
assert.match(clientHtml, /class="ui-icon telegram-connect-arrow"/, 'В Telegram-действии нет понятного направления перехода');

const timeRangeFunctionSource = app.match(/function timeRange\(time, duration\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(timeRangeFunctionSource, 'Не удалось извлечь расчёт интервала услуги');
const calculateTimeRange = Function(`${timeRangeFunctionSource}; return timeRange;`)();
assert.equal(calculateTimeRange('11:00', 120), '11:00–13:00', 'Двухчасовой сеанс с 11:00 должен заканчиваться в 13:00');
assert.equal(calculateTimeRange('12:00', 120), '12:00–14:00', 'Альтернативное начало в 12:00 должно проверять интервал до 14:00');

const suggestionFunctionSource = app.match(/function renderAvailabilitySuggestion\(times\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(suggestionFunctionSource, 'Не удалось извлечь умную подсказку для проверки');
const suggestionHolder = { hidden: true, innerHTML: '' };
const suggestionDates = [
  { iso: '2026-09-01', weekday: 'вт', label: '1 сентября' },
  { iso: '2026-09-02', weekday: 'ср', label: '2 сентября' }
];
const renderSuggestion = Function('state', 'dates', 'holder', `const $ = () => holder; const escapeHtml = value => String(value); ${suggestionFunctionSource}; return renderAvailabilitySuggestion([]);`);
assert.equal(renderSuggestion({ loadingAvailability: false, date: '2026-09-01', availability: new Map([['2026-09-01', []], ['2026-09-02', ['12:00']]]) }, suggestionDates, suggestionHolder), true, 'Подсказка не находит ближайшее окно');
assert.match(suggestionHolder.innerHTML, /Сегодня мест нет[\s\S]*завтра, 12:00[\s\S]*data-suggested-date="2026-09-02"/, 'Подсказка не ведёт одним кликом на ближайшее время');

const index = readFileSync(join(root, 'index.html'), 'utf8');
const bookingHtml = readFileSync(join(root, 'booking.html'), 'utf8');
assert.match(index, /id="portfolioSection"/, 'На публичной странице нет раздела портфолио');
assert.match(index, /Услуга[\s\S]*Время[\s\S]*Контакты/, 'На форме нет понятного прогресса из трёх этапов');
assert.match(index, /id="submitBooking"[^>]*disabled/, 'Кнопка подтверждения активна до корректных контактов');
assert.match(index, /id="availabilityHint"/, 'В форме нет места для подсказки ближайшего времени');
assert.match(index, /id="waitlistCta"[\s\S]*id="waitlistDialog"/, 'В форме нет листа ожидания');
assert.match(index, /id="durationNote"/, 'В форме нет пояснения длительности выбранного интервала');
assert.doesNotMatch(index, /id="successCode"/, 'Технический номер показывается клиенту после записи');
assert.doesNotMatch(bookingHtml, /id="manageCode"|Номер записи/, 'Технический номер показывается на странице управления записью');
assert.match(index, /class="booking-footer"[\s\S]*provider\.html/, 'Исполнитель потерял доступ к своему кабинету');
assert.match(index, /href="my-bookings\.html"[\s\S]*Мои записи/, 'На странице записи нет отдельной кнопки «Мои записи»');
assert.match(index, /id="clientAccessResult"/, 'После записи не показывается личный код клиента');
const clientHeader = index.match(/<header class="site-header booking-client-header">[\s\S]*?<\/header>/)?.[0] || '';
assert.doesNotMatch(clientHeader, /provider-link|provider\.html/, 'Вход исполнителя снова отвлекает клиента в шапке');
assert.ok(existsSync(join(root, 'ui-icons.svg')), 'Единый набор иконок отсутствует');
assert.match(index, /ui-icons\.svg#icon-/, 'Клиентская форма не использует новые иконки');
assert.match(providerHtml, /ui-icons\.svg#icon-(?:grid|users|bell|chart)/, 'Навигация кабинета не использует новые иконки');
assert.match(provider, /function uiIcon\(name/, 'Динамические элементы кабинета не используют единый набор иконок');

const booking = readFileSync(join(root, 'booking.js'), 'utf8');
assert.match(booking, /booking\.html#token=/, 'Токен управления не переносится из query-параметра во fragment');
assert.match(booking, /loadBooking\(\{ silent: true \}\)/, 'Не проверяется результат неопределённой операции');
assert.match(booking, /get_booking_management/, 'Клиент не получает серверные правила отмены и переноса');
assert.match(booking, /cancel_too_late/, 'Клиентский интерфейс не обрабатывает срок отмены');
assert.match(booking, /confirm_booking_by_token/, 'Клиент не может подтвердить визит');

const waitlist = readFileSync(join(root, 'waitlist.js'), 'utf8');
assert.match(waitlist, /get_waitlist_request/, 'Страница листа ожидания не загружает заявку');
assert.match(waitlist, /cancel_waitlist_request/, 'Клиент не может отменить заявку листа ожидания');
assert.match(provider, /booking_waitlist_requests/, 'Кабинет не загружает лист ожидания');
assert.match(provider, /set_waitlist_request_status/, 'Кабинет не меняет статус заявки листа ожидания');

const waitlistMigration = readFileSync(join(root, 'supabase-migration-v58.sql'), 'utf8');
assert.match(waitlistMigration, /create table if not exists public\.booking_waitlist_requests/, 'Нет серверной таблицы листа ожидания');
assert.match(waitlistMigration, /confirm_booking_by_token/, 'Нет серверного подтверждения визита клиентом');
assert.match(bookingHtml, /id="addAppleCalendar"[\s\S]*id="addAndroidCalendar"/, 'Нет отдельных вариантов календаря для iPhone и Android');
assert.match(booking, /new File\([\s\S]*type: 'text\/calendar'/, 'Для телефонов не создаётся календарный файл');
assert.match(booking, /intent:\/\/com\.android\.calendar\/events/, 'Android не открывает установленное приложение календаря');
assert.match(booking, /S\.browser_fallback_url=/, 'Для Android нет резервного перехода в календарь Google');
assert.doesNotMatch(booking, /link\.download = file\.name/, 'iPhone по-прежнему принудительно скачивает календарный файл');
assert.match(booking, /typeof dialog\.showModal !== 'function'/, 'Старые мобильные браузеры не получают запасной календарный файл');
assert.doesNotMatch(booking, /controllerchange[\s\S]*location\.reload/, 'Обновление Service Worker перезагружает страницу вместо открытия календаря');

const migration = readFileSync(join(root, 'supabase-migration-v41.sql'), 'utf8');
assert.match(migration, /create table if not exists public\.booking_policies/, 'Нет серверного хранения правил записи');
assert.match(migration, /reschedule_limit_reached/, 'Лимит переносов не проверяется сервером');
assert.match(migration, /cancel_too_late/, 'Срок отмены не проверяется сервером');
assert.match(migration, /payment_url_template/, 'Предоплата не подключена к правилам записи');

const durationMigration = readFileSync(join(root, 'supabase-migration-v57.sql'), 'utf8');
assert.match(durationMigration, /duration_minutes >= 1/, 'Сервер не разрешает поминутные услуги');
assert.match(durationMigration, /actual_duration_minutes/, 'Фактическое время поминутной услуги не сохраняется');
assert.match(providerHtml, /option value="1">1 мин \(цена за минуту\)/, 'В создании услуги нет поминутного тарифа');
assert.match(provider, /actualMinutes \* bookingMinuteRate\(item\)/, 'Итог поминутной услуги не рассчитывается');
assert.match(provider, /if \(amount\) amount\.value = String\(total\)/, 'Полученная сумма не обновляется при изменении фактического времени');
assert.doesNotMatch(provider, /if \(amount && \$\('#outcomePaymentMethod'\)\?\.value !== 'unpaid'\)/, 'Пересчёт полученной суммы всё ещё зависит от способа оплаты');

const idempotencyMigration = readFileSync(join(root, 'supabase-migration-v43.sql'), 'utf8');
assert.match(idempotencyMigration, /add column if not exists request_id uuid/, 'В записях нет идентификатора идемпотентности');
assert.match(idempotencyMigration, /create unique index if not exists idx_bookings_request_id/, 'Идентификатор идемпотентности не защищён уникальным индексом');
assert.match(idempotencyMigration, /pg_advisory_xact_lock\(hashtextextended\('booking-request:/, 'Повторные запросы не сериализуются на сервере');
assert.match(idempotencyMigration, /message = 'request_conflict'/, 'Повтор идентификатора с изменёнными данными не отклоняется');
assert.match(idempotencyMigration, /public\.book_appointment\(uuid, uuid, date, time without time zone, text, text\)/, 'Новая RPC-функция не опубликована для клиента');

const immutableRequestMigration = readFileSync(join(root, 'supabase-migration-v44.sql'), 'utf8');
assert.match(immutableRequestMigration, /add column if not exists request_fingerprint text/, 'Исходный запрос не получает неизменяемый отпечаток');
assert.match(immutableRequestMigration, /booking\.request_fingerprint/, 'Повтор сравнивается с изменяемыми полями записи');
assert.doesNotMatch(immutableRequestMigration, /v_existing_(?:service|date|time|name|phone)/, 'Повтор всё ещё зависит от изменяемого состояния записи');
assert.match(immutableRequestMigration, /request_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/, 'Формат серверного отпечатка не ограничен');
assert.match(app, /clearBookingAttempt\(\);\s*\n\s*\$\('#bookingFlow'\)/, 'Подтверждённая запись оставляет попытку в sessionStorage');

const portfolioMigration = readFileSync(join(root, 'supabase-migration-v45.sql'), 'utf8');
assert.match(portfolioMigration, /create table if not exists public\.portfolio_items/, 'Нет серверного хранения карточек портфолио');
assert.match(portfolioMigration, /create table if not exists public\.portfolio_photos/, 'Нет серверного хранения метаданных фотографий');
assert.match(portfolioMigration, /portfolio_publication_requires_consent/, 'Сервер разрешает публикацию без согласия клиента');
assert.match(portfolioMigration, /'portfolio-images',[\s\S]*false,[\s\S]*8388608/, 'Хранилище портфолио не является закрытым или не ограничивает размер');
assert.match(portfolioMigration, /array\['image\/webp'\]/, 'Хранилище принимает файлы с лишними метаданными');
assert.match(portfolioMigration, /portfolio_objects_public_select/, 'Нет ограниченного публичного чтения опубликованных фотографий');
assert.match(portfolioMigration, /create or replace function public\.reorder_portfolio_items/, 'Нет серверного изменения порядка портфолио');

const bookingColorMigration = readFileSync(join(root, 'supabase-migration-v48.sql'), 'utf8');
assert.match(bookingColorMigration, /add column if not exists color_key text/, 'Цвет записи не сохраняется на сервере');
assert.match(bookingColorMigration, /create or replace function public\.set_booking_color/, 'Нет защищённой RPC смены цвета записи');
assert.match(bookingColorMigration, /performer_id = \(select auth\.uid\(\)\)/, 'Исполнитель может изменить цвет чужой записи');

const bookingNoteMigration = readFileSync(join(root, 'supabase-migration-v49.sql'), 'utf8');
assert.match(bookingNoteMigration, /add column if not exists provider_note text/, 'Заметка к перерыву не сохраняется на сервере');
assert.match(bookingNoteMigration, /create or replace function public\.set_booking_note/, 'Нет защищённой RPC сохранения заметки к перерыву');
assert.match(bookingNoteMigration, /char_length\(provider_note\) <= 1000/, 'Длина заметки к перерыву не ограничена');

const clientLabelsMigration = readFileSync(join(root, 'supabase-migration-v50.sql'), 'utf8');
assert.match(clientLabelsMigration, /create table if not exists public\.client_labels/, 'Нет серверного хранения меток клиента');
assert.match(clientLabelsMigration, /performer_id = \(select auth\.uid\(\)\)/, 'Исполнитель может читать или менять чужие метки клиентов');
assert.match(clientLabelsMigration, /not attention or char_length\(btrim\(attention_reason\)\) >= 3/, 'Сервер принимает предупреждение без причины');

const clientLabelNotesMigration = readFileSync(join(root, 'supabase-migration-v51.sql'), 'utf8');
assert.match(clientLabelNotesMigration, /add column if not exists favorite_note text/, 'Комментарий любимого клиента не сохраняется на сервере');
assert.match(clientLabelNotesMigration, /add column if not exists vip_note text/, 'Комментарий VIP-клиента не сохраняется на сервере');
assert.match(clientLabelNotesMigration, /char_length\(favorite_note\) <= 500/, 'Длина комментария любимого клиента не ограничена');
assert.match(clientLabelNotesMigration, /char_length\(vip_note\) <= 500/, 'Длина комментария VIP-клиента не ограничена');

const automaticVisitsMigration = readFileSync(join(root, 'supabase-migration-v52.sql'), 'utf8');
assert.match(automaticVisitsMigration, /add column if not exists auto_complete_visits boolean/, 'Настройка автоматического учёта не сохраняется на сервере');
assert.match(automaticVisitsMigration, /add column if not exists completion_source text/, 'Источник результата визита не сохраняется на сервере');
assert.match(automaticVisitsMigration, /completion_source in \('manual', 'auto'\)/, 'Источник результата визита не ограничен допустимыми значениями');

const bookingSessionMigration = readFileSync(join(root, 'supabase-migration-v53.sql'), 'utf8');
assert.match(bookingSessionMigration, /create table if not exists public\.booking_session_items/, 'Состав сеанса не сохраняется на сервере');
assert.match(bookingSessionMigration, /create table if not exists public\.booking_session_revisions/, 'История первоначальной и итоговой суммы не сохраняется');
assert.match(bookingSessionMigration, /create or replace function public\.save_booking_session/, 'Нет защищённого сохранения состава сеанса');
assert.match(bookingSessionMigration, /session_overlap:/, 'Сервер не блокирует пересечение со следующей записью');
assert.match(bookingSessionMigration, /original_price_rub/, 'Первоначальная стоимость записи не сохраняется');
assert.match(bookingSessionMigration, /total_price_rub/, 'Итоговая стоимость записи не сохраняется');

const clientAccountMigration = readFileSync(join(root, 'supabase-migration-v54.sql'), 'utf8');
assert.match(clientAccountMigration, /create table if not exists public\.client_accounts/, 'Нет серверного хранения клиентских аккаунтов');
assert.match(clientAccountMigration, /create table if not exists public\.client_device_sessions/, 'Нет ограниченных сессий клиентских устройств');
assert.match(clientAccountMigration, /access_code_hash/, 'Личный код клиента хранится без хеша');
assert.match(clientAccountMigration, /create or replace function public\.login_client_access/, 'Нет безопасного входа клиента');
assert.match(clientAccountMigration, /login_rate_limited/, 'Вход клиента не ограничивает частоту попыток');
assert.match(clientAccountMigration, /create or replace function public\.get_client_bookings/, 'Нет защищённого списка записей клиента');
const clientBookingsMigration = readFileSync(join(root, 'supabase-migration-v56.sql'), 'utf8');
assert.match(clientBookingsMigration, /add column if not exists total_price_rub integer/, 'Миграция не добавляет стоимость, используемую RPC');
assert.match(clientBookingsMigration, /booking\.booking_code::text/, 'Код записи не приводится к типу RPC');
assert.match(clientBookingsMigration, /booking\.status::text/, 'Статус записи не приводится к типу RPC');
assert.match(clientBookingsMigration, /where booking\.client_account_id = v_account_id/, 'RPC не выбирает записи текущего клиента');
assert.match(clientBookingsMigration, /coalesce\(booking\.total_price_rub, service\.price_rub\)::integer/, 'RPC не возвращает стоимость после миграции схемы');
const clientAccount = readFileSync(join(root, 'my-bookings.js'), 'utf8');
assert.match(clientAccount, /login_client_access/, 'Клиентская зона не выполняет вход по телефону и коду');
assert.match(clientAccount, /get_client_bookings/, 'Клиентская зона не загружает все записи');
assert.match(clientAccount, /localStorage\.setItem\(SESSION_KEY/, 'Сессия клиента не сохраняется на устройстве');
assert.doesNotMatch(clientAccount, /localStorage\.setItem\([^\n]*(?:phone|code)/i, 'Телефон или личный код сохраняется в открытом виде');
assert.doesNotMatch(clientAccount, /if \(!data\?\.length\)[\s\S]*logout/, 'Пустой кабинет ошибочно сбрасывает действующую сессию');
assert.match(app, /bootstrap_client_access/, 'После оформления не создаётся клиентский доступ');
assert.match(app, /saveClientContact\(name, phone\);\s*\n\s*clearBookingAttempt/, 'Контакты не сохраняются после подтверждённой записи');
assert.match(app, /restoreClientContact\(\);\s*\$\('#formError'\)/, 'Новая запись не восстанавливает имя и телефон');
assert.match(app, /CLIENT_CONTACT_TTL = 90 \* 24 \* 60 \* 60 \* 1000/, 'Срок хранения контактов не ограничен 90 днями');
assert.match(app, /if \(error\) \{[\s\S]*?return;\s*\n\s*\}\s*\n\s*const manageToken[\s\S]*?saveClientContact\(name, phone\)/, 'Контакты сохраняются до подтверждения записи');

const privacy = readFileSync(join(root, 'privacy.html'), 'utf8');
assert.match(privacy, /Фотографии «до» и «после» публикуются[^.]+согласия клиента/, 'В политике не описано согласие на публикацию работ');
assert.match(privacy, /EXIF и геометки/, 'В политике не описано удаление метаданных фотографий');

const reliability = readFileSync(join(root, 'reliability.js'), 'utf8');
assert.match(reliability, /removeItem\('minuta-last-booking-url'\)/, 'Старый секретный токен не очищается');
assert.match(reliability, /removeExpired/, 'Нет автоматического удаления просроченного офлайн-кэша');

const productionHealth = readFileSync(join(root, 'production-health-check.mjs'), 'utf8');
assert.match(productionHealth, /`\\\$\{CACHE_PREFIX\}v\$\{expectedVersion\}`/, 'Production health ожидает неверное имя кэша Service Worker');
assert.match(productionHealth, /rest\/v1\/portfolio_items/, 'Production health не проверяет таблицу портфолио');
assert.match(productionHealth, /rest\/v1\/portfolio_photos/, 'Production health не проверяет таблицу фотографий');

console.log('minuta-online-booking smoke test: OK');
