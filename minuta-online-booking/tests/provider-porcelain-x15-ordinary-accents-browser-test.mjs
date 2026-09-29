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
      const app = document.createElement('div'); app.className = 'provider-app';
      const dashboard = document.createElement('main'); dashboard.id = 'dashboard';
      app.append(dashboard); document.body.append(app);
      const clients = document.createElement('section'); clients.dataset.providerPanel = 'clients'; clients.className = 'provider-view';
      const profile = document.createElement('div'); profile.className = 'client-profile-card';
      profile.append(clone('#clientQuickRepeat')); clients.append(profile);
      const head = document.createElement('div'); head.className = 'client-profile-head';
      head.append(clone('#clientProfileOrbit')); clients.append(head);
      const records = clone('#clientRecords');
      records.replaceChildren(); clients.append(records);
      clients.append(clone('#clientBenefitLifecycle')); dashboard.append(clients);
      const bookings = document.createElement('section'); bookings.dataset.providerPanel = 'bookings'; bookings.className = 'provider-view';
      bookings.innerHTML = '<div class="booking-time-slots"><button class="active" type="button">10:00</button></div>';
      dashboard.append(bookings);
      const organization = document.createElement('section'); organization.dataset.providerPanel = 'organization'; organization.className = 'provider-view organization-section';
      organization.append(clone('#inventoryPanel .inventory-settings'),
        clone('#inventoryItemCreator'), clone('#inventoryWarehouseCreator'), clone('#inventoryMovementForm'),
        document.importNode(original.querySelector('#retentionEnabled').closest('label'), true));
      const checks = document.createElement('div'); checks.className = 'organization-checks';
      checks.innerHTML = '<label><input type="checkbox" checked><span>Активен</span></label>';
      organization.append(checks); dashboard.append(organization);
      const danger = document.createElement('button'); danger.className = 'primary danger'; danger.textContent = 'Удалить'; organization.append(danger);
      const dialog = document.createElement('dialog'); dialog.id = 'freeSlotsDialog'; dialog.className = 'free-slots-dialog'; dialog.open = true;
      dialog.append(clone('#freeSlotsDialog .free-slots-source'), clone('#freeSlotsDialog .free-slots-title-toggle'));
      const times = document.createElement('div'); times.className = 'free-slots-time-grid';
      times.innerHTML = '<label><input type="checkbox" checked><span>10:00</span></label>';
      dialog.append(times); document.body.append(dialog);
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
      '#clientQuickRepeat', '#clientRecords [data-cr-note] .cr-button', '.booking-time-slots button.active',
      '#freeSlotsDialog .free-slots-source input:checked+span', '#freeSlotsDialog .free-slots-time-grid input:checked+span'
    ];
    const customChecks = ['.organization-checks input:checked'];
    const nativeChecks = ['#inventoryEnabled', '#inventoryAutoDeduct', '#inventoryItemActive', '#inventoryWarehouseActive',
      '#inventoryTransfersEnabled', '#freeSlotsDialog .free-slots-title-toggle input:checked'];
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
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px overflow`);
    assert.deepEqual(errors, [], `${width}px page errors`);
    console.log(`${width}px: 15 palettes, retention thumb minimum ${minimumThumbContrast.toFixed(2)}:1, ordinary controls, timeline markers, current threshold, inventory, contrast, overflow PASS; network attempts blocked: ${blocked.length}`);
    await page.close();
  }
} finally {
  await browser.close();
}
