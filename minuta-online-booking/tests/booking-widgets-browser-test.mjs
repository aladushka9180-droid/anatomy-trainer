import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const ids = {
  org:'11111111-1111-4111-8111-111111111111',
  service:'22222222-2222-4222-8222-222222222222',
  otherService:'23232323-2323-4232-8232-232323232323',
  performer:'33333333-3333-4333-8333-333333333333',
  otherPerformer:'34343434-3434-4343-8343-343434343434',
  branch:'44444444-4444-4444-8444-444444444444',
  otherBranch:'45454545-4545-4454-8454-454545454545',
  group:'55555555-5555-4555-8555-555555555555',
  fullGroup:'56565656-5656-4656-8656-565656565656',
  foreign:'66666666-6666-4666-8666-666666666666'
};
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,10);
const catalog = {
  organization:{ id:ids.org, name:'Студия PrimeTime' }, resource_scheduling:true, branch_shift_scheduling:true,
  client_page:{ theme_key:'sage', headline_key:'massage-time' },
  locations:[{ id:ids.branch, name:'Центр', is_primary:true }, { id:ids.otherBranch, name:'Север' }],
  services:[
    { id:ids.service, performer_id:ids.performer, name:'Массаж', duration_minutes:60, price_rub:1500, location_ids:[ids.branch], performer_profiles:{ display_name:'Анна' } },
    { id:ids.otherService, performer_id:ids.otherPerformer, name:'Уход', duration_minutes:45, price_rub:1200, location_ids:[ids.otherBranch], performer_profiles:{ display_name:'Ирина' } }
  ]
};
const groups = { enabled:true, events:[
  { id:ids.group, title:'Здоровая спина', description:'Группа', event_date:tomorrow, start_time:'18:00:00', duration_minutes:60, capacity:8, seats_taken:2, seats_left:6, location_name:'Центр', location_address:'Главная, 1', performer_name:'Анна' },
  { id:ids.fullGroup, title:'Заполненная группа', description:'Группа', event_date:tomorrow, start_time:'20:00:00', duration_minutes:60, capacity:8, seats_taken:8, seats_left:0, location_name:'Центр', location_address:'Главная, 1', performer_name:'Анна' }
] };
const originalHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const html = originalHtml.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>[\s\S]*?<\/script>/gi,
  (tag, src) => /^(?:vendor\/supabase[^/]*\.js|booking-widgets\.js|theme-catalog\.js|config\.js|group-bookings\.js|app\.js)(?:\?|$)/.test(src) ? tag : '');
const providerFixtureHtml = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const calls = [];
const unexpected = [];
const output = process.env.MINUTA_WIDGET_OUTPUT ? resolve(process.env.MINUTA_WIDGET_OUTPUT) : '';
if (output) mkdirSync(output, { recursive:true });
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json' };
let appOrigin = '';

function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type':'application/json', 'cache-control':'no-store' });
  response.end(JSON.stringify(value));
}
function rpc(name, args, response) {
  calls.push({ name, args });
  if (['get_public_minuta_catalog_v5','get_public_minuta_catalog_v4'].includes(name)) return json(response, catalog);
  if (name === 'get_public_minuta_group_events') return args.p_slug === 'group-error'
    ? json(response, { code:'XX000', message:'group fixture failure' }, 500)
    : json(response, groups);
  if (name === 'get_public_minuta_available_slots_v101') return json(response, [{ booking_date:tomorrow, booking_time:'10:00:00' }]);
  if (['track_public_booking_funnel_event','upsert_public_booking_presence'].includes(name)) return json(response, true);
  if (name === 'get_public_booking_reviews') return json(response, []);
  unexpected.push(`RPC ${name}`);
  return json(response, { code:'PGRST202', message:`function ${name} does not exist` }, 404);
}
const appServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, appOrigin);
    if (url.pathname === '/auth/v1/settings') return json(response, { external:{ phone:false } });
    if (request.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      return rpc(url.pathname.split('/').at(-1), JSON.parse(Buffer.concat(chunks).toString() || '{}'), response);
    }
    if (request.method !== 'GET') throw new Error(`Unexpected method ${request.method}`);
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith('/minuta-online-booking/') || pathname.includes('\\') || pathname.split('/').includes('..')) throw new Error('Disallowed URL');
    const relative = pathname.slice('/minuta-online-booking/'.length) || 'index.html';
    const target = resolve(root, relative);
    if (!target.startsWith(root + sep)) throw new Error('Path escapes fixture root');
    if (relative === 'config.js') {
      response.writeHead(200, { 'content-type':'text/javascript' });
      return response.end(`window.MINUTA_CONFIG=${JSON.stringify({ supabaseUrl:appOrigin, supabaseKey:'fixture-anon-key', defaultOrganizationSlug:'' })};`);
    }
    const body = relative === 'index.html' ? html : relative === 'provider-fixture.html' ? providerFixtureHtml : readFileSync(target);
    response.writeHead(200, { 'content-type':relative === 'index.html' ? mime['.html'] : mime[extname(target)] || 'application/octet-stream', 'cache-control':'no-store' });
    response.end(body);
  } catch (error) {
    unexpected.push(`${request.method} ${request.url}: ${error.message}`);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});
