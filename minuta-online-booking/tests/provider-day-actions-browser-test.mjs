import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Isolated HTML/CSS fixture. No provider runtime, authentication or database traffic.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'provider.html'), 'utf8');
const fixture = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i, '');
const types = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/fixture') { response.writeHead(200, { 'Content-Type':'text/html' }); response.end(fixture); return; }
  const file = resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`)) { response.writeHead(403); response.end(); return; }
  if (!types[extname(file)] || !existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type':types[extname(file)] }); response.end(readFileSync(file));
});
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath:process.env.BROWSER_EXECUTABLE } : {}) });
let checks = 0;
const output = process.env.OUTPUT_DIR;
if (output) mkdirSync(output, { recursive:true });
async function setup(width = 390, theme = 'pink-porcelain') {
  const page = await browser.newPage({ viewport:{ width, height:1050 } });
  await page.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  await page.goto(`${origin}/fixture`);
  const motionStyle = await page.addStyleTag({ content:'.provider-body #dashboard #dateStrip>button,*,*::before,*::after { transition:none!important; animation:none!important; }' });
  await motionStyle.evaluate(element => document.body.append(element));
  await page.addScriptTag({ content:readFileSync(join(root, 'theme-catalog.js'), 'utf8') });
  await page.evaluate(themeKey => {
    document.documentElement.className = '';
    document.querySelector('#providerBoot').remove();
    const palette = window.MinutaThemeCatalog.theme(themeKey).palette;
    const names = { surfaceAlt:'surface-alt', accentSoft:'accent-soft', contrast:'accent-contrast' };
    for (const [name, value] of Object.entries(palette)) document.body.style.setProperty(`--theme-${names[name] || name}`, value);
    Object.assign(document.body.dataset, { providerTheme:themeKey, providerLayout:'default', providerResolvedColorMode:palette.dark ? 'dark' : 'light' });
    const dashboard = document.querySelector('#dashboard'); dashboard.hidden = false; dashboard.dataset.activeView = 'bookings';
    document.querySelector('#todayLabel').textContent = 'понедельник, 5 октября';
    document.querySelector('#currentTimeLabel').textContent = '10:50';
    document.querySelector('#tomorrowBookingsCount').textContent = '1';
    document.querySelector('#newBookingsCount').textContent = '2';
    document.querySelector('#mobileTomorrowBookingsCount').textContent = '1';
    document.querySelector('#mobileUpcomingBookingsCount').textContent = '2';
    document.querySelector('#scheduleMobileSummary').hidden = false;
    document.querySelector('.booking-filters').hidden = true;
    document.querySelector('.schedule-date-picker input').value = '2026-10-05';
    document.querySelector('#upcomingBookingsLabel').textContent = 'Предстоящих записей';
    document.querySelector('#selectedDateSummary').textContent = 'Выходной';
    document.querySelector('.selected-date-title-mobile').textContent = 'Понедельник';
    const context = document.querySelector('.schedule-context');
    const navigation = context.querySelector('.date-navigation');
    const tabs = context.querySelector('.calendar-view-toggle');
    const strip = context.querySelector('.date-strip-frame');
    // DOM order used by the production syncCompactScheduleOrder for this viewport.
    if (innerWidth <= 760) { context.insertBefore(tabs, navigation); context.insertBefore(strip, navigation); }
    else { navigation.prepend(tabs); navigation.after(strip); }
    document.querySelector('#dateStrip').innerHTML = Array.from({ length:9 }, (_, index) => `<button type="button" data-date-distance="${Math.abs(index - 4)}" class="${index === 4 ? 'active' : ''}"><span>${['Чт','Пт','Сб','Вс','Пн','Вт','Ср','Чт','Пт'][index]}</span><strong>${index + 1}</strong><small>окт</small></button>`).join('');
    const holder = document.querySelector('#providerBookings'); holder.className = 'provider-bookings timeline-view';
    holder.innerHTML = '<div class="provider-empty schedule-empty"><strong>Выходной</strong><small>Запись на этот день закрыта.</small></div>';
  }, theme);
  return page;
}
async function install(page) {
  const style = await page.addStyleTag({ content:readFileSync(join(root, 'provider-day-actions.css'), 'utf8') });
  await style.evaluate(element => document.body.append(element));
  await page.addScriptTag({ content:readFileSync(join(root, 'provider-day-actions.js'), 'utf8') });
  await page.evaluate(() => {
    const state = window.dayTest = {
      context:{ userId:'test-user', organizationId:'test-org', locationId:'test-location', date:'2026-10-05', timeZone:'Europe/Samara' },
      canWrite:true, saves:[], resolutions:[], actions:[], refreshes:[], behaviour:'success', loadDate:'2026-10-05'
    };
    const result = payload => ({ confirmed:true, date:payload.date, requestId:payload.requestId });
    const ports = window.dayPorts = {
      getContext:() => state.context,
      canWrite:() => state.canWrite,
      loadDay:async () => ({ date:state.loadDate, start:'09:00', end:'18:00', onlineEnabled:false, revision:'test-revision-1', pendingHours:state.pendingHours }),
      saveHours:async (context, payload) => {
        state.saves.push({ context,payload });
        if (state.behaviour === 'pending') return new Promise(resolve => { state.finish = () => resolve(result(payload)); });
        if (state.behaviour === 'unknown') { state.pendingHours=payload; return {}; }
        if (state.behaviour === 'collision') return { notApplied:true, date:payload.date, requestId:payload.requestId };
        return result(payload);
      },
      resolveHours:async (context, requestId) => {
        state.resolutions.push({ context,requestId });
        state.pendingHours=null;
        return result(state.saves.find(entry => entry.payload.requestId === requestId).payload);
      },
      openAppointment:async (context, options) => state.actions.push({ kind:'booking',context,options }),
      openBlockedTime:async (context, options) => state.actions.push({ kind:'block',context,options }),
      refresh:async context => state.refreshes.push(context)
    };
    const controller = window.dayController = window.PrimeTimeProviderDayActions.create(ports);
    const holder = document.querySelector('#providerBookings');
    holder.innerHTML = controller.markup({ date:state.context.date, label:'Выходной' });
    controller.attach(holder); controller.attach(holder);
  });
}
const beforeSelectors = ['[data-date-today]', '#todayBookingsCount', '#tomorrowBookingsCount', '#newBookingsCount', '[data-calendar-view="day"]', '[data-calendar-view="week"]', '[data-calendar-view="month"]', '[data-journal-mode="timeline"]', '[data-journal-mode="list"]'];
const chrome = page => page.evaluate(selectors => selectors.map(selector => {
  const element = document.querySelector(selector); if (!element) return { selector, missing:true };
  return { selector, text:element.textContent, display:getComputedStyle(element).display, color:getComputedStyle(element).color, bounds:element.getBoundingClientRect().toJSON() };
}), beforeSelectors);
try {
  for (const width of [390,760,1440]) {
    const page = await setup(width);
    const before = await chrome(page);
    assert.ok(before.every(item => !item.missing), 'fixture retains original schedule controls');
    if (output) await page.screenshot({ path:join(output, `before-${width}.png`), fullPage:true });
    await install(page);
    assert.deepEqual(await chrome(page), before, `${width}: schedule chrome remains unchanged`);
    const metrics = await page.evaluate(() => {
      const active = document.querySelector('#dateStrip>button.active');
      return {
        scroll:document.documentElement.scrollWidth, width:document.documentElement.clientWidth,
        dateColor:getComputedStyle(active.querySelector('strong')).color,
        ink:getComputedStyle(document.body).getPropertyValue('--theme-ink').trim(),
        dateFill:getComputedStyle(active).backgroundColor,
        primaryFill:getComputedStyle(document.querySelector('.schedule-day-primary')).backgroundColor,
        secondaryRows:[...document.querySelectorAll('.schedule-day-secondary-action')].map(element => element.getBoundingClientRect().top),
        dateRules:[...document.styleSheets].flatMap(sheet => {
          const visit = rules => [...rules].flatMap(rule => {
            let own = [];
            try { if (rule.selectorText && active.matches(rule.selectorText) && (rule.style.background || rule.style.backgroundColor)) own = [rule.cssText]; } catch {}
            return own.concat(rule.cssRules ? visit(rule.cssRules) : []);
          });
          try { return visit(sheet.cssRules); } catch { return []; }
        }),
        day:document.querySelector('.schedule-day-empty').getBoundingClientRect().toJSON(),
        buttons:[...document.querySelectorAll('[data-schedule-day-action]')].map(button => button.getBoundingClientRect().height)
      };
    });
    assert.ok(metrics.scroll <= metrics.width + 1, `${width}: no horizontal page overflow`);
    assert.equal(metrics.dateFill, 'rgba(0, 0, 0, 0)', `${width}: oversized selected-date fill removed\n${metrics.dateRules.join('\n')}`);
    assert.equal(metrics.dateColor, 'rgb(48, 44, 48)', `${width}: selected date follows theme ink`);
    assert.notEqual(metrics.primaryFill, 'rgba(0, 0, 0, 0)', 'one visually distinct primary action');
    if (width > 760) assert.ok(Math.abs(metrics.secondaryRows[0]-metrics.secondaryRows[1]) < 1, 'desktop secondary actions remain in one row');
    assert.ok(metrics.buttons.every(height => height >= 44), `${width}: reachable action targets`);
    assert.equal(await page.locator('#providerBookings [data-schedule-day]').count(), 0, 'date actions do not enter weekly schedule form selectors');
    if (output) await page.screenshot({ path:join(output, `after-${width}.png`), fullPage:true });
    await page.locator('[data-schedule-day-action="hours"]').click();
    await page.locator('dialog.schedule-day-hours-dialog[open]').waitFor();
    assert.equal(await page.locator('dialog.schedule-day-hours-dialog').getAttribute('aria-labelledby') !== null, true);
    assert.ok(await page.locator('dialog.schedule-day-hours-dialog').evaluate(element => element.getBoundingClientRect().right <= innerWidth), 'hours dialog fits');
    if (output) await page.screenshot({ path:join(output, `hours-${width}.png`) });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog.schedule-day-hours-dialog').count(), 0, 'Escape closes native dialog');
    checks += 1; await page.close();
  }
  const page = await setup(); await install(page);
  await page.locator('[data-schedule-day-action="booking"]').click();
  await page.locator('[data-schedule-day-action="block"]').click();
  const actions = await page.evaluate(() => dayTest.actions);
  assert.equal(actions.length, 2, 'delegation is attached once');
  assert.deepEqual(actions[0].options, { outsideSchedule:true, preserveDayAvailability:true });
  assert.deepEqual(actions[1].options, { mode:'block', clientRequired:false, preserveDayAvailability:true }); checks++;
  const open = async () => { await page.locator('[data-schedule-day-action="hours"]').click(); await page.locator('dialog.schedule-day-hours-dialog[open]').waitFor(); };
  const submit = async () => page.locator('dialog.schedule-day-hours-dialog [type="submit"]').click();
  await open();
  await page.locator('dialog.schedule-day-hours-dialog [name="start"]').fill('19:00'); await submit();
  assert.equal(await page.evaluate(() => dayTest.saves.length), 0, 'inverted hours never saved'); checks++;
  await page.locator('dialog.schedule-day-hours-dialog [name="start"]').fill('10:00');
  await page.locator('dialog.schedule-day-hours-dialog [name="end"]').fill('14:00');
  await page.locator('dialog.schedule-day-hours-dialog [name="online"]').check(); await submit();
  await page.waitForFunction(() => dayTest.refreshes.length === 1);
  const saved = await page.evaluate(() => dayTest.saves[0]);
  assert.deepEqual(Object.keys(saved.payload).sort(), ['date','end','expectedRevision','onlineEnabled','requestId','start'].sort());
  assert.equal(saved.payload.date, '2026-10-05'); assert.equal(saved.payload.start, '10:00'); assert.equal(saved.payload.end, '14:00');
  assert.equal(saved.payload.onlineEnabled, true); assert.match(saved.payload.requestId, /^[\da-f-]{36}$/); checks++;
  for (const field of ['userId','organizationId','locationId','date','timeZone']) {
    await open();
    await page.evaluate(field => { dayTest.previous = dayTest.context[field]; dayTest.context[field] = 'changed'; }, field);
    await submit(); assert.equal(await page.evaluate(() => dayTest.saves.length), 1, `${field}: stale context denied`);
    await page.evaluate(field => { dayTest.context[field] = dayTest.previous; dayController.close(); }, field);
  } checks++;
  await open(); await page.evaluate(() => { dayTest.canWrite=false; }); await submit();
  assert.equal(await page.evaluate(() => dayTest.saves.length), 1, 'revoked permission denied');
  await page.evaluate(() => { dayTest.canWrite=true; dayController.close(); }); checks++;
  await open(); await page.evaluate(() => { dayTest.behaviour='unknown'; }); await submit();
  await page.waitForFunction(() => document.querySelector('dialog.schedule-day-hours-dialog [type="submit"]').textContent === 'Проверить сохранение');
  const uncertain = await page.evaluate(() => dayTest.saves.at(-1).payload.requestId);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const holder=document.querySelector('#providerBookings');
    dayController.detach(holder);
    window.dayController=window.PrimeTimeProviderDayActions.create(dayPorts);
    dayController.attach(holder);
  });
  await open(); await submit();
  await page.waitForFunction(() => dayTest.resolutions.length === 1);
  assert.equal(await page.evaluate(() => dayTest.saves.length), 2, 'unknown result recovery after controller recreation never repeats mutation');
  assert.equal(await page.evaluate(() => dayTest.resolutions[0].requestId), uncertain); checks++;
  await page.evaluate(() => { dayTest.behaviour='pending'; }); await open(); await submit();
  assert.equal(await page.locator('dialog.schedule-day-hours-dialog [type="submit"]').isDisabled(), true);
  await page.evaluate(() => { dayTest.context=null; dayTest.finish(); });
  await page.waitForFunction(() => !document.querySelector('dialog.schedule-day-hours-dialog [type="submit"]').textContent.includes('Проверить'));
  assert.equal(await page.evaluate(() => dayTest.refreshes.length), 2, 'late result after logout never refreshes another session'); checks++;
  await page.evaluate(() => dayController.close());
  await page.close();
  for (const [name, configure, expected] of [
    ['wrong response date', () => { dayTest.loadDate='2026-10-06'; }, 'load'],
    ['server conflict', () => { dayTest.behaviour='collision'; }, 'save']
  ]) {
    const isolated = await setup(); await install(isolated); await isolated.evaluate(configure);
    await isolated.locator('[data-schedule-day-action="hours"]').click();
    if (expected === 'load') {
      await isolated.locator('.schedule-day-empty [role="alert"]:not([hidden])').waitFor();
      assert.equal(await isolated.locator('dialog.schedule-day-hours-dialog').count(), 0, name);
      assert.equal(await isolated.evaluate(() => dayTest.saves.length), 0, name);
    } else {
      await isolated.locator('dialog.schedule-day-hours-dialog[open]').waitFor();
      await isolated.locator('dialog.schedule-day-hours-dialog [type="submit"]').click();
      await isolated.locator('dialog.schedule-day-hours-dialog [role="alert"]:not([hidden])').waitFor();
      assert.equal(await isolated.locator('dialog.schedule-day-hours-dialog [type="submit"]').isDisabled(), true, name);
      assert.equal(await isolated.evaluate(() => dayTest.refreshes.length), 0, name);
    }
    checks++; await isolated.close();
  }
  const dark = await setup(390, 'graphite'); await install(dark);
  const darkColors = await dark.evaluate(() => ({ date:getComputedStyle(document.querySelector('#dateStrip>.active strong')).color, ink:getComputedStyle(document.body).getPropertyValue('--theme-ink').trim() }));
  assert.equal(darkColors.date, 'rgb(242, 241, 245)', 'selected date uses dark theme ink');
  checks++; await dark.close();
  console.log(`provider day actions: ${checks} isolated browser groups passed; backend and live acceptance not covered`);
} finally {
  await browser.close(); await new Promise(done => server.close(done));
}
