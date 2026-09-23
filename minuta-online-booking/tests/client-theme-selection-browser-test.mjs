import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [clientHtml, personalHtml, providerHtml, catalogSource, css] = await Promise.all([
  'index.html', 'my-bookings.html', 'provider.html', 'theme-catalog.js', 'client-themes.css'
].map(name => readFile(path.join(root, name), 'utf8')));
const personalButton = personalHtml.match(/<button class="client-theme-button"[\s\S]*?<\/button>/)?.[0];
const personalDialog = personalHtml.match(/<dialog class="client-theme-dialog"[\s\S]*?<\/dialog>/)?.[0];
const providerCard = providerHtml.match(/<section class="panel settings-card client-appearance-settings-card[\s\S]*?<\/section>/)?.[0];
assert.ok(personalButton && personalDialog && providerCard, 'Three-layer theme controls must exist');
assert.doesNotMatch(clientHtml, /id="openClientTheme"/, 'Public booking must not expose a personal override');

const harness = `
  const catalog = window.MinutaThemeCatalog;
  const settings = catalog.settingsFromSearch(location.search);
  if (location.pathname === '/client') {
    catalog.applyClientTheme(document.body, settings.theme_key, settings);
    document.querySelector('#clientHeroTitle').textContent = catalog.headline(settings.headline_key).label;
  }
  if (location.pathname === '/personal') {
    const dialog = document.querySelector('#personalThemeDialog');
    const holder = document.querySelector('#personalThemeOptions');
    function render() {
      const saved = catalog.readPersonalSettings();
      catalog.applyClientTheme(document.body, saved.theme_key, saved);
      holder.innerHTML = catalog.clientThemes.map(item => '<label><input type="radio" name="personalTheme" value="' + item.key + '" ' + (saved.theme_key === item.key ? 'checked' : '') + '>' + item.label + '</label>').join('');
      document.querySelector('#personalPorcelainCustomization').hidden = saved.theme_key !== 'pink-porcelain';
    }
    document.querySelector('#openPersonalTheme').addEventListener('click', () => { render(); dialog.showModal(); });
    holder.addEventListener('change', event => {
      catalog.writePersonalSettings({ theme_key:event.target.value });
      render();
    });
    render();
  }
  if (location.pathname === '/provider') {
    const form = document.querySelector('#clientAppearanceForm');
    const options = document.querySelector('#providerClientThemeOptions');
    options.innerHTML = catalog.clientThemes.map(item => '<label><input type="radio" name="providerClientTheme" value="' + item.key + '">' + item.label + '</label>').join('');
    form.addEventListener('change', () => {
      const theme = form.querySelector('[name="providerClientTheme"]:checked')?.value;
      const porcelain = theme === 'pink-porcelain';
      document.querySelector('#porcelainCustomization').hidden = !porcelain;
      document.querySelector('#clientAppearancePreview').dataset.previewTheme = theme;
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      localStorage.setItem('org-theme', form.querySelector('[name="providerClientTheme"]:checked')?.value);
    });
  }
`;

const page = body => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="theme-color" content="#fff"><link rel="stylesheet" href="/client-themes.css"></head><body class="booking-client-page" data-client-theme="sage">${body}<script src="/theme-catalog.js"></script><script>${harness}</script></body></html>`;
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/theme-catalog.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(catalogSource); return; }
  if (url.pathname === '/client-themes.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/personal') { response.end(page(`${personalButton}${personalDialog}`)); return; }
  if (url.pathname === '/provider') { response.end(page(providerCard)); return; }
  response.end(page('<h1 id="clientHeroTitle"></h1>'));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
let browser;
try {
  browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext();
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  await tab.goto(`${base}/client?org=alpha&theme=pink-porcelain&headline=care&porcelain_shade=petal-pink&porcelain_character=silk`);
  assert.equal(await tab.locator('body').getAttribute('data-client-theme'), 'pink-porcelain');
  assert.equal(await tab.locator('body').getAttribute('data-client-porcelain-character'), 'silk');
  await tab.evaluate(() => localStorage.setItem('minuta-client-theme-v2:organization:org-alpha', 'midnight'));
  await tab.reload();
  assert.equal(await tab.locator('body').getAttribute('data-client-theme'), 'pink-porcelain', 'Legacy personal override must not change organization branding');

  await tab.goto(`${base}/personal`);
  await tab.locator('#openPersonalTheme').click();
  await tab.locator('input[name="personalTheme"][value="pink-porcelain"]').check();
  assert.equal(await tab.locator('body').getAttribute('data-client-theme'), 'pink-porcelain');
  assert.equal(await tab.locator('#personalPorcelainCustomization').isVisible(), true);
  await tab.reload();
  assert.equal(await tab.locator('body').getAttribute('data-client-theme'), 'pink-porcelain', 'Personal theme must survive reload');
  await tab.goto(`${base}/client?org=beta&theme=warm`);
  assert.equal(await tab.locator('body').getAttribute('data-client-theme'), 'warm', 'Personal theme must not override another organization');

  await tab.goto(`${base}/provider`);
  await tab.locator('#providerClientThemeChooser > summary').click();
  await tab.locator('input[name="providerClientTheme"][value="pink-porcelain"]').check();
  assert.equal(await tab.locator('#porcelainCustomization').isVisible(), true);
  assert.equal(await tab.locator('#clientAppearancePreview').getAttribute('data-preview-theme'), 'pink-porcelain');
  assert.equal(await tab.evaluate(() => localStorage.getItem('org-theme')), null, 'Preview must remain a draft');
  await tab.locator('#applyClientAppearance').click();
  assert.equal(await tab.evaluate(() => localStorage.getItem('org-theme')), 'pink-porcelain');
  assert.deepEqual(errors, []);
  console.log('Client theme browser checks passed: independent public, personal and provider draft layers.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
