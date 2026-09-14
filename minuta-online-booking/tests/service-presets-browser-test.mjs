import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const playwrightModule = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = playwrightModule.default || playwrightModule;
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/service-presets.css"><body class="provider-body"><button data-open-service-presets>Добавить по шаблону</button><script src="/theme-catalog.js"></script><script src="/service-presets-catalog.js"></script><script src="/service-presets.js"></script></body></html>`;
const mime = { '.css':'text/css', '.js':'text/javascript' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html); return; }
  const target = resolve(root, `.${pathname}`);
  if (!target.startsWith(root + sep)) { response.writeHead(400).end(); return; }
  try { response.setHeader('content-type', mime[extname(target)] || 'application/octet-stream'); response.end(readFileSync(target)); }
  catch { response.writeHead(404).end(); }
});

await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless:true, ...(process.env.MINUTA_CHROME_PATH ? { executablePath:process.env.MINUTA_CHROME_PATH } : { channel:'chrome' }) });
const screenshots = process.env.MINUTA_AUDIT_SCREENSHOTS;
if (screenshots) mkdirSync(screenshots, { recursive:true });

async function fixture(width = 390, mode = 'normal') {
  const browserContext = await browser.newContext({ viewport:{ width, height:920 } });
  await browserContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  if (mode === 'offline') await browserContext.setOffline(true);
  const page = await browserContext.newPage();
  if (mode === 'offline') { await browserContext.setOffline(false); await page.goto(origin); await browserContext.setOffline(true); }
  else await page.goto(origin);
  await page.evaluate(mode => {
    const catalog = window.MinutaServicePresetCatalog;
    const user = { id:'11111111-1111-4111-8111-111111111111', user_metadata:{} };
    const calls = [];
    window.fixture = { mode, calls, saved:0, edited:0 };
    const db = { async rpc(name, args) {
      calls.push({ name, args:structuredClone(args) });
      if (mode === 'retry' && calls.length === 1) return { data:null, error:{ message:'network failure' } };
      return { data:{ created_count:args.p_services.length, replayed:calls.length > 1 }, error:null };
    } };
    window.MinutaServicePresets.open({
      db,
      user,
      existingServices:[{ id:'existing-1', name:'Массаж лица', duration_minutes:30, price_rub:1000, active:true }],
      professionIds:['massage_therapist'],
      onSaved:async () => { window.fixture.saved += 1; },
      onExisting:() => { window.fixture.edited += 1; }
    });
    const applyTheme = theme => {
      const palette = theme.palette;
      const style = document.body.style;
      style.setProperty('--theme-surface', palette.surface);
      style.setProperty('--theme-surface-strong', palette.surface);
      style.setProperty('--theme-ink', palette.ink);
      style.setProperty('--theme-muted', palette.muted);
      style.setProperty('--theme-line', palette.line);
      style.setProperty('--theme-accent', palette.accent);
      style.setProperty('--theme-accent-contrast', palette.contrast);
      style.setProperty('--theme-soft', palette.accentSoft);
      document.body.dataset.providerTheme = theme.key;
      document.body.style.background = palette.bg;
    };
    window.fixture.applyTheme = applyTheme;
    applyTheme(window.MinutaThemeCatalog.themes[0]);
    window.fixture.catalog = catalog;
  }, mode);
  return { page, browserContext };
}

