import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual provider markup, styles, navigation and lazy bootstrap. Module transport
// and feature controllers are local fixtures: no authenticated/server writes.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'provider.js'), 'utf8');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const navigation = source.slice(source.indexOf('function providerSectionViewKey('), source.indexOf('function canUseIosTransitions('));
const features = source.slice(source.indexOf('const organizationFeatureDefinitions ='), source.indexOf('\nbatchBookingsController =', source.indexOf('const organizationFeatureDefinitions =')));
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
let passed = 0;
async function fixture(width = 390, selected = 'loyaltyPanel', { visible = true, role = 'owner', failed = false, deferred = false } = {}) {
  const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block', bypassCSP:true });
  const unexpected = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://lazy.test') { unexpected.push(url.href); return route.abort(); }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) return route.abort();
    try { return route.fulfill({ body:file.endsWith('provider.html') ? html : readFileSync(file), contentType:({ '.html':'text/html', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2' })[extname(file)] || 'application/octet-stream' }); }
    catch { return route.fulfill({ status:404, body:'' }); }
  });
  await page.goto('https://lazy.test/provider.html');
  await page.evaluate(({ selected, visible, role, failed, deferred }) => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot').remove();
    document.querySelector('#dashboard').hidden = false;
    document.body.dataset.providerTheme = 'loft'; document.body.dataset.providerLayout = 'bento';
    document.querySelectorAll('.provider-view').forEach(e => e.hidden = e.dataset.providerPanel !== 'organization' || !visible);
    document.querySelector('#organizationWorkspace').hidden = false;
    document.querySelector('#organizationLoading').hidden = true;
    localStorage.setItem('minuta-provider-subsection-v1:organization', selected);
    Object.assign(window, { activeOrg:{ id:'org-a', current_role:role }, failed, deferred, loads:0, binds:0, sets:0, notices:[], selected });
  }, { selected, visible, role, failed, deferred });
  await page.addScriptTag({ content:`
    const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
    const providerSectionSelections=new Map(), providerSectionPresentation=new Map(), PROVIDER_SECTION_STORAGE_PREFIX='minuta-provider-subsection-v1', PROVIDER_SECTION_COMPANIONS={};
    let sectionNavigationFrame=0, currentUser={id:'user-a'}, sessionGeneration=1;
    let resourceController=null,shiftController=null,payrollController=null,benefitController=null,loyaltyController=null,inventoryController=null,retentionController=null;
    const organizationFeatureRequests=new Map(); let organizationFeatureContext='',organizationFeatureContextRevision=0;
    const organizationController={getActiveOrganization:()=>window.activeOrg};
    const db={},escapeHtml=x=>x,requireWrites=()=>true,applyWriteAvailability=()=>{},notify=x=>window.notices.push(x);
    const sessionIsCurrent=(id,generation)=>currentUser?.id===id&&sessionGeneration===generation;
    async function loadProviderFeatureScript(){window.loads++;if(window.deferred)await new Promise(resolve=>window.release=resolve);if(window.failed)throw Error('fixture network');}
    ${navigation}
    ${features}
    for (const [id, definition] of organizationFeatureDefinitions) {
      const apiName=({'resourcesPanel':'MinutaResources','shiftsPanel':'MinutaShifts','payrollPanel':'MinutaPayroll','benefitsPanel':'MinutaBenefits','loyaltyPanel':'MinutaLoyalty','inventoryPanel':'MinutaInventory','retentionPanel':'MinutaRetention'})[id];
      window[apiName]={createController:()=>({bind(){window.binds++;},async setOrganization(org){window.sets++;const panel=document.getElementById(id);panel.hidden=false;panel.querySelector('.loading-state').hidden=true;const workspace=panel.querySelector('[id$="Workspace"]');if(workspace)workspace.hidden=false;}})};
    }
    prepareOrganizationFeatures(window.activeOrg);
    new MutationObserver(refreshSectionNavigation).observe($('#dashboard'),{attributes:true,subtree:true,attributeFilter:['hidden']});
    refreshSectionNavigation();
  ` });
  return { page, check:() => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); } };
}
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
try {
  for (const width of [390, 760, 1440]) for (const section of ['resourcesPanel','shiftsPanel','payrollPanel','benefitsPanel','loyaltyPanel','inventoryPanel','retentionPanel']) {
    await test(`${width}px remembered ${section} loads once without a second click or focus theft`, async () => {
      const f = await fixture(width, section); try {
        await f.page.waitForFunction(() => window.sets === 1);
        assert.equal(await f.page.locator('#' + section).isVisible(), true);
        await f.page.evaluate(() => { for(let i=0;i<8;i++)refreshSectionNavigation(); });
        assert.deepEqual(await f.page.evaluate(() => ({ loads, binds, sets, focus:document.activeElement.tagName, overflow:document.documentElement.scrollWidth>innerWidth+2 })), { loads:1, binds:1, sets:1, focus:'BODY', overflow:false });
        f.check();
      } finally { await f.page.close(); }
    });
  }
  await test('hidden organization defers loading until entry even when selected target did not change', async () => {
    const f = await fixture(390, 'loyaltyPanel', { visible:false }); try {
      assert.equal(await f.page.evaluate(() => loads), 0);
      await f.page.evaluate(() => { document.querySelector('[data-provider-panel="organization"]').hidden=false;refreshSectionNavigation(); });
      await f.page.waitForFunction(() => window.sets===1); f.check();
    } finally { await f.page.close(); }
  });
  await test('specialist cannot restore an admin feature', async () => {
    const f = await fixture(390, 'loyaltyPanel', { role:'specialist' }); try {
      assert.equal(await f.page.evaluate(() => loads), 0);
      assert.equal(await f.page.locator('#loyaltyPanel').isVisible(), false); f.check();
    } finally { await f.page.close(); }
  });
  await test('script failure does not loop through hidden observers and explicit selection retries', async () => {
    const f = await fixture(390, 'loyaltyPanel', { failed:true }); try {
      await f.page.waitForFunction(() => window.notices.length===1);
      await f.page.evaluate(() => { for(let i=0;i<8;i++)refreshSectionNavigation(); });
      assert.equal(await f.page.evaluate(() => loads), 1);
      await f.page.evaluate(() => { window.failed=false;scrollToProviderSection(document.querySelector('[data-section-target="loyaltyPanel"]')); });
      await f.page.waitForFunction(() => window.sets===1);
      assert.equal(await f.page.evaluate(() => loads), 2); f.check();
    } finally { await f.page.close(); }
  });
  for(const transition of ['role','organization','logout']) await test(`pending loader ignores stale ${transition} and repeated clicks stay single-flight`, async () => {
    const f = await fixture(390, 'loyaltyPanel', { deferred:true }); try {
      await f.page.waitForFunction(() => !!window.release);
      await f.page.evaluate(() => { const button=document.querySelector('[data-section-target="loyaltyPanel"]');scrollToProviderSection(button);scrollToProviderSection(button); });
      assert.equal(await f.page.evaluate(() => loads), 1);
      await f.page.evaluate(transition => {
        if(transition==='role')window.activeOrg={id:'org-a',current_role:'specialist'};
        else if(transition==='organization')window.activeOrg=null;
        else {currentUser=null;sessionGeneration++;window.activeOrg=null;}
        prepareOrganizationFeatures(window.activeOrg);refreshSectionNavigation();window.release();
      }, transition);
      await f.page.waitForFunction(() => ![...organizationFeatureRequests.values()].some(r=>r.pending));
      assert.equal(await f.page.evaluate(() => binds), 0);
      assert.equal(await f.page.locator('#loyaltyPanel').isVisible(), false); f.check();
    } finally { await f.page.close(); }
  });
} finally { await browser.close(); }
console.log(`${passed}/${passed} lazy restore browser checks passed; real Auth/RPC not exercised`);
