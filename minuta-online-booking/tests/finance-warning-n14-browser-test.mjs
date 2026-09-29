import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ui = readFileSync(resolve(root, 'finance-center.js'), 'utf8');
const provider = readFileSync(resolve(root, 'finance-center-provider.js'), 'utf8');
const css = readFileSync(resolve(root, 'finance-center.css'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const output = process.env.MINUTA_VISUAL_OUTPUT ? resolve(process.env.MINUTA_VISUAL_OUTPUT) : '';
if (output) mkdirSync(output, { recursive:true });
const errors = [];
const organizationId = '11111111-1111-4111-8111-111111111111';

function rawScreen() {
  // Deliberately invented values, unrelated to the published organization.
  return {
    schema:'minuta-finance-screen-v1', ledger_version:163, organization_id:organizationId,
    currency:'RUB', timezone:'Europe/Samara', finance_enabled:true,
    period:{ start:'2024-04-01', end:'2024-04-08', bucket_grain:'day' },
    summary:{ received_minor:1234500, expense_minor:267800, services_minor:1730000, debt_minor:0 },
    confidence:{ completed_visits:8, payment_marked_visits:5, unposted_payment_visits:2,
      service_value_known_visits:7, is_complete:false, result_reliable:false },
    series:[], expense_structure:[], operations:[], categories:[], accounts:[], performers:[]
  };
}

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.setContent(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
      :root{font:16px Arial,sans-serif;--theme-surface:#fff;--theme-surface-alt:#f6f4f2;--theme-ink:#32262d;--theme-muted:#746c70;--theme-line:#e0d7da;--theme-accent:#b92c73;--theme-accent-soft:#f8ebf1;--theme-accent-contrast:#fff}
      body{margin:0;background:#fff8fb} ${css}
    </style></head><body><div id="root"></div><script>${ui}</script><script>${provider}</script></body></html>`);
    await page.evaluate(({ raw, organizationId }) => {
      window.rawScreen = raw;
      window.controller = MinutaFinanceCenter.init({
        root:document.querySelector('#root'),
        adapter:{ readDashboard:async () => MinutaFinanceProvider.normalizeFinanceScreen(window.rawScreen, { organizationId, period:'current_month' }) }
      });
    }, { raw:rawScreen(), organizationId });
    await page.evaluate(() => controller.ready);

    const warning = page.locator('[data-finance-completeness]');
    assert.match(await warning.innerText(), /^Итог пока не рассчитан/);
    assert.doesNotMatch(await warning.innerText(), /подтверждённой оплаты|подтверждённые деньги/i);
    assert.equal(await page.locator('[data-finance-net]').innerText(), '—');
    assert.deepEqual(await warning.locator('details summary').allTextContents(), [
      'Визитов без отметки оплаты: 3 из 8.',
      'Визитов с указанной оплатой без проводки в журнале: 2.',
      'Визитов без стоимости услуг: 1.'
    ]);
    for (const [index, detail] of [
      /Оплата отмечена у 5 из 8.*Список визитов без отметки.*недоступен/,
      /Из 5 визитов.*2 ещё не проведены.*Операции.*только проведённые.*список этих визитов.*недоступен/,
      /Стоимость известна у 7 из 8.*Список визитов без стоимости.*недоступен/
    ].entries()) {
      const disclosure = warning.locator('details').nth(index);
      assert.equal(await disclosure.getAttribute('open'), null);
      await disclosure.locator('summary').click();
      assert.notEqual(await disclosure.getAttribute('open'), null);
      assert.match(await disclosure.locator('p').innerText(), detail);
    }
    assert.match(await warning.locator('small').innerText(), /количества нельзя складывать/);
    const geometry = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
      summaryHeights:[...document.querySelectorAll('[data-finance-completeness] summary')].map(item => item.getBoundingClientRect().height)
    }));
    assert.ok(geometry.summaryHeights.every(height => height >= 44), `${width}: short disclosure target ${geometry.summaryHeights}`);
    const overflow = geometry.overflow;
    assert.ok(overflow <= 1, `${width}: horizontal overflow ${overflow}`);
    if (output) await page.screenshot({ path:resolve(output, `n14-finance-warning-${width}.png`), fullPage:true });

    await page.evaluate(async () => {
      rawScreen.finance_enabled = false;
      rawScreen.confidence.completed_visits = 0;
      rawScreen.confidence.payment_marked_visits = 0;
      rawScreen.confidence.unposted_payment_visits = 0;
      rawScreen.confidence.service_value_known_visits = 0;
      await controller.reload();
    });
    await page.locator('[data-finance-completeness] details summary').first().waitFor();
    assert.match(await warning.locator('details summary').first().innerText(), /Число операций неизвестно/);
    await warning.locator('summary').first().click();
    assert.match(await warning.locator('details p').first().innerText(), /список операций.*недоступны/);

    await page.evaluate(async () => {
      rawScreen.finance_enabled = true;
      rawScreen.confidence.result_reliable = false;
      rawScreen.confidence.is_complete = true;
      await controller.reload();
    });
    await page.waitForFunction(() => document.querySelector('[data-finance-completeness] details summary')?.textContent.includes('количество не указано'));
    await warning.locator('summary').first().click();
    assert.match(await warning.innerText(), /Расшифровка здесь недоступна/);
    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(errors, []);
console.log('N14 finance warning passed: 390, 760, 1440; three count disclosures and unavailable breakdowns.');
