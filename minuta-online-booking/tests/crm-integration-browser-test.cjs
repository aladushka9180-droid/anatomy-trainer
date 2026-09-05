const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const providerStylesheets = [...source('provider.html').matchAll(/<link\s+rel="stylesheet"\s+href="([^"?]+)/g)]
  .map(match => match[1].replace(/^\.\//,''))
  .filter(name => name.endsWith('.css') && !path.isAbsolute(name) && !name.startsWith('..') && fs.existsSync(path.join(root,name)));

const shell = `<!doctype html><html lang="ru"><head><meta charset="utf-8"></head>
<body class="provider-body" data-provider-theme="sage" data-provider-layout="bento">
  <main class="crm-test-shell">
    <section aria-label="Карточка клиента"><div id="clientRecords"></div><details><summary>Старая история</summary><div id="clientHistory"></div></details></section>
    <section aria-label="Себестоимость">
      <form id="inventoryMovementForm">
        <select id="inventoryMovementKind"><option value="receipt" selected>Приход</option></select>
        <label>Причина<input id="inventoryMovementReason"></label><p id="inventoryMovementError"></p>
      </form>
      <section id="inventoryMovementsPanel"></section>
    </section>
    <section class="provider-view" data-provider-panel="notifications" aria-label="Уведомления">
      <div id="legacyNotifications">Старые уведомления продолжают работать</div>
      <details class="panel unified-notification-panel ux-disclosure" id="unifiedNotificationPanel" hidden open>
        <summary><strong>Настроить каналы доставки</strong><span id="unifiedNotificationState">Выключен</span></summary>
        <div class="resource-inline-error" id="unifiedNotificationUnavailable" hidden><div><strong>Центр каналов временно недоступен</strong><small id="unifiedNotificationUnavailableText"></small></div><button class="secondary-button" id="reloadUnifiedNotifications" type="button">Повторить</button></div>
        <div id="unifiedNotificationWorkspace" hidden>
          <label class="settings-check"><input id="unifiedNotificationsEnabled" type="checkbox"><span><strong>Включить единую очередь</strong><small>Сначала подключите конкретные каналы.</small></span></label>
          <div class="unified-notification-channels" id="unifiedNotificationChannels"></div>
          <details class="resource-audit" open><summary><span><small>Последние события</small><strong>Доставка по каналам</strong></span></summary><div class="organization-audit-list" id="unifiedNotificationDeliveries"></div></details>
        </div>
      </details>
    </section>
  </main>
</body></html>`;

async function createHarness(browser) {
  const page = await browser.newPage({ viewport:{ width:390, height:1200 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setContent(shell);
  await page.addStyleTag({ content:`
    html,body{margin:0;min-width:0}.crm-test-shell{display:grid;gap:24px;max-width:980px;margin:auto;padding:12px;min-width:0}
    .crm-test-shell>section{min-width:0}.crm-test-shell #inventoryMovementForm{display:none}
  ` });
  for (const name of [...new Set([...providerStylesheets,'profitability-management.css'])]) {
    await page.addStyleTag({ content:source(name) });
  }
  for (const name of ['client-records.js', 'profitability-management.js', 'notification-center.js']) {
    await page.addScriptTag({ content:source(name) });
  }
  return { page, pageErrors };
}

async function installControllers(page, mode = 'ready') {
  await page.evaluate(mode => {
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[char]);
    const longService = 'Очень длинное название услуги без сокращений — глубокая восстановительная процедура для спины и плечевого пояса';
    const longPerson = 'Александра-Екатерина Специалистова с очень длинным именем';
    const longFile = `${'Подробное_заключение_и_рекомендации_без_сокращений_'.repeat(4)}.pdf`;
    const longNote = 'Клиент просит сохранить эту подробную заметку полностью: '.repeat(8);
    const payloadFor = organizationId => ({
      current_role:'owner', settings:{enabled:true},
      endpoints:[{audience:'provider',channel:'telegram',active:true,configured:true}],
      channels:[
        {audience:'provider',channel:'telegram',enabled:true},
        {audience:'client',channel:'sms',enabled:false}
      ],
      outbox:[{
        id:`outbox-${organizationId}`, kind:'booking_created', channel:'telegram', audience:'provider', status:'failed',
        last_error:`${organizationId}: ${'подробная ошибка доставки без обрезки '.repeat(6)}`,
        created_at:'2026-09-05T10:00:00+04:00',
        context:{client_name:`${organizationId} · ${'Очень длинное имя клиента '.repeat(4)}`,service_name:longService,booking_date:'2026-09-05',booking_time:'10:30:00'}
      }]
    });
    const profitPayload = {
      organization_id:'org-ready',
      summary:{revenue_kopecks:250000,material_cost_kopecks:null,commission_kopecks:15000,payout_kopecks:90000,remainder_before_overhead_kopecks:null},
      services:[{service_id:'service-long',service_name:longService,visit_count:12,revenue_kopecks:250000,material_cost_kopecks:null,commission_kopecks:15000,payout_kopecks:90000,remainder_before_overhead_kopecks:null,missing_material_cost_count:12,missing_commission_count:0,missing_payout_count:0}],
      visits:[{booking_id:'booking-long',booking_date:'2026-09-05',service_name:longService,performer_name:longPerson,material_mode:'unspecified',revenue_kopecks:30000,material_cost_kopecks:null,commission_kopecks:null,payout_kopecks:10000,remainder_before_overhead_kopecks:null}]
    };
    window.MINUTA_CONFIG = {supabaseUrl:'https://mock.invalid',supabaseKey:'public-test-key'};
    window.fetch = async () => ({ok:true,json:async()=>({ok:true,configured_channels:['telegram'],provider_telegram_fallback:false})});
    window.crm = {
      mode, calls:[], notices:[], context:{userId:'user-1',sessionGeneration:1},
      longService,longPerson,longFile,longNote,failProfitWrite:false,delayProfitRead:false,
      payloadFor,profitPayload
    };
    window.db = {
      auth:{getUser:async()=>({data:{user:{id:'user-1'}}})},
      rpc:async(name, parameters) => {
        crm.calls.push({name,parameters});
        if (name === 'get_minuta_client_records') {
          if (crm.mode === 'missing') return {error:{code:'PGRST202',message:'function get_minuta_client_records does not exist'}};
          return {data:{enabled:true,can_enable:true,entries:[
            {id:'file-1',kind:'file',file_name:longFile,byte_size:9000,mime_type:'application/pdf',object_path:'org/file-1',created_at:'2026-09-05T11:00:00+04:00',can_delete:true},
            {id:'note-1',kind:'note',body:longNote,created_at:'2026-09-05T10:40:00+04:00',can_delete:true}
          ]}};
        }
        if (name === 'get_minuta_profitability_v113') {
          if (crm.delayProfitRead) await new Promise(resolve => setTimeout(resolve, 80));
          return crm.mode === 'profit-read-error' ? {error:{message:'temporary'}} : {data:crm.profitPayload};
        }
        if (name === 'set_minuta_service_material_mode_v113') {
          await new Promise(resolve => setTimeout(resolve, 40));
          if (crm.failProfitWrite) return {error:{message:'temporary'}};
          return {data:{organization_id:'org-ready',service_id:'service-long',material_mode:parameters.p_material_mode}};
        }
        if (name === 'get_minuta_notification_workspace') {
          if (crm.mode === 'missing') return {error:{code:'PGRST202',message:'function get_minuta_notification_workspace does not exist'}};
          return {data:crm.payloadFor(parameters.p_organization)};
        }
        if (name === 'retry_notification_outbox') return {data:{ok:true}};
        return {data:{organization_id:parameters?.p_organization || 'org-ready'}};
      },
      storage:{from:()=>({download:async()=>({data:new Blob(['test'])})})}
    };
    window.controllers = {
      records:MinutaClientRecords.createController({db,getContext:()=>crm.context,requireWrites:()=>true}),
      profit:MinutaProfitability.createController({db,escapeHtml,notify:text=>crm.notices.push(text),requireWrites:()=>true,applyWriteAvailability:()=>{}}),
      notifications:MinutaNotificationCenter.createController({db,$:selector=>document.querySelector(selector),escapeHtml,notify:text=>crm.notices.push(text),requireWrites:()=>true})
    };
    controllers.records.bind(); controllers.profit.bind(); controllers.notifications.bind();
  }, mode);
}

async function verifyMissingMigrations(browser) {
  const { page, pageErrors } = await createHarness(browser);
  try {
    await installControllers(page, 'missing');
    await page.evaluate(async () => {
      const visit = {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',at:'2026-09-05T10:00:00+04:00',title:crm.longService,status:'Завершён',payment:'Получено 3 000 ₽'};
      controllers.records.setOrganization({id:'org-legacy'}); controllers.records.setClient({phone:'79999999991',bookings:[visit]});
      await controllers.profit.setOrganization({id:'org-legacy'},{costing_version:null,costing_enabled:false,current_role:'owner',services:[]});
      await controllers.notifications.setOrganization({id:'org-legacy'});
    });
    await page.waitForFunction(() => document.querySelector('.cr-status')?.textContent.includes('пока не подключены'));
    await page.locator('[data-cr-panel="history"]>summary').click();
    assert.match(await page.locator('#clientRecords').innerText(), /История клиента[\s\S]*Очень длинное название услуги/);
    assert.equal(await page.locator('[data-cr-upload]').count(), 0, 'v112 writes must stay unavailable before migration');
    assert.equal(await page.locator('#profitabilityPanel').isHidden(), true, 'v113 panel must stay hidden before migration');
    assert.equal(await page.locator('#unifiedNotificationPanel').isHidden(), true, 'v114 panel must stay hidden before migration');
    assert.equal(await page.locator('#legacyNotifications').isVisible(), true, 'legacy notifications must remain available');
    const names = await page.evaluate(() => crm.calls.map(call => call.name));
    assert.equal(names.includes('get_minuta_profitability_v113'), false, 'v113 read must not run without capability marker');
    assert.equal(names.some(name => /^(create|complete|archive|set|save|enable|retry)_/.test(name)), false, 'fallback must not perform writes');
    assert.deepEqual(pageErrors, []);
  } finally { await page.close(); }
}

async function verifyReadyUi(browser, failures) {
  const { page, pageErrors } = await createHarness(browser);
  try {
    await installControllers(page, 'ready');
    await page.evaluate(async () => {
      controllers.records.setOrganization({id:'org-ready'});
      controllers.records.setClient({phone:'79999999991',bookings:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',at:'2026-09-05T10:00:00+04:00',title:crm.longService,status:'Завершён',payment:'Получено 3 000 ₽ · Долг 1 500 ₽'}]});
      await controllers.profit.setOrganization({id:'org-ready'}, {costing_version:113,costing_enabled:true,current_role:'owner',services:[{id:'service-long',name:crm.longService,active:true}],service_cost_settings:[],usage:[]});
      await controllers.notifications.setOrganization({id:'org-ready'});
    });
    await page.waitForFunction(() => document.querySelector('.cr-files')?.textContent.includes('Подробное_заключение'));
    await page.locator('[data-cr-panel="files"]>summary').click();
    await page.locator('[data-cr-panel="history"]>summary').click();
    assert.equal(await page.locator('[data-unified-channel="sms"]').isDisabled(), true, 'channel without a gateway must be disabled');
    assert.match(await page.locator('[data-unified-channel="sms"]').locator('xpath=..').innerText(), /Шлюз канала не настроен/);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({width,height:1400});
      for (const theme of ['sage','graphite','luxury']) {
        await page.evaluate(theme => { document.body.dataset.providerTheme = theme; }, theme);
        const violations = await page.evaluate(() => {
          const result = [];
          const roots = ['#clientRecords','#profitabilityPanel','#unifiedNotificationPanel'].map(selector => document.querySelector(selector)).filter(Boolean);
          for (const root of roots) {
            if (!root.getClientRects().length) continue;
            if (root.scrollWidth > root.clientWidth + 1) {
              const rootRect = root.getBoundingClientRect();
              const offender = [...root.querySelectorAll('*')].filter(element => element.getClientRects().length)
                .map(element => ({element,rect:element.getBoundingClientRect()}))
                .filter(item => item.rect.right > rootRect.right + 1)
                .sort((a,b) => b.rect.right - a.rect.right)[0];
              result.push(`${root.id}: horizontal overflow ${root.scrollWidth}/${root.clientWidth}${offender ? ` from ${offender.element.id || offender.element.className || offender.element.tagName}` : ''}`);
            }
          }
          const longText = ['.cr-file strong','.cr-event p','.profitability-service-card header strong','.profitability-visit-card header strong','.organization-audit-data-row small'];
          for (const selector of longText) for (const element of document.querySelectorAll(selector)) {
            if (!element.getClientRects().length) continue;
            const style = getComputedStyle(element);
            if (style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none') result.push(`${selector}: truncated`);
            if (element.scrollWidth > element.clientWidth + 1) result.push(`${selector}: clipped ${element.scrollWidth}/${element.clientWidth}`);
          }
          if (innerWidth <= 768) {
            const targets = document.querySelectorAll('#clientRecords button,#clientRecords input,#clientRecords select,#clientRecords textarea,#profitabilityPanel button,#profitabilityPanel input,#profitabilityPanel select,#unifiedNotificationPanel button');
            for (const element of targets) {
              if (!element.getClientRects().length) continue;
              const rect = element.getBoundingClientRect();
              if (rect.width < 44 || rect.height < 44) {
                const label = element.id || element.getAttribute('data-service-material-mode') || element.getAttribute('data-unified-retry') || element.textContent.trim() || element.className || element.tagName;
                result.push(`${label}: touch target ${Math.round(rect.width)}x${Math.round(rect.height)}`);
              }
            }
          }
          return result;
        });
        failures.push(...violations.map(item => `${width}/${theme}: ${item}`));
      }
    }
    if (process.env.MINUTA_CRM_SCREENSHOT_DIR) {
      const screenshotDir = path.resolve(process.env.MINUTA_CRM_SCREENSHOT_DIR);
      fs.mkdirSync(screenshotDir,{recursive:true});
      for (const [width,theme] of [[390,'sage'],[1440,'luxury']]) {
        await page.setViewportSize({width,height:1400});
        await page.evaluate(theme => { document.body.dataset.providerTheme = theme; },theme);
        const screenshotPath = path.join(screenshotDir,`crm-ready-${width}-${theme}.png`);
        await page.screenshot({path:screenshotPath,fullPage:true});
        console.log(`CRM ready screenshot: ${screenshotPath}`);
      }
    }

    await page.evaluate(() => { crm.delayProfitRead = true; });
    await page.locator('#reloadProfitability').click();
    await page.waitForFunction(() => !document.querySelector('#profitabilityLoading').hidden);
    assert.equal(await page.locator('#profitabilityWorkspace').isHidden(), true, 'workspace must hide while recalculating');
    await page.waitForFunction(() => document.querySelector('#profitabilityLoading').hidden);
    await page.evaluate(() => { crm.delayProfitRead = false; crm.mode = 'profit-read-error'; });
    await page.locator('#reloadProfitability').click();
    await page.waitForFunction(() => !document.querySelector('#profitabilityUnavailable').hidden);
    assert.equal(await page.locator('#profitabilityWorkspace').isHidden(), true, 'stale profitability must hide on read error');
    assert.deepEqual(pageErrors, []);
  } finally { await page.close(); }
}

async function verifyProfitabilityWriteRecovery(browser, failures) {
  const { page, pageErrors } = await createHarness(browser);
  try {
    await installControllers(page, 'ready');
    await page.evaluate(async () => {
      await controllers.profit.setOrganization({id:'org-ready'}, {costing_version:113,costing_enabled:true,current_role:'owner',services:[{id:'service-long',name:crm.longService,active:true}],service_cost_settings:[],usage:[]});
      crm.failProfitWrite = true;
    });
    const button = page.locator('[data-service-material-mode]');
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-service-material-mode]')?.textContent === 'Сохраняем…');
    assert.equal(await button.isDisabled(), true, 'profitability action must be disabled while its write is pending');
    await page.waitForFunction(() => crm.notices.some(text => text.includes('Данные не сохранены')));
    if (await button.isDisabled()) failures.push('profitability write error leaves the action permanently disabled');
    assert.deepEqual(pageErrors, []);
  } finally { await page.close(); }
}

async function verifyNotificationOrganizationRace(browser, failures) {
  const { page, pageErrors } = await createHarness(browser);
  try {
    await installControllers(page, 'ready');
    await page.evaluate(() => {
      const original = db.rpc;
      db.rpc = async (name, parameters) => {
        if (name !== 'get_minuta_notification_workspace') return original(name, parameters);
        await new Promise(resolve => setTimeout(resolve, parameters.p_organization === 'org-a' ? 90 : 5));
        return {data:crm.payloadFor(parameters.p_organization)};
      };
    });
    await page.evaluate(async () => {
      const first = controllers.notifications.setOrganization({id:'org-a'});
      await new Promise(resolve => setTimeout(resolve, 10));
      const second = controllers.notifications.setOrganization({id:'org-b'});
      await Promise.all([first, second]);
    });
    const text = await page.locator('#unifiedNotificationDeliveries').innerText();
    if (!text.includes('org-b') || text.includes('org-a')) failures.push('late v114 response from org-a replaces current org-b notification data');
    assert.deepEqual(pageErrors, []);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.MINUTA_BROWSER_CHANNEL ? {channel:process.env.MINUTA_BROWSER_CHANNEL} : {})});
  const failures = [];
  try {
    await verifyMissingMigrations(browser);
    await verifyReadyUi(browser, failures);
    await verifyProfitabilityWriteRecovery(browser, failures);
    await verifyNotificationOrganizationRace(browser, failures);
    assert.deepEqual(failures, [], `CRM integration regressions:\n${failures.join('\n')}`);
    console.log('CRM integration: fallback safety, v112/v113/v114 states, 12 responsive/theme cases and organization isolation passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
