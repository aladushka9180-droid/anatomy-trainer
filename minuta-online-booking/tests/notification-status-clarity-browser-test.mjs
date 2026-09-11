import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const source = readFileSync(new URL('../notification-center.js', import.meta.url), 'utf8');
const providerHtml = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const styleFiles = [...providerHtml.matchAll(/<link rel="stylesheet" href="([^"?]+)(?:\?[^" ]*)?"/g)].map(match => match[1]);
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const browserErrors = [];

try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.setContent('<!doctype html><html lang="ru"><body class="provider-body" data-provider-theme="warm" data-provider-layout="soft"></body></html>');
  await page.evaluate(html => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const panel = parsed.querySelector('#unifiedNotificationPanel');
    panel.open = true;
    document.body.append(document.importNode(panel, true));
  }, providerHtml);
  for (const file of styleFiles) await page.addStyleTag({ content:readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') });
  await page.addScriptTag({ content:source });
  await page.evaluate(async () => {
    window.MINUTA_CONFIG = { supabaseUrl:'https://status.test', supabaseKey:'public-test-key' };
    window.fetch = async () => ({ ok:true, json:async () => ({ ok:true, configured_channels:['telegram','email'] }) });
    const base = { performer_id:'owner', audience:'client', context:{ client_name:'Ирина', service_name:'Массаж', booking_date:'2026-09-09', booking_time:'14:00' } };
    const outbox = [
      { ...base, id:'primary', kind:'booking_confirmation_request', channel:'telegram', status:'failed', attempts:2, last_error:'gateway_timeout', created_at:'2026-09-09T10:00:00Z', updated_at:'2026-09-09T10:03:00Z' },
      { ...base, id:'fallback', kind:'booking_confirmation_request', channel:'email', status:'sent', attempts:1, sent_at:'2026-09-09T10:04:00Z', fallback_of:'primary', fallback_depth:1, created_at:'2026-09-09T10:03:10Z' },
      { ...base, id:'delivered', kind:'booking_reminder', channel:'email', status:'sent', attempts:1, sent_at:'2026-09-09T11:00:00Z', delivered_at:'2026-09-09T11:01:00Z', created_at:'2026-09-09T10:59:00Z' },
      { ...base, id:'pending', kind:'booking_created', channel:'telegram', status:'pending', attempts:0, next_attempt_at:'2026-09-09T12:30:00Z', created_at:'2026-09-09T12:00:00Z' },
      { ...base, id:'unknown', kind:'booking_cancelled', channel:'telegram', status:'failed', attempts:1, last_error_code:'telegram_delivery_unknown', created_at:'2026-09-09T13:00:00Z' },
      { ...base, id:'cancelled', kind:'booking_reminder', channel:'telegram', status:'cancelled', attempts:0, last_error:'Событие устарело после переноса записи', created_at:'2026-09-09T13:30:00Z' }
    ];
    const db = {
      auth:{ getUser:async () => ({ data:{ user:{ id:'owner' } } }) },
      rpc:async name => name === 'get_minuta_notification_workspace'
        ? { data:{ organization_id:'organization-a', current_role:'owner', settings:{ organization_id:'organization-a', enabled:true }, channels:[], endpoints:[], outbox }, error:null }
        : { data:null, error:null }
    };
    window.controller = MinutaNotificationCenter.createController({
      db,
      $:selector => document.querySelector(selector),
      escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
      notify:() => {}, requireWrites:() => true
    });
    controller.bind();
    await controller.setOrganization({ id:'organization-a' });
  });

  const content = await page.locator('#unifiedNotificationDeliveries').textContent();
  assert.match(content, /Запрос подтверждения записи/);
  assert.match(content, /передано каналу/);
  assert.match(content, /Подтверждения доставки нет/);
  assert.match(content, /доставлено/);
  assert.match(content, /Подтверждено каналом/);
  assert.match(content, /Резервный канал после Telegram/);
  assert.match(content, /Попыток: 0/);
  assert.match(content, /нужна проверка/);
  assert.match(content, /Проверьте чат вручную/);
  assert.match(content, /отменено/);
  assert.match(content, /Событие устарело после переноса записи/);
  assert.doesNotMatch(content, /отправлено/);
  assert.equal(await page.locator('[data-unified-retry="primary"]').count(), 1);
  assert.equal(await page.locator('[data-unified-retry="unknown"]').count(), 0);
  await page.locator('#unifiedNotificationDeliveries').evaluate(node => { node.closest('details').open = true; });
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    const geometry = await page.locator('#unifiedNotificationPanel').evaluate(panel => ({
      left:panel.getBoundingClientRect().left,
      right:panel.getBoundingClientRect().right,
      viewport:innerWidth,
      overflow:document.documentElement.scrollWidth > innerWidth + 2
    }));
    assert.equal(geometry.overflow, false, `${width}px notification center must not overflow`);
    assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, `${width}px notification panel must stay in viewport`);
    if (process.env.MINUTA_NOTIFICATION_SCREENSHOT) await page.screenshot({ path:`${process.env.MINUTA_NOTIFICATION_SCREENSHOT}-${width}.png`, fullPage:true });
  }
  assert.deepEqual(browserErrors, []);
  await page.close();
  console.log('Notification status clarity: accepted, delivered, attempts, fallback and unknown delivery PASS');
} finally {
  await browser.close();
}
