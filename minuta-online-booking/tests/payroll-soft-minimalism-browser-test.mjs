import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Real provider markup/styles and payroll controller, synthetic read transport only.
// Preview explicitly skips the shared HTML hooks owned by the release coordinator.
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const originalHtml = readFileSync(resolve(app, 'provider.html'), 'utf8');
const preview = process.env.MINUTA_PAYROLL_SOFT_PREVIEW === '1';
if (!preview) {
  const style = originalHtml.match(/<link\s[^>]*href="payroll-soft-minimalism\.css\?v=\d+"[^>]*>/)?.[0];
  const script = originalHtml.match(/<script\s[^>]*src="payroll-soft-minimalism\.js\?v=\d+"[^>]*\bdefer\b[^>]*>/)?.[0];
  assert.ok(style, 'Missing production CSS hook; isolated preview requires MINUTA_PAYROLL_SOFT_PREVIEW=1');
  assert.ok(script, 'Missing production deferred module hook');
  assert.ok(originalHtml.indexOf(style) > originalHtml.indexOf('organization-overview.css'), 'Load payroll CSS after organization styles');
  assert.ok(originalHtml.indexOf(script) > originalHtml.indexOf('<script src="provider.js'), 'Load presentation after provider.js');
} else console.log('PREVIEW: shared HTML hooks and publication are not proved');
const html = originalHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '')
  .replace(/<link\b[^>]*href="payroll-soft-minimalism\.css[^>]*>/gi, '');
const output = process.env.MINUTA_SCREENSHOT_DIR;
if (output) mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true });
const errors = [], unexpected = [], results = [];
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp' };