try {
  const entry = await fixture(390);
  await entry.page.evaluate(() => {
    document.querySelector('#servicePresetsDialog').close();
    window.currentUser = { id:'22222222-2222-4222-8222-222222222222', user_metadata:{ minuta_profession_ids:['massage_therapist'] } };
    window.ownServices = [];
    window.db = { rpc:async name => name === 'get_provider_service_preset_state_v160'
      ? { data:{ catalog_version:null, profession_ids:[] }, error:null }
      : { data:{ created_count:0 }, error:null } };
  });
  await entry.page.locator('body > [data-open-service-presets]').click();
  await entry.page.locator('#servicePresetsDialog').waitFor({ state:'visible' });
  assert.equal(await entry.page.locator('[data-service-profession][value="massage_therapist"]').isChecked(), true, 'Metadata profession fallback must survive an empty server state');
  await entry.browserContext.close();

  const changedProfession = await fixture(390);
  await changedProfession.page.locator('[data-service-presets-next]').click();
  await changedProfession.page.locator('[data-service-preset="massage_full_body"]').click();
  await changedProfession.page.locator('[data-draft-price]').fill('2500');
  await changedProfession.page.locator('[data-service-presets-back]').click();
  await changedProfession.page.locator('.service-profession-chip').filter({ has:changedProfession.page.locator('[data-service-profession][value="esthetician"]') }).click();
  await changedProfession.page.locator('.service-profession-chip').filter({ has:changedProfession.page.locator('[data-service-profession][value="massage_therapist"]') }).click();
  await changedProfession.page.locator('[data-service-presets-next]').click();
  assert.equal(await changedProfession.page.locator('[data-service-draft]').count(), 0, 'Deselecting a profession must remove its preset drafts');
  await changedProfession.browserContext.close();

  const existingEdit = await fixture(390);
  await existingEdit.page.locator('[data-service-presets-next]').click();
  await existingEdit.page.locator('[data-service-preset="massage_face"]').click();
  await existingEdit.page.locator('#servicePresetsDialog').waitFor({ state:'hidden' });
  assert.equal(await existingEdit.page.evaluate(() => fixture.edited), 1, 'Existing service should open its editor callback');
  await existingEdit.browserContext.close();

  const { page, browserContext } = await fixture(390);
  const professions = page.locator('[data-service-profession]');
  assert.equal(await professions.count(), 12);
  assert.equal(await professions.nth(0).isChecked?.() ?? true, true);
  await page.locator('.service-profession-chip').filter({ has:page.locator('[data-service-profession][value="esthetician"]') }).click();
  await page.locator('[data-service-presets-next]').click();
  assert.equal(await page.locator('[data-service-preset]').count(), 12, 'Only six immediate presets per selected profession');
  const existing = page.locator('[data-service-preset="massage_face"]');
  assert.match(await existing.innerText(), /Уже добавлено/);
  await page.locator('[data-service-preset="massage_full_body"]').click();
  assert.equal(await page.locator('[data-service-draft]').count(), 1);
  assert.equal(await page.locator('[data-draft-price]').getAttribute('value'), '');
  assert.equal(await page.evaluate(() => fixture.calls.length), 0, 'Selection must not create services');
  await page.locator('[data-draft-price]').fill('2500');
  await page.locator('[data-service-presets-search]').fill('уход');
  assert.ok(await page.locator('[data-service-preset]').count() >= 1);
  await page.locator('[data-service-presets-search]').fill('');
  await page.locator('[data-add-custom-service]').click();
  const custom = page.locator('[data-service-draft]').last();
  await custom.locator('[data-draft-name]').fill('Авторская услуга');
  await custom.locator('[data-draft-price]').fill('1800');
  await custom.locator('[data-draft-duration]').selectOption('60');
  await page.locator('[data-service-presets-next]').click();
  const reviewCount = await page.locator('.service-preset-review article').count();
  const reviewError = await page.locator('[role="alert"]').allTextContents();
  assert.equal(reviewCount, 2, `Review did not open: ${reviewError.join(' | ')}`);
  assert.equal(await page.evaluate(() => fixture.calls.length), 0, 'Review must still be read-only');
  const cta = page.locator('[data-service-presets-next]');
  assert.ok((await cta.evaluate(element => element.getBoundingClientRect().height)) >= 44);
  if (screenshots) await page.screenshot({ path:resolve(screenshots, 'service-presets-review-390.png'), fullPage:true });
  await cta.click();
  await page.locator('#servicePresetsDialog').waitFor({ state:'hidden' });
  const saved = await page.evaluate(() => fixture);
  assert.equal(saved.saved, 1);
  assert.equal(saved.calls.length, 1);
  assert.equal(saved.calls[0].name, 'create_provider_services_from_presets_v160');
  assert.equal(saved.calls[0].args.p_services.length, 2);
  assert.equal(saved.calls[0].args.p_professions.length, 2);
  await browserContext.close();

  for (const width of [390, 760, 1440]) {
    const current = await fixture(width);
    const metrics = await current.page.evaluate(async widthValue => {
      const themes = window.MinutaThemeCatalog.themes;
      const layouts = ['linear','soft','capsule','editorial','bento','split'];
      const failures = [];
      for (const theme of themes) for (const layout of layouts) {
        fixture.applyTheme(theme);
        document.body.dataset.providerLayout = layout;
        await new Promise(requestAnimationFrame);
        const dialog = document.querySelector('#servicePresetsDialog').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.service-profession-chip')].map(element => element.getBoundingClientRect().height);
        const overflow = document.documentElement.scrollWidth > innerWidth + 1 || dialog.left < -1 || dialog.right > innerWidth + 1;
        const colors = getComputedStyle(document.querySelector('#servicePresetsDialog'));
        if (overflow || Math.min(...buttons) < 44 || colors.color === colors.backgroundColor) failures.push(`${theme.key}/${layout}`);
      }
      return { failures, themeCount:themes.length, width:widthValue, scrollWidth:document.documentElement.scrollWidth };
    }, width);
    assert.deepEqual(metrics.failures, [], `${width}px theme/layout geometry failures`);
    assert.ok(metrics.themeCount >= 35);
    assert.ok(metrics.scrollWidth <= width + 1);
    if (screenshots) await current.page.screenshot({ path:resolve(screenshots, `service-presets-professions-${width}.png`), fullPage:true });
    await current.browserContext.close();
  }

  const retry = await fixture(760, 'retry');
  await retry.page.locator('[data-service-presets-next]').click();
  await retry.page.locator('[data-service-preset="massage_full_body"]').click();
  await retry.page.locator('[data-draft-price]').fill('2500');
  await retry.page.locator('[data-service-presets-next]').click();
  await retry.page.locator('[data-service-presets-next]').click();
  await retry.page.locator('[role="alert"]').waitFor();
  const firstRequest = await retry.page.evaluate(() => fixture.calls[0]?.args?.p_request || null);
  await retry.page.locator('[data-service-presets-next]').click();
  await retry.page.locator('#servicePresetsDialog').waitFor({ state:'hidden' });
  const retryState = await retry.page.evaluate(() => fixture);
  assert.equal(retryState.calls.length, 2);
  assert.equal(retryState.calls[0].args.p_request, retryState.calls[1].args.p_request);
  assert.equal(retryState.calls[0].args.p_request, firstRequest);
  await retry.browserContext.close();

  const offline = await fixture(390, 'offline');
  await offline.page.locator('[data-service-presets-next]').click();
  await offline.page.locator('[data-service-preset="massage_full_body"]').click();
  await offline.page.locator('[data-draft-price]').fill('2500');
  await offline.page.locator('[data-service-presets-next]').click();
  await offline.page.locator('[data-service-presets-next]').click();
  assert.match(await offline.page.locator('[role="alert"]').innerText(), /соединения|подключения/i);
  assert.equal(await offline.page.evaluate(() => fixture.calls.length), 0);
  await offline.browserContext.close();

  console.log('Service presets browser checks passed: selection, review-only confirmation, retry, offline and all theme/layout geometry at 390/760/1440.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
}
