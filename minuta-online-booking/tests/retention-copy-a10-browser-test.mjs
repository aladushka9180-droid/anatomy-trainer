import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Read the integrated files. All data and saving are synthetic; external requests fail.
const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const paths = [
  'minuta-online-booking/provider.html',
  'minuta-online-booking/retention-management.js',
  'minuta-online-booking/help/help-data.js'
];
let browser;
try {
  const html = readFileSync(join(project, paths[0]), 'utf8');
  const source = readFileSync(join(project, paths[1]), 'utf8');
  const help = readFileSync(join(project, paths[2]), 'utf8');
  const css = readFileSync(join(project, 'minuta-online-booking/styles.css'), 'utf8');
  const uxCss = readFileSync(join(project, 'minuta-online-booking/provider-ux.css'), 'utf8');
  const familyCss = readFileSync(join(project, 'minuta-online-booking/provider-theme-families.css'), 'utf8');
  const loftCss = readFileSync(join(project, 'minuta-online-booking/provider-theme-loft-modern.css'), 'utf8');
  const providerSource = readFileSync(join(project, 'minuta-online-booking/provider.js'), 'utf8');
  const confirmationStart = providerSource.indexOf('function requestProviderConfirmation(');
  const confirmationEnd = providerSource.indexOf('\nfunction visitorVisitTimeLabel(', confirmationStart);
  assert.ok(confirmationStart >= 0 && confirmationEnd > confirmationStart, 'real confirmation helper must exist');
  const confirmationSource = providerSource.slice(confirmationStart, confirmationEnd);
  assert.ok(help.includes('Повторное предложение появится после заданного интервала'), 'A10 help must explain repeat interval');
  assert.ok(!help.includes('Откройте возврат|Перейдите в'), 'contextual help must not link to the current screen');
  browser = await chromium.launch({ headless:true,
    ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  const errors = [], unexpectedRequests = [];
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://a10-synthetic.test/') {
        return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><meta charset="utf-8"><body></body></html>' });
      }
      unexpectedRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto('https://a10-synthetic.test/');
    await page.evaluate(markup => {
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      const panel = parsed.getElementById('retentionPanel');
      const dialog = parsed.getElementById('providerConfirmDialog');
      if (!panel || !dialog) throw new Error('Retention panel or confirmation dialog missing');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'sage';
      document.body.dataset.providerLayout = 'soft';
      const main = document.createElement('main');
      main.style.cssText = 'max-width:960px;margin:auto;padding:16px';
      main.append(document.importNode(panel, true));
      document.body.append(main, document.importNode(dialog, true));
    }, html);
    await page.addStyleTag({ content:css });
    await page.addStyleTag({ content:uxCss });
    await page.addStyleTag({ content:familyCss });
    await page.addStyleTag({ content:loftCss });
    await page.addScriptTag({ content:`function $(selector) { return document.querySelector(selector); }\n${confirmationSource}` });
    await page.addScriptTag({ content:source });
    await page.evaluate(async () => {
      window.a10Calls = [];
      const clients = [
        { client_account_id:'synthetic-no-visits', client_name:'Клиент А', client_phone:'', last_visit_on:null,
          completed_visits:0, consent_status:'unknown', eligible:false },
        { client_account_id:'synthetic-consent', client_name:'Клиент Б', client_phone:'', last_visit_on:'2026-01-01',
          completed_visits:2, consent_status:'granted', eligible:true },
        { client_account_id:'synthetic-refused', client_name:'Клиент В', client_phone:'', last_visit_on:'2026-01-02',
          completed_visits:1, consent_status:'revoked', eligible:false }
      ];
      const db = { rpc:async (name, args) => {
        a10Calls.push({ name, args });
        if (name === 'save_minuta_retention_settings') {
          return { data:{ organization_id:'synthetic-org', enabled:args.p_enabled }, error:null };
        }
        if (name !== 'get_minuta_retention_workspace') throw new Error(`Unexpected operation: ${name}`);
        return { data:{ organization_id:'synthetic-org', current_role:'owner', enabled:false,
          inactivity_days:45, cooldown_days:90, message_template:'', clients, deliveries:[], audit:[] }, error:null };
      } };
      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
        char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
      const retention = window.MinutaRetention.createController({ db, escapeHtml,
        $:selector => document.querySelector(selector), notify() {}, requireWrites:() => true,
        getCurrentUser:() => ({ id:'synthetic-owner' }), getSessionGeneration:() => 1,
        sessionIsCurrent:(user, generation) => user === 'synthetic-owner' && generation === 1,
        applyWriteAvailability() {}, requestConfirmation:requestProviderConfirmation });
      retention.bind();
      await retention.setOrganization({ id:'synthetic-org', current_role:'owner' });
    });
    assert.equal(await page.locator('#retentionPanel .panel-head h3').innerText(), 'Возврат клиентов');
    assert.match(await page.locator('#retentionEnabled').locator('..').innerText(), /Подбирать клиентов после перерыва/);
    const enabledAppearance = await page.locator('#retentionEnabled').evaluate(input => {
      const previous = input.checked;
      const theme = document.body.dataset.providerTheme;
      document.body.dataset.providerTheme = 'loft';
      input.checked = true;
      const track = getComputedStyle(input).backgroundColor;
      const knob = getComputedStyle(input, '::after').backgroundColor;
      input.checked = previous;
      document.body.dataset.providerTheme = theme;
      return { track, knob };
    });
    assert.notEqual(enabledAppearance.track, enabledAppearance.knob, `${width}: enabled switch must look selected`);
    assert.match(await page.locator('#retentionPanel').innerText(), /Дней после последнего визита/);
    assert.match(await page.locator('#retentionPanel').innerText(), /Повторное предложение — не раньше чем через/);
    assert.match(await page.locator('#retentionPanel').innerText(), /Подготовленные сообщения/);
    assert.doesNotMatch(await page.locator('#retentionPanel').innerText(), /Возврат без спама|Контролируемая отправка/);
    assert.match(await page.locator('#retentionMessageTemplate').inputValue(), /Это \{организация\}\. Выбрать время/);
    const cards = page.locator('.retention-client-row');
    assert.equal(await cards.count(), 3);
    assert.match(await cards.nth(0).innerText(), /Завершённых визитов нет/);
    assert.doesNotMatch(await cards.nth(0).innerText(), /последний визит визитов пока нет|завершено 0/);
    assert.deepEqual(await cards.nth(0).locator('option').allTextContents(),
      ['Согласие не указано', 'Клиент согласен', 'Клиент отказался']);
    assert.equal(await cards.nth(0).locator('[data-retention-prepare]').count(), 0);
    assert.equal(await cards.nth(1).locator('[data-retention-prepare]').count(), 1);
    assert.equal(await cards.nth(2).locator('[data-retention-prepare]').count(), 0);
    assert.match(await page.locator('#retentionDeliveriesList').innerText(), /Сообщения не отправляются автоматически/);
    assert.match(await page.locator('#retentionDeliveriesList').innerText(), /не подтверждает доставку/);
    const saveStatus = page.locator('#retentionSaveStatus');
    assert.equal(await saveStatus.getAttribute('role'), 'status');
    assert.equal(await saveStatus.getAttribute('aria-live'), 'polite');
    assert.equal(await saveStatus.innerText(), 'Изменения сохраняются автоматически');
    const placement = await page.evaluate(() => {
      const status = document.querySelector('#retentionSaveStatus');
      const form = document.querySelector('#retentionSettingsForm');
      const field = document.querySelector('.retention-message-field');
      const statusBox = status.getBoundingClientRect();
      const fieldBox = field.getBoundingClientRect();
      const formBox = form.getBoundingClientRect();
      return { inForm:status.parentElement === form, followsField:status.previousElementSibling === field,
        visible:getComputedStyle(status).display !== 'none' && statusBox.width > 0,
        gap:statusBox.top - fieldBox.bottom, withinForm:statusBox.bottom <= formBox.bottom };
    });
    assert.ok(placement.inForm && placement.followsField && placement.visible && placement.withinForm,
      `save status must remain next to editable settings at ${width}px`);
    assert.ok(placement.gap >= 0 && placement.gap <= 32, `save status gap at ${width}px: ${placement.gap}`);
    await page.locator('#retentionEnabled').check();
    const dialog = page.locator('#providerConfirmDialog');
    await dialog.waitFor({ state:'visible' });
    assert.equal(await page.locator('#providerConfirmTitle').innerText(), 'Включить подбор клиентов?');
    assert.match(await page.locator('#providerConfirmMessage').innerText(), /45 дней.*90 дней/);
    await dialog.locator('[value="cancel"]').click();
    await page.waitForFunction(() => !document.querySelector('#retentionEnabled').checked);
    assert.deepEqual(await page.evaluate(() => a10Calls.map(call => call.name)), ['get_minuta_retention_workspace']);
    await page.locator('#retentionMessageTemplate').fill('Здравствуйте! Выберите время: {ссылка}');
    assert.equal(await saveStatus.innerText(), 'Ожидает сохранения…');
    await page.waitForFunction(() => document.querySelector('#retentionSaveStatus').textContent === 'Сохранено автоматически');
    const calls = await page.evaluate(() => a10Calls);
    assert.deepEqual(calls.map(call => call.name), ['get_minuta_retention_workspace', 'save_minuta_retention_settings']);
    assert.equal(calls[1].args.p_enabled, false, 'editing text must not enable selection');
    assert.equal(calls[1].args.p_inactivity_days, 45);
    assert.equal(calls[1].args.p_cooldown_days, 90);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `outer overflow at ${width}: ${overflow}`);
    if (process.env.A10_SCREENSHOT_DIR) {
      mkdirSync(process.env.A10_SCREENSHOT_DIR, { recursive:true });
      await page.screenshot({ path:join(process.env.A10_SCREENSHOT_DIR, `a10-${width}.png`), fullPage:true });
    }
    console.log(`PASS ${width}px: texts, consent, visit state, adjacent autosave, mock save, no overflow`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedRequests, []);
} finally {
  if (browser) await browser.close();
}