async function fixture({ width = 390, theme = 'pink-porcelain', state = 'empty', role = 'owner', enhance = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://payroll-ui.test' || route.request().method() !== 'GET') {
      unexpected.push(`${route.request().method()} ${url.href}`);
      return route.abort();
    }
    const file = resolve(app, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(app + '/') && !file.startsWith(app + '\\')) return route.abort();
    try { return route.fulfill({ body: file.endsWith('provider.html') ? html : readFileSync(file), contentType: mime[extname(file)] || 'application/octet-stream' }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('https://payroll-ui.test/provider.html');
  await page.addScriptTag({ path: resolve(app, 'theme-catalog.js') });
  await page.evaluate(({ theme }) => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.documentElement.classList.add('top-level');
    document.querySelector('#providerBoot')?.remove();
    document.querySelector('#authCard').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#dashboard').dataset.activeView = 'organization';
    document.body.dataset.providerTheme = theme;
    document.body.dataset.providerLayout = 'soft';
    document.body.dataset.providerPorcelainCharacter = 'petal';
    const palette = MinutaThemeCatalog.theme(theme).palette;
    Object.entries({ bg: palette.bg, surface: palette.surface, 'surface-alt': palette.surfaceAlt, ink: palette.ink,
      muted: palette.muted, line: palette.line, accent: palette.accent, 'accent-soft': palette.accentSoft,
      'accent-contrast': palette.contrast, shadow: palette.shadow }).forEach(([key, value]) => document.body.style.setProperty('--theme-' + key, value));
    document.body.style.colorScheme = palette.dark ? 'dark' : 'light';
    document.querySelectorAll('.provider-view').forEach(panel => {
      panel.hidden = panel.dataset.providerPanel !== 'organization';
      panel.classList.toggle('active', !panel.hidden);
    });
    document.querySelector('#organizationLoading').hidden = true;
    document.querySelector('#organizationWorkspace').hidden = false;
    document.querySelectorAll('.organization-section').forEach(panel => { panel.hidden = panel.id !== 'payrollPanel'; });
    document.querySelector('#organizationTitle').textContent = 'Тестовая организация';
    document.querySelector('#organizationRoleBadge').textContent = 'Владелец';
    document.querySelector('#payrollStartDate').value = '2026-10-01';
    document.querySelector('#payrollEndDate').value = '2026-10-31';
    window.beforeForms = [...document.querySelectorAll('#payrollPanel form')];
    window.beforeInputs = [...document.querySelectorAll('#payrollPanel input, #payrollPanel select, #payrollPanel textarea')];
    window.beforePayment = document.querySelector('#paymentProviderPanel').outerHTML.replace(/\sstyle=""/g, '');
  }, { theme });
  await page.addScriptTag({ path: resolve(app, 'payroll-management.js') });
  if (enhance) {
    await page.addStyleTag({ path: resolve(app, 'payroll-soft-minimalism.css') });
    await page.addScriptTag({ path: resolve(app, 'payroll-soft-minimalism.js') });
  }
  await page.evaluate(async ({ state, role }) => {
    window.payrollCalls = [];
    window.payrollNotices = [];
    window.payrollFixture = { state, role };
    window.payrollController = MinutaPayroll.createController({
      db: { rpc: async (name, parameters) => {
        payrollCalls.push({ name, parameters });
        if (name !== 'get_minuta_payroll_ledger_workspace_v136') throw new Error('Unexpected write RPC');
        if (payrollFixture.state === 'unavailable') return { data: null, error: { message: 'fixture unavailable' } };
        const empty = payrollFixture.state === 'empty', settled = payrollFixture.state === 'settled';
        return { data: { organization_id: 'fixture-org', current_role: payrollFixture.role,
          can_manage: ['owner', 'admin'].includes(payrollFixture.role), ledger_enabled: !empty,
          summary: payrollFixture.state === 'large' ? { accrued_minor: 999999999900, paid_minor: 999999999900, debt_minor: 999999999900, advance_open_minor: 999999999900 } : {},
          members: [{ id: 'fixture-member', display_name: 'Тестовый сотрудник', is_bookable: true }],
          locations: [{ id: 'fixture-location', name: 'Тестовый филиал' }],
          plans: empty ? [] : [{ id: 'fixture-plan', name: 'Основное правило', performer_id: 'fixture-member', effective_from: '2026-10-01', base_rate_bps: 4000 }],
          periods: empty ? [] : [{ id: 'fixture-period', name: 'Октябрь 2026', location_id: 'fixture-location', starts_on: '2026-10-01', ends_on: '2026-10-31',
            status: payrollFixture.state === 'draft' ? 'draft' : 'approved', total_payroll_rub: 85000 }],
          items: empty ? [] : [{ id: 'fixture-item', performer_id: 'fixture-member', period_id: 'fixture-period', service_name: 'Тестовая услуга', booking_date: '2026-10-02', payroll_rub: 85000 }],
          accruals: ['filled', 'settled'].includes(payrollFixture.state) ? [{ id: 'fixture-accrual', transaction_id: 'fixture-accrual-transaction', period_id: 'fixture-period', amount_minor: 8500000 }] : [],
          debts: ['filled', 'settled'].includes(payrollFixture.state) ? [{ accrual_source_id: 'fixture-accrual', performer_id: 'fixture-member', period_id: 'fixture-period', original_minor: 8500000, debt_minor: settled ? 0 : 2500000 }] : [],
          payment_accounts: [{ id: 'fixture-account', name: 'Тестовый счёт', account_type: 'cash', active: true }],
          advances: empty ? [] : [{ id: 'fixture-advance', performer_id: 'fixture-member', amount_minor: 500000, remaining_minor: 500000 }]
        }, error: null };
      } },
      $: selector => document.querySelector(selector),
      escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]),
      notify: message => payrollNotices.push(message), requireWrites: () => false, applyWriteAvailability: () => {},
      getCurrentUser: () => ({ id: 'fixture-user' }), getSessionGeneration: () => 1, sessionIsCurrent: () => true,
      confirmAction: () => false
    });
    payrollController.bind();
    await payrollController.setOrganization({ id: 'fixture-org' });
  }, { state, role });
  if (enhance) await page.waitForFunction(() => document.querySelector('#payrollEnabledStatus').textContent.length > 0);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  return page;
}
async function shot(page, name) {
  if (output) await page.locator('#payrollPanel').screenshot({ path: resolve(output, name + '.png') });
}
async function invariants(page, label) {
  const proof = await page.evaluate(() => {
    const panel = document.querySelector('#payrollPanel'), date = document.querySelector('#payrollStartDate');
    const visible = [...panel.querySelectorAll('*')].filter(node => {
      const closed = node.closest('details:not([open])');
      return node.getClientRects().length && (!closed || closed === node || closed.querySelector(':scope > summary')?.contains(node));
    });
    const bounds = panel.getBoundingClientRect();
    // Playwright temporarily hides caret during screenshots, leaving empty style attributes.
    const paymentNow = document.querySelector('#paymentProviderPanel').outerHTML.replace(/\sstyle=""/g, '');
    const difference = [...beforePayment].findIndex((character, index) => character !== paymentNow[index]);
    return {
      preservesForms: beforeForms.every(node => panel.contains(node)),
      preservesInputs: beforeInputs.every(node => panel.contains(node)),
      missingForms: beforeForms.filter(node => !panel.contains(node)).map(node => node.id),
      missingInputs: beforeInputs.filter(node => !panel.contains(node)).map(node => node.id),
      paymentUnchanged: beforePayment === paymentNow,
      paymentDifference: difference < 0 ? null : { before: beforePayment.slice(Math.max(0, difference - 30), difference + 90), after: paymentNow.slice(Math.max(0, difference - 30), difference + 90) },
      idsUnique: [...panel.querySelectorAll('[id]')].every(node => document.querySelectorAll('#' + node.id).length === 1),
      workspaceHidden: document.querySelector('#payrollWorkspace').hidden,
      ancestors: (() => { const rows = []; for (let node = date; node; node = node.parentElement) if (node.hidden || getComputedStyle(node).display === 'none') rows.push(node.id || node.tagName); return rows; })(),
      periodAncestors: (() => { const rows = []; for (let node = panel.querySelector('.payroll-soft-periods'); node; node = node.parentElement) rows.push([node.id || node.className, node.hidden, getComputedStyle(node).display]); return rows; })(),
      dateType: date.type, dateWeight: getComputedStyle(date).fontWeight,
      overflowing: visible.filter(node => node.getBoundingClientRect().right > bounds.right + 1 || node.getBoundingClientRect().left < bounds.left - 1).map(node => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        return { tag: node.tagName, id: node.id, class: String(node.className), text: node.textContent.slice(0, 55), left: rect.left, right: rect.right, position: style.position, display: style.display, width: style.width, minWidth: style.minWidth, css: node.getAttribute('style') };
      }).slice(0, 5),
      zeroColor: getComputedStyle(document.querySelector('#payrollDebtTotal')).color,
      normalColor: getComputedStyle(document.querySelector('#payrollAccruedTotal')).color,
      periodNumbers: [...panel.querySelectorAll('.payroll-period-totals b')].map(node => ({ text: node.textContent, color: getComputedStyle(node).color, visibility: getComputedStyle(node).visibility, rect: node.getBoundingClientRect().toJSON() })),
      height: Math.round(bounds.height)
    };
  });
  assert.ok(proof.preservesForms && proof.preservesInputs && proof.paymentUnchanged && proof.idsUnique, label + ': original forms/IDs/payment section preserved ' + JSON.stringify(proof));
  assert.equal(proof.dateType, 'date', label + ': native date picker preserved');
  assert.equal(proof.dateWeight, '400', label + ': regular date text');
  assert.deepEqual(proof.overflowing, [], label + ': no clipped content');
  return proof;
}

