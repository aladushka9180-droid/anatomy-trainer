import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwrightModule = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = playwrightModule.default || playwrightModule;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_SMART_DELIVERY_OUTPUT || '';
if (output) fs.mkdirSync(output, { recursive:true });

const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
  response.writeHead(200, { 'content-type':`${type}; charset=utf-8`, 'cache-control':'no-store' }).end(content);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html?section=notifications`);
  await page.addScriptTag({ path:path.join(root, 'notification-center.js') });
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot').hidden = true;
    document.querySelectorAll('.provider-view').forEach(view => { view.hidden = view.dataset.providerPanel !== 'notifications'; });
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#unifiedNotificationPanel').hidden = false;
    window.MINUTA_CONFIG = { supabaseUrl:'https://status.test', supabaseKey:'public-test-key' };
    window.fetch = async () => ({ ok:true, json:async () => ({ ok:true, configured_channels:['telegram'], provider_telegram_fallback:false }) });
    const base = {
      organization_id:'organization-a', current_role:'owner',
      settings:{ organization_id:'organization-a', enabled:true, booking_created_enabled:true, booking_confirmed_enabled:true,
        booking_confirmation_request_enabled:false, booking_rescheduled_enabled:true, booking_cancelled_enabled:true,
        booking_reminder_enabled:true, reminder_minutes_before:1440, confirmation_request_minutes_before:1440 },
      channels:['telegram','max','sms','email','push'].flatMap(channel => ['provider','client'].map(audience => ({ organization_id:'organization-a', audience, channel, enabled:channel === 'telegram' && audience === 'provider' }))),
      endpoints:[{ audience:'provider', subject_key:'user-a', channel:'telegram', active:true, configured:true }],
      outbox:[
        { id:'failed-a', performer_id:'user-a', kind:'booking_reminder', audience:'client', channel:'telegram', status:'failed', attempts:2, last_error:'gateway_timeout', context:{ client_name:'Очень длинное имя клиента для проверки русской строки', service_name:'Комплексная услуга', booking_date:'2026-09-16', booking_time:'10:30' } },
        { id:'pending-a', performer_id:'user-a', kind:'booking_confirmed', audience:'client', channel:'telegram', status:'pending', attempts:0, context:{ client_name:'Анна', service_name:'Массаж', booking_date:'2026-09-17', booking_time:'12:00' } },
        { id:'sent-a', performer_id:'user-a', kind:'booking_created', audience:'provider', channel:'telegram', status:'sent', attempts:1, delivered_at:'2026-09-15T10:00:00Z', context:{ client_name:'Ирина' } }
      ]
    };
    window.testWorkspace = structuredClone(base);
    window.testRpcCalls = [];
    const db = {
      auth:{ getUser:async () => ({ data:{ user:{ id:'user-a' } } }) },
      rpc:async (name, args) => {
        window.testRpcCalls.push({ name, args });
        if (name === 'set_minuta_notification_channel') {
          const row = window.testWorkspace.channels.find(item => item.audience === args.p_audience && item.channel === args.p_channel);
          if (row) row.enabled = args.p_enabled;
        }
        if (name === 'set_minuta_notification_master') window.testWorkspace.settings.enabled = args.p_enabled;
        if (name === 'retry_notification_outbox') return { data:'pending', error:null };
        return { data:structuredClone(window.testWorkspace), error:null };
      }
    };
    window.smartController = window.MinutaNotificationCenter.createController({
      db, $:selector => document.querySelector(selector),
      escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
      notify:message => { window.testNotification = message; }, requireWrites:() => true
    });
    window.smartController.bind();
  });

  const cases = [
    { width:390, height:844, theme:'warm', mode:'full' },
    { width:760, height:900, theme:'cocoa-pearl', mode:'partial' },
    { width:1440, height:950, theme:'oled-mono', mode:'empty' }
  ];
  for (const item of cases) {
    await page.setViewportSize({ width:item.width, height:item.height });
    await page.evaluate(async ({ theme, mode }) => {
      document.body.dataset.providerTheme = theme;
      if (mode === 'partial') window.testWorkspace.endpoints = [];
      if (mode === 'empty') window.testWorkspace.outbox = [];
      await window.smartController.setOrganization({ id:'organization-a' });
    }, item);
    await page.locator('#smartDeliveryTitle').waitFor({ state:'attached' });
    const visibility = await page.locator('#smartDeliveryTitle').evaluate(element => ({
      visible:Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length),
      hiddenAncestors:[...function * ancestors(node) { for (let current = node; current; current = current.parentElement) if (current.hidden) yield current.id || current.className || current.tagName; }(element)]
    }));
    assert.equal(visibility.visible, true, `${item.width}: smart delivery hidden by ${visibility.hiddenAncestors.join(', ') || 'CSS'}`);
    await page.locator('#saveUnifiedNotifications').scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const channelTab = document.querySelector('[data-unified-tab="channels"]');
      const tabBox = channelTab.getBoundingClientRect();
      const tabStyle = getComputedStyle(channelTab);
      return {
        overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
        saveVisible:document.querySelector('#saveUnifiedNotifications').getBoundingClientRect().bottom <= innerHeight + 1,
        tabCount:document.querySelectorAll('[data-unified-tab]').length,
        tabWidth:tabBox.width,
        tabGeometry:`${tabBox.width}x${tabBox.height}/${tabStyle.display}/${tabStyle.visibility}`,
        proCount:[...document.querySelectorAll('.smart-event-row em')].filter(item => item.textContent.includes('Pro')).length
      };
    });
    assert.ok(geometry.overflow <= 1, `${item.width}: horizontal overflow ${geometry.overflow}`);
    assert.equal(geometry.saveVisible, true, `${item.width}: save action must stay visible`);
    assert.equal(geometry.tabCount, 3);
    assert.ok(geometry.tabWidth > 0, `${item.width}: channel tab geometry ${geometry.tabGeometry}`);
    assert.equal(geometry.proCount, 3);
    if (output && item.mode === 'full') await page.locator('#unifiedNotificationPanel').screenshot({ path:path.join(output, `smart-delivery-events-${item.theme}-${item.width}.png`) });
    await page.locator('[data-unified-tab="channels"]').click();
    assert.match(await page.locator('#unifiedNotificationChannels').textContent(), /WhatsApp[\s\S]*Недоступен[\s\S]*VK[\s\S]*Недоступен/);
    if (output && item.mode === 'full') await page.locator('#unifiedNotificationPanel').screenshot({ path:path.join(output, `smart-delivery-channels-${item.theme}-${item.width}.png`) });
    await page.locator('[data-unified-tab="deliveries"]').click();
    await page.locator('[data-unified-delivery-filter="all"]').click();
    if (item.mode === 'empty') assert.match(await page.locator('#unifiedNotificationDeliveries').textContent(), /пока пусто/);
    else assert.match(await page.locator('#unifiedNotificationDeliveries').textContent(), /Telegram/);
    if (output) await page.screenshot({ path:path.join(output, `smart-delivery-${item.theme}-${item.width}.png`), fullPage:true });
  }

  await page.evaluate(async () => {
    window.testWorkspace.endpoints = [{ audience:'provider', subject_key:'user-a', channel:'telegram', active:true, configured:true }];
    await window.smartController.setOrganization({ id:'organization-a' });
  });
  await page.locator('[data-unified-tab="channels"]').click();
  const providerTelegram = page.locator('[data-unified-channel="telegram"][data-unified-audience="provider"]');
  await providerTelegram.uncheck();
  assert.equal(await page.locator('#saveUnifiedNotifications').isEnabled(), true);
  await page.locator('#saveUnifiedNotifications').click();
  await page.waitForFunction(() => window.testNotification === 'Настройки доставки сохранены');
  const writes = await page.evaluate(() => window.testRpcCalls.filter(call => call.name.startsWith('set_minuta_notification_')).map(call => call.name));
  assert.deepEqual(writes, ['set_minuta_notification_channel']);
  assert.equal(await page.locator('#saveUnifiedNotifications').isEnabled(), false);
  console.log('PrimeTime Pro smart delivery browser: PASS at 390/760/1440 in light and dark themes');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
