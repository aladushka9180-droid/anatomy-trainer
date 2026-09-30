import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const app = join(root, '..');
const html = readFileSync(join(app, 'provider.html'), 'utf8');
const resources = html.slice(html.indexOf('<section class="panel organization-section organization-resources"'), html.indexOf('<section class="panel organization-section organization-shifts"'));
const shifts = html.slice(html.indexOf('<section class="panel organization-section organization-shifts"'), html.indexOf('<section class="panel organization-section organization-payroll"'));
const css = readFileSync(join(app, 'organization-overview.css'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
const output = process.env.MINUTA_OVERVIEW_SCREENSHOTS;
if (output) mkdirSync(output, { recursive: true });

const locations = ['Центр', 'Север', 'Парк'].map((name, index) => ({ id: `l${index + 1}`, name, active: true }));
const performers = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дина'].map((name, index) => ({ id: `p${index + 1}`, display_name: name }));
const resourcePayload = {
  organization_id: 'test-org', can_manage: true, locations,
  groups: [{ id: 'g1', name: 'Кабинеты', kind: 'room', active: true }],
  resources: Array.from({ length: 21 }, (_, index) => ({
    id: `r${index + 1}`, name: `Кабинет ${String(index + 1).padStart(2, '0')}`,
    location_id: locations[index % 3].id, location_name: locations[index % 3].name,
    group_id: 'g1', group_name: 'Кабинеты', kind: 'room', active: true
  })),
  services: [], requirements: [], audit: []
};
const shiftPayload = {
  organization_id: 'test-org', can_manage_team: true, current_role: 'owner', enabled: false,
  locations, performers, services: [], bookings: [], utilization: [], audit: [],
  shifts: [
    { id: 's1', performer_id: 'p1', location_id: 'l1', shift_date: '2026-09-30', start_time: '09:00', end_time: '14:00', active: true },
    { id: 's2', performer_id: 'p1', location_id: 'l2', shift_date: '2026-09-30', start_time: '13:00', end_time: '18:00', active: true },
    { id: 's3', performer_id: 'p2', location_id: 'l3', shift_date: '2026-10-01', start_time: '10:00', end_time: '18:00', active: true },
    ...performers.slice(2).map((performer, index) => ({ id: `s${index + 4}`, performer_id: performer.id, location_id: locations[index].id, shift_date: '2026-10-02', start_time: '10:00', end_time: '17:00', active: true }))
  ],
  absences: [{ id: 'a1', performer_id: 'p2', starts_on: '2026-10-01', ends_on: '2026-10-02', kind: 'vacation', active: true }]
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await page.route('**/*', route => route.abort());
    await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>*,*::before,*::after{box-sizing:border-box}body{margin:0;padding:12px;background:#fff7fa;color:#303038;font:16px Arial,sans-serif}.panel{max-width:100%;border:1px solid #444;border-radius:14px;padding:14px;margin:0 0 20px;background:white}.organization-list{display:grid;gap:6px}.organization-row{display:block;padding:8px;border:1px solid #ded5d9;border-radius:8px}.organization-row summary{cursor:pointer}.organization-row-main{display:grid;gap:3px}.organization-row-main small{color:#6c6468}label{display:grid;gap:4px}input,select,button{min-height:38px;max-width:100%;font:inherit}details>form{padding:12px}.shift-management-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:760px){.shift-management-grid{grid-template-columns:1fr}}[hidden]{display:none!important}</style><style>${css}</style>${resources}${shifts}</html>`);
    await page.addScriptTag({ content: readFileSync(join(app, 'resource-management.js'), 'utf8') });
    await page.addScriptTag({ content: readFileSync(join(app, 'shift-management.js'), 'utf8') });
    await page.evaluate(({ resourcePayload, shiftPayload }) => {
      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
      const common = { $: selector => document.querySelector(selector), escapeHtml, notify() {}, requireWrites: () => false, getCurrentUser: () => ({ id: 'synthetic-user' }), getSessionGeneration: () => 1, sessionIsCurrent: () => true, applyWriteAvailability() {} };
      window.rpcCalls = [];
      window.resourceController = MinutaResources.createController({ ...common, db: { rpc: async name => { rpcCalls.push(name); return { data: resourcePayload }; } } });
      window.shiftController = MinutaShifts.createController({ ...common, db: { rpc: async name => { rpcCalls.push(name); return { data: shiftPayload }; } } });
      resourceController.bind(); shiftController.bind();
      document.querySelector('#shiftStartDate').value = '2026-09-30';
    }, { resourcePayload, shiftPayload });
    assert.equal((await page.evaluate(() => resourceController.setOrganization({ id: 'test-org' }))).ok, true);
    assert.equal((await page.evaluate(() => shiftController.setOrganization({ id: 'test-org' }))).ok, true);
    assert.equal(await page.locator('#resourcesList [data-resource-card]').count(), 21);
    assert.equal(await page.locator('#shiftWeekGrid .shift-week-person').count(), 6);
    assert.equal(await page.locator('#shiftWeekGrid .is-conflict').count(), 3);
    assert.match(await page.locator('#shiftWeekHint').textContent(), /3/);
    await page.locator('#resourceListSearch').fill('Кабинет 05');
    assert.equal(await page.locator('#resourcesList [data-resource-card]').count(), 1);
    assert.match(await page.locator('#resourcesList').textContent(), /Север · Кабинеты/);
    await page.locator('#resourceListSearch').fill('');
    await page.locator('#resourceListLocation').selectOption('l3');
    assert.equal(await page.locator('#resourcesList [data-resource-card]').count(), 7);
    assert.equal(await page.locator('#resourceListMatchCount').textContent(), '7 из 21');
    assert.equal(await page.locator('#resourcesList').textContent().then(text => text.includes('Центр · Кабинеты')), false);
    await page.locator('#resourceListLocation').selectOption('');
    assert.equal(await page.locator('#resourcesList [data-resource-card]').count(), 21);
    const previous = await page.locator('#shiftWeekRange').textContent();
    await page.locator('[data-shift-week="1"]').click();
    assert.notEqual(await page.locator('#shiftWeekRange').textContent(), previous);
    assert.equal(await page.locator('#shiftWeekGrid .is-conflict').count(), 0);
    await page.locator('[data-shift-week="-1"]').click();
    assert.equal(await page.locator('#shiftWeekRange').textContent(), previous);
    assert.equal(await page.locator('#shiftWeekGrid .is-conflict').count(), 3);
    assert.equal(await page.locator('#shiftForm').count(), 1);
    assert.equal(await page.locator('#absenceForm').count(), 1);
    assert.equal(await page.locator('#resourceForm').count(), 1);
    assert.equal(await page.locator('#resourceRequirementForm').count(), 1);
    assert.equal(await page.evaluate(() => rpcCalls.every(name => name.startsWith('get_'))), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `outer overflow at ${width}`);
    if (output) {
      await page.locator('#resourcesPanel').screenshot({ path: join(output, `resources-${width}.png`) });
      await page.locator('#shiftsPanel').screenshot({ path: join(output, `shifts-${width}.png`) });
    }
    await page.close();
  }
  console.log('Organization O06/O09 synthetic browser test passed at 390/760/1440');
} finally {
  await browser.close();
}
