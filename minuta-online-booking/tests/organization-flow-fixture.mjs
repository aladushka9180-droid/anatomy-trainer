import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(app, 'provider.html'), 'utf8');
const layers = [...html.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '').matchAll(/<link\s+rel="stylesheet"[^>]*href="([^"?]+)/g)].map(match => readFileSync(join(app, match[1]), 'utf8'));
export async function fixture(page, { role = 'owner', theme = 'pink-porcelain', ready = false } = {}) {
  await page.route('**/*', route => route.request().url() === 'https://organization-flow.test/' ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ru"><meta charset="utf-8"><body></body></html>' }) : route.abort());
  await page.goto('https://organization-flow.test/');
  await page.evaluate(({ html, theme }) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.className = 'provider-body';
    Object.assign(document.body.dataset, { providerTheme: theme, providerPorcelainCharacter: 'pearl', providerLayout: 'soft', providerTextScale: 'default' });
    document.body.style.margin = '0';
    const main = document.createElement('main'); main.id = 'dashboard'; main.style.cssText = 'max-width:1100px;margin:auto;padding:16px;box-sizing:border-box';
    const panel = document.importNode(parsed.querySelector('[data-provider-panel="organization"]'), true); panel.hidden = false; main.append(panel); document.body.append(main);
    const service = document.createElement('button'); service.dataset.providerView = 'services'; service.textContent = 'Услуги'; document.body.append(service);
  }, { html, theme });
  for (const content of layers) await page.addStyleTag({ content });
  await page.addStyleTag({ content: readFileSync(join(app, 'organization-flow.css'), 'utf8') });
  await page.addScriptTag({ content: readFileSync(join(app, 'organization.js'), 'utf8') });
  await page.addScriptTag({ content: readFileSync(join(app, 'organization-flow.js'), 'utf8') });
  await page.evaluate(async ({ role, ready }) => {
    window.orgData = { id: 'test-org', name: 'Тестовая организация', public_slug: 'synthetic-only', public_booking_enabled: false, can_manage: ['owner', 'admin'].includes(role), current_role: role, locations: ready ? [{ id: 'l1', name: 'Центр', address: 'Тестовый адрес', active: true }] : [], members: ready ? [{ user_id: 'test-user', display_name: 'Анна', active: true, is_bookable: true, role: 'owner', is_current_user: true }] : [], invitations: [], audit: [] };
    window.shiftData = { organization_id: 'test-org', services: ready ? [{ id: 's1', performer_id: 'test-user', name: 'Массаж', duration_minutes: 60 }] : [], shifts: ready ? [{ id: 'sh1', performer_id: 'test-user', location_id: 'l1', shift_date: '2026-10-02', start_time: '10:00', end_time: '18:00', active: true }] : [], absences: [] };
    window.readFailure = false; window.renameFailure = false; window.renamePending = false; window.shiftPending = false; window.calls = []; window.notices = []; window.generation = 1;
    const db = { rpc: async (name, params) => {
      calls.push({ name, params });
      if (name === 'get_minuta_workspace') return { data: { organizations: [structuredClone(orgData)], pending_invitations: [] } };
      if (name === 'get_minuta_shift_workspace') {
        if (shiftPending) await new Promise(resolve => { window.resolveShift = resolve; });
        return readFailure ? { error: { code: 'READ_FAILED' } } : { data: structuredClone(shiftData) };
      }
      if (name === 'update_minuta_organization') {
        if (renamePending) await new Promise(resolve => { window.resolveRename = resolve; });
        if (renameFailure) return { error: { code: 'WRITE_REFUSED' } };
        orgData.name = params.p_name; return { data: { organizations: [structuredClone(orgData)] } };
      }
      throw new Error(`Unexpected RPC ${name}`);
    } };
    const options = { db, $: selector => document.querySelector(selector), $$: selector => [...document.querySelectorAll(selector)], escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])), notify: value => notices.push(value), requireWrites: () => ['owner', 'admin'].includes(role), getCurrentUser: () => ({ id: 'test-user' }), getSessionGeneration: () => generation, sessionIsCurrent: (user, gen) => user === 'test-user' && gen === generation, applyWriteAvailability() {} };
    window.flow = MinutaOrganizationFlow.createController({ ...options, now: () => new Date('2026-10-02T08:00:00Z') }); flow.bind();
    window.orgController = MinutaOrganization.createController({ ...options, onActiveOrganizationChange: next => flow.setOrganization(next) }); orgController.bind();
    document.querySelectorAll('#organizationSectionNav button').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('#organizationSectionNav button').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('#organizationWorkspace > .provider-section-anchor').forEach(section => { section.hidden = section.id !== button.dataset.sectionTarget; });
      const audit = document.getElementById('organizationAuditPanel'); if (audit) audit.hidden = button.dataset.sectionTarget !== 'organizationPeopleSection';
    }));
    await orgController.load();
    document.querySelector('[data-section-target="organizationOverviewSection"]').click();
  }, { role, ready });
  await page.locator('.of-count').waitFor();
  await page.addScriptTag({ content: readFileSync(join(app, 'organization-group-navigation.js'), 'utf8') });
  await page.waitForFunction(() => !document.querySelector('.of-read-state').textContent.includes('Проверяем сохранённые настройки'));
}