try {
  for (const width of [390, 760, 1440]) {
    const baseline = await fixture({ width, enhance: false });
    const baselineHeight = await baseline.locator('#payrollPanel').evaluate(node => Math.round(node.getBoundingClientRect().height));
    await shot(baseline, `${width}-before`);
    await baseline.close();
    for (const theme of ['pink-porcelain', 'noir-safari']) {
      for (const state of ['empty', 'filled', 'draft']) {
        const label = `${width}-${theme}-${state}`;
        const page = await fixture({ width, theme, state });
        await shot(page, label);
        const proof = await invariants(page, label);
        if (output) writeFileSync(resolve(output, 'latest-proof.json'), JSON.stringify(proof, null, 2));
        assert.equal(await page.locator('#payrollEnabledStatus').textContent(), state === 'empty' ? 'Выключен' : 'Включён', label + ': switch status');
        assert.match(await page.locator('#payrollEnabledHint').textContent(), /не создаёт начислений и выплат/);
        if (proof.ancestors.length || !proof.paymentUnchanged) console.log(label, JSON.stringify(proof));
        assert.equal(await page.locator('#payrollAuditPanel').evaluate(node => node.open), false);
        assert.equal(await page.locator('#payrollRulesDisclosure').evaluate(node => node.open), false);
        assert.equal(await page.locator('.payroll-soft-setup').isVisible(), state === 'empty');
        if (state === 'empty') {
          assert.equal(proof.zeroColor, proof.normalColor, label + ': zero debt is neutral');
          assert.ok(proof.height < baselineHeight, label + ': first launch is shorter');
        } else {
          await page.locator('.payroll-soft-periods').scrollIntoViewIfNeeded();
          assert.equal(await page.locator('.payroll-soft-periods').isVisible(), true, label + ': visible periods ' + JSON.stringify(proof.periodAncestors));
          assert.equal(await page.locator('[data-payroll-approve-accrue]').isVisible(), state === 'draft');
          if (state === 'filled') assert.notEqual(proof.zeroColor, proof.normalColor, label + ': positive debt has accent');
        }
        await shot(page, label);
        if (theme === 'pink-porcelain') {
          if (state === 'empty') {
            await page.getByRole('button', { name: 'Добавить правило', exact: true }).click();
            await page.locator('#payrollPlanForm').waitFor({ state: 'visible' });
            await page.waitForFunction(() => document.querySelector('.payroll-soft-setup').hidden);
            assert.equal(await page.locator('#payrollPlanForm button[type=submit]').evaluate(node => getComputedStyle(node).backgroundColor),
              await page.locator('.payroll-soft-add-rule').evaluate(node => getComputedStyle(node).backgroundColor), 'Saving the rule is the primary action while editing');
            await invariants(page, label + '-rule');
            await shot(page, `${width}-rule`);
            await page.locator('#payrollPlanCreator summary').click();
          } else {
            if (state === 'filled') {
              await page.getByRole('button', { name: 'Записать выплату', exact: true }).click();
              await page.locator('#payrollPaymentForm').waitFor({ state: 'visible' });
              await invariants(page, label + '-payment-shortcut');
              await page.locator('#payrollPaymentPanel > summary').click();
              await page.locator('#payrollOperationsDisclosure > summary').click();
            }
            await page.getByRole('button', { name: 'Подготовить расчёт', exact: true }).click();
            await page.locator('#payrollPeriodForm').waitFor({ state: 'visible' });
            assert.match(await page.locator('#payrollPeriodScope').innerText(), /начисление и выплата выполняются отдельно/);
            await invariants(page, label + '-prepare');
            await shot(page, `${width}-${state}-prepare`);
            await page.locator('#payrollPeriodName').fill('Несохранённый расчёт');
            await page.locator('#payrollRulesDisclosure > summary').click();
            await page.locator('#payrollPlanCreator > summary').click();
            await page.waitForFunction(() => !document.querySelector('#payrollPlanCreator').open && document.querySelector('#payrollPeriodCreator').open && document.activeElement === document.querySelector('.payroll-soft-prepare'));
            assert.equal(await page.locator('#payrollPeriodName').inputValue(), 'Несохранённый расчёт', 'Dirty period and visible focus are retained');
            await page.locator('#payrollRulesDisclosure > summary').click();
            await page.getByRole('button', { name: 'Подготовить расчёт', exact: true }).first().click();
            await page.locator('#payrollPeriodForm').waitFor({ state: 'hidden' });
            await page.locator('#payrollRulesDisclosure > summary').click();
            await page.locator('#payrollPlanCreator > summary').click();
            await page.locator('#payrollPlanName').fill('Несохранённое правило');
            await page.getByRole('button', { name: 'Подготовить расчёт', exact: true }).click();
            await page.waitForFunction(() => payrollNotices.length > 0);
            assert.equal(await page.locator('#payrollPlanCreator').evaluate(node => node.open), true, 'Unsaved rule stays open');
            assert.equal(await page.locator('#payrollPeriodCreator').evaluate(node => node.open), false, 'Competing form blocked');
            await page.locator('#payrollPlanCreator > summary').click();
            await page.locator('#payrollRulesDisclosure > summary').click();
            await page.locator('#payrollOperationsDisclosure > summary').click();
            for (const id of ['payrollAdjustmentPanel', 'payrollAdvancePanel', 'payrollPaymentPanel', 'payrollOffsetPanel']) {
              if (await page.locator('#' + id).isVisible()) {
                await page.locator('#' + id + ' > summary').click();
                await invariants(page, label + '-' + id);
                await page.locator('#' + id + ' > summary').click();
              }
            }
          }
          await page.locator('.payroll-items > summary').click();
          await page.locator('#payrollItemsList').waitFor({ state: 'visible' });
          await page.locator('#payrollAuditPanel > summary').click();
          await page.locator('#payrollAuditList').waitFor({ state: 'visible' });
          await invariants(page, label + '-history');
          const reversal = page.locator('.payroll-reverse > summary').first();
          if (await reversal.isVisible()) {
            await reversal.click();
            await invariants(page, label + '-reverse');
          }
        }
        assert.ok((await page.evaluate(() => payrollCalls)).every(call => call.name === 'get_minuta_payroll_ledger_workspace_v136'), 'UI actions make no writes');
        results.push({ label, ...proof, baselineHeight });
        await page.close();
      }
    }
  }
  for (const role of ['admin', 'specialist']) {
    const page = await fixture({ role, state: 'filled' });
    assert.equal(await page.locator('#payrollEnabled').isDisabled(), true, role + ': owner-only switch unchanged');
    assert.equal(await page.locator('.payroll-soft-prepare').isVisible(), role === 'admin');
    assert.equal(await page.locator('#payrollOperationsDisclosure').isVisible(), role === 'admin');
    await invariants(page, role);
    await page.close();
  }
  const large = await fixture({ state: 'large' });
  assert.ok(await large.locator('.payroll-summary strong').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), 'Large totals are readable without ellipsis at 390px');
  await invariants(large, 'large-totals');
  await large.close();
  const page = await fixture({ state: 'settled' });
  assert.equal(await page.locator('#payrollDebtTotal').textContent(), '0 ₽');
  assert.equal(await page.locator('.payroll-soft-pay').isVisible(), false, 'No payout shortcut when no debt');
  const settled = await invariants(page, 'settled');
  assert.equal(settled.zeroColor, settled.normalColor, 'Paid period returns to neutral zero');
  await page.locator('#payrollEnabled').click();
  await page.waitForFunction(() => document.querySelector('#payrollEnabled').checked && document.querySelector('#payrollEnabledStatus').textContent === 'Включён');
  assert.ok((await page.evaluate(() => payrollCalls)).every(call => call.name === 'get_minuta_payroll_ledger_workspace_v136'), 'Rejected switch change makes no writes and restores its status');
  await page.evaluate(async () => { payrollFixture.state = 'unavailable'; await payrollController.load(); });
  assert.equal(await page.locator('#payrollWorkspace').isVisible(), false);
  assert.equal(await page.locator('#payrollUnavailable').isVisible(), true);
  await page.locator('#reloadPayroll').click();
  assert.equal(await page.locator('#payrollWorkspace').isVisible(), false);
  await page.evaluate(async () => { payrollFixture.state = 'empty'; await payrollController.load(); MinutaPayrollPresentation.mount(); });
  assert.equal(await page.locator('.payroll-soft-setup').count(), 1, 'Mount remains idempotent after reload');
  await page.close();
  assert.deepEqual(errors, [], 'No browser errors');
  assert.deepEqual(unexpected, [], 'No external traffic or financial requests');
  if (output) writeFileSync(resolve(output, 'results.json'), JSON.stringify({ preview, results, errors, unexpected }, null, 2));
  console.log(`PASS: ${results.length} viewport/theme/data combinations; native dates, original forms, zero/debt, roles, disclosures, unsaved data and unavailable/reload; no writes`);
} finally { await browser.close(); }
