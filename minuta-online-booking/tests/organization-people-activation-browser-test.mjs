import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtureHtml } from './organization-people-fixture.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const provider = readFileSync(resolve(app, 'provider.js'), 'utf8').replace(/\r\n/g,'\n');
const readFunction = name => {
  const start = provider.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'actual provider function ' + name);
  const end = provider.indexOf('\n}\n', start);
  assert.ok(end > start, 'actual function boundary ' + name);
  return provider.slice(start, end + 3);
};
// Real disclosure, selector, section storage and native click navigation. The
// fixture supplies synthetic organization RPCs; unrelated lazy modules stay off.
const navigation = `
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const providerSectionPresentation=new WeakMap(),providerSectionSelections=new Map();
  const PROVIDER_SECTION_STORAGE_PREFIX='minuta-provider-subsection-v1';
  ${provider.match(/const PROVIDER_SECTION_COMPANIONS = Object\.freeze\(\{[\s\S]*?\n\}\);/)[0]}
  const activateOrganizationSectionFeature=()=>{};
  ${['providerSectionViewKey','providerSectionStorageKey','rememberedProviderSection','rememberProviderSection',
    'providerSectionSelector','syncProviderSectionSelector','preferredProviderSectionTarget',
    'providerSectionElements','setProviderSectionElementVisible','refreshProviderSectionDisclosure',
    'scrollToProviderSection'].map(readFunction).join('\n')}
  const nav=document.getElementById('organizationSectionNav');
  const choose=id=>scrollToProviderSection(nav.querySelector('[data-section-target="'+id+'"]'));
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-section-target]');
    if(button){event.preventDefault();scrollToProviderSection(button);}
  });
  document.getElementById('benefitsPanel').hidden=false;
  choose('benefitsPanel');
`;
function activationHtml() {
  const original = fixtureHtml('pink-porcelain', 'owner');
  const withNavigation = original.replace(/    const show=id=>\{[\s\S]*?    window\.logout=/, () => navigation + '\n    window.logout=');
  assert.notEqual(withNavigation, original, 'replace fixture-only hidden navigation');
  const html = withNavigation.replace("controller.load().then(()=>show('organizationPeopleSection'));",
    "controller.load().then(()=>{window.activationReady=true;});");
  assert.notEqual(html, withNavigation, 'bootstrap on benefits instead of people');
  return html;
}
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}) });
let checks=0;
const receipts=[],failures=[];
function check(actual, expected, message) {
  checks++;
  try { assert.deepEqual(actual,expected,message); } catch(error) { failures.push(error.message); }
}
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const readCount=page=>page.evaluate(()=>calls.filter(call=>call.name==='get_minuta_shift_workspace').length);
async function boot(page) {
  const errors=[],outbound=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://people.test'){outbound.push(url.href);return route.abort();}
    if(url.pathname==='/people-activation.html')return route.fulfill({body:activationHtml(),contentType:'text/html'});
    const file=resolve(app,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(app+'/')&&!file.startsWith(app+'\\')){outbound.push(url.href);return route.abort();}
    try { return route.fulfill({body:readFileSync(file),contentType:({'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'}); }
    catch {return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://people.test/people-activation.html');
  try { await page.waitForFunction(()=>window.activationReady,{},{timeout:5000}); }
  catch(error){throw new Error('Activation fixture bootstrap: '+JSON.stringify({errors,outbound})+' '+error.message);}
  await frames(page);
  return {errors,outbound};
}
async function team(page) {
  await page.locator('[data-organization-group="team"]').click();
  await page.locator('#organizationSectionNav [data-section-target="organizationPeopleSection"]').click();
  await page.locator('[data-member-card="u1"] summary').click();
  await frames(page);
}
try {
  for(const width of [390,760,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
    const f=await boot(page);
    try {
      check(await readCount(page),0,'no hidden workplace read at benefits bootstrap '+width);
      check(await page.locator('#organizationPeopleSection').isVisible(),false,'people initially hidden');
      const refreshBefore=await page.locator('[data-people-reload]').isVisible();
      check(refreshBefore,false,'People refresh must not leak into benefits '+width);
      const workspaceReads=await page.evaluate(()=>calls.filter(call=>call.name==='get_minuta_workspace').length);
      await team(page);
      // Bound far below organization synchronization (5 min) and read timeout
      // (12 s). No refresh/setOrganization is invoked to repair activation.
      await page.waitForFunction(()=>calls.some(call=>call.name==='get_minuta_shift_workspace'),{},{timeout:2000}).catch(()=>{});
      const readsAfter=await readCount(page);
      check(readsAfter,1,'native style activation starts schedule immediately '+width);
      check(await page.evaluate(()=>calls.filter(call=>call.name==='get_minuta_workspace').length),workspaceReads,'activation does not rely on organization synchronization');
      const note=page.locator('[data-member-card="u1"] [data-people-workplace]');
      const text=await note.innerText();
      check(text.includes('Проверяем график'),false,'activation resolves pending label '+width);
      check(text.includes('По графику: Основной филиал'),true,'saved shift resolves the actual workplace label '+width);
      check(await page.locator('[data-people-reload]').isVisible(),true,'refresh usable within people');
      check(await page.locator('[data-people-reload]').evaluate(node=>Boolean(node.closest('#organizationPeopleSection'))),true,'refresh belongs to People boundary');
      const args=await page.evaluate(()=>calls.find(call=>call.name==='get_minuta_shift_workspace')?.p);
      if(args){
        check(args.p_organization,'org-a','same tenant');
        check((Date.parse(args.p_end)-Date.parse(args.p_start))/86400000,13,'inclusive 14 day range unchanged');
      }
      await page.evaluate(()=>{
        const root=document.getElementById('organizationPeopleSection');
        root.classList.add('activation-neutral');root.style.setProperty('--activation-neutral','1');
        root.classList.remove('activation-neutral');
      });
      await frames(page);
      check(await readCount(page),readsAfter,'irrelevant class/style changes do not duplicate reads');
      await page.locator('[data-organization-group="sales"]').click();
      await page.locator('#organizationSectionNav [data-section-target="benefitsPanel"]').click();
      await frames(page);
      check(await page.locator('[data-people-reload]').isVisible(),false,'refresh hides on native departure '+width);
      check(await readCount(page),readsAfter,'departure does not read hidden People');
      check(await page.evaluate(()=>calls.filter(call=>!call.name.startsWith('get_')).length),0,'activation makes no writes');
      check(f.errors,[],'no runtime errors');check(f.outbound,[],'no external requests');
      receipts.push({width,refreshBefore,readsAfter,text,args,errors:f.errors,outbound:f.outbound});
    } finally {await page.close();}
  }
  // Higher ancestors can hide the same native section without mutating its
  // hidden attribute. Keep a pending response to exercise concurrency/session.
  {
    const page=await browser.newPage({viewport:{width:390,height:1000},serviceWorkers:'block'});
    const f=await boot(page);
    try {
      await page.evaluate(()=>{
        document.getElementById('dashboard').style.display='none';
        delayRead=true;
        document.querySelector('#organizationSectionNav [data-section-target="organizationPeopleSection"]').click();
      });
      await frames(page);check(await readCount(page),0,'no read while higher ancestor is style-hidden');
      await page.evaluate(()=>{document.getElementById('dashboard').style.display='';});
      await page.waitForFunction(()=>Boolean(window.releaseRead),{},{timeout:2000}).catch(()=>{});
      check(await readCount(page),1,'higher ancestor style reveal starts one read');
      await page.evaluate(()=>{
        document.getElementById('organizationPeopleSection').classList.toggle('activation-neutral');
        document.getElementById('dashboard').classList.toggle('activation-neutral');
        document.getElementById('organizationWorkspace').style.setProperty('--activation-neutral','2');
      });
      await frames(page);check(await readCount(page),1,'pending read is not duplicated by class/style mutations');
      await page.evaluate(()=>{logout();delayRead=false;window.releaseRead?.();});
      await frames(page);
      check(await page.locator('#organizationWorkspace').isVisible(),false,'stale completion cannot reopen logged out workspace');
      check(await page.evaluate(()=>notices.length),0,'stale completion cannot announce success');
      check(f.errors,[],'ancestor scenario has no runtime errors');check(f.outbound,[],'ancestor scenario has no external requests');
    } finally {await page.close();}
  }
  if(process.env.MINUTA_PEOPLE_ACTIVATION_OUTPUT){
    const output=resolve(process.env.MINUTA_PEOPLE_ACTIVATION_OUTPUT);mkdirSync(output,{recursive:true});
    writeFileSync(resolve(output,'activation.json'),JSON.stringify({checks,failures,receipts},null,2));
  }
  assert.deepEqual(failures,[],'People activation regressions');
  console.log('Organization people activation PASS: '+checks+' assertions; full provider styles/native disclosure; synthetic transport only.');
} finally {await browser.close();}