await new Promise(resolveReady => appServer.listen(0, '127.0.0.1', resolveReady));
appOrigin = `http://127.0.0.1:${appServer.address().port}`;

let hostOrigin = '';
let hostSnippet = '';
const hostServer = createServer((request, response) => {
  response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>External host</title><style>html,body{margin:0}iframe{display:block}</style><script>window.messages=[];addEventListener('message',event=>window.messages.push(event.data))</script>${hostSnippet}`);
});
await new Promise(resolveReady => hostServer.listen(0, '127.0.0.1', resolveReady));
hostOrigin = `http://127.0.0.1:${hostServer.address().port}`;

let browser;
try {
  browser = await chromium.launch({ headless:true });
  const context = await browser.newContext({ serviceWorkers:'block', reducedMotion:'reduce' });
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if (origin === appOrigin || origin === hostOrigin) return route.continue();
    unexpected.push(`External ${route.request().url()}`);
    return route.abort();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(15000);

  await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=studio-one&service=${ids.service}&utm_source=primetime&utm_medium=shared_link&utm_campaign=booking_link&utm_content=service`);
  await page.locator('.step[data-step="2"].active').waitFor();
  assert.equal(await page.locator(`[data-service="${ids.service}"]`).getAttribute('aria-pressed'), 'true');
  const serviceTrack = calls.find(call => call.name === 'track_public_booking_funnel_event' && call.args.p_event === 'page_opened');
  assert.equal(serviceTrack?.args.p_utm_source, 'primetime');
  assert.equal(serviceTrack?.args.p_utm_content, 'service');
  for (const source of ['yandex','google']) {
    const beforeCalls = calls.length;
    await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=studio-one&utm_source=${source}&utm_medium=maps&utm_campaign=maps_booking_general&utm_content=general`);
    await page.locator('[data-service]').first().waitFor();
    const mapTrack = calls.slice(beforeCalls).find(call => call.name === 'track_public_booking_funnel_event' && call.args.p_event === 'page_opened');
    assert.equal(mapTrack?.args.p_source_kind, 'search');
    assert.equal(mapTrack?.args.p_utm_source, source);
    assert.equal(mapTrack?.args.p_utm_medium, 'maps');
    assert.equal(mapTrack?.args.p_utm_campaign, 'maps_booking_general');
    assert.equal(mapTrack?.args.p_utm_content, 'general');
  }
  hostSnippet = await page.evaluate(({ appOrigin, service }) => {
    const url = window.MinutaBookingWidgets.buildUrl(`${appOrigin}/minuta-online-booking/index.html`, { slug:'studio-one', target:'service', id:service, mode:'widget', source:'website' });
    return window.MinutaBookingWidgets.embedCode(url, 'Онлайн-запись');
  }, { appOrigin, service:ids.service });

  await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=studio-one&provider=${ids.performer}`);
  await page.locator(`[data-service="${ids.service}"]`).waitFor();
  assert.equal(await page.locator(`[data-service="${ids.service}"]`).count(), 1);
  assert.equal(await page.locator(`[data-service="${ids.otherService}"]`).count(), 0);

  await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=studio-one&location=${ids.otherBranch}`);
  await page.locator('#locationSelect').waitFor();
  assert.equal(await page.locator('#locationSelect').inputValue(), ids.otherBranch);
  assert.equal(await page.locator(`[data-service="${ids.otherService}"]`).count(), 1);
  assert.equal(await page.locator(`[data-service="${ids.service}"]`).count(), 0);

  await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=studio-one&group=${ids.group}`);
  await page.locator('#publicGroupBookingDialog').waitFor({ state:'visible' });
  assert.match(await page.locator('#publicGroupBookingTitle').innerText(), /Здоровая спина/);

  for (const groupId of [ids.fullGroup, ids.foreign]) {
    await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=studio-one&group=${groupId}`);
    await page.locator('.empty-service').waitFor();
    assert.equal(await page.locator('#publicGroupEvents').isHidden(), true);
    assert.equal(await page.locator('#publicGroupBookingDialog').isVisible(), false);
  }
  await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=group-error&group=${ids.group}`);
  await page.locator('.empty-service').waitFor();
  assert.equal(await page.locator('#publicGroupEvents').isHidden(), true);
  assert.equal(await page.locator('#publicGroupBookingDialog').isVisible(), false);

  await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=studio-one&service=${ids.foreign}`);
  await page.locator('.empty-service').waitFor();
  assert.match(await page.locator('.empty-service').innerText(), /недоступны для этой организации/);
  assert.equal(await page.locator('#toDate').isDisabled(), true);

  await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=studio-one&provider=${ids.performer}&location=${ids.otherBranch}`);
  await page.locator('.empty-service').waitFor();
  assert.match(await page.locator('.empty-service').innerText(), /недоступны для этой организации/);

  await page.goto(`${appOrigin}/minuta-online-booking/index.html?org=BAD_SLUG&service=${ids.service}`);
  await page.locator('.empty-service').waitFor();
  assert.match(await page.locator('.empty-service').innerText(), /Проверьте адрес ссылки/);

  for (const width of [390,760,1440]) {
    await page.setViewportSize({ width, height:900 });
    await page.goto(`${hostOrigin}/`);
    const frame = page.frameLocator('[data-primetime-booking-widget]');
    try {
      await frame.locator('.step[data-step="2"].active').waitFor();
    } catch (error) {
      console.error('embed diagnostic', await frame.locator('body').innerText().catch(() => ''), pageErrors, unexpected);
      throw error;
    }
    assert.equal(await frame.locator('.booking-client-header').isVisible(), false);
    assert.equal(await frame.locator('.client-hero').isVisible(), false);
    assert.equal(await frame.locator('.booking-faq').isVisible(), false);
    assert.equal(await frame.locator('html').evaluate(element => element.scrollWidth > element.clientWidth), false);
    await page.waitForFunction(() => window.messages.some(message => message?.type === 'primetime:ready'));
    assert.ok(await page.evaluate(() => window.messages.every(message => Object.keys(message).every(key => ['type','height'].includes(key)))));
    await page.waitForFunction(() => document.querySelector('[data-primetime-booking-widget]')?.style.height !== '720px');
    if (output) await page.screenshot({ path:resolve(output, `embed-${width}.png`), fullPage:true });
  }
  assert.deepEqual(pageErrors, []);

  await page.goto(`${appOrigin}/minuta-online-booking/provider-fixture.html`);
  await page.addScriptTag({ url:`${appOrigin}/minuta-online-booking/booking-widgets.js` });
  await page.evaluate(({ catalog, groups }) => {
    document.documentElement.classList.remove('provider-booting');
    document.documentElement.classList.add('top-level');
    const card = document.querySelector('#clientAppearanceSettingsCard');
    const dialog = document.querySelector('#bookingWidgetsDialog');
    const toast = document.querySelector('#toast');
    document.body.replaceChildren(card, dialog, toast);
    document.body.style.display = 'block';
    document.body.style.padding = '18px';
    card.hidden = false;
    card.style.maxWidth = '980px';
    card.style.margin = '0 auto';
    window.fixtureController = window.MinutaBookingWidgets.createProviderController({
      $:selector => document.querySelector(selector),
      notify:message => { toast.textContent = message; },
      getAppearance:() => ({ theme_key:'sage', headline_key:'massage-time' }),
      getContext:async () => ({ organizationSlug:'studio-one', services:catalog.services, locations:catalog.locations, groups:groups.events })
    });
    window.fixtureController.bind();
  }, { catalog, groups });
  await page.locator('#openBookingWidgets').click();
  await page.locator('#bookingWidgetsDialog').waitFor({ state:'visible' });
  for (const [source,label] of [['yandex','Яндекс Карты'],['google','Google Карты']]) {
    await page.locator('#bookingWidgetSource').selectOption(source);
    const generated = new URL(await page.locator('#bookingWidgetOutput').inputValue());
    assert.equal(generated.searchParams.get('utm_source'), source);
    assert.equal(generated.searchParams.get('utm_medium'), 'maps');
    assert.equal(generated.searchParams.get('utm_campaign'), 'maps_booking_general');
    assert.match(await page.locator('#bookingWidgetStatus').innerText(), new RegExp(label));
  }
  for (const width of [390,760,1440]) {
    await page.setViewportSize({ width, height:900 });
    assert.equal(await page.locator('#bookingWidgetsDialog').evaluate(element => element.scrollWidth > element.clientWidth), false);
    const box = await page.locator('#bookingWidgetsDialog').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
    if (output) await page.screenshot({ path:resolve(output, `provider-link-${width}.png`), fullPage:true });
  }
  await page.locator('#bookingWidgetSource').selectOption('telegram');
  for (const [target,id,parameter] of [['service',ids.otherService,'service'],['provider',ids.otherPerformer,'provider'],['branch',ids.otherBranch,'location'],['group',ids.group,'group']]) {
    await page.locator('#bookingWidgetTarget').selectOption(target);
    await page.locator('#bookingWidgetItem').selectOption(id);
    assert.equal(await page.locator('#bookingWidgetItem').inputValue(), id);
    const generated = new URL(await page.locator('#bookingWidgetOutput').inputValue());
    assert.equal(generated.searchParams.get(parameter), id);
    assert.equal(generated.searchParams.get('utm_source'), 'telegram');
    assert.equal(generated.searchParams.get('utm_campaign'), `booking_link_${target}_${id}`);
  }
  await page.locator('#bookingWidgetTarget').selectOption('group');
  assert.equal(await page.locator(`#bookingWidgetItem option[value="${ids.fullGroup}"]`).count(), 0);
  await page.locator('#bookingWidgetTarget').selectOption('service');
  await page.locator('#bookingWidgetItem').selectOption(ids.otherService);
  await page.locator('#bookingWidgetSource').selectOption('yandex');
  await page.locator('[data-booking-widget-mode="widget"]').click();
  assert.equal(await page.locator('#bookingWidgetSource').inputValue(), 'website');
  assert.equal(await page.locator('#bookingWidgetSource option[value="yandex"]').evaluate(option => option.disabled), true);
  assert.equal(await page.locator('#bookingWidgetSource option[value="google"]').evaluate(option => option.disabled), true);
  assert.match(await page.locator('#bookingWidgetCode').inputValue(), /<iframe/);
  assert.match(await page.locator('#bookingWidgetCode').inputValue(), /primetime:resize/);
  assert.match(await page.locator('#bookingWidgetCode').inputValue(), /allow-same-origin/);
  assert.equal(await page.locator('#bookingWidgetPreview').evaluate(element => element.tagName), 'DIV');
  assert.match(await page.locator('#bookingWidgetPreview').innerText(), /онлайн-запись/i);
  for (const width of [390,760,1440]) {
    await page.setViewportSize({ width, height:900 });
    assert.equal(await page.locator('#bookingWidgetsDialog').evaluate(element => element.scrollWidth > element.clientWidth), false);
    assert.equal(await page.locator('#bookingWidgetPreview').evaluate(element => element.scrollWidth > element.clientWidth), false);
    if (output) await page.screenshot({ path:resolve(output, `provider-widget-${width}.png`), fullPage:true });
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpected, []);
  await context.close();
  console.log('booking widgets browser checks passed');
} finally {
  await browser?.close();
  await new Promise(resolveDone => appServer.close(resolveDone));
  await new Promise(resolveDone => hostServer.close(resolveDone));
}
