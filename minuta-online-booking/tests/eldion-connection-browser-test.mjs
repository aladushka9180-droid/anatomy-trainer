import assert from 'node:assert/strict';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'primetime-handoff.js'), 'utf8');
const origin = 'https://provider.fixture.invalid';
const client = 'https://primetime-booking.primetime-booking-ru.workers.dev';
const {chromium} = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({headless:true, channel:process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined)});
try {
  for (const width of [390,760,1440]) for (const theme of ['pink-porcelain','carbon-crimson']) {
    const context = await browser.newContext({viewport:{width,height:1000},bypassCSP:true});
    const page = await context.newPage();
    const errors = [], requests = [];
    let mode = 'connected';
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === client && url.pathname === '/api/provider-public-link') {
        requests.push({method:request.method(),query:Object.fromEntries(url.searchParams),headers:request.headers()});
        if (mode === 'error') return route.fulfill({status:503,body:'Unavailable'});
        if (mode === 'delayed') await new Promise(resolve=>setTimeout(resolve,300));
        return route.fulfill({json:{connected:mode !== 'missing',profiles:mode === 'missing' ? [] : [{locationId:'synthetic-location',shortCode:'synthetic',displayName:'Тестовый мастер',url:mode === 'unsafe' ? 'https://untrusted.invalid/r/synthetic' : `${client}/r/synthetic`}]}});
      }
      if (url.origin === client && url.pathname === '/for-masters/start') return route.fulfill({contentType:'text/html',body:'<h1>Synthetic connection start</h1>'});
      if (url.origin !== origin || request.method() !== 'GET') return route.abort();
      if (url.pathname === '/provider.html') return route.fulfill({contentType:'text/html',body:html});
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!path.startsWith(root + sep)) return route.abort();
      try { return route.fulfill({body:readFileSync(path),contentType:path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'application/octet-stream'}); } catch { return route.abort(); }
    });
    async function open() {
      await page.goto(`${origin}/provider.html`);
      await page.evaluate(theme => {
        const card = document.querySelector('#clientAppearanceSettingsCard');
        const panel = document.querySelector('[data-provider-panel="settings"]');
        panel.hidden = false; panel.classList.add('active'); panel.replaceChildren(card); document.body.replaceChildren(panel);
        document.documentElement.classList.remove('provider-booting'); document.documentElement.classList.add('provider-ready','top-level');
        document.body.dataset.providerTheme = theme;
        document.body.style.cssText = 'display:block;padding:16px;min-height:100vh';
        panel.style.cssText = 'display:block;max-width:800px;margin:0 auto';
        window.currentUser = {id:'11111111-1111-4111-8111-111111111111'};
        window.fixtureOrg = {public_slug:'synthetic-org',public_booking_enabled:true};
        window.organizationController = {getActiveOrganization:()=>window.fixtureOrg};
      }, theme);
      await page.addScriptTag({content:source});
    }
    await open();
    await page.getByText('Подключено к Eldion',{exact:true}).waitFor();
    assert.equal(await page.locator('#eldionConnectButton').isVisible(), false);
    assert.equal(await page.getByRole('link',{name:'Открыть свой профиль'}).getAttribute('href'), `${client}/r/synthetic`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.MINUTA_AUDIT_SCREENSHOTS) {
      mkdirSync(process.env.MINUTA_AUDIT_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOTS,`eldion-connected-${theme}-${width}.png`)});
    }
    // Reload re-reads server truth, not a saved client-side badge.
    mode = 'missing'; await open();
    await page.getByText('Нет подтверждённого опубликованного профиля в Eldion.',{exact:true}).waitFor();
    const button = await page.locator('#eldionConnectButton').boundingBox();
    assert.ok(button.height >= 44);
    if (process.env.MINUTA_AUDIT_SCREENSHOTS) await page.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOTS,`eldion-connect-${theme}-${width}.png`)});
    await page.getByRole('button',{name:'Подключить к Eldion',exact:true}).click();
    await page.waitForURL(`${client}/for-masters/start?connect=1`);
    mode = 'error'; await open();
    await page.getByRole('button',{name:'Повторить проверку',exact:true}).waitFor();
    mode = 'connected'; await page.getByRole('button',{name:'Повторить проверку',exact:true}).click();
    await page.getByText('Подключено к Eldion',{exact:true}).waitFor();
    mode = 'unsafe'; await page.evaluate(()=>MinutaEldionConnection.refresh({force:true}));
    assert.equal(await page.locator('#eldionConnectionLinks a').count(),0);
    await page.evaluate(()=>{fixtureOrg=null;return MinutaEldionConnection.refresh({force:true});});
    assert.equal(await page.locator('#eldionConnectButton').isDisabled(),true);
    await page.evaluate(()=>{fixtureOrg={public_slug:'synthetic-org',public_booking_enabled:true};});
    await context.setOffline(true);
    await page.getByText('Нет соединения. Проверим подключение, когда интернет появится.',{exact:true}).waitFor();
    assert.equal(await page.locator('#eldionConnectButton').isDisabled(),true);
    await context.setOffline(false);
    mode = 'delayed';
    await page.evaluate(()=>{void MinutaEldionConnection.refresh({force:true});currentUser=null;dispatchEvent(new Event('minuta:provider-session-reset'));});
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#eldionConnectionLinks a').count(),0);
    assert.equal(await page.locator('#eldionConnectButton').isDisabled(),true);
    assert.ok(requests.length >= 4);
    assert.ok(requests.every(r=>r.method==='GET'&&!r.headers.authorization&&!r.headers.cookie&&r.query.organizationSlug==='synthetic-org'));
    assert.deepEqual(errors,[]);
    console.log(`PASS connection states, reload, retry, redirect, stale-session guard and layout: ${theme} ${width}`);
    await context.close();
  }
} finally { await browser.close(); }
