import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Isolated visual fixture using the real Pro panel, confirmation dialog, CSS,
// and confirmation helper. All RPCs are synthetic; no production requests.
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const retentionSource = readFileSync(new URL('../retention-management.js', import.meta.url), 'utf8');
const providerSource = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const start = providerSource.indexOf('function requestProviderConfirmation(');
const end = providerSource.indexOf('\nfunction visitorVisitTimeLabel(', start);
assert.ok(start >= 0 && end > start, 'the real provider confirmation helper must be available');
const confirmationSource = providerSource.slice(start, end);
const browser = await chromium.launch({ headless:true,
  ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const screenshotDir = process.env.O20_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, { recursive:true });
const pageErrors = [], unexpectedRequests = [];

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://retention-visual.test/') {
        return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><meta charset="utf-8"><title>Pro retention review fixture</title><body></body></html>' });
      }
      unexpectedRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto('https://retention-visual.test/');
    await page.evaluate(html => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const panel = parsed.getElementById('retentionPanel');
      const dialog = parsed.getElementById('providerConfirmDialog');
      if (!panel || !dialog) throw new Error('real Pro retention panel or dialog missing');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerLayout = 'soft';
      document.body.style.cssText = '--theme-ink:#302b31;--theme-muted:#625c64;--theme-accent:#c43372;--theme-line:#e9cbd6;--theme-surface:#fff;--theme-surface-alt:#ffe8f0;--theme-shadow:rgba(103,67,87,.09);--porcelain-action-bg:#f3b8ce;--porcelain-action-ink:#382532;background:#fff5f8';
      const main = document.createElement('main');
      main.style.cssText = 'max-width:960px;margin:auto;padding:16px';
      main.append(document.importNode(panel, true));
      document.body.append(main, document.importNode(dialog, true));
    }, html);
    await page.addStyleTag({ content:css });
    await page.addScriptTag({ content:`function $(selector) { return document.querySelector(selector); }\n${confirmationSource}` });
    await page.addScriptTag({ content:retentionSource });
    await page.evaluate(async () => {
      const state = window.visualState = { calls:[] };
      const db = { rpc:async (name, args) => {
        state.calls.push({ name, args });
        if (name === 'get_minuta_retention_workspace') return { data:{
          organization_id:'org-test', current_role:'owner', enabled:false,
          inactivity_days:45, cooldown_days:90,
          message_template:'Здравствуйте! Будем рады видеть снова: {ссылка}',
          clients:[], deliveries:[], audit:[] }, error:null };
        if (name === 'save_minuta_retention_settings') return { data:{ organization_id:'org-test', enabled:args.p_enabled }, error:null };
        throw new Error(`Unexpected RPC: ${name}`);
      } };
      window.retention = window.MinutaRetention.createController({
        db, $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g,
          char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])),
        notify() {}, requireWrites:() => true,
        getCurrentUser:() => ({ id:'synthetic-owner' }), getSessionGeneration:() => 1,
        sessionIsCurrent:(user, generation) => user === 'synthetic-owner' && generation === 1,
        applyWriteAvailability() {}, requestConfirmation:requestProviderConfirmation
      });
      retention.bind();
      await retention.setOrganization({ id:'org-test', current_role:'owner' });
    });
    await page.locator('#retentionEnabled').check();
    const dialog = page.locator('#providerConfirmDialog');
    await dialog.waitFor({ state:'visible' });
    assert.match(await page.locator('#providerConfirmMessage').innerText(), /45 дней.*90 дней/);
    await page.waitForFunction(() => document.activeElement?.value === 'cancel');
    const geometry = await page.evaluate(() => {
      const rect = document.querySelector('#providerConfirmDialog').getBoundingClientRect();
      return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom,
        width:innerWidth, height:innerHeight, overflow:document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.width, `dialog fits ${width}px width`);
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height, `dialog fits ${width}px height`);
    assert.ok(geometry.overflow <= 0, `no outer horizontal overflow at ${width}px`);
    assert.equal(await page.locator('#providerConfirmSubmit').evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(243, 184, 206)');
    assert.equal(await page.evaluate(() => visualState.calls.filter(row => row.name === 'save_minuta_retention_settings').length), 0);
    if (screenshotDir) await page.screenshot({ path:join(screenshotDir, `o20-review-${width}.png`) });
    if (width === 390) {
      const otherThemeColor = await page.evaluate(() => {
        document.body.dataset.providerTheme = 'sage';
        const color = getComputedStyle(document.querySelector('#providerConfirmSubmit')).backgroundColor;
        document.body.dataset.providerTheme = 'pink-porcelain';
        return color;
      });
      assert.equal(otherThemeColor, 'rgb(169, 72, 66)', 'other themes keep their existing confirmation color');
    }
    await dialog.locator('[value="cancel"]').click();
    await page.waitForFunction(() => !document.querySelector('#retentionEnabled').checked);
    assert.equal(await dialog.getAttribute('class'), 'provider-confirm-dialog');
    assert.equal(await page.evaluate(() => visualState.calls.filter(row => row.name === 'save_minuta_retention_settings').length), 0);
    await page.locator('#retentionEnabled').check();
    await dialog.waitFor({ state:'visible' });
    await dialog.locator('[value="confirm"]').click();
    await page.waitForFunction(() => visualState.calls.some(row => row.name === 'save_minuta_retention_settings'));
    assert.equal(await page.evaluate(() => visualState.calls.filter(row => row.name === 'save_minuta_retention_settings')[0].args.p_enabled), true);
    console.log(`PASS: visible O20 review, cancel and confirm at ${width}px`);
    await page.close();
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpectedRequests, []);
  console.log('Retention enable visual review: 3/3 PASS (synthetic data, no production access)');
} finally { await browser.close(); }
