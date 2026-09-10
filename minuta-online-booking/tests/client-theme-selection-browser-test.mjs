import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [indexHtml, providerHtml, catalogSource] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'provider.html'), 'utf8'),
  readFile(path.join(root, 'theme-catalog.js'), 'utf8'),
]);

const clientButton = indexHtml.match(/<button class="client-theme-button"[\s\S]*?<\/button>/)?.[0];
const clientDialog = indexHtml.match(/<dialog class="client-theme-dialog"[\s\S]*?<\/dialog>/)?.[0];
const providerCard = providerHtml.match(/<section class="panel settings-card client-appearance-settings-card[\s\S]*?<\/section>/)?.[0];
assert.ok(clientButton && clientDialog && providerCard, 'Production theme controls must remain available to the browser fixture');

const clientHarness = `
  const catalog = window.MinutaThemeCatalog;
  const query = new URLSearchParams(location.search);
  const organizationSlug = query.get('org') || 'default';
  const organizationId = 'org-' + organizationSlug;
  const organizationSettings = catalog.settingsFromSearch(location.search);
  const options = document.querySelector('#clientThemeOptions');
  const dialog = document.querySelector('#clientThemeDialog');
  const label = document.querySelector('#clientThemeButtonLabel');
  function render() {
    const selected = catalog.readClientOverride(organizationId, organizationSlug);
    options.innerHTML = '<label><input type="radio" name="clientTheme" value="follow" ' + (selected === 'follow' ? 'checked' : '') + '>Как у организации</label>'
      + catalog.clientThemes.map(item => '<label><input type="radio" name="clientTheme" value="' + item.key + '" ' + (selected === item.key ? 'checked' : '') + '>' + item.label + '</label>').join('');
    const effective = selected === 'follow' ? organizationSettings.theme_key : selected;
    label.textContent = catalog.applyClientTheme(document.body, effective).label;
    document.querySelector('#clientHeroTitle').textContent = catalog.headline(organizationSettings.headline_key).label;
  }
  document.querySelector('#openClientTheme').addEventListener('click', () => { render(); dialog.showModal(); });
  options.addEventListener('change', event => {
    if (!event.target.matches('input[name="clientTheme"]')) return;
    catalog.writeClientOverride(organizationId, event.target.value, organizationSlug);
    render();
  });
  render();
`;

const providerHarness = `
  const catalog = window.MinutaThemeCatalog;
  const query = new URLSearchParams(location.search);
  const slug = query.get('org') || 'alpha';
  const organization = { id:'org-' + slug, public_slug:slug, public_booking_enabled:true };
  const storageKey = 'minuta-provider-client-page-v1:owner-1:' + organization.id;
  const defaults = catalog.normalizeSettings({});
  const read = () => {
    try { return catalog.normalizeSettings(JSON.parse(localStorage.getItem(storageKey) || 'null') || defaults); }
    catch { return defaults; }
  };
  const buildLink = settings => {
    const url = new URL('/client', location.href);
    url.searchParams.set('org', organization.public_slug);
    url.searchParams.set('theme', settings.theme_key);
    url.searchParams.set('headline', settings.headline_key);
    return url;
  };
  const themeHolder = document.querySelector('#providerClientThemeOptions');
  const headlineHolder = document.querySelector('#clientHeadlineOptions');
  const form = document.querySelector('#clientAppearanceForm');
  const status = document.querySelector('#clientAppearanceStatus');
  function render() {
    const settings = read();
    themeHolder.innerHTML = catalog.clientThemes.map(item => '<label><input type="radio" name="providerClientTheme" value="' + item.key + '" ' + (settings.theme_key === item.key ? 'checked' : '') + '>' + item.label + '</label>').join('');
    headlineHolder.innerHTML = catalog.headlines.map(item => '<label><input type="radio" name="providerClientHeadline" value="' + item.key + '" ' + (settings.headline_key === item.key ? 'checked' : '') + '>' + item.label + '</label>').join('');
    document.querySelector('#providerClientLink').href = buildLink(settings).href;
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const settings = catalog.normalizeSettings({
      theme_key:form.querySelector('[name="providerClientTheme"]:checked')?.value,
      headline_key:form.querySelector('[name="providerClientHeadline"]:checked')?.value,
    });
    localStorage.setItem(storageKey, JSON.stringify({ ...settings, updated_at:Date.now() }));
    document.querySelector('#providerClientLink').href = buildLink(settings).href;
    status.textContent = 'Сохранено на этом устройстве';
  });
  render();
`;

function html(body, harness) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="theme-color" content="#fff"></head><body data-client-theme="sage">${body}<script src="/theme-catalog.js"></script><script>${harness}</script></body></html>`;
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/theme-catalog.js') {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    response.end(catalogSource);
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/provider') {
    response.end(html(`${providerCard}<a id="providerClientLink">Открыть страницу клиента</a>`, providerHarness));
    return;
  }
  response.end(html(`${clientButton}<h1 id="clientHeroTitle"></h1>${clientDialog}`, clientHarness));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
let browser;
try {
  browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  const clientContext = await browser.newContext();
  const client = await clientContext.newPage();
  const clientErrors = [];
  client.on('pageerror', error => clientErrors.push(error.message));
  await client.goto(`${baseUrl}/client?org=alpha&theme=sage&headline=care`);
  await client.locator('#openClientTheme').click();
  assert.equal(await client.locator('#clientThemeDialog').evaluate(element => element.open), true, 'Theme dialog must open');
  await client.locator('input[name="clientTheme"][value="midnight"]').check();
  assert.equal(await client.locator('body').getAttribute('data-client-theme'), 'midnight', 'Selected theme must be applied immediately');
  const alphaStorage = await client.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  assert.equal(Object.values(alphaStorage).some(value => value === 'midnight'), true, 'Client choice must be stored locally');
  assert.equal(Object.keys(alphaStorage).some(key => key.includes('organization:org-alpha')), true, 'Client choice must be scoped by immutable organization id');
  await client.reload();
  assert.equal(await client.locator('body').getAttribute('data-client-theme'), 'midnight', 'Client choice must survive reload');
  await client.goto(`${baseUrl}/client?org=beta&theme=warm&headline=care`);
  assert.equal(await client.locator('body').getAttribute('data-client-theme'), 'warm', 'Another organization must keep its own default');
  await client.goto(`${baseUrl}/client?org=alpha&theme=sage&headline=care`);
  assert.equal(await client.locator('body').getAttribute('data-client-theme'), 'midnight', 'Organization-scoped client choice must remain isolated');
  await client.evaluate(() => { localStorage.clear(); localStorage.setItem('minuta-client-theme-v1:alpha','graphite'); });
  await client.reload();
  assert.equal(await client.locator('body').getAttribute('data-client-theme'), 'graphite', 'Legacy slug override must migrate');
  assert.equal(await client.evaluate(() => localStorage.getItem('minuta-client-theme-v2:organization:org-alpha')), 'graphite', 'Migrated override must be stored by organization id');
  assert.deepEqual(clientErrors, []);
  await clientContext.close();

  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const ownerErrors = [];
  owner.on('pageerror', error => ownerErrors.push(error.message));
  await owner.goto(`${baseUrl}/provider?org=alpha`);
  assert.equal(await owner.locator('#providerClientThemeChooser').getAttribute('open'), null, 'Full theme catalog must be collapsed initially');
  await owner.locator('#providerClientThemeChooser > summary').click();
  assert.equal(await owner.locator('#providerClientThemeChooser').evaluate(element => element.open), true, 'Owner theme catalog must open on demand');
  await owner.locator('input[name="providerClientTheme"][value="noir-safari"]').check();
  await owner.locator('input[name="providerClientHeadline"][value="care"]').check();
  await owner.locator('#clientAppearanceForm button[type="submit"]').click();
  await owner.getByText('Сохранено на этом устройстве').waitFor();
  const link = new URL(await owner.locator('#providerClientLink').getAttribute('href'));
  assert.deepEqual({ org:link.searchParams.get('org'), theme:link.searchParams.get('theme'), headline:link.searchParams.get('headline') }, { org:'alpha', theme:'noir-safari', headline:'care' });
  await owner.reload();
  assert.equal(await owner.locator('input[name="providerClientTheme"][value="noir-safari"]').isChecked(), true, 'Owner setting must survive reload');
  await owner.goto(`${baseUrl}/provider?org=beta`);
  assert.equal(await owner.locator('input[name="providerClientTheme"][value="sage"]').isChecked(), true, 'Owner settings must be isolated by organization');
  const clientFromOwnerLink = await ownerContext.newPage();
  await clientFromOwnerLink.goto(link.href);
  assert.equal(await clientFromOwnerLink.locator('body').getAttribute('data-client-theme'), 'noir-safari', 'Generated owner link must apply the saved organization theme');
  assert.deepEqual(ownerErrors, []);
  await ownerContext.close();
  console.log('Client theme browser checks passed: dialog, switch, organization-scoped persistence, reload and owner-generated link.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
