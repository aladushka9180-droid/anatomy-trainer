import { mkdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'images');
const baseUrl = process.env.MINUTA_SCREENSHOT_BASE_URL || 'http://127.0.0.1:4174/minuta-online-booking';
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 768 }, deviceScaleFactor: 1 });
await page.route(/\.js(?:\?|$)/, route => route.abort());

const screenshotCss = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  html { scroll-behavior: auto !important; }
  body { min-width: 0 !important; }
  .kb-shot-ribbon { position: fixed; z-index: 2147483647; top: 14px; right: 18px; padding: 9px 13px; border-radius: 999px; color: #fff; background: #17211b; box-shadow: 0 8px 24px rgb(18 44 31 / 22%); font: 700 12px/1.2 Inter, "Segoe UI", sans-serif; letter-spacing: .02em; }
  .kb-focus { position: relative !important; z-index: 20 !important; outline: 3px solid #168454 !important; outline-offset: 4px !important; box-shadow: 0 0 0 8px rgb(22 132 84 / 13%) !important; }
  .kb-step { position: absolute; z-index: 60; top: -13px; left: -13px; display: grid; place-items: center; width: 28px; height: 28px; border: 3px solid #fff; border-radius: 50%; color: #fff; background: #168454; box-shadow: 0 5px 14px rgb(9 70 42 / 30%); font: 800 13px/1 Inter, "Segoe UI", sans-serif; }
  dialog.kb-static-dialog { display: block !important; position: fixed !important; inset: 50% auto auto 50% !important; transform: translate(-50%, -50%) !important; max-height: 86vh !important; overflow: auto !important; }
`;

async function load(relativePath) {
  await page.goto(`${baseUrl}/${relativePath}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: screenshotCss });
  await page.evaluate(() => {
    const ribbon = document.createElement('div');
    ribbon.className = 'kb-shot-ribbon';
    ribbon.textContent = 'Реальный интерфейс Minuta · учебный пример';
    document.body.append(ribbon);
  });
}

