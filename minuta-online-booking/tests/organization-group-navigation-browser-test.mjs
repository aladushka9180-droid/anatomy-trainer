import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual markup, CSS and provider navigation/lazy code; transport/controllers
// are fixtures. No account, backend request or production write is involved.
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(app, 'provider.js'), 'utf8');
const providerHtml = readFileSync(resolve(app, 'provider.html'), 'utf8');
const preview = process.env.MINUTA_ORGANIZATION_GROUPS_PREVIEW === '1';
if (!preview) {
  const styleHook = providerHtml.match(/<link\s[^>]*href="organization-group-navigation\.css(?:\?v=\d+)?"[^>]*>/)?.[0];
  const scriptHook = providerHtml.match(/<script\s[^>]*src="organization-group-navigation\.js(?:\?v=\d+)?"[^>]*\bdefer\b[^>]*>/)?.[0];
  assert.ok(styleHook, 'Missing production CSS hook; preview alone requires MINUTA_ORGANIZATION_GROUPS_PREVIEW=1');
  assert.ok(scriptHook, 'Missing production deferred module hook; preview alone requires MINUTA_ORGANIZATION_GROUPS_PREVIEW=1');
  assert.ok(providerHtml.indexOf(styleHook) > providerHtml.indexOf('<link rel="stylesheet" href="organization-overview.css'), 'Grouped navigation CSS must follow the organization styles');
  assert.ok(providerHtml.indexOf(scriptHook) > providerHtml.indexOf('<script src="provider.js'), 'Grouped navigation module must follow provider.js');
} else console.log('PREVIEW: production HTML hooks are not checked; isolated CSS/module injection only');
const html = providerHtml
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
const navigation = source.slice(source.indexOf('function providerSectionViewKey('), source.indexOf('function canUseIosTransitions('));
const featureStart = source.indexOf('const organizationFeatureDefinitions =');
const features = source.slice(featureStart, source.indexOf('\nbatchBookingsController =', featureStart));
const css = readFileSync(resolve(app, 'organization-group-navigation.css'), 'utf8');
const modulePath = resolve(app, 'organization-group-navigation.js');
const output = process.env.MINUTA_SCREENSHOT_DIR;
if (output) mkdirSync(output, { recursive:true });
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
const grouping = {
  overview:['organizationOverviewSection'],
  team:['organizationPeopleSection','resourcesPanel','shiftsPanel','inventoryPanel'],
  finance:['payrollPanel','paymentProviderPanel'],
  sales:['commercePanel','benefitsPanel','loyaltyPanel','retentionPanel']
};

