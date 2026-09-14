import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.tmp-finance-v163');
mkdirSync(output, { recursive:true });
const html = readFileSync(resolve(root, 'provider.html'), 'utf8');
const baseStyles = readFileSync(resolve(root, 'styles.css'), 'utf8');
const financeStyles = readFileSync(resolve(root, 'finance-center.css'), 'utf8');
const financeSource = readFileSync(resolve(root, 'finance-center.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const organizationId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:1000 }, serviceWorkers:'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html lang="ru"><body></body></html>');
    await page.evaluate(markup => {
      const documentCopy = new DOMParser().parseFromString(markup, 'text/html');
      document.body.append(documentCopy.querySelector('#financeCenter').cloneNode(true));
      document.body.append(documentCopy.querySelector('#financeExpenseDialog').cloneNode(true));
      document.body.dataset.providerTheme = 'neutral';
      document.body.dataset.providerColorMode = 'dark';
    }, html);
    await page.addStyleTag({ content:baseStyles });
    await page.addStyleTag({ content:financeStyles });
    await page.addScriptTag({ content:financeSource });
    await page.evaluate(async ({ organizationId, accountId }) => {
      window.financeCalls = [];
      window.addAttempts = 0;
      if (!crypto.randomUUID) Object.defineProperty(crypto, 'randomUUID', { value:() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const payload = {
        organization_id:organizationId, expense_minor:700000, timezone:'Europe/Samara', category_version:1,
        accounts:[{ id:accountId, name:'Основная касса', account_type:'cash' }],
        daily_expenses:[{ date:'2026-09-10', amount_minor:500000 }, { date:'2026-09-12', amount_minor:200000 }],
        expense_structure:[{ category_key:'rent', amount_minor:500000 }, { category_key:'materials', amount_minor:200000 }],
        operations:[{ expense_id:'33333333-3333-4333-8333-333333333333', category_key:'rent', description:'Аренда кабинета', occurred_on:'2026-09-10', amount_minor:500000, reversed:false }]
      };
      const db = { rpc:async (name, args) => {
        financeCalls.push({ name, args:structuredClone(args) });
        if (name === 'get_minuta_finance_expenses_v163') return { data:structuredClone(payload), error:null };
        if (name === 'record_minuta_expense_v163') {
          addAttempts += 1;
          if (addAttempts === 1) return { data:null, error:{ message:'uncertain transport' } };
          return { data:{ organization_id:organizationId, expense_id:'44444444-4444-4444-8444-444444444444', replayed:true }, error:null };
        }
        return { data:null, error:{ message:`unexpected rpc ${name}` } };
      }};
      const controller = MinutaFinanceCenter.createController({
        db, $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
        notify:message => { window.lastFinanceNotice = message; }, requireWrites:() => true, applyWriteAvailability:() => {}
      });
      controller.bind();
      controller.setOrganization({ id:organizationId, current_role:'owner' });
      controller.updateSnapshot({
        range:{ start:'2026-09-01', end:'2026-09-30' }, source:'own', receivedRub:36600,
        serviceValueRub:140700, debtRub:1500, completedCount:43, knownPaymentCount:11,
        daily:[{ date:'2026-09-10', receivedRub:16600 }, { date:'2026-09-12', receivedRub:20000 }],
        operations:[
          { date:'2026-09-12', description:'Массаж', category:'Анна', amountRub:20000, type:'Получено' },
          { date:'2026-09-11', description:'Частичная оплата', category:'Ирина', amountRub:16600, type:'Получено' }
        ]
      });
      window.financeController = controller;
      await controller.load({ start:'2026-09-01', end:'2026-09-30' });
    }, { organizationId, accountId });

    assert.equal(await page.locator('#financeNet').innerText(), '29 600 ₽');
    assert.equal(await page.locator('#reportRevenue').innerText(), '36 600 ₽');
    assert.equal(await page.locator('#reportCompletedValue').innerText(), '140 700 ₽');
    assert.equal(await page.locator('#reportDebt').innerText(), '1 500 ₽');
    assert.equal(await page.locator('#financeExpenses').innerText(), '7 000 ₽');
    assert.match(await page.locator('#financeCoverageText').innerText(), /11 из 43/);
    assert.equal(await page.locator('#financeFlowChart .finance-flow-column').count(), 2);
    assert.equal(await page.locator('#financeOperationList .finance-operation-row').count(), 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px must not overflow`);
    const buttonBox = await page.locator('#financeAddExpense').boundingBox();
    assert.ok(buttonBox && buttonBox.height >= 40, `${width}px primary action remains touchable`);

    if (width === 390) {
      await page.locator('#financeAddExpense').click();
      assert.equal(await page.locator('#financeExpenseDialog').getAttribute('open'), '');
      await page.locator('#financeExpenseCategory').selectOption('materials');
      await page.locator('#financeExpenseDescription').fill('Масло для массажа');
      await page.locator('#financeExpenseAmount').fill('1250.50');
      await page.locator('#financeExpenseDate').fill('2026-09-12');
      await page.locator('#financeExpenseAccount').selectOption(accountId);
      await page.locator('#financeExpenseForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true })));
      await page.waitForFunction(() => window.addAttempts === 1);
      await page.locator('#financeExpenseError').waitFor({ state:'visible' });
      await page.locator('#financeExpenseForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true })));
      await page.waitForFunction(() => window.addAttempts === 2);
      const requests = await page.evaluate(() => financeCalls.filter(call => call.name === 'record_minuta_expense_v163').map(call => call.args.p_request_id));
      assert.equal(requests.length, 2);
      assert.equal(requests[0], requests[1], 'uncertain retry reuses the request id');
      assert.equal(await page.locator('#financeExpenseDialog').getAttribute('open'), null);
    }
    await page.screenshot({ path:resolve(output, `money-${width}.png`), fullPage:true });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: finance result, coverage, cash flow, operations, expense dialog and idempotent retry`);
    await page.close();
  }
} finally {
  await browser.close();
}
