import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_OVERVIEW_SCREENSHOTS || join(app, '..', 'outputs', 'o06-o09-themed-preview');
mkdirSync(output, { recursive: true });
const html = readFileSync(join(app, 'provider.html'), 'utf8')
  .replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const before = name => execFileSync('git', ['show', `6a4120dd:minuta-online-booking/${name}`], { cwd: join(app, '..'), encoding: 'utf8' });
const source = (name, variant) => variant === 'before' ? before(name) : readFileSync(join(app, name), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
const locations = ['Центр', 'Север', 'Парк'].map((name, index) => ({ id: `l${index + 1}`, name, active: true }));
const performers = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дина'].map((display_name, index) => ({ id: `p${index + 1}`, display_name }));
const resourcePayload = { organization_id:'test-org', can_manage:true, locations, groups:[{ id:'g1', name:'Кабинеты', kind:'room', active:true }], resources:Array.from({ length:21 }, (_, index) => ({ id:`r${index + 1}`, name:`Кабинет ${String(index + 1).padStart(2, '0')}`, location_id:locations[index % 3].id, location_name:locations[index % 3].name, group_id:'g1', group_name:'Кабинеты', kind:'room', active:true })), services:[], requirements:[], audit:[] };
const shiftPayload = { organization_id:'test-org', can_manage_team:true, current_role:'owner', enabled:false, locations, performers, services:[], bookings:[], utilization:[], audit:[], shifts:[
  { id:'s1', performer_id:'p1', location_id:'l1', shift_date:'2026-09-30', start_time:'09:00', end_time:'14:00', active:true },
  { id:'s2', performer_id:'p1', location_id:'l2', shift_date:'2026-09-30', start_time:'13:00', end_time:'18:00', active:true },
  { id:'s3', performer_id:'p2', location_id:'l3', shift_date:'2026-10-01', start_time:'10:00', end_time:'18:00', active:true },
  ...performers.slice(2).map((item, index) => ({ id:`s${index + 4}`, performer_id:item.id, location_id:locations[index].id, shift_date:'2026-10-02', start_time:'10:00', end_time:'17:00', active:true }))
], absences:[{ id:'a1', performer_id:'p2', starts_on:'2026-10-01', ends_on:'2026-10-02', kind:'vacation', active:true }] };

try {
  for (const width of [390, 760, 1440]) for (const variant of ['before', 'after']) for (const section of ['resources', 'shifts']) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block', deviceScaleFactor:1 });
    await page.route('**/*', route => route.abort());
    await page.route('https://preview.test/**', route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
      if (name === 'provider.html') return route.fulfill({ contentType:'text/html', body:variant === 'after' ? html.replace('</body>', '<link rel="stylesheet" href="organization-overview.css?v=1"></body>') : html });
      const file = join(app, name);
      if (!name.includes('..') && existsSync(file)) {
        const type = extname(file) === '.css' ? 'text/css' : extname(file) === '.svg' ? 'image/svg+xml' : undefined;
        return route.fulfill({ path:file, ...(type ? { contentType:type } : {}) });
      }
      return route.abort();
    });
    await page.goto('https://preview.test/provider.html', { waitUntil:'load' });
    await page.evaluate(section => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerLayout = 'soft';
      document.body.dataset.providerPorcelainCharacter = 'pearl';
      document.querySelector('#providerBoot').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelector('#dashboard').dataset.activeView = 'organization';
      document.querySelectorAll('.provider-view').forEach(node => { node.hidden = node.dataset.providerPanel !== 'organization'; });
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelector('#organizationRoleBadge').textContent = 'Владелец';
      document.querySelector('#todayLabel').textContent = 'Среда, 30 Сентября';
      document.querySelector('#currentTimeLabel').textContent = '';
      document.querySelector('#syncState').hidden = true;
      document.querySelectorAll('#organizationWorkspace > .organization-section, #organizationOverviewSection, #organizationPeopleSection').forEach(node => { node.hidden = true; });
      document.querySelector('#organizationSectionSelect').value = section === 'resources' ? 'resourcesPanel' : 'shiftsPanel';
      document.querySelectorAll('#organizationSectionNav button').forEach(node => node.classList.toggle('active', node.dataset.sectionTarget === (section === 'resources' ? 'resourcesPanel' : 'shiftsPanel')));
      document.querySelectorAll('.provider-nav button').forEach(node => node.classList.toggle('active', node.dataset.providerView === 'organization'));
    }, section);
    await page.addScriptTag({ content:source(section === 'resources' ? 'resource-management.js' : 'shift-management.js', variant) });
    await page.evaluate(({ section, resourcePayload, shiftPayload }) => {
      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
      const common = { $:selector => document.querySelector(selector), escapeHtml, notify() {}, requireWrites:() => false, getCurrentUser:() => ({ id:'synthetic-user' }), getSessionGeneration:() => 1, sessionIsCurrent:() => true, applyWriteAvailability() {} };
      if (section === 'resources') { window.controller = MinutaResources.createController({ ...common, db:{ rpc:async () => ({ data:resourcePayload }) } }); }
      else { document.querySelector('#shiftStartDate').value = '2026-09-30'; window.controller = MinutaShifts.createController({ ...common, db:{ rpc:async () => ({ data:shiftPayload }) } }); }
      controller.bind();
    }, { section, resourcePayload, shiftPayload });
    assert.equal((await page.evaluate(() => controller.setOrganization({ id:'test-org' }))).ok, true);
    const panel = section === 'resources' ? '#resourcesPanel' : '#shiftsPanel';
    assert.equal(await page.locator(panel).isVisible(), true, JSON.stringify(await page.locator(panel).evaluate(node => { const chain=[]; for (let current=node;current;current=current.parentElement) chain.push({ tag:current.tagName, id:current.id, className:current.className, hidden:current.hidden, display:getComputedStyle(current).display, visibility:getComputedStyle(current).visibility }); return chain; })));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${section} ${variant} outer overflow at ${width}`);
    const panelBox = await page.locator(panel).boundingBox();
    assert.ok(panelBox.x >= -1 && panelBox.x + panelBox.width <= width + 1, `${section} ${variant} panel clipped at ${width}: ${JSON.stringify(panelBox)}`);
    if (variant === 'after') {
      const controls = section === 'resources' ? '#resourceListSearch, #resourceListLocation' : '#shiftWeekOverview .shift-week-controls button';
      for (const rect of await page.locator(controls).evaluateAll(nodes => nodes.map(node => ({ width:node.getBoundingClientRect().width, height:node.getBoundingClientRect().height })))) {
        assert.ok(rect.height >= 44 && rect.width >= 44, `${section} ${width}: control ${rect.width}×${rect.height}`);
      }
      assert.equal(await page.locator(section === 'resources' ? '#resourceListFilters' : '#shiftWeekOverview').isVisible(), true);
      if (section === 'shifts' && width < 840) assert.equal(await page.locator('.shift-week-scroll').evaluate(node => node.scrollWidth > node.clientWidth && node.tabIndex === 0), true);
    }
    await page.screenshot({ path:join(output, `${section}-${variant}-${width}-viewport.png`) });
    if (section === 'resources') {
      await page.locator('#resourceObjectsSection').screenshot({ path:join(output, `${section}-${variant}-${width}-detail.png`) });
    } else {
      await page.locator(variant === 'after' ? '#shiftWeekOverview' : '#shiftsList').scrollIntoViewIfNeeded();
      await page.screenshot({ path:join(output, `${section}-${variant}-${width}-detail.png`) });
      if (variant === 'after') await page.locator('#shiftWeekOverview').screenshot({ path:join(output, `${section}-${variant}-${width}-widget.png`) });
    }
    await page.close();
  }
  console.log('O06/O09 Pink Porcelain dashboard preview PASS: before/after, 390/760/1440, 44px controls and no outer overflow');
} finally {
  await browser.close();
}