async function fixture({ width=390, theme='pink-porcelain', selected='organizationOverviewSection', enhance=true, failed=false, deferred=false, longPanels=false } = {}) {
  const page = await browser.newPage({ viewport:{ width,height:950 }, serviceWorkers:'block', reducedMotion:'reduce' });
  const errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://organization-groups.test') { unexpected.push(url.href); return route.abort(); }
    const file = resolve(app, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(app)) return route.abort();
    try {
      return route.fulfill({ body:file.endsWith('provider.html') ? html : readFileSync(file),
        contentType:({ '.html':'text/html', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2' })[extname(file)] || 'application/octet-stream' });
    } catch { return route.fulfill({ status:404, body:'' }); }
  });
  await page.goto('https://organization-groups.test/provider.html');
  await page.addStyleTag({ content:css });
  await page.addStyleTag({ content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
  await page.addScriptTag({ path:resolve(app,'theme-catalog.js') });
  await page.evaluate(({ theme,selected,failed,deferred }) => {
    document.documentElement.classList.remove('provider-booting','requires-top-level');
    document.documentElement.classList.add('top-level');
    document.querySelector('#providerBoot')?.remove();
    document.querySelector('#authCard').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#dashboard').dataset.activeView = 'organization';
    document.body.dataset.providerTheme = theme;
    document.body.dataset.providerLayout = 'soft';
    document.body.dataset.providerPorcelainCharacter = 'petal';
    const palette = window.MinutaThemeCatalog.theme(theme).palette;
    Object.entries({ bg:palette.bg,surface:palette.surface,'surface-alt':palette.surfaceAlt,
      ink:palette.ink,muted:palette.muted,line:palette.line,accent:palette.accent,
      'accent-soft':palette.accentSoft,'accent-contrast':palette.contrast,shadow:palette.shadow })
      .forEach(([name,value]) => document.body.style.setProperty('--theme-'+name,value));
    document.body.style.colorScheme = palette.dark ? 'dark' : 'light';
    document.querySelectorAll('.provider-view').forEach(panel => panel.hidden = panel.dataset.providerPanel !== 'organization');
    document.querySelectorAll('.provider-nav [data-provider-view]').forEach(button=>button.classList.toggle('active',button.dataset.providerView==='organization'));
    document.querySelector('#organizationLoading').hidden = true;
    document.querySelector('#organizationWorkspace').hidden = false;
    document.querySelector('#paymentProviderPanel').hidden = false;
    document.querySelector('#organizationTitle').textContent = 'Тестовая организация';
    document.querySelector('#organizationRoleBadge').textContent = 'Владелец';
    document.querySelector('#organizationName').value = 'Тестовая организация';
    localStorage.setItem('minuta-provider-subsection-v1:organization',selected);
    Object.assign(window,{ activeOrg:{id:'test-org',current_role:'owner'},failed,deferred,
      loads:0,binds:0,sets:0,notices:[],visits:[] });
  },{ theme,selected,failed,deferred });
  if(longPanels)await page.evaluate(()=>{
    for(const id of['inventoryPanel','retentionPanel','paymentProviderPanel','organizationPeopleSection']){
      const rows=document.createElement('div');rows.dataset.fixtureLongContent='true';rows.style.minHeight='1300px';
      document.getElementById(id).append(rows);
    }
  });
  await page.addScriptTag({ content:`
    const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
    const providerSectionSelections=new Map(), providerSectionPresentation=new Map(), PROVIDER_SECTION_STORAGE_PREFIX='minuta-provider-subsection-v1';
    const PROVIDER_SECTION_COMPANIONS={organizationPeopleSection:['invitationsPanel','organizationAuditPanel']};
    let sectionNavigationFrame=0,currentUser={id:'test-user'},sessionGeneration=1;
    let resourceController=null,shiftController=null,payrollController=null,commerceController=null,benefitController=null,loyaltyController=null,inventoryController=null,retentionController=null;
    const organizationFeatureRequests=new Map();let organizationFeatureContext='',organizationFeatureContextRevision=0;
    const organizationController={getActiveOrganization:()=>window.activeOrg};
    const db={},escapeHtml=x=>x,requireWrites=()=>true,applyWriteAvailability=()=>{},notify=x=>window.notices.push(x);
    const requestProviderConfirmation=async()=>false;
    const sessionIsCurrent=(id,generation)=>currentUser?.id===id&&sessionGeneration===generation;
    async function loadProviderFeatureScript(){window.loads++;if(window.deferred)await new Promise(resolve=>window.release=resolve);if(window.failed)throw Error('fixture network');}
    ${navigation}
    ${features}
    for(const[id,definition]of organizationFeatureDefinitions){
      const apiName=({'resourcesPanel':'MinutaResources','shiftsPanel':'MinutaShifts','payrollPanel':'MinutaPayroll','commercePanel':'MinutaCommerce','benefitsPanel':'MinutaBenefits','loyaltyPanel':'MinutaLoyalty','inventoryPanel':'MinutaInventory','retentionPanel':'MinutaRetention'})[id];
      window[apiName]={createController:()=>({bind(){window.binds++;},async setOrganization(){window.sets++;const panel=document.getElementById(id);panel.hidden=false;panel.querySelector('.loading-state').hidden=true;const workspace=panel.querySelector('[id$="Workspace"]');if(workspace)workspace.hidden=false;}})};
    }
    document.addEventListener('click',event=>{const button=event.target.closest('[data-section-target]');if(button){event.preventDefault();window.visits.push(button.dataset.sectionTarget);scrollToProviderSection(button);}});
    new MutationObserver(refreshSectionNavigation).observe($('#dashboard'),{attributes:true,subtree:true,attributeFilter:['hidden']});
    prepareOrganizationFeatures(window.activeOrg);refreshSectionNavigation();
  ` });
  if (enhance) await page.addScriptTag({ path:modulePath });
  return { page,check:() => { assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]); } };
}

async function choose(page, group, section) {
  await page.locator(`[data-organization-group="${group}"]`).click();
  await page.locator(`#organizationSectionNav [data-section-target="${section}"]`).click();
  await page.waitForFunction(id => document.querySelector('#organizationSectionNav').dataset.activeSectionTarget === id,section);
  await page.waitForFunction(id => document.getElementById(id).checkVisibility(),section);
  assert.equal(await page.locator(`[data-organization-group="${group}"]`).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#organizationSectionSelect').inputValue(),section);
}

async function appearance(page, width) {
  const state = await page.evaluate(() => {
    const nav=document.querySelector('#organizationSectionNav'),groups=document.querySelector('.organization-section-groups');
    const activeGroup=groups.querySelector('[aria-pressed="true"]'),activeSection=nav.querySelector('.active');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
    const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
    const luminance=color=>rgb(color).map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    return {
      overflow:document.documentElement.scrollWidth>innerWidth+2,
      navOverflow:nav.scrollWidth>nav.clientWidth+1,
      selectHidden:getComputedStyle(document.querySelector('.organization-section-selector')).display==='none',
      groupHeight:Math.min(...[...groups.querySelectorAll('button:not([hidden])')].map(button=>button.getBoundingClientRect().height)),
      sectionHeight:Math.min(...[...nav.querySelectorAll('button')].filter(button=>button.checkVisibility()).map(button=>button.getBoundingClientRect().height)),
      groupContrast:contrast(getComputedStyle(activeGroup).color,getComputedStyle(activeGroup).backgroundColor),
      sectionContrast:contrast(getComputedStyle(activeSection).color,getComputedStyle(document.body).getPropertyValue('--theme-bg')),
      activeFill:getComputedStyle(activeSection).backgroundColor,
      sectionWeight:getComputedStyle(activeSection).fontWeight,
      underline:getComputedStyle(activeSection,'::after').height,
      groupColumns:getComputedStyle(groups).gridTemplateColumns.split(' ').length
    };
  });
  assert.equal(state.overflow,false,`${width}px page overflow`);
  assert.equal(state.navOverflow,false,`${width}px section overflow`);
  assert.equal(state.selectHidden,true);
  assert.ok(state.groupHeight>=44&&state.sectionHeight>=44,JSON.stringify(state));
  assert.ok(state.groupContrast>=4.5&&state.sectionContrast>=4.5,JSON.stringify(state));
  assert.equal(state.activeFill,'rgba(0, 0, 0, 0)');
  assert.equal(state.sectionWeight,'500');
  assert.equal(state.underline,'2px');
  assert.equal(state.groupColumns,width<=580?2:4);
}

try {
  for(const width of[390,760,1440])for(const theme of['pink-porcelain','midnight','sage']){
    const f=await fixture({width,theme,longPanels:true});try{
      for(const[group,sections]of Object.entries(grouping))for(const section of sections){
        await choose(f.page,group,section);
        if(output&&theme==='pink-porcelain'&&[390,1440].includes(width)&&['inventoryPanel','retentionPanel','paymentProviderPanel'].includes(section)){
          await f.page.screenshot({path:resolve(output,`organization-groups-after-click-${section}-${width}.png`),animations:'disabled'});
        }
        if(['inventoryPanel','retentionPanel','paymentProviderPanel'].includes(section)){
          const sticky=await f.page.evaluate(id=>{
            const shell=document.querySelector('.organization-group-navigation'),nav=document.querySelector('#organizationSectionNav');
            return {scroll:scrollY,top:shell.getBoundingClientRect().top,bottom:shell.getBoundingClientRect().bottom,
              panelTop:document.getElementById(id).getBoundingClientRect().top,navVisible:nav.getBoundingClientRect().bottom>0};
          },section);
          assert.ok(sticky.scroll>0&&sticky.top>=0&&sticky.navVisible,`${width}/${section}: sticky navigation disappeared ${JSON.stringify(sticky)}`);
          assert.ok(sticky.panelTop>=sticky.bottom-1,`${width}/${section}: navigation covers the selected panel ${JSON.stringify(sticky)}`);
        }
      }
      await choose(f.page,'finance','paymentProviderPanel');
      await appearance(f.page,width);
      if(output){await f.page.locator('[data-provider-panel="organization"] .view-title').scrollIntoViewIfNeeded();await f.page.screenshot({path:resolve(output,`organization-groups-${theme}-${width}.png`),animations:'disabled'});}
      f.check();console.log(`PASS ${width}px/${theme}: all 11 sections, selection, theme, contrast and overflow`);
    }finally{await f.page.close();}
  }

  const f=await fixture({longPanels:true});try{
    const page=f.page;
    await choose(page,'team','inventoryPanel');
    await choose(page,'sales','loyaltyPanel');
    await page.locator('[data-organization-group="team"]').click();
    assert.equal(await page.locator('#organizationSectionSelect').inputValue(),'inventoryPanel','group must restore its last permitted section');
    await page.locator('[data-organization-group="sales"]').click();
    await page.evaluate(()=>{
      document.querySelector('#organizationSectionNav [data-section-target="inventoryPanel"]').disabled=true;
      document.querySelector('#organizationSectionNav [data-section-target="resourcesPanel"]').setAttribute('aria-disabled','true');
    });
    await page.locator('[data-organization-group="team"]').click();
    assert.equal(await page.locator('#organizationSectionSelect').inputValue(),'organizationPeopleSection','group must not activate disabled or aria-disabled sections');
    await page.evaluate(()=>{
      document.querySelector('#organizationSectionNav [data-section-target="inventoryPanel"]').disabled=false;
      document.querySelector('#organizationSectionNav [data-section-target="resourcesPanel"]').removeAttribute('aria-disabled');
    });
    await page.locator('[data-organization-group="finance"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-organization-group="sales"]').evaluate(node=>node===document.activeElement),true);
    await page.keyboard.press('Enter');
    // Enter moves focus in the next animation frame; finish that navigation
    // before starting the independent Home/End keyboard case.
    await page.waitForFunction(()=>document.querySelector('#organizationSectionSelect').value==='loyaltyPanel'
      && document.activeElement===document.getElementById('loyaltyPanel'));
    await page.locator('[data-organization-group="finance"]').focus();await page.keyboard.press('Home');
    assert.equal(await page.locator('[data-organization-group="overview"]').evaluate(node=>node===document.activeElement),true);
    await page.keyboard.press('End');
    assert.equal(await page.locator('[data-organization-group="sales"]').evaluate(node=>node===document.activeElement),true);
    await choose(page,'finance','paymentProviderPanel');
    await page.evaluate(()=>scrollToProviderSection(document.querySelector('[data-section-target="organizationPeopleSection"]')));
    await page.waitForFunction(()=>document.querySelector('[data-organization-group="team"]').getAttribute('aria-pressed')==='true');
    assert.equal(await page.locator('#organizationPeopleSection').evaluate(node=>node===document.activeElement),true,'existing panel focus must stay intact');
    const externalScroll=await page.evaluate(()=>({panelTop:document.querySelector('#organizationPeopleSection').getBoundingClientRect().top,
      navBottom:document.querySelector('.organization-group-navigation').getBoundingClientRect().bottom}));
    assert.ok(externalScroll.panelTop>=externalScroll.navBottom-1,`external section change must not cover its heading ${JSON.stringify(externalScroll)}`);
    await page.evaluate(()=>{
      document.querySelector('#invitationsPanel').hidden=false;document.querySelector('#organizationAuditPanel').hidden=false;refreshSectionNavigation();
    });
    assert.equal(await page.locator('#invitationsPanel').isVisible(),true);assert.equal(await page.locator('#organizationAuditPanel').isVisible(),true);
    await page.locator('[data-organization-group="overview"]').click();
    assert.equal(await page.locator('#invitationsPanel').isVisible(),false);assert.equal(await page.locator('#organizationAuditPanel').isVisible(),false);
    await choose(page,'team','inventoryPanel');
    await page.locator('[data-organization-group="overview"]').click();
    await page.evaluate(()=>{
      window.activeOrg.current_role='specialist';document.querySelector('#paymentProviderPanel').hidden=true;
      document.querySelector('#inventoryPanel').hidden=true;prepareOrganizationFeatures(window.activeOrg);refreshSectionNavigation();
    });
    await page.waitForFunction(()=>document.querySelector('[data-organization-group="sales"]').hidden);
    await page.locator('[data-organization-group="team"]').click();
    assert.notEqual(await page.locator('#organizationSectionSelect').inputValue(),'inventoryPanel','revoked last section must not open');
    assert.equal(await page.locator('#organizationSectionNav [data-section-target="inventoryPanel"]').getAttribute('hidden'),'');
    await page.evaluate(()=>{
      delete document.querySelector('#payrollPanel').dataset.lazyOrganizationFeature;document.querySelector('#payrollPanel').hidden=true;refreshSectionNavigation();
    });
    await page.waitForFunction(()=>document.querySelector('[data-organization-group="finance"]').hidden);
    f.check();console.log('PASS group memory, keyboard, external/help navigation, focus, companions and permission changes');
  }finally{await f.page.close();}

  for(const section of Object.values(grouping).flat()){
    const group=Object.keys(grouping).find(key=>grouping[key].includes(section));
    const f=await fixture({selected:section});try{
      await f.page.waitForFunction(id=>document.getElementById(id).checkVisibility(),section);
      assert.equal(await f.page.locator(`[data-organization-group="${group}"]`).getAttribute('aria-pressed'),'true');
      assert.equal(await f.page.locator('#organizationSectionSelect').inputValue(),section);
      assert.equal(await f.page.evaluate(()=>document.activeElement.tagName),'BODY','reload must not steal focus');
      f.check();
    }finally{await f.page.close();}
  }
  console.log('PASS existing stored selection restores all 11 sections and the corresponding group');

  const delayed=await fixture({selected:'loyaltyPanel',deferred:true});try{
    await delayed.page.waitForFunction(()=>typeof window.release==='function');
    assert.equal(await delayed.page.locator('[data-organization-group="sales"]').getAttribute('aria-pressed'),'true');
    assert.equal(await delayed.page.locator('#organizationSectionNav [data-section-target="loyaltyPanel"]').isVisible(),true);
    await delayed.page.evaluate(()=>{window.deferred=false;window.release();});
    await delayed.page.waitForFunction(()=>window.sets===1);
    assert.equal(await delayed.page.evaluate(()=>window.loads),1);
    delayed.check();console.log('PASS transient lazy loading preserves selected group and loads the existing controller once');
  }finally{await delayed.page.close();}

  const failed=await fixture({selected:'loyaltyPanel',failed:true});try{
    await failed.page.waitForFunction(()=>window.notices.length===1);
    await failed.page.evaluate(()=>{window.failed=false;});
    await failed.page.locator('#organizationSectionNav [data-section-target="loyaltyPanel"]').click();
    await failed.page.waitForFunction(()=>window.sets===1);
    assert.equal(await failed.page.evaluate(()=>window.loads),2);
    failed.check();console.log('PASS failed lazy module retries through the original section action');
  }finally{await failed.page.close();}

  for(const width of[390,760,1440]){
    const f=await fixture({width,enhance:false});try{
      const state=await f.page.evaluate(()=>({ready:document.querySelector('#organizationWorkspace').hasAttribute('data-organization-groups-ready'),
        selector:getComputedStyle(document.querySelector('.organization-section-selector')).display!=='none',
        nav:getComputedStyle(document.querySelector('#organizationSectionNav')).display!=='none'}));
      assert.deepEqual(state,{ready:false,selector:width<=760,nav:width>760});
      await f.page.evaluate(()=>{window.MutationObserver=class{constructor(){throw Error('fixture enhancement failure');}};});
      await f.page.addScriptTag({path:modulePath});
      assert.equal(await f.page.locator('.organization-section-groups').count(),0);
      assert.equal(await f.page.locator('#organizationWorkspace').getAttribute('data-organization-groups-ready'),null);
      f.check();
    }finally{await f.page.close();}
  }
  console.log('PASS missing enhancement and initialization failure retain original desktop/mobile fallback');

  const future=await fixture();try{
    await future.page.evaluate(()=>{
      const button=document.createElement('button');button.dataset.sectionTarget='futureOrganizationPanel';button.textContent='Новый раздел';
      document.querySelector('#organizationSectionNav').append(button);
    });
    await future.page.waitForFunction(()=>!document.querySelector('#organizationWorkspace').hasAttribute('data-organization-groups-ready'));
    assert.equal(await future.page.locator('.organization-section-groups').count(),0);
    assert.equal(await future.page.locator('#organizationSectionNav [data-organization-group-inactive]').count(),0);
    future.check();console.log('PASS an unknown future section restores the complete original navigation');
  }finally{await future.page.close();}
}finally{await browser.close();}
