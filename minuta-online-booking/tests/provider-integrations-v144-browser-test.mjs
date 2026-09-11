import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.tmp-provider-integrations-v144');
mkdirSync(output, { recursive:true });
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'integration-management.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [];
const unexpected = [];
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://provider-integrations.test' || route.request().method() !== 'GET') {
        unexpected.push(`${route.request().method()} ${url.href}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try {
        return route.fulfill({
          contentType:mime[extname(relative)] || 'application/octet-stream',
          body:readFileSync(resolve(root, relative))
        });
      } catch {
        return route.abort();
      }
    });
    await page.goto('https://provider-integrations.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.body.dataset.providerTheme = 'midnight';
      document.body.dataset.providerLayout = 'bento';
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelectorAll('[data-provider-panel]').forEach(panel => {
        panel.hidden = panel.dataset.providerPanel !== 'organization';
        panel.classList.toggle('active', !panel.hidden);
      });
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelector('#organizationSectionSelect').value = 'paymentProviderPanel';
      document.querySelectorAll('#organizationSectionNav button').forEach(button => {
        button.classList.toggle('active', button.dataset.sectionTarget === 'paymentProviderPanel');
      });
      document.querySelectorAll('[data-provider-panel="organization"] .organization-section').forEach(panel => {
        panel.hidden = panel.id !== 'paymentProviderPanel';
      });
      document.querySelector('#paymentProviderWorkspace').hidden = false;
      document.querySelector('#providerIntegrationsDisclosure').open = true;
    });
    await page.addScriptTag({ content:source });
    await page.evaluate(async () => {
      window.integrationCalls = [];
      const workspace = {
        organizationId:'organization-a', currentRole:'owner',
        connections:[
          { connectionId:'11111111-1111-4111-8111-111111111111', provider:'dikidi', environment:'testing', externalAccountId:'studio-1', status:'disabled', enabled:false },
          { connectionId:'22222222-2222-4222-8222-222222222222', provider:'yclients', environment:'testing', externalAccountId:'salon-42', status:'disabled', enabled:false }
        ],
        recentEvents:[
          { eventId:'event-1', connectionId:'11111111-1111-4111-8111-111111111111', provider:'dikidi', eventType:'booking.updated', state:'processed', receivedAt:'2026-09-11T10:00:00Z', processedAt:'2026-09-11T10:00:01Z' },
          { eventId:'event-2', connectionId:'22222222-2222-4222-8222-222222222222', provider:'yclients', eventType:'booking.created', state:'accepted', receivedAt:'2026-09-11T10:01:00Z' }
        ]
      };
      const db = { rpc:async (name, args) => {
        integrationCalls.push({ name, args });
        if (name === 'get_minuta_provider_connector_read_model_v144') return { data:workspace, error:null };
        if (name === 'configure_minuta_integration_connection_v142') return {
          data:{ ok:true, provider:args.p_provider, environment:'testing', enabled:false }, error:null
        };
        return { data:null, error:{ code:'PGRST202' } };
      } };
      window.integrationNotices = [];
      window.integrationController = MinutaIntegrations.createController({
        db,
        $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
        notify:value => integrationNotices.push(value),
        requireWrites:() => true
      });
      integrationController.bind();
      await integrationController.setOrganization({ id:'organization-a', current_role:'owner' });
    });

    await page.locator('#providerIntegrationsWorkspace').waitFor({ state:'visible' });
    assert.equal(await page.locator('#providerIntegrationsState').innerText(), 'Готово: 2 из 2');
    assert.equal(await page.locator('[data-provider-integration="dikidi"] [data-provider-integration-account]').inputValue(), 'studio-1');
    assert.equal(await page.locator('[data-provider-integration="yclients"] [data-provider-integration-account]').inputValue(), 'salon-42');
    const text = await page.locator('#providerIntegrationsWorkspace').textContent();
    assert.match(text, /Контур готов/);
    assert.match(text, /Запись обновлена/);
    assert.doesNotMatch(text, /\+7|7999|Ирина|Сергей/i);
    const layout = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.provider-integration-card')].map(card => card.getBoundingClientRect());
      return {
        overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
        firstTop:cards[0]?.top,
        secondTop:cards[1]?.top,
        touchHeight:document.querySelector('[data-provider-integration-form="dikidi"] button')?.getBoundingClientRect().height
      };
    });
    assert.ok(layout.overflow <= 1, `${width}: horizontal overflow ${layout.overflow}`);
    if (width <= 760) {
      assert.ok(layout.secondTop > layout.firstTop, `${width}: cards must stack`);
      assert.ok(layout.touchHeight >= 44, `${width}: mobile button must be at least 44px`);
    } else {
      assert.ok(Math.abs(layout.secondTop - layout.firstTop) <= 1, 'desktop cards must share a row');
    }
    if (width === 390) {
      await page.locator('[data-provider-integration-form="dikidi"] button').click();
      await page.waitForFunction(() => window.integrationCalls.filter(item => item.name === 'configure_minuta_integration_connection_v142').length === 1);
      const saved = await page.evaluate(() => window.integrationCalls.find(item => item.name === 'configure_minuta_integration_connection_v142'));
      assert.equal(saved.args.p_environment, 'testing');
      assert.equal(saved.args.p_enabled, false);
      assert.equal(saved.args.p_external_account_id, 'studio-1');
      assert.match((await page.evaluate(() => window.integrationNotices.join(' '))), /подготовлен/i);
    }
    await page.screenshot({ path:resolve(output, `${width}.png`), fullPage:true });
    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('PrimeTime Pro integrations browser checks passed at 390, 760 and 1440');