async function addHighlights(selectors) {
  await page.evaluate(items => {
    items.forEach((selector, index) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Не найден элемент для подсветки: ${selector}`);
      element.classList.add('kb-focus');
      const badge = document.createElement('span');
      badge.className = 'kb-step';
      badge.textContent = String(index + 1);
      badge.setAttribute('aria-hidden', 'true');
      element.append(badge);
    });
  }, selectors);
}

async function save(name) {
  const temporaryPath = join(outputDirectory, `${name}.capture.png`);
  const outputPath = join(outputDirectory, `${name}.webp`);
  await page.screenshot({ path: temporaryPath, fullPage: false });
  await sharp(temporaryPath).resize(1200, 675, { fit: 'cover' }).webp({ quality: 86, effort: 6 }).toFile(outputPath);
  unlinkSync(temporaryPath);
  console.log(`${name}.webp`);
}

async function prepareProvider(view, targetSelector = '') {
  await load(`provider.html?view=${view}`);
  await page.evaluate(({ view, targetSelector }) => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.setAttribute('hidden', '');
    document.querySelector('#authCard')?.setAttribute('hidden', '');
    const dashboard = document.querySelector('#dashboard');
    dashboard?.removeAttribute('hidden');
    if (dashboard) dashboard.dataset.activeView = view;
    document.querySelectorAll('.provider-view').forEach(panel => {
      const active = panel.dataset.providerPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-provider-view]').forEach(button => button.classList.toggle('active', button.dataset.providerView === view));
    const sync = document.querySelector('#syncState');
    if (sync) { sync.className = 'sync-state is-online'; sync.innerHTML = '<i></i><span>Сохранено</span>'; }
    const clock = document.querySelector('.provider-topbar-clock');
    if (clock) clock.textContent = '10:24';
    document.querySelectorAll('select').forEach(select => {
      if (!select.options.length) select.add(new Option('Учебный вариант', 'demo'));
    });
    if (!targetSelector) return;
    const panel = document.querySelector(`[data-provider-panel="${view}"]`);
    const target = document.querySelector(targetSelector);
    if (!panel || !target) throw new Error(`Не найден целевой блок: ${targetSelector}`);
    if (view === 'organization') {
      const roleBadge = document.querySelector('#organizationRoleBadge');
      if (roleBadge) roleBadge.textContent = 'Владелец';
      document.querySelectorAll('[data-section-target]').forEach(button => {
        button.classList.toggle('active', button.dataset.sectionTarget === target.id);
      });
    }
    target.hidden = false;
    let node = target;
    while (node && node !== panel) {
      node.hidden = false;
      const parent = node.parentElement;
      if (!parent) break;
      parent.hidden = false;
      [...parent.children].forEach(sibling => {
        if (sibling === node || sibling.classList.contains('view-title') || sibling.classList.contains('provider-section-nav')) return;
        sibling.hidden = true;
      });
      node = parent;
    }
    target.scrollIntoView({ block: 'start' });
    window.scrollTo(0, 0);
  }, { view, targetSelector });
}

async function providerShot(name, view, targetSelector, mutate, highlights) {
  await prepareProvider(view, targetSelector);
  if (mutate) await page.evaluate(mutate);
  if (highlights?.length) await addHighlights(highlights);
  await save(name);
}

async function injectBookingEditor(kind) {
  await page.evaluate(kind => {
    const sheet = document.querySelector('#bookingSheet');
    const content = document.querySelector('#bookingSheetContent');
    sheet.hidden = false;
    sheet.classList.add('booking-sheet-wide', 'new-booking-sheet');
    document.body.classList.add('booking-sheet-open');
    const times = '<div class="booking-time-hours"><button type="button" class="active">10:00</button><button type="button">11:00</button><button type="button">14:00</button></div><div class="booking-time-slots"><button type="button" class="active">10:30</button><button type="button">10:45</button><button type="button">11:15</button></div>';
    if (kind === 'reschedule') {
      sheet.classList.remove('booking-sheet-wide', 'new-booking-sheet');
      content.innerHTML = `<div class="booking-editor-heading"><button class="booking-editor-back" type="button"><span>← К записи</span></button><small class="booking-sheet-kicker">Изменение записи</small></div><h2 id="bookingSheetTitle">Перенести или изменить</h2><form class="booking-editor-form booking-edit-form-compact" id="bookingEditForm"><label>Основная услуга<select disabled><option>Классический массаж · 60 мин</option></select><small>Состав, длительность и стоимость меняются в блоке «Состав сеанса».</small></label><label>Заметка о клиенте<textarea rows="2" placeholder="Пожелания, особенности или важная информация"></textarea></label><label>Новая дата<input type="date" value="2026-09-12"></label><label>Свободное время<div class="repeat-times booking-editor-times">${times}</div></label><fieldset><legend>Какие записи перенести</legend><label><input type="radio" checked> Только эту запись</label><label><input type="radio"> Эту и последующие</label></fieldset><button class="primary" type="button">Сохранить изменения</button></form>`;
      return;
    }
    const advancedOpen = kind === 'recurring' ? ' open' : '';
    content.innerHTML = `<small class="booking-sheet-kicker">Ручное расписание</small><h2 id="bookingSheetTitle">Новый клиент</h2><form class="booking-editor-form new-booking-form" id="newBookingForm"><div class="new-booking-mode-toggle" role="group"><button class="active" type="button">Клиент</button><button type="button">Занять время</button></div><div class="new-booking-layout"><section class="new-booking-section"><div class="new-booking-section-title"><span>1</span><div><strong>Клиент и услуга</strong><small>Только необходимое для записи</small></div></div><div class="booking-client-fields"><label>Имя клиента<input placeholder="Например, Анна"></label><label>Телефон<input placeholder="+7 (___) ___-__-__"></label></div><label>Услуга<select><option>Классический массаж · 60 мин</option></select></label><details class="new-booking-advanced"${advancedOpen}><summary><span>Дополнительные параметры</span><small>Заметка, цвет и серия</small></summary><div class="new-booking-advanced-content"><label>Заметка о клиенте<textarea rows="2" placeholder="Необязательно"></textarea></label><section class="new-booking-recurrence"><div><strong>Курс или серия</strong><small>Все окна должны быть свободны, а последний визит — не дальше двух лет.</small></div><label>Количество<select><option>${kind === 'recurring' ? '6 визитов' : 'Одна запись'}</option></select></label><label>Повторять<select><option>Каждую неделю</option></select></label></section></div></details></section><section class="new-booking-section"><div class="new-booking-section-title"><span>2</span><div><strong>Дата и время</strong><small>Выберите удобное свободное окно</small></div></div><label>Дата<input type="date" value="2026-09-12"></label><label>Свободное время<div class="booking-editor-times booking-time-picker">${times}</div></label></section></div><p class="new-booking-draft-status">Данные формы сохранятся в этой вкладке · это ещё не запись</p><button class="primary new-booking-submit" type="button">${kind === 'recurring' ? 'Создать серию из 6' : 'Создать запись'}</button></form>`;
  }, kind);
}

await prepareProvider('bookings');
await injectBookingEditor('manual');
await addHighlights(['.new-booking-mode-toggle', '.booking-client-fields', '.booking-time-picker', '.new-booking-submit']);
await save('manual-booking');

await prepareProvider('bookings');
await injectBookingEditor('recurring');
await addHighlights(['#newBookingForm .new-booking-advanced', '#newBookingForm .new-booking-recurrence', '#newBookingForm .new-booking-submit']);
await save('recurring-series');

await prepareProvider('bookings');
await injectBookingEditor('reschedule');
await addHighlights(['#bookingEditForm input[type="date"]', '#bookingEditForm .booking-editor-times', '#bookingEditForm fieldset', '#bookingEditForm .primary']);
await save('reschedule-booking');

await providerShot('team-calendar', 'bookings', '.schedule-card', () => {
  document.querySelector('#teamCalendarToolbar').hidden = false;
  document.querySelector('#teamCalendarFilters').hidden = false;
  document.querySelector('#teamCalendarResourceField').hidden = false;
  document.querySelector('#teamCalendarDensity').hidden = false;
  document.querySelectorAll('#teamCalendarFilters select').forEach((select, index) => { select.innerHTML = `<option>${['Филиал — Центр', 'Все специалисты', 'Все ресурсы'][index]}</option>`; });
}, ['#teamCalendarToolbar .team-calendar-mode', '#teamCalendarFilters', '#teamCalendarDensity']);

await providerShot('date-exceptions', 'schedule', '#monthlyScheduleEditor', () => {
  document.querySelector('#monthlyScheduleEditor').open = true;
  document.querySelector('#monthlyScheduleMonth').value = '2026-09';
  document.querySelector('#monthlyScheduleGrid').innerHTML = '<button class="monthly-schedule-day"><strong>12</strong><span>Рабочий день</span></button><button class="monthly-schedule-day"><strong>13</strong><span>По графику</span></button><button class="monthly-schedule-day"><strong>14</strong><span>По графику</span></button>';
  document.querySelector('#monthlyScheduleDetails').hidden = false;
  document.querySelector('#monthlyScheduleDetails').innerHTML = '<div class="monthly-schedule-detail-head"><div><small>12 сентября</small><strong>Изменить доступность</strong></div></div><div class="monthly-schedule-actions"><button class="primary">Сделать выходным</button><button class="secondary-button">Закрыть часть дня</button><button class="secondary-button">Открыть по обычному графику</button></div>';
}, ['#monthlyScheduleMonth', '#monthlyScheduleGrid', '#monthlyScheduleDetails']);

await prepareProvider('bookings');
await page.evaluate(() => {
  const dialog = document.querySelector('#freeSlotsDialog');
  dialog.classList.add('kb-static-dialog');
  dialog.setAttribute('open', '');
  document.querySelector('#freeSlotsFrom').value = '2026-09-12';
  document.querySelector('#freeSlotsText').value = 'Свободное время на 12 сентября: 10:30, 12:00, 16:15';
  document.querySelector('#freeSlotsBookingLink').textContent = 'minuta.online/book/demo';
});
await addHighlights(['.free-slots-mode', '.free-slots-dates', '.free-slots-source', '.free-slots-actions']);
await save('share-free-slots');

await providerShot('client-card', 'clients', '.clients-layout', () => {
  document.querySelector('#clientProfileEmpty').hidden = true;
  document.querySelector('#clientProfileContent').hidden = false;
  document.querySelector('#clientName').textContent = 'Учебный клиент';
  document.querySelector('#clientPhone').textContent = 'Телефон скрыт';
  document.querySelector('#clientVisits').textContent = '4';
  document.querySelector('#clientNext').textContent = '12 сентября';
  document.querySelector('#clientsList').innerHTML = '<button class="client-item active"><span class="client-avatar">У</span><span><strong>Учебный клиент</strong><small>4 визита</small></span></button>';
}, ['#clientSearch', '#clientProfileContent .client-profile-head', '.client-labels-panel', '.client-note-label']);

await providerShot('batch-bookings', 'clients', '#batchBookingComposer', () => {
  const composer = document.querySelector('#batchBookingComposer');
  composer.hidden = false;
  composer.open = true;
  document.querySelector('#batchBookingClientName').textContent = 'Учебный клиент';
  document.querySelector('#batchBookingLocation').innerHTML = '<option>Филиал — Центр</option>';
  document.querySelector('#batchBookingService').innerHTML = '<option>Классический массаж · 60 мин</option>';
  document.querySelector('#batchBookingRows').innerHTML = '<div class="batch-booking-row"><label>Дата<input type="date" value="2026-09-12"></label><label>Время<input type="time" value="10:30"></label></div><div class="batch-booking-row"><label>Дата<input type="date" value="2026-09-19"></label><label>Время<input type="time" value="10:30"></label></div>';
}, ['#batchBookingService', '#batchBookingRows', '#addBatchBookingRow', '#createBatchBookings']);

await providerShot('client-import', 'clients', '#clientImportPanel', () => {
  document.querySelector('#clientImportPanel').hidden = false;
  document.querySelector('#clientImportPanel').open = true;
  document.querySelector('#clientImportMapping').hidden = false;
  document.querySelector('#clientImportNameColumn').innerHTML = '<option>Имя</option>';
  document.querySelector('#clientImportPhoneColumn').innerHTML = '<option>Телефон</option>';
}, ['#clientImportFile', '#clientImportMapping', '#clientImportApplyMapping']);

await providerShot('employee-access', 'organization', '#organizationPeopleSection', () => {
  document.querySelector('#organizationPeopleSection > section:first-child').hidden = true;
  document.querySelector('#memberCreator').open = true;
}, ['#memberCreator summary', '#memberRole', '#memberBookable', '#memberInviteForm .primary']);

await providerShot('service-resources', 'organization', '#resourcesPanel', () => {
  document.querySelector('#resourceWorkspace').hidden = false;
  document.querySelector('#resourceGroupCreator').open = true;
  document.querySelector('#resourceCreator').open = true;
  document.querySelector('#resourceRequirementService').innerHTML = '<option>Классический массаж</option>';
  document.querySelector('#resourceRequirementsList').innerHTML = '<label>Кабинет массажа<input type="number" value="1" min="0"></label>';
}, ['#resourceGroupCreator', '#resourceCreator', '#resourceRequirementsPanel']);

await providerShot('staff-absence', 'organization', '#shiftsPanel', () => {
  document.querySelector('#shiftWorkspace').hidden = false;
  document.querySelector('#absenceCreator').open = true;
  document.querySelector('#absencePerformer').innerHTML = '<option>Специалист</option>';
  document.querySelector('#absenceStart').value = '2026-09-12';
  document.querySelector('#absenceEnd').value = '2026-09-18';
  document.querySelector('#substitutionBooking').innerHTML = '<option>12 сентября · 10:30 · Учебный клиент</option>';
  document.querySelector('#substitutionService').innerHTML = '<option>Другой специалист · Классический массаж</option>';
}, ['#shiftSubstitutionPanel', '#absenceCreator', '#absenceKind']);

await providerShot('payroll', 'organization', '#payrollPanel', () => {
  document.querySelector('#payrollWorkspace').hidden = false;
  document.querySelector('#payrollStartDate').value = '2026-09-01';
  document.querySelector('#payrollEndDate').value = '2026-09-30';
}, ['#payrollStartDate', '#payrollEndDate', '#payrollPanel .payroll-toolbar', '#payrollPanel .primary']);

await providerShot('yookassa', 'organization', '#paymentProviderPanel', () => {
  document.querySelector('#paymentProviderWorkspace').hidden = false;
  document.querySelector('#paymentProviderEnabled').checked = true;
  document.querySelector('#paymentProviderEnvironment').value = 'test';
}, ['#paymentProviderEnabled', '#paymentProviderEnvironment', '#paymentProviderSettingsForm .primary']);

await providerShot('loyalty-rules', 'organization', '#loyaltyPanel', () => {
  document.querySelector('#loyaltyWorkspace').hidden = false;
  document.querySelector('#loyaltyEnabled').checked = true;
  document.querySelector('#loyaltyEarnPercent').value = '5';
  document.querySelector('#loyaltyMinPaid').value = '1000';
  document.querySelector('#loyaltyMaxRedeemPercent').value = '30';
}, ['#loyaltyEnabled', '#loyaltyRuleForm .loyalty-form-grid', '#loyaltyRuleForm .primary']);

await providerShot('promo', 'organization', '#loyaltyPanel', () => {
  document.querySelector('#loyaltyWorkspace').hidden = false;
  document.querySelectorAll('.loyalty-management-grid, .loyalty-guide, .loyalty-example, .loyalty-rule-form, .loyalty-enable-field').forEach(element => element.hidden = true);
  const details = document.querySelectorAll('.loyalty-promotions details');
  details.forEach(element => { element.open = true; });
  document.querySelector('#loyaltyPromoCode').value = 'WELCOME10';
  document.querySelector('#loyaltyPromoValue').value = '10';
  document.querySelector('#loyaltyPromoFrom').value = '2026-09-01';
  document.querySelector('#loyaltyPromoUntil').value = '2026-09-30';
}, ['#loyaltyPromoForm', '#loyaltyPromoForm .primary', '#loyaltyPromoApplyForm']);

await providerShot('benefit', 'organization', '#benefitsPanel', () => {
  document.querySelector('#benefitsWorkspace').hidden = false;
  document.querySelector('#benefitIssueCreator').open = true;
  document.querySelector('#benefitApplyCreator').open = true;
  document.querySelectorAll('#benefitIssueForm select, #benefitApplyForm select').forEach(select => { select.innerHTML = '<option>Учебный вариант</option>'; });
}, ['#benefitIssueCreator', '#benefitApplyCreator', '#benefitApplyForm .secondary-button']);

await providerShot('inventory', 'organization', '#inventoryPanel', () => {
  document.querySelector('#inventoryWorkspace').hidden = false;
  document.querySelector('#inventoryControls').hidden = false;
  document.querySelector('#inventoryEnabled').checked = true;
  document.querySelector('#inventoryItemCreator').open = true;
  document.querySelector('#inventoryWarehouseCreator').open = true;
}, ['#inventoryEnabled', '#inventoryItemCreator', '#inventoryWarehouseCreator']);

await providerShot('inventory-operations', 'organization', '#inventoryPanel', () => {
  document.querySelector('#inventoryWorkspace').hidden = false;
  document.querySelector('#inventoryControls').hidden = false;
  document.querySelector('.inventory-settings').hidden = true;
  document.querySelector('.inventory-balances-section').hidden = true;
  document.querySelectorAll('#inventoryMovementForm select, #inventoryUsageForm select').forEach(select => { if (!select.options.length) select.innerHTML = '<option>Учебный вариант</option>'; });
}, ['#inventoryMovementForm', '#inventoryUsageForm', '#inventoryMovementsPanel']);

await providerShot('statistics-report', 'analytics', '#analyticsView', () => {
  document.querySelectorAll('.report-stat strong').forEach((element, index) => { element.textContent = ['82 500 ₽', '76%', '34', '2 430 ₽'][index] || element.textContent; });
}, ['.report-filters', '.report-view-tabs', '.report-summary', '#exportBookings']);

await providerShot('portfolio', 'portfolio', '', () => {
  const dialog = document.querySelector('#portfolioEditorDialog');
  dialog.classList.add('kb-static-dialog');
  dialog.setAttribute('open', '');
  document.querySelector('#portfolioProcedure').value = 'Учебный пример';
  document.querySelector('#portfolioSessions').value = '6';
}, ['#portfolioProcedure', '.portfolio-photo-fields', '.portfolio-consent', '.portfolio-form-actions .primary']);

await providerShot('telegram-settings', 'settings', '#telegramClientSettingsCard', () => {
  document.querySelector('#telegramContactUsername').value = '@minuta_demo';
  document.querySelector('#telegramNotifyConfirmation').checked = true;
  document.querySelector('#telegramNotifyReminder').checked = true;
}, ['#telegramContactUsername', '.telegram-event-settings', '.telegram-client-settings-actions .primary']);

await providerShot('install-app', 'settings', '#installAppCard', () => {
  document.querySelector('#installAppStatus').textContent = 'Выберите инструкцию для своего устройства';
  document.querySelector('#desktopInstallGuide').hidden = false;
  document.querySelector('#androidInstallGuide').hidden = false;
  document.querySelector('#iosInstallGuide').hidden = false;
}, ['#installAppButton', '#desktopInstallGuide', '#androidInstallGuide', '#iosInstallGuide']);

await load('index.html');
await page.evaluate(() => {
  document.querySelector('#bookingStatus').innerHTML = '<i></i><span>Онлайн-запись доступна</span>';
  document.querySelector('#services').innerHTML = '<label class="option active"><input type="radio" checked><span><strong>Классический массаж</strong><small>60 минут</small></span><b>2 500 ₽</b></label><label class="option"><input type="radio"><span><strong>Массаж спины</strong><small>45 минут</small></span><b>2 000 ₽</b></label>';
  document.querySelector('#toDate').disabled = false;
});
await addHighlights(['#services', '#toDate']);
await save('online-booking');

await load('my-bookings.html');
await page.evaluate(() => {
  document.querySelector('#clientSmsButton').disabled = false;
  document.querySelector('#clientSmsButton').textContent = 'Получить код';
  document.querySelector('#clientSmsStatus').textContent = 'Код придёт на подтверждённый номер телефона.';
  document.querySelector('#legacyClientLogin').open = true;
});
await addHighlights(['#clientSmsPhone', '#clientSmsButton', '#legacyClientLogin']);
await save('my-bookings');

await load('index.html');
await page.evaluate(() => {
  document.querySelector('#bookingFlow').hidden = false;
  const dialog = document.querySelector('#waitlistDialog');
  dialog.classList.add('kb-static-dialog');
  dialog.setAttribute('open', '');
  document.querySelector('#waitlistService').textContent = 'Классический массаж';
  document.querySelector('#waitlistDate').textContent = '12 сентября';
});
await addHighlights(['#waitlistName', '#waitlistPhone', '#waitlistPeriod', '#submitWaitlist']);
await save('waitlist');

await load('booking.html');
await page.evaluate(() => {
  document.querySelector('#manageLoading').hidden = true;
  document.querySelector('#manageContent').hidden = false;
  document.querySelector('#manageService').textContent = 'Классический массаж';
  document.querySelector('#manageDay').textContent = '12';
  document.querySelector('#manageMonth').textContent = 'сент';
  document.querySelector('#manageDate').textContent = 'Суббота, 12 сентября';
  document.querySelector('#manageTime').textContent = '10:30';
  document.querySelector('#managePerformer').textContent = 'Специалист';
  document.querySelector('#manageDuration').textContent = '60 минут';
  document.querySelector('#managePrice').textContent = '2 500 ₽';
  document.querySelector('#manageTelegramConnect').disabled = false;
});
await addHighlights(['#manageTelegramConnect']);
await save('client-telegram');

await browser.close();
console.log('Готово: 27 снимков реального интерфейса');
