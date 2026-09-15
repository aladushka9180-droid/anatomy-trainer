import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'finance-center.js'), 'utf8');
const css = readFileSync(resolve(root, 'finance-center.css'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const output = process.env.MINUTA_VISUAL_OUTPUT ? resolve(process.env.MINUTA_VISUAL_OUTPUT) : '';
if (output) mkdirSync(output, { recursive:true });
const errors = [];

const periods = [{ value:'current_month', label:'Сентябрь 2026' }, { value:'previous_month', label:'Август 2026' }];
const masters = [{ value:'', label:'Все мастера' }, { value:'master-a', label:'Александра с очень длинной фамилией' }];
const fullFixture = {
  available:true, financeEnabled:true, resultReliable:true,
  today:'2026-09-15',
  periodLabel:'1–15 сентября 2026', timezone:'Europe/Samara',
  summary:{ receivedMinor:128456700, expenseMinor:3642200, serviceMinor:139820000, debtMinor:8450000, totalVisits:43, paymentKnownVisits:11 },
  completeness:{ partial:true }, permissions:{ canAddExpense:true }, filters:{ periods, masters, selectedPeriod:'current_month', selectedMaster:'' },
  movement:[
    { key:'1', label:'1 сен', fullLabel:'1 сентября', receivedMinor:16450000, expenseMinor:240000 },
    { key:'3', label:'3 сен', fullLabel:'3 сентября', receivedMinor:22100000, expenseMinor:0 },
    { key:'5', label:'5 сен', fullLabel:'5 сентября', receivedMinor:18700000, expenseMinor:922200 },
    { key:'8', label:'8 сен', fullLabel:'8 сентября', receivedMinor:25600000, expenseMinor:1200000 },
    { key:'10', label:'10 сен', fullLabel:'10 сентября', receivedMinor:21356700, expenseMinor:680000 },
    { key:'12', label:'12 сен', fullLabel:'12 сентября', receivedMinor:14600000, expenseMinor:600000 },
    { key:'15', label:'15 сен', fullLabel:'15 сентября', receivedMinor:9650000, expenseMinor:0 }
  ],
  expenseCategories:[
    { id:'materials', name:'Расходные материалы с длинным названием', amountMinor:1422200 },
    { id:'rent', name:'Аренда', amountMinor:1200000 },
    { id:'ads', name:'Реклама', amountMinor:620000 },
    { id:'tax', name:'Налоги', amountMinor:400000 }
  ],
  expenseDirectory:[{ id:'materials', name:'Материалы' }, { id:'rent', name:'Аренда' }, { id:'ads', name:'Реклама' }],
  paymentAccounts:[{ id:'cash-main', name:'Основная касса' }, { id:'bank-main', name:'Расчётный счёт' }],
  operations:[
    { id:'1', type:'income', occurredAt:'2026-09-15T08:20:00Z', label:'Оплата визита · Восстановительный массаж с очень длинным названием', category:'Визит', actorName:'Александра', amountMinor:350000 },
    { id:'2', type:'expense', occurredAt:'2026-09-14T14:10:00Z', label:'Покупка расходных материалов', category:'Материалы', actorName:'Владелец', amountMinor:128450 },
    { id:'3', type:'refund', occurredAt:'2026-09-13T10:00:00Z', label:'Возврат за продажу', category:'Возврат', actorName:'Администратор', amountMinor:50000 }
  ], nextCursor:'page-2'
};

function baseHtml(theme, scale) {
  const dark = theme === 'dark';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{font-family:Inter,Arial,sans-serif;font-size:${scale}px;--theme-surface:${dark ? '#191817' : '#fff'};--theme-surface-alt:${dark ? '#252321' : '#f4f7f5'};--theme-ink:${dark ? '#f5f1ed' : '#173128'};--theme-muted:${dark ? '#c1b7af' : '#60746a'};--theme-line:${dark ? '#71665d' : '#d9e5de'};--theme-accent:${dark ? '#d19b70' : '#296b4b'};--theme-accent-soft:${dark ? '#35261e' : '#e4f1ea'};--theme-accent-contrast:${dark ? '#20120b' : '#fff'};background:${dark ? '#111' : '#edf2ef'}}body{margin:0}.fixture{min-height:100vh}.bottom-nav{position:fixed;z-index:10;left:10px;right:10px;bottom:10px;height:68px;border:1px solid var(--theme-line);border-radius:18px;background:var(--theme-surface)}</style><style>${css}</style></head><body><main class="fixture"><div id="root"></div></main><nav class="bottom-nav" aria-label="Нижняя навигация"></nav><script>${source}</script></body></html>`;
}

try {
  for (const scenario of [
    { width:390, theme:'light', scale:16 },
    { width:760, theme:'dark', scale:18 },
    { width:1440, theme:'light', scale:16 }
  ]) {
    const page = await browser.newPage({ viewport:{ width:scenario.width, height:940 }, deviceScaleFactor:1 });
    page.on('pageerror', error => errors.push(`${scenario.width}: ${error.message}`));
    await page.setContent(baseHtml(scenario.theme, scenario.scale), { waitUntil:'domcontentloaded' });
    await page.evaluate(({ fullFixture, periods, masters }) => {
      window.mode = 'full'; window.created = []; window.reads = []; window.notices = []; window.expenseAttempts = 0; window.prepared = false; window.prepareCalls = 0;
      window.adapter = {
        readDashboard:async query => {
          reads.push({ period:query.period, masterId:query.masterId });
          if (mode === 'empty') return { available:true, financeEnabled:true, resultReliable:true, summary:{}, movement:[], operations:[], expenseCategories:[], expenseDirectory:fullFixture.expenseDirectory, paymentAccounts:fullFixture.paymentAccounts, permissions:{ canAddExpense:true }, filters:{ periods, masters, selectedPeriod:query.period, selectedMaster:query.masterId } };
          if (mode === 'unprepared') return { available:true, financeEnabled:true, resultReliable:true, summary:{}, movement:[], operations:[], expenseCategories:[], expenseDirectory:prepared ? fullFixture.expenseDirectory : [], paymentAccounts:prepared ? fullFixture.paymentAccounts : [], permissions:{ canAddExpense:true }, filters:{ periods, masters, selectedPeriod:query.period, selectedMaster:query.masterId } };
          if (mode === 'extreme') return { ...structuredClone(fullFixture), summary:{ receivedMinor:0, expenseMinor:999999999999, serviceMinor:1, debtMinor:0, totalVisits:1, paymentKnownVisits:1 }, movement:[{ key:'15', label:'15 сен', fullLabel:'15 сентября', receivedMinor:0, expenseMinor:999999999999 }], expenseCategories:[{ id:'large', name:'Большой подтверждённый расход', amountMinor:999999999999 }], operations:[], nextCursor:'', filters:{ periods, masters, selectedPeriod:query.period, selectedMaster:query.masterId } };
          if (mode === 'disabled') return { available:true, financeEnabled:false, resultReliable:false, periodLabel:'1–15 сентября 2026', summary:{ receivedMinor:3660000, serviceMinor:9300000, debtMinor:1200000, totalVisits:43, paymentKnownVisits:11 }, movement:[{ key:'15', label:'15 сен', fullLabel:'15 сентября', receivedMinor:3660000, expenseMinor:0 }], operations:[], expenseCategories:[], expenseDirectory:[], permissions:{ canAddExpense:true }, filters:{ periods, masters, selectedPeriod:query.period, selectedMaster:query.masterId } };
          if (mode === 'unavailable') return { available:false, financeEnabled:false, resultReliable:false, availabilityMessage:'Финансовый журнал ещё не готов.', summary:{}, permissions:{ canAddExpense:false }, filters:{ periods, masters, selectedPeriod:query.period, selectedMaster:query.masterId } };
          return structuredClone({ ...fullFixture, filters:{ periods, masters, selectedPeriod:query.period, selectedMaster:query.masterId } });
        },
        readOperations:async ({ cursor }) => ({ operations:[{ id:'4', type:'adjustment', occurredAt:'2026-09-12T12:00:00Z', label:'Корректировка подтверждённой операции', category:'Корректировка', actorName:'Владелец', amountMinor:-1250 }], nextCursor:cursor === 'page-2' ? '' : '' }),
        prepareExpense:async () => { prepareCalls += 1; prepared = true; },
        createExpense:async payload => { created.push(structuredClone(payload)); expenseAttempts += 1; if (expenseAttempts === 1) throw Object.assign(new Error('lost ack'), { code:'AMBIGUOUS_RESULT' }); return { id:'expense-1' }; },
        findExpenseByRequestId:async () => null
      };
      window.controller = MinutaFinanceCenter.init({ root:document.querySelector('#root'), adapter, periods, masters, today:() => '2026-09-15', onNotice:value => notices.push(value) });
    }, { fullFixture, periods, masters });
    await page.evaluate(() => controller.ready);

    assert.equal(await page.locator('[data-finance-net]').innerText(), '1\u00a0248\u00a0145\u00a0₽');
    assert.equal(await page.locator('[data-finance-received]').innerText(), '1\u00a0284\u00a0567\u00a0₽');
    assert.equal(await page.locator('[data-finance-expense]').innerText(), '36\u00a0422\u00a0₽');
    assert.equal(await page.locator('[data-finance-completeness]').innerText(), 'Оплата указана в 11 из 43 визитов. Получено учитывает только подтверждённые деньги.');
    assert.equal(await page.locator('[data-finance-chart] button').count(), 7);
    assert.equal(await page.locator('[data-finance-ring] [role="img"]').count(), 1);
    assert.ok((await page.locator('[data-finance-chart]').evaluate(node => node.compareDocumentPosition(document.querySelector('[data-finance-ring]')) & Node.DOCUMENT_POSITION_FOLLOWING)) > 0);
    await page.locator('[data-finance-chart] button').first().focus();
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('[data-finance-chart-detail]').innerText(), /3 сентября: получено 221\u00a0000\u00a0₽/);
    await page.locator('[data-finance-more]').click();
    assert.equal(await page.locator('.finance-center__operation').count(), 4);
    assert.match(await page.locator('.finance-center__operation').last().innerText(), /−12,50\u00a0₽/);

    const originalSection = await page.locator('.finance-center').evaluate(node => { node.dataset.identity = 'stable'; return node.dataset.identity; });
    await page.locator('[data-finance-master]').selectOption('master-a');
    await page.waitForFunction(() => reads.at(-1)?.masterId === 'master-a');
    assert.equal(originalSection, await page.locator('.finance-center').getAttribute('data-identity'), 'filter change must not replace whole interface');

    const geometry = await page.evaluate(() => {
      const root = document.querySelector('.finance-center');
      const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      const last = document.querySelector('.finance-center__operations').getBoundingClientRect();
      const visiblePrimary = [...root.querySelectorAll('.finance-center__primary')].filter(item => !item.hidden && getComputedStyle(item).display !== 'none' && item.getBoundingClientRect().width > 0);
      const touch = [...root.querySelectorAll('button:not([hidden]),select:not([hidden])')].filter(item => item.getBoundingClientRect().width > 0).map(item => item.getBoundingClientRect().height);
      return { overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth, width:root.getBoundingClientRect().width, navTop:nav.top, operationsBottom:last.bottom, pageBottom:document.documentElement.scrollHeight, visiblePrimary:visiblePrimary.length, touch };
    });
    assert.ok(geometry.overflow <= 1, `${scenario.width}: horizontal overflow ${geometry.overflow}`);
    assert.ok(geometry.width <= 1120.5, `${scenario.width}: centered content is too wide`);
    assert.equal(geometry.visiblePrimary, 1, `${scenario.width}: exactly one primary action on the screen`);
    assert.ok(geometry.touch.every(height => height >= 44), `${scenario.width}: touch target below 44px`);
    assert.ok(geometry.pageBottom - geometry.operationsBottom >= 92, `${scenario.width}: bottom-nav clearance missing`);
    if (output && scenario.width === 390) await page.screenshot({ path:resolve(output, 'finance-center-390-light-full.png'), fullPage:true });

    if (scenario.width === 390) {
      await page.locator('[data-finance-add]').click();
      await page.locator('[data-finance-category]').selectOption('materials');
      assert.equal(await page.locator('[data-finance-account]').inputValue(), '', 'multiple accounts must not be selected silently');
      await page.locator('[data-finance-account]').selectOption('cash-main');
      await page.locator('input[name="amount"]').fill('1284,50');
      await page.locator('input[name="note"]').fill('Материалы');
      await page.locator('[data-finance-submit]').click();
      await page.locator('[data-finance-form-error]').waitFor({ state:'visible' });
      assert.match(await page.locator('[data-finance-form-error]').innerText(), /не создаст дубль/);
      await page.locator('[data-finance-submit]').click();
      await page.waitForFunction(() => created.length === 2 && notices.includes('Расход добавлен'));
      const requests = await page.evaluate(() => created.map(item => item.requestId));
      assert.equal(requests[0], requests[1], 'lost ACK retry must reuse request id');
      assert.deepEqual(await page.evaluate(() => created.map(item => item.paymentAccountId)), ['cash-main', 'cash-main']);
      assert.equal(await page.locator('[data-finance-dialog]').getAttribute('open'), null);

      await page.evaluate(async () => { mode = 'empty'; await controller.reload(); });
      assert.equal(await page.locator('[data-finance-empty]').isVisible(), true);
      assert.equal(await page.locator('[data-finance-add]').getAttribute('hidden'), '');
      assert.equal(await page.locator('[data-finance-empty-action]').isVisible(), true);
      assert.equal(await page.locator('.finance-center__empty .finance-center__primary').count(), 1);

      await page.evaluate(async () => { mode = 'unprepared'; prepared = false; await controller.reload(); });
      await page.locator('[data-finance-empty-action]').click();
      await page.locator('[data-finance-dialog]').waitFor({ state:'visible' });
      assert.equal(await page.evaluate(() => prepareCalls), 1, 'preparation runs only from explicit add-expense action');
      await page.locator('[data-finance-close]').click();

      await page.evaluate(async () => { mode = 'extreme'; await controller.reload(); });
      assert.equal(await page.locator('[data-finance-received]').innerText(), '0\u00a0₽');
      assert.match(await page.locator('[data-finance-net]').innerText(), /^−9\u00a0999\u00a0999\u00a0999,99\u00a0₽$/);
      const amountOverflow = await page.evaluate(() => [...document.querySelectorAll('.finance-center__net strong,.finance-center__main-metrics dd,.finance-center__trust-metrics dd')].some(item => item.getBoundingClientRect().right > item.parentElement.getBoundingClientRect().right + 1));
      assert.equal(amountOverflow, false, 'large and negative values must fit their cards');

      await page.evaluate(async () => { mode = 'disabled'; await controller.reload(); });
      assert.equal(await page.locator('[data-finance-net]').innerText(), '—');
      assert.equal(await page.locator('[data-finance-expense]').innerText(), '—');
      assert.equal(await page.locator('[data-finance-received]').innerText(), '36\u00a0600\u00a0₽');
      assert.match(await page.locator('[data-finance-completeness]').innerText(), /Расходы ещё не подключены.*Итог за период не рассчитан/);
      assert.match(await page.locator('[data-finance-ring]').innerText(), /после подключения финансового журнала/);
      assert.equal(await page.locator('[data-finance-add]').getAttribute('hidden'), '');

      await page.evaluate(async () => { mode = 'unavailable'; await controller.reload(); });
      assert.equal(await page.locator('[data-finance-unavailable]').isVisible(), true);
      assert.equal(await page.locator('[data-finance-unavailable-message]').innerText(), 'Финансовый журнал ещё не готов.');
      assert.equal(await page.locator('[data-finance-content]').isHidden(), true);
    }
    if (output) await page.screenshot({ path:resolve(output, `finance-center-${scenario.width}-${scenario.theme}.png`), fullPage:true });
    await page.evaluate(() => controller.destroy());
    assert.equal(await page.locator('#root').evaluate(node => node.childElementCount), 0);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Finance center browser matrix passed: 390/760/1440, light/dark, text scale, empty/partial/full, retry and pagination.');
} finally {
  await browser.close();
}
