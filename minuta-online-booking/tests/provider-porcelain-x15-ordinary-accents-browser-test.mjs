import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const html = readFileSync(path.join(root, 'provider.html'), 'utf8');
const matrix = readFileSync(path.join(root, 'provider-porcelain-matrix.js'), 'utf8');
const recordsScript = readFileSync(path.join(root, 'client-records.js'), 'utf8');
const benefitScript = readFileSync(path.join(root, 'benefit-lifecycle.js'), 'utf8');
const loyaltyScript = readFileSync(path.join(root, 'client-loyalty-frames.js'), 'utf8');
const serviceCatalogScript = readFileSync(path.join(root, 'service-presets-catalog.js'), 'utf8');
const servicePresetsScript = readFileSync(path.join(root, 'service-presets.js'), 'utf8');
const cssLayers = [...html.matchAll(/<link rel="stylesheet" href="([^"?]+)(?:\?[^\"]*)?"[^>]*>/g)]
  .map(match => ({ file:match[1], media:match[0].match(/media="([^"]+)"/)?.[1] || '' }));
const cssFiles = cssLayers.map(layer => layer.file);
assert.ok(cssFiles.includes('provider-porcelain-detail.css'));
assert.ok(cssFiles.includes('client-profile-card.css'));
assert.ok(cssFiles.includes('free-slots-compact.css'));
for (const file of cssFiles) assert.ok(existsSync(path.join(root, file)), `Missing stylesheet: ${file}`);

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = modulePath ? await import(pathToFileURL(modulePath).href) : createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const outputDir = process.env.MINUTA_X15_SCREENSHOT_DIR;
if (outputDir) mkdirSync(outputDir, { recursive:true });
const toRgb = hex => `rgb(${hex.match(/[a-f\d]{2}/gi).map(part => parseInt(part, 16)).join(', ')})`;
const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
  const channel = value / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (first, second) => {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:1000 }, serviceWorkers:'block' });
    const blocked = [];
    const errors = [];
    let minimumThumbContrast = Infinity;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { blocked.push(route.request().url()); return route.abort(); });
    await page.setContent('<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="soft" data-provider-resolved-color-mode="light"></body></html>');
    await page.evaluate(markup => {
      const original = new DOMParser().parseFromString(markup, 'text/html');
      const clone = selector => {
        const element = original.querySelector(selector);
        if (!element) throw new Error(`Real provider HTML missing: ${selector}`);
        const result = document.importNode(element, true);
        result.removeAttribute('hidden');
        return result;
      };
      const dashboard = document.createElement('section'); dashboard.id = 'dashboard'; dashboard.className = 'provider-app';
      dashboard.dataset.activeView = 'bookings';
      const workspace = document.createElement('div'); workspace.className = 'provider-workspace';
      dashboard.append(clone('.provider-sidebar'), workspace, clone('#mobileNewBookingButton'));
      document.body.append(dashboard);
      const clients = document.createElement('section'); clients.dataset.providerPanel = 'clients'; clients.className = 'provider-view';
      const profile = document.createElement('div'); profile.className = 'client-profile-card';
      profile.append(clone('#clientQuickRepeat')); clients.append(profile);
      const head = document.createElement('div'); head.className = 'client-profile-head';
      head.append(clone('#clientProfileOrbit')); clients.append(head);
      const records = clone('#clientRecords');
      records.replaceChildren(); clients.append(records);
      clients.append(clone('#clientBenefitLifecycle')); workspace.append(clients);
      const bookings = document.createElement('section'); bookings.dataset.providerPanel = 'bookings'; bookings.className = 'provider-view';
      bookings.innerHTML = '<div class="booking-time-slots"><button class="active" type="button">10:00</button></div>';
      bookings.prepend(clone('.schedule-view-title'));
      const stripCard = document.createElement('div'); stripCard.className = 'schedule-card';
      const strip = clone('.date-strip-frame');
      strip.querySelector('#dateStrip').innerHTML = '<button type="button" class="is-today" aria-current="date" aria-pressed="false" data-booking-date="2026-09-30"><span>Ср</span><strong>30</strong><small>сент</small></button>'
        + '<button type="button" class="active" aria-pressed="true" data-booking-date="2026-10-01"><span>Чт</span><strong>1</strong><small>окт</small></button>';
      stripCard.append(strip); bookings.append(stripCard);
      workspace.append(bookings);
      const schedule = document.createElement('section'); schedule.dataset.providerPanel = 'schedule'; schedule.className = 'provider-view';
      schedule.append(clone('.schedule-quick-setup')); workspace.append(schedule);
      schedule.querySelector('[data-schedule-quick-preset="custom"]').classList.add('active');
      schedule.querySelectorAll('[data-schedule-quick-day]').forEach(input => { input.checked = input.dataset.scheduleQuickDay !== '1'; });
      schedule.querySelector('#scheduleQuickBreak').checked = true;
      const themeFilters = document.createElement('section'); themeFilters.dataset.providerPanel = 'settings';
      themeFilters.append(clone('.provider-client-theme-filters')); workspace.append(themeFilters);
      document.body.append(clone('#clientMessagingDialog .client-message-presets'));
      document.querySelector('.client-message-presets button').classList.add('active');
      const hours = document.createElement('div'); hours.className = 'booking-time-hours';
      hours.innerHTML = '<button type="button" class="active" aria-pressed="true" data-edit-booking-hour="10">10:00</button>';
      document.body.append(hours);
      const organization = document.createElement('section'); organization.dataset.providerPanel = 'organization'; organization.className = 'provider-view organization-section';
      organization.append(clone('#inventoryPanel .inventory-settings'),
        clone('#inventoryItemCreator'), clone('#inventoryWarehouseCreator'), clone('#inventoryMovementForm'),
        document.importNode(original.querySelector('#retentionEnabled').closest('label'), true));
      const checks = document.createElement('div'); checks.className = 'organization-checks';
      checks.innerHTML = '<label><input type="checkbox" checked><span>Активен</span></label>';
      organization.append(checks); workspace.append(organization);
      const danger = document.createElement('button'); danger.className = 'primary danger'; danger.textContent = 'Удалить'; organization.append(danger);
      const regular = document.createElement('section'); regular.dataset.providerPanel = 'settings';
      regular.innerHTML = '<div id="clientDirectoryFilters"><label class="client-directory-check"><input type="checkbox" checked></label></div>'
        + '<label class="booking-series-scope"><input type="checkbox" checked></label>'
        + '<div class="unified-channel-card"><input type="checkbox" checked></div>'
        + '<label class="smart-channel-toggle"><input type="checkbox" checked></label>'
        + '<label class="break-toggle"><input type="checkbox" data-schedule-break checked></label>';
      for (const selector of ['#unifiedNotificationsEnabled', '#fullDataExportConfirm', '#providerNavigationForm',
        '#groupBookingsEnabled', '#createServiceScheduleNameEnabled', '.telegram-event-settings', '#shiftHasBreak']) {
        const element = original.querySelector(selector);
        if (!element) throw new Error(`Real provider HTML missing: ${selector}`);
        regular.append(document.importNode(element.closest('label') || element, true));
      }
      regular.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = true; });
      workspace.append(regular);
      const dialog = clone('#freeSlotsDialog'); dialog.open = true;
      dialog.querySelector('#freeSlotsTimeChoices').innerHTML = '<div class="free-slots-time-grid"><label><input type="checkbox" checked><span>10:00</span></label></div>';
      dialog.querySelectorAll('.free-slots-text-options input').forEach(input => { input.checked = true; });
      document.body.append(dialog);
      document.querySelectorAll('#inventoryEnabled,#inventoryAutoDeduct,#retentionEnabled,#inventoryItemActive,#inventoryWarehouseActive,#inventoryTransfersEnabled').forEach(input => { input.checked = true; });
      document.querySelector('#inventoryTransfersSetting').hidden = false;
      document.querySelector('#inventoryItemCreator').open = true;
      document.querySelector('#inventoryWarehouseCreator').open = true;
    }, html);
    for (const { file, media } of cssLayers) {
      const style = await page.addStyleTag({ content:readFileSync(path.join(root, file), 'utf8') });
      if (media) await style.evaluate((element, value) => { element.media = value; }, media);
    }
    await page.addScriptTag({ content:matrix });
    await page.addScriptTag({ content:recordsScript });
    await page.addScriptTag({ content:benefitScript });
    await page.addScriptTag({ content:loyaltyScript });
    await page.addScriptTag({ content:serviceCatalogScript });
    await page.addScriptTag({ content:servicePresetsScript });
    await page.evaluate(async () => {
      const recordController = MinutaClientRecords.createController({
        db:{ rpc:async () => ({ data:{ enabled:true, entries:[{ id:'note-1', kind:'note', body:'Тестовая заметка', created_at:'2026-01-04T12:00:00Z', can_delete:false }] } }) },
        getContext:() => ({ userId:'synthetic-user', sessionGeneration:1 }), requireWrites:() => false
      });
      window.__x15RecordsController = recordController;
      recordController.bind(); recordController.setOrganization({ id:'synthetic-org' });
      recordController.setClient({ phone:'synthetic-phone', bookings:[
        { id:'visit-1', at:'2026-01-03T12:00:00Z', title:'Тестовый визит', status:'Завершён' },
        { id:'visit-2', at:'2026-01-02T12:00:00Z', title:'Тестовый визит', status:'Отменён' }
      ] });
      recordController.setView('notes'); recordController.setView('history');
      const benefitController = MinutaBenefitLifecycle.createClientController({
        db:{ rpc:async () => ({ data:{ organization_id:'synthetic-org', client_account_id:'synthetic-client', instruments:[{
          id:'synthetic-benefit', kind:'visit_pass', public_code:'TEST', name:'Тестовый абонемент', status:'active',
          remaining_visits:2, expires_on:'2027-01-01', allowed_actions:[], history:[
            { event_type:'issued', created_at:'2026-01-01T10:00:00Z', visits_balance:3 },
            { event_type:'frozen', created_at:'2026-01-02T10:00:00Z', visits_balance:3 },
            { event_type:'activated', created_at:'2026-01-03T10:00:00Z', visits_balance:3 }
          ]
        }] } }) },
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character])),
        notify:() => {}, requireWrites:() => false, getCurrentUser:() => ({ id:'synthetic-user' }),
        getSessionGeneration:() => 1, sessionIsCurrent:() => true,
        storage:{ getItem:() => null, setItem:() => {}, removeItem:() => {} }
      });
      await benefitController.setClient({ clientAccountId:'synthetic-client' }, { id:'synthetic-org', current_role:'owner' });
      document.querySelector('.client-benefit-history').open = true;
      PrimeTimeLoyaltyFrames.render({ client:{ phone:'synthetic-phone', bookings:[] }, outcome:() => null, scope:'synthetic-org' });
      document.querySelector('#clientLoyaltyLevel').click();
    });
    await page.waitForFunction(() => document.querySelectorAll('#clientRecords [data-cr-view="notes"] .cr-event-dot').length === 1);
    assert.equal(await page.locator('#clientRecords [data-cr-view="history"] .cr-event-dot').count(), 2, 'real records renderer: two synthetic visits');
    assert.equal(await page.locator('.client-benefit-history-marker').count(), 3, 'real benefit renderer: three synthetic events');
    assert.equal(await page.locator('.loyalty-thresholds li').count(), 14, 'real loyalty renderer: all thresholds');
    const filled = [
      '#clientQuickRepeat', '#clientRecords [data-cr-note] .cr-button', '#newBookingButton', '#mobileNewBookingButton', '.booking-time-slots button.active',
      '#freeSlotsDialog .free-slots-source input:checked+span', '#freeSlotsDialog .free-slots-time-grid input:checked+span'
    ];
    const customChecks = ['.organization-checks input:checked'];
    const nativeChecks = ['#inventoryEnabled', '#inventoryAutoDeduct', '#inventoryItemActive', '#inventoryWarehouseActive',
      '#inventoryTransfersEnabled', '#freeSlotsDialog .free-slots-title-toggle input:checked'];
    const remainingNativeChecks = [
      '#clientDirectoryFilters .client-directory-check input', '#freeSlotsDialog .free-slots-text-options input',
      '#fullDataExportConfirm', '.provider-navigation-form .settings-check input', '.booking-series-scope input',
      '#unifiedNotificationsEnabled', '#createServiceScheduleNameEnabled', '.telegram-event-settings .settings-check input',
      '#groupBookingsEnabled', '.unified-channel-card input', '.smart-channel-toggle input'
    ];
    const inventoryButtons = ['#inventoryItemForm button.primary[type="submit"]',
      '#inventoryWarehouseForm button.primary[type="submit"]', '#inventoryMovementForm button.primary[type="submit"]'];
    const inventoryCheckboxGeometry = new Map();
    for (const character of ['pearl', 'petal', 'silk']) {
      for (const shade of ['pearl-white', 'porcelain-white', 'gentle-pink', 'petal-pink', 'pink-accent']) {
        const palette = await page.evaluate(({ character, shade }) => {
          const palette = MinutaProviderPorcelainMatrix.paletteFor(character, shade);
          document.body.dataset.providerPorcelainCharacter = character;
          for (const [name, value] of Object.entries({
            '--theme-bg':palette.bg, '--theme-surface':palette.surface, '--theme-surface-alt':palette.surfaceAlt,
            '--theme-ink':palette.ink, '--theme-muted':palette.muted, '--theme-line':palette.line,
            '--theme-accent':palette.accent, '--theme-accent-soft':palette.accentSoft,
            '--theme-accent-contrast':palette.contrast, '--theme-shadow':palette.shadow,
            '--porcelain-action-bg':palette.actionBg, '--porcelain-action-ink':palette.actionInk
          })) document.body.style.setProperty(name, value);
          return palette;
        }, { character, shade });
        await page.waitForTimeout(750);
        for (const selector of filled) {
          const actual = await page.locator(selector).evaluate(element => ({ background:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color }));
          assert.equal(actual.background, toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector} background`);
          assert.equal(actual.color, toRgb(palette.actionInk), `${width} ${character}/${shade} ${selector} ink`);
          assert.ok(contrast(actual.color, actual.background) >= 4.5, `${width} ${character}/${shade} ${selector} contrast`);
        }
        for (const selector of ['#copyFreeSlots', '#updateFreeSlotsText']) {
          const action = await page.locator(selector).evaluate(element => ({
            background:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color,
            border:getComputedStyle(element).borderTopColor
          }));
          assert.deepEqual(action, {
            background:toRgb(palette.actionBg), color:toRgb(palette.actionInk), border:toRgb(palette.line)
          }, `${width} ${character}/${shade} ${selector} free-slots primary action`);
          assert.ok(contrast(action.color, action.background) >= 4.5, `${selector} text contrast`);
        }
        for (const selector of ['#copyFreeSlotsLink', '#shareFreeSlots', '#resetFreeSlotsText',
          '#keepFreeSlotsText', '#freeSlotsClearSelection', '#freeSlotsAutoSelection', '#downloadFreeSlotsQr', '#freeSlotsChangeDates']) {
          assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).color),
            toRgb(palette.actionInk), `${width} ${character}/${shade} ${selector} quiet ink`);
        }
        for (const selector of ['#copyFreeSlots', '#copyFreeSlotsLink', '#shareFreeSlots']) {
          assert.ok(await page.locator(selector).evaluate(element => Number(getComputedStyle(element).opacity) < 1),
            `${width} ${character}/${shade} ${selector} disabled appearance`);
        }
        for (const selector of ['#newBookingButton span', '#newBookingButton .ui-icon', '#mobileNewBookingButton span', '#mobileNewBookingButton .ui-icon']) {
          const ink = await page.locator(selector).evaluate(element => getComputedStyle(element).color);
          assert.equal(ink, toRgb(palette.actionInk), `${width} ${character}/${shade} ${selector} ink`);
        }
        const today = await page.locator('#dateStrip>button.is-today:not(.active)').evaluate(element => {
          const edge = getComputedStyle(element);
          const sample = document.createElement('span');
          sample.style.color = 'var(--porcelain-quiet-mark)';
          document.body.append(sample);
          const expected = getComputedStyle(sample).color;
          sample.remove();
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d'); context.fillStyle = edge.borderTopColor; context.fillRect(0, 0, 1, 1);
          const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
          return { color:edge.borderTopColor, rgb:`rgb(${red}, ${green}, ${blue})`, width:parseFloat(edge.borderTopWidth), expected };
        });
        assert.equal(today.color, today.expected, `${width} ${character}/${shade} today border follows soft shade`);
        assert.ok(today.width >= .8 && today.color !== toRgb(palette.accent), 'today remains a distinct, quiet outline');
        assert.ok(contrast(today.rgb, toRgb(palette.surface)) >= 3, 'today outline stays visible on the schedule surface');
        for (const selector of customChecks) {
          const actual = await page.locator(selector).evaluate(element => ({ background:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color }));
          assert.equal(actual.background, toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector} background`);
          assert.equal(actual.color, toRgb(palette.actionInk), `${width} ${character}/${shade} ${selector} ink`);
          assert.ok(contrast(actual.color, actual.background) >= 4.5, `${width} ${character}/${shade} ${selector} contrast`);
        }
        const retention = await page.locator('#retentionEnabled').evaluate(element => {
          const track = getComputedStyle(element);
          const thumb = getComputedStyle(element, '::after');
          return { track:track.backgroundColor, thumb:thumb.backgroundColor,
            top:thumb.top, left:thumb.left, width:thumb.width, height:thumb.height,
            offset:new DOMMatrixReadOnly(thumb.transform).m41 };
        });
        assert.equal(retention.track, toRgb(palette.actionBg), `${width} ${character}/${shade} retention track`);
        assert.equal(retention.thumb, toRgb(palette.actionInk), `${width} ${character}/${shade} retention thumb`);
        minimumThumbContrast = Math.min(minimumThumbContrast, contrast(retention.thumb, retention.track));
        assert.ok(contrast(retention.thumb, retention.track) >= 3, `${width} ${character}/${shade} retention thumb contrast`);
        assert.deepEqual([retention.top, retention.left, retention.width, retention.height, retention.offset], ['3px', '3px', '16px', '16px', 20], 'checked thumb geometry');
        for (const selector of nativeChecks) {
          assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).accentColor), toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector} accent`);
        }
        for (const selector of remainingNativeChecks) {
          const matches = page.locator(selector);
          assert.ok(await matches.count() > 0, `${selector} fixture exists`);
          for (const input of await matches.all()) {
            assert.equal(await input.evaluate(element => getComputedStyle(element).accentColor), toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector} checked accent`);
            await input.evaluate(element => { element.checked = false; });
            assert.notEqual(await input.evaluate(element => getComputedStyle(element).accentColor), toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector} unchecked unchanged`);
            await input.evaluate(element => { element.checked = true; });
          }
        }
        for (const selector of ['#scheduleQuickBreak', '#shiftHasBreak', '[data-schedule-break]']) {
          assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).accentColor), toRgb(palette.accent), `${selector} break unchanged`);
        }
        for (const selector of ['[data-schedule-quick-preset="custom"].active', '.schedule-quick-days input[data-schedule-quick-day="2"]:checked+span',
          '.provider-client-theme-filters button.active', '.client-message-presets button.active', '.booking-time-hours button.active']) {
          const selected = await page.locator(selector).evaluate(element => ({
            background:getComputedStyle(element).backgroundColor,
            color:getComputedStyle(element).color,
            border:getComputedStyle(element).borderTopColor,
            height:element.getBoundingClientRect().height
          }));
          assert.equal(selected.background, toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector} fill`);
          assert.equal(selected.color, toRgb(palette.actionInk), `${width} ${character}/${shade} ${selector} ink`);
          assert.equal(selected.border, toRgb(palette.line), `${width} ${character}/${shade} ${selector} border`);
          assert.ok(contrast(selected.color, selected.background) >= 4.5, `${selector} readable`);
          if (selector.includes('schedule-quick')) assert.ok(selected.height >= 44, `${selector} tappable`);
        }
        assert.notEqual(await page.locator('.schedule-quick-days input[data-schedule-quick-day="1"]+span').evaluate(element => getComputedStyle(element).backgroundColor), toRgb(palette.actionBg), 'unchecked day remains neutral');
        for (const selector of ['#inventoryItemActive', '#inventoryWarehouseActive', '#inventoryTransfersEnabled']) {
          const input = page.locator(selector);
          const size = await input.evaluate(element => {
            const rect = element.getBoundingClientRect(); return [rect.width, rect.height];
          });
          assert.ok(size[0] >= 18 && size[1] >= 18, `${width} ${selector} visible checkbox size`);
          if (!inventoryCheckboxGeometry.has(selector)) inventoryCheckboxGeometry.set(selector, size);
          assert.deepEqual(size, inventoryCheckboxGeometry.get(selector), `${width} ${character}/${shade} ${selector} geometry`);
          await input.evaluate(element => { element.checked = false; });
          assert.notEqual(await input.evaluate(element => getComputedStyle(element).accentColor), toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector} unchecked remains original`);
          await input.evaluate(element => { element.checked = true; });
        }
        for (const selector of inventoryButtons) {
          const button = await page.locator(selector).evaluate(element => ({ background:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color }));
          assert.equal(button.background, toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector}: existing primary rule`);
          assert.equal(button.color, toRgb(palette.actionInk), `${width} ${character}/${shade} ${selector}: existing primary ink`);
        }
        for (const selector of ['#clientRecords [data-cr-view="history"] .cr-event-dot',
          '#clientRecords [data-cr-view="notes"] .cr-event-dot', '.client-benefit-history-marker']) {
          if (selector.includes('notes')) await page.evaluate(() => window.__x15RecordsController.setView('notes'));
          const marker = await page.locator(selector).first().evaluate(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return { background:style.backgroundColor, shadow:style.boxShadow, width:rect.width, height:rect.height,
              marginTop:style.marginTop, x:rect.x };
          });
          const size = selector.includes('benefit') ? 8 : 9;
          assert.equal(marker.background, toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector} fill`);
          assert.ok(marker.shadow.includes(toRgb(palette.actionInk)) && marker.shadow.includes('inset'), `${width} ${character}/${shade} ${selector} contour`);
          assert.ok(contrast(toRgb(palette.actionInk), marker.background) >= 3, `${width} ${character}/${shade} ${selector} contour contrast`);
          assert.deepEqual([marker.width, marker.height, marker.marginTop], [size, size, selector.includes('benefit') ? '5px' : '6px'], `${selector} geometry`);
          assert.ok(marker.x >= 0 && marker.x + marker.width <= width, `${selector} inside viewport`);
          if (selector.includes('notes')) await page.evaluate(() => window.__x15RecordsController.setView('history'));
        }
        for (const [visits, expected] of [[0, '0'], [3, '3'], [100, '100']]) {
          await page.evaluate(visits => PrimeTimeLoyaltyFrames.render({
            client:{ phone:'synthetic-phone', bookings:Array.from({ length:visits }, (_, index) => ({ id:`synthetic-visit-${index}`, status:'visited' })) },
            outcome:() => ({ visit_status:'completed' }), scope:'synthetic-org'
          }), visits);
          const current = page.locator('.loyalty-thresholds [aria-current="step"]');
          assert.equal(await current.count(), 1, `${width} ${character}/${shade}: one current threshold`);
          assert.equal(await current.textContent(), expected, `${width} ${character}/${shade}: current rank`);
          const selected = await current.evaluate(element => {
            const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
            return { background:style.backgroundColor, color:style.color, border:style.borderTopColor,
              width:rect.width, height:rect.height, weight:Number(style.fontWeight), x:rect.x };
          });
          assert.equal(selected.background, toRgb(palette.actionBg));
          assert.equal(selected.color, toRgb(palette.actionInk));
          assert.equal(selected.border, toRgb(palette.actionInk));
          assert.ok(contrast(selected.color, selected.background) >= 4.5 && contrast(selected.border, selected.background) >= 3);
          assert.ok(selected.width >= 34 && selected.height === 32 && selected.weight >= 700, 'threshold geometry and emphasis');
          assert.ok(selected.x >= 0 && selected.x + selected.width <= width, 'selected threshold inside viewport');
        }
        assert.ok(await page.locator('.loyalty-thresholds').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'thresholds wrap without internal overflow');
        assert.notEqual(await page.locator('.primary.danger').evaluate(element => getComputedStyle(element).backgroundColor), toRgb(palette.actionBg), 'danger stays separate');
        if (character === 'petal' && shade === 'gentle-pink') {
          await page.evaluate(() => {
            document.querySelector('#clientLoyaltyLevelsDialog').close();
            window.__x15RecordsController.setView('notes');
            document.querySelector('#clientRecords details[data-cr-panel="note"]').open = true;
          });
          await page.locator('#freeSlotsDialog .free-slots-actions button').evaluateAll(buttons =>
            buttons.forEach(button => { button.disabled = false; }));
          await page.waitForFunction(() => [...document.querySelectorAll('#freeSlotsDialog .free-slots-actions button')]
            .every(button => Number(getComputedStyle(button).opacity) > .99));
          for (const selector of ['#copyFreeSlots', '#copyFreeSlotsLink', '#shareFreeSlots']) {
            for (const state of ['hover', 'focus']) {
              if (state === 'hover') await page.locator(selector).hover();
              else await page.locator(selector).focus();
              const style = await page.locator(selector).evaluate(element => ({
                background:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color,
                opacity:Number(getComputedStyle(element).opacity),
                outline:getComputedStyle(element).outlineColor
              }));
              assert.equal(style.color, toRgb(palette.actionInk), `${width} ${selector} ${state} ink`);
              if (selector === '#copyFreeSlots') assert.equal(style.background, toRgb(palette.actionBg), `${width} primary ${state} fill`);
              assert.equal(style.opacity, 1, `${width} ${selector} enabled ${state} appearance`);
              if (state === 'focus') assert.equal(style.outline, toRgb(palette.actionInk), `${width} ${selector} focus outline`);
            }
          }
          if (outputDir) await page.locator('#freeSlotsDialog').screenshot({ path:path.join(outputDir, `x15-free-slots-${width}.png`) });
          await page.locator('#freeSlotsDialog .free-slots-actions button').evaluateAll(buttons =>
            buttons.forEach(button => { button.disabled = true; }));
          await page.waitForFunction(() => [...document.querySelectorAll('#freeSlotsDialog .free-slots-actions button')]
            .every(button => Number(getComputedStyle(button).opacity) < .56));
          await page.locator('#clientRecords [data-cr-note] .cr-button').hover();
          await page.locator('.booking-time-slots button.active').focus();
          await page.waitForTimeout(350);
          for (const selector of ['#clientRecords [data-cr-note] .cr-button', '.booking-time-slots button.active']) {
            assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).backgroundColor), toRgb(palette.actionBg), `${width} ${selector} hover/focus`);
          }
          await page.evaluate(() => {
            window.__x15RecordsController.setView('history');
            document.querySelector('#clientLoyaltyLevelsDialog').showModal();
          });
        }
        if (outputDir && character === 'petal' && shade === 'gentle-pink') {
          await page.evaluate(() => document.querySelector('#clientLoyaltyLevelsDialog').close());
          await page.locator('.schedule-view-title').screenshot({ path:path.join(outputDir, `x15-bookings-header-${width}.png`) });
          await page.locator('.date-strip-frame').screenshot({ path:path.join(outputDir, `x15-today-marker-${width}.png`) });
          if (await page.locator('#mobileNewBookingButton').isVisible()) {
            await page.locator('#mobileNewBookingButton').screenshot({ path:path.join(outputDir, `x15-mobile-create-${width}.png`) });
          }
          const monday = page.locator('.schedule-quick-days label').first();
          await monday.click();
          assert.equal(await monday.locator('input').isChecked(), true, 'real weekday label toggles on click');
          await monday.click();
          assert.equal(await monday.locator('input').isChecked(), false, 'real weekday label toggles off click');
          await page.locator('.schedule-quick-setup').screenshot({ path:path.join(outputDir, `x15-schedule-${width}.png`) });
          await page.evaluate(() => document.querySelector('#clientLoyaltyLevelsDialog').showModal());
          await page.screenshot({ path:path.join(outputDir, `x15-ordinary-${width}.png`), fullPage:true });
          await page.evaluate(() => { document.querySelector('#clientLoyaltyLevelsDialog').close(); window.scrollTo(0, 0); });
          await page.locator('#clientRecords').screenshot({ path:path.join(outputDir, `x15-records-${width}.png`) });
          await page.locator('#clientBenefitLifecycle').screenshot({ path:path.join(outputDir, `x15-benefit-${width}.png`) });
          await page.evaluate(() => document.querySelector('#clientLoyaltyLevelsDialog').showModal());
          await page.locator('.loyalty-thresholds').screenshot({ path:path.join(outputDir, `x15-thresholds-${width}.png`) });
        }
      }
    }
    await page.locator('#retentionEnabled').evaluate(input => { input.checked = false; });
    await page.waitForTimeout(350);
    const unchecked = await page.locator('#retentionEnabled').evaluate(element => {
      const thumb = getComputedStyle(element, '::after');
      return { track:getComputedStyle(element).backgroundColor, thumb:thumb.backgroundColor,
        top:thumb.top, left:thumb.left, width:thumb.width, height:thumb.height,
        offset:new DOMMatrixReadOnly(thumb.transform).m41 };
    });
    assert.notEqual(unchecked.track, toRgb('#e5a3be'), 'unchecked retention track stays neutral');
    assert.equal(unchecked.thumb, toRgb('#ffffff'), 'unchecked thumb keeps surface color');
    assert.deepEqual([unchecked.top, unchecked.left, unchecked.width, unchecked.height, unchecked.offset], ['3px', '3px', '16px', '16px', 0], 'unchecked thumb geometry');
    await page.evaluate(() => { document.body.dataset.providerTheme = 'sage'; document.body.style.setProperty('--theme-accent', '#287a58'); });
    assert.equal(await page.locator('#clientRecords [data-cr-note] .cr-button').evaluate(element => getComputedStyle(element).backgroundColor), toRgb('#287a58'), 'another theme keeps own action');
    assert.equal(await page.locator('#groupBookingsEnabled').evaluate(element => getComputedStyle(element).accentColor), toRgb('#287a58'), 'another theme keeps own checkbox accent');
    for (const selector of ['#copyFreeSlots', '#updateFreeSlotsText']) {
      assert.notEqual(await page.locator(selector).evaluate(element => getComputedStyle(element).backgroundColor),
        toRgb('#f3b8ce'), `${selector} keeps other theme primary`);
    }
    for (const selector of ['#copyFreeSlotsLink', '#shareFreeSlots', '#resetFreeSlotsText',
      '#keepFreeSlotsText', '#freeSlotsClearSelection', '#freeSlotsAutoSelection', '#downloadFreeSlotsQr', '#freeSlotsChangeDates']) {
      assert.notEqual(await page.locator(selector).evaluate(element => getComputedStyle(element).color), toRgb('#382532'), `${selector} keeps other theme ink`);
    }
    await page.evaluate(() => MinutaServicePresets.open({ professionIds:['tire_fitter'], existingServices:[] }));
    await page.locator('#servicePresetsDialog [data-service-presets-next]').click();
    await page.locator('#servicePresetsDialog [data-service-preset]').first().click();
    await page.locator('#servicePresetsDialog [data-draft-price]').fill('500');
    await page.locator('#servicePresetsDialog [data-service-presets-next]').click();
    const serviceAction = page.locator('#servicePresetsDialog [data-service-presets-next]');
    assert.equal(await serviceAction.textContent(), 'Добавить услуги', 'real service wizard reaches review without saving');
    for (const character of ['pearl', 'petal', 'silk']) {
      for (const shade of ['pearl-white', 'porcelain-white', 'gentle-pink', 'petal-pink', 'pink-accent']) {
        const palette = await page.evaluate(({ character, shade }) => {
          const palette = MinutaProviderPorcelainMatrix.paletteFor(character, shade);
          document.body.dataset.providerTheme = 'pink-porcelain';
          for (const [name, value] of Object.entries({
            '--theme-accent':palette.accent, '--theme-line':palette.line,
            '--porcelain-action-bg':palette.actionBg, '--porcelain-action-ink':palette.actionInk
          })) document.body.style.setProperty(name, value);
          return palette;
        }, { character, shade });
        await page.waitForFunction(expected => getComputedStyle(document.querySelector('#servicePresetsDialog [data-service-presets-next]')).backgroundColor === expected, toRgb(palette.actionBg), { timeout:1500 });
        const actual = await serviceAction.evaluate(element => ({ background:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color, border:getComputedStyle(element).borderTopColor }));
        assert.deepEqual(actual, { background:toRgb(palette.actionBg), color:toRgb(palette.actionInk), border:toRgb(palette.line) }, `${width} ${character}/${shade} service review action`);
        assert.ok(contrast(actual.color, actual.background) >= 4.5, 'service review action text contrast');
        if (outputDir && character === 'petal' && shade === 'gentle-pink') {
          await page.locator('#servicePresetsDialog').screenshot({ path:path.join(outputDir, `x15-service-review-${width}.png`) });
        }
      }
    }
    await page.evaluate(() => { document.body.dataset.providerTheme = 'sage'; document.body.style.setProperty('--theme-accent', '#287a58'); });
    assert.notEqual(await serviceAction.evaluate(element => getComputedStyle(element).backgroundColor), toRgb('#f3b8ce'), 'another theme keeps own service action');
    await page.evaluate(() => MinutaServicePresets.close());
    await page.evaluate(markup => {
      document.body.dataset.providerTheme = 'pink-porcelain';
      const source = new DOMParser().parseFromString(markup, 'text/html').querySelector('#serviceCreatorContent');
      const creator = document.importNode(source, true);
      creator.hidden = false;
      document.body.append(creator);
    }, html);
    await page.evaluate(() => MinutaServicePresets.open({ prepareCustom:() => {}, professionIds:['tire_fitter'] }));
    await page.locator('#servicePresetsDialog [data-start-custom-service]').click();
    const customServiceAction = page.locator('#servicePresetsDialog [data-custom-service-footer] button.primary[type="submit"][form="serviceForm"]');
    assert.equal(await customServiceAction.count(), 1, 'real custom service form submit moves into the wizard footer');
    for (const character of ['pearl', 'petal', 'silk']) {
      for (const shade of ['pearl-white', 'porcelain-white', 'gentle-pink', 'petal-pink', 'pink-accent']) {
        const palette = await page.evaluate(({ character, shade }) => {
          const palette = MinutaProviderPorcelainMatrix.paletteFor(character, shade);
          document.body.dataset.providerPorcelainCharacter = character;
          for (const [name, value] of Object.entries({
            '--theme-bg':palette.bg, '--theme-surface':palette.surface, '--theme-surface-alt':palette.surfaceAlt,
            '--theme-ink':palette.ink, '--theme-muted':palette.muted, '--theme-line':palette.line,
            '--theme-accent':palette.accent, '--theme-accent-soft':palette.accentSoft,
            '--theme-accent-contrast':palette.contrast, '--theme-shadow':palette.shadow,
            '--porcelain-action-bg':palette.actionBg, '--porcelain-action-ink':palette.actionInk
          })) document.body.style.setProperty(name, value);
          return palette;
        }, { character, shade });
        await page.waitForFunction(({ background, border }) => {
          const style = getComputedStyle(document.querySelector('#servicePresetsDialog [data-custom-service-footer] button'));
          return style.backgroundColor === background && style.borderTopColor === border;
        }, { background:toRgb(palette.actionBg), border:toRgb(palette.line) }, { timeout:1500 });
        const action = await customServiceAction.evaluate(element => ({
          background:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color,
          border:getComputedStyle(element).borderTopColor
        }));
        assert.deepEqual(action, { background:toRgb(palette.actionBg), color:toRgb(palette.actionInk), border:toRgb(palette.line) },
          `${width} ${character}/${shade} real custom service footer action`);
        assert.ok(contrast(action.color, action.background) >= 4.5, 'custom service action text contrast');
        if (character === 'petal' && shade === 'gentle-pink') {
          assert.equal(await page.locator('#servicePresetsDialog #serviceForm .service-public-card-editor summary')
            .evaluate(element => getComputedStyle(element).color), toRgb(palette.muted), `${width} custom service summary stays muted`);
          for (const selector of ['#serviceName', '#serviceDuration', '#servicePrice',
            '#createServiceShortDescription', '#serviceForm .service-public-card-editor summary']) {
            const control = page.locator(`#servicePresetsDialog ${selector}`);
            if (selector.includes('summary')) await page.keyboard.press('Tab');
            await control.focus();
            const style = await control.evaluate(element => ({
              outline:getComputedStyle(element).outlineColor,
              border:getComputedStyle(element).borderTopColor
            }));
            assert.equal(style.outline, toRgb(palette.actionInk), `${width} ${selector} quiet focus outline`);
            if (!selector.includes('summary')) assert.equal(style.border, toRgb(palette.line), `${width} ${selector} quiet focus border`);
          }
          await customServiceAction.hover();
          assert.equal(await customServiceAction.evaluate(element => getComputedStyle(element).backgroundColor),
            toRgb(palette.actionBg), `${width} custom service hover fill`);
          await customServiceAction.focus();
          assert.equal(await customServiceAction.evaluate(element => getComputedStyle(element).outlineColor),
            toRgb(palette.actionInk), `${width} custom service focus outline`);
          await customServiceAction.evaluate(element => { element.disabled = true; });
          await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#servicePresetsDialog [data-custom-service-footer] button')).opacity) < .99);
          assert.ok(await customServiceAction.evaluate(element => Number(getComputedStyle(element).opacity) < 1),
            `${width} custom service disabled appearance`);
          await customServiceAction.evaluate(element => { element.disabled = false; });
          await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#servicePresetsDialog [data-custom-service-footer] button')).opacity) > .99);
          if (outputDir) await page.locator('#servicePresetsDialog').screenshot({ path:path.join(outputDir, `x15-custom-service-${width}.png`) });
        }
      }
    }
    await page.evaluate(() => { document.body.dataset.providerTheme = 'sage'; document.body.style.setProperty('--theme-accent', '#287a58'); });
    await page.waitForTimeout(250);
    assert.notEqual(await customServiceAction.evaluate(element => getComputedStyle(element).backgroundColor),
      toRgb('#f3b8ce'), 'another theme keeps its custom service action');
    await page.evaluate(() => MinutaServicePresets.close());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px overflow`);
    assert.deepEqual(errors, [], `${width}px page errors`);
    console.log(`${width}px: 15 palettes, retention thumb minimum ${minimumThumbContrast.toFixed(2)}:1, ordinary controls, timeline markers, current threshold, inventory, contrast, overflow PASS; network attempts blocked: ${blocked.length}`);
    await page.close();
  }
} finally {
  await browser.close();
}
