import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const output = resolve(root, '../outputs/a05-a08-copy');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const benefits = readFileSync(resolve(root, 'benefit-management.js'), 'utf8');
const help = readFileSync(resolve(root, 'help/help-data.js'), 'utf8');
const { chromium } = process.env.MINUTA_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href) : createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const unexpected = [], errors = [];
mkdirSync(resolve(output, 'screenshots'), { recursive:true });

try {
  assert.match(help, /Подключить оплату только из этого кабинета нельзя/);
  assert.match(help, /Создайте шаблон/);
  assert.doesNotMatch(help.slice(help.indexOf("makeArticle('setup-yookassa'"), help.indexOf("makeArticle('yookassa-refund'")), /Supabase Secrets|тестовый платёж/);
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== 'https://copy-audit.test' || request.method() !== 'GET') {
        unexpected.push(`${request.method()} ${request.url()}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
      catch { return route.abort(); }
    });
    await page.goto('https://copy-audit.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerPorcelainCharacter = 'pearl';
      document.body.dataset.providerLayout = 'split';
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelector('#dashboard').dataset.activeView = 'organization';
      document.querySelectorAll('[data-provider-panel]').forEach(panel => { panel.hidden = panel.dataset.providerPanel !== 'organization'; });
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelector('#organizationOverviewSection').hidden = true;
      document.querySelector('#organizationPeopleSection').hidden = true;
      window.showAuditPanel = id => {
        document.querySelectorAll('[data-provider-panel="organization"] .organization-section').forEach(panel => { panel.hidden = panel.id !== id; });
        document.querySelector('#organizationSectionSelect').value = id;
      };
    });
    await page.evaluate(() => { showAuditPanel('payrollPanel'); document.querySelector('#payrollWorkspace').hidden = false; });
    assert.equal((await page.locator('.payroll-items>summary').innerText()).trim(), 'Детали начислений');
    assert.match(await page.locator('#payrollAuditPanel>summary').innerText(), /История начислений и выплат/);
    assert.doesNotMatch(await page.locator('#payrollAuditPanel>summary').innerText(), /Неизменяемая история операций/);
    await page.locator('.payroll-items>summary').click();
    assert.equal(await page.locator('.payroll-items').getAttribute('open'), '');
    await page.locator('#payrollAuditPanel>summary').click();
    assert.equal(await page.locator('#payrollAuditPanel').getAttribute('open'), null);
    await page.locator('#payrollAuditPanel>summary').click();
    assert.equal(await page.locator('#payrollAuditPanel').getAttribute('open'), '');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}: panel has no page overflow`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path:resolve(output, 'screenshots', `a05-${width}.png`), fullPage:true });

    await page.evaluate(() => showAuditPanel('paymentProviderPanel'));
    await page.evaluate(() => { document.querySelector('#paymentProviderState').textContent = 'Приём предоплаты выключен'; });
    const badge = await page.locator('#paymentProviderState').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return { bottom:bounds.bottom, lineBottoms:[...range.getClientRects()].map(rect => rect.bottom) };
    });
    assert.ok(badge.lineBottoms.every(bottom => bottom <= badge.bottom - 1), `${width}: payment state must fit inside its badge`);
    await page.locator('#paymentSandboxDisclosure summary').click();
    await page.evaluate(() => { document.querySelector('#paymentProviderWorkspace').hidden = false; });
    const payment = await page.locator('#paymentProviderPanel').innerText();
    assert.equal(await page.locator('#paymentProviderPanel>.panel-head h3').innerText(), 'Предоплата через ЮKassa');
    assert.equal(await page.locator('#paymentProviderPanel>.panel-head small').count(), 0);
    assert.match(payment, /администратор системы.*магазин на сервере/s);
    assert.match(payment, /ЮKassa и банк не участвуют/);
    assert.match(payment, /Отправлять чеки через ЮKassa/);
    assert.match(payment, /согласуйте настройки чеков с бухгалтером/);
    assert.doesNotMatch(payment, /проверьте тестовый платёж/i);
    assert.equal(await page.locator('#providerIntegrationsDisclosure').isVisible(), false, 'DIKIDI/YCLIENTS stay hidden');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}: panel has no page overflow`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path:resolve(output, 'screenshots', `a06-${width}.png`), fullPage:true });

    await page.evaluate(() => { showAuditPanel('commercePanel'); document.querySelector('#commerceWorkspace').hidden = false; });
    await page.locator('#commerceSaleCreator summary').first().click();
    const sales = await page.locator('#commercePanel').innerText();
    for (const phrase of ['Если выбран клиент — в его карточке', 'Финансовый учёт', 'Записывает продажи, возвраты и расходы', 'Продажи за вычетом возвратов', 'Деньги с карты не списываются', 'Тип продажи', 'Оформить продажу']) assert.ok(sales.toLocaleLowerCase('ru-RU').includes(phrase.toLocaleLowerCase('ru-RU')), `${width}: ${phrase}`);
    for (const phrase of ['Единая операция', 'безопасный денежный журнал', 'Касса, склад и клиент']) assert.ok(!sales.toLocaleLowerCase('ru-RU').includes(phrase.toLocaleLowerCase('ru-RU')), `${width}: obsolete ${phrase}`);
    await page.locator('#commerceSaleOptions summary').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}: panel has no page overflow`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path:resolve(output, 'screenshots', `a07-${width}.png`), fullPage:true });

    await page.evaluate(() => showAuditPanel('benefitsPanel'));
    await page.addScriptTag({ content:benefits });
    await page.evaluate(async () => {
      const db = { rpc: async name => {
        if (name !== 'get_minuta_benefit_workspace') throw Error('Unexpected RPC');
        return { data:{ organization_id:'org-synthetic', current_role:'owner', enabled:true, services:[], clients:[], bookings:[], products:[], instruments:[], redemptions:[], audit:[] }, error:null };
      } };
      window.auditBenefits = MinutaBenefits.createController({ db, $:selector => document.querySelector(selector), escapeHtml:value => String(value??''), notify:() => {}, requireWrites:() => true, getCurrentUser:() => ({id:'synthetic-user'}), getSessionGeneration:() => 1, sessionIsCurrent:() => true, applyWriteAvailability:() => {} });
      auditBenefits.bind();
      await auditBenefits.setOrganization({ id:'org-synthetic', current_role:'owner' });
    });
    const benefitText = await page.locator('#benefitsPanel').innerText();
    for (const phrase of ['Создайте шаблон', 'Погасить', 'Вернуть', 'Шаблоны абонементов и сертификатов', 'Нет выданных абонементов и сертификатов', 'Использование в записях']) assert.ok(benefitText.toLocaleLowerCase('ru-RU').includes(phrase.toLocaleLowerCase('ru-RU')), `${width}: ${phrase}`);
    assert.ok(!benefitText.includes('Резерв и погашение без двойного списания'));
    await page.locator('#benefitProductCreator>summary').click();
    const placeholder = await page.locator('#benefitProductName').evaluate(element => ({ opacity:Number(getComputedStyle(element, '::placeholder').opacity), weight:getComputedStyle(element, '::placeholder').fontWeight }));
    assert.ok(placeholder.opacity <= .6, `${width}: example must read as a placeholder`);
    assert.ok(Number(placeholder.weight) <= 400, `${width}: placeholder must not resemble entered text`);
    assert.equal(await page.locator('#benefitProductKindHelp').innerText(), 'Абонемент — заданное число посещений.');
    await page.locator('#benefitProductKind').selectOption('package');
    assert.equal(await page.locator('#benefitProductKindHelp').innerText(), 'Пакет — посещения выбранных услуг.');
    await page.locator('#benefitProductKind').selectOption('certificate');
    assert.equal(await page.locator('#benefitProductKindHelp').innerText(), 'Сертификат — сумма для оплаты визитов.');
    await page.locator('#benefitProductKind').selectOption('visit_pass');
    await page.locator('#benefitIssueCreator>summary').click();
    await page.locator('#benefitApplyCreator>summary').click();
    const formText = await page.locator('#benefitsPanel').innerText();
    for (const phrase of ['Срок действия, дней', 'Количество посещений', 'Название видно клиенту', 'Если не указать дату, срок рассчитается по шаблону', 'Нужна запись этого клиента']) assert.ok(formText.toLocaleLowerCase('ru-RU').includes(phrase.toLocaleLowerCase('ru-RU')), `${width}: ${phrase}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}: panel has no page overflow`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path:resolve(output, 'screenshots', `a08-${width}.png`), fullPage:true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${width}: horizontal overflow ${overflow}`);
    await page.close();
  }
  assert.deepEqual(unexpected, [], 'all requests remain inside the local synthetic fixture');
  assert.deepEqual(errors, [], 'no renderer errors');
  console.log('A05/A06/A07/A08 local copy and disclosure checks: PASS (390/760/1440, network blocked)');
} finally { await browser.close(); }
