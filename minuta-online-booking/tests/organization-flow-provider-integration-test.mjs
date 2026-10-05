import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Full current provider DOM; real organization, grouping, selects, navigation,
// lazy bootstrap and shift editor. Only transport/session/view shell are fixtures.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const source = read('provider.js');
const html = read('provider.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const navigation = source.slice(source.indexOf('function providerSectionViewKey('), source.indexOf('function canUseIosTransitions('));
const features = source.slice(source.indexOf('const organizationFeatureDefinitions ='), source.indexOf('\nbatchBookingsController =', source.indexOf('const organizationFeatureDefinitions =')));
const companions = source.match(/const PROVIDER_SECTION_COMPANIONS = Object\.freeze\([\s\S]*?\n\}\);/)[0];
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
let checks = 0;
async function fixture(width = 390, role = 'owner', visible = true) {
  const page = await browser.newPage({ viewport:{ width, height:1000 }, serviceWorkers:'block', reducedMotion:'reduce', bypassCSP:true });
  const errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://org-integration.test') { unexpected.push(url.href); return route.abort(); }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) return route.abort();
    try { return route.fulfill({ body:file.endsWith('provider.html') ? html : readFileSync(file), contentType:({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2' })[extname(file)] || 'application/octet-stream' }); }
    catch { return route.fulfill({ status:404, body:'' }); }
  });
  await page.goto('https://org-integration.test/provider.html');
  await page.addStyleTag({ content:read('organization-flow.css') });
  await page.evaluate(({ role, visible }) => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove(); document.querySelector('#dashboard').hidden = false;
    Object.assign(document.body.dataset, { providerTheme:'pink-porcelain', providerLayout:'soft' });
    document.querySelectorAll('.provider-view').forEach(node => { node.hidden = node.dataset.providerPanel !== 'organization' || !visible; });
    window.role = role;
    window.orgData = { id:'org-a', name:'Синтетическая организация', public_slug:'synthetic-only', public_booking_enabled:false, current_role:role, can_manage:['owner','admin'].includes(role), locations:[{ id:'l1', name:'Центр', address:'Тестовый адрес', timezone:'Europe/Samara', active:true, is_primary:true }], members:[{ user_id:'u1', display_name:'Анна', active:true, is_bookable:true, role:'owner', is_current_user:true }], invitations:[], audit:[] };
    window.shiftData = { organization_id:'org-a', current_role:role, can_manage_team:['owner','admin'].includes(role), enabled:false, locations:orgData.locations, performers:[{ id:'u1', display_name:'Анна' }], services:[{ id:'s1', performer_id:'u1', name:'Массаж', duration_minutes:60, active:true }], shifts:[{ id:'sh1', performer_id:'u1', location_id:'l1', shift_date:'2026-10-02', start_time:'10:00', end_time:'18:00', active:true }], absences:[], bookings:[], utilization:[], audit:[] };
    window.calls = []; window.notices = []; window.loadedScripts = []; window.renameFailure = false; window.renamePending = false; window.shiftPending = false; window.readFailure=false;
  }, { role, visible });
  await page.addScriptTag({ content:read('organization.js') });
  await page.addScriptTag({ content:read('organization-flow.js') });
  await page.addScriptTag({ content:`
    const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
    const providerSectionSelections=new Map(),providerSectionPresentation=new Map(),PROVIDER_SECTION_STORAGE_PREFIX='minuta-provider-subsection-v1';
    ${companions}
    let sectionNavigationFrame=0,currentUser={id:'u1'},sessionGeneration=1;
    let certificateController=null,clientCertificateController=null,resourceController=null,shiftController=null,payrollController=null,commerceController=null,benefitController=null,loyaltyController=null,inventoryController=null,retentionController=null;
    const organizationFeatureRequests=new Map();let organizationFeatureContext='',organizationFeatureContextRevision=0;
    const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const notify=value=>notices.push(value),requireWrites=()=>Boolean(currentUser&&['owner','admin'].includes(window.role)),applyWriteAvailability=()=>{},requestProviderConfirmation=async()=>false;
    const sessionIsCurrent=(id,generation)=>currentUser?.id===id&&sessionGeneration===generation;
    const db={rpc:async(name,params)=>{
      calls.push({name,params});
      if(name==='get_minuta_workspace')return{data:{organizations:[structuredClone(orgData)],pending_invitations:[]}};
      if(name==='get_minuta_shift_workspace'){
        const data=structuredClone(shiftData);
        if(shiftPending)await new Promise(resolve=>window.releaseShift=resolve);
        return readFailure?{error:{code:'READ_FAILED'}}:{data};
      }
      if(name==='update_minuta_organization'){
        if(renamePending)await new Promise(resolve=>window.releaseRename=resolve);
        if(renameFailure)return{error:{code:'WRITE_REFUSED'}};
        orgData.name=params.p_name;return{data:{organizations:[structuredClone(orgData)],pending_invitations:[]}};
      }
      throw Error('Unapproved RPC '+name);
    }};
    async function loadProviderFeatureScript(path){
      loadedScripts.push(path);
      if(!['team-schedule-ui.js','shift-management.js'].includes(path))throw Error('Unapproved module '+path);
      await new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src=new URL(path,location.href).href;
        script.onload=resolve;script.onerror=()=>reject(Error('Module failed '+path));document.head.append(script);
      });
    }
    ${navigation}
    ${features}
    window.flow=MinutaOrganizationFlow.createController({db,notify,requireWrites,getCurrentUser:()=>currentUser,getSessionGeneration:()=>sessionGeneration,sessionIsCurrent,now:()=>new Date('2026-10-01T20:30:00Z')});flow.bind();
    const organizationController=MinutaOrganization.createController({db,$,$$,escapeHtml,notify,requireWrites,getCurrentUser:()=>currentUser,getSessionGeneration:()=>sessionGeneration,sessionIsCurrent,applyWriteAvailability,onActiveOrganizationChange:organization=>{
      flow.setOrganization(organization);prepareOrganizationFeatures(organization);shiftController?.setOrganization(organization);refreshSectionNavigation();
    }});window.orgController=organizationController;organizationController.bind();
    window.chooseSection=id=>{const button=$('#organizationSectionNav [data-section-target="'+id+'"]');scrollToProviderSection(button);};
    document.addEventListener('click',event=>{
      const section=event.target.closest('[data-section-target]');if(section){event.preventDefault();scrollToProviderSection(section);}
      const view=event.target.closest('[data-provider-view]');if(view&&view.dataset.providerView==='services'){
        $$('.provider-view').forEach(node=>node.hidden=node.dataset.providerPanel!=='services');$('#dashboard').dataset.activeView='services';
      }
    });
    document.addEventListener('change',event=>{
      const selector=event.target.closest('[data-provider-section-selector]');if(!selector)return;
      const nav=document.getElementById(selector.dataset.providerSectionSelector);
      const button=[...nav.querySelectorAll('[data-section-target]')].find(item=>item.dataset.sectionTarget===selector.value&&!item.hidden);if(button)scrollToProviderSection(button);
    });
    window.enterOverview=()=>{$$('.provider-view').forEach(node=>node.hidden=node.dataset.providerPanel!=='organization');$('#dashboard').dataset.activeView='organization';chooseSection('organizationOverviewSection');};
    window.logout=()=>{sessionGeneration++;currentUser=null;organizationController.reset();};
    new MutationObserver(refreshSectionNavigation).observe($('#dashboard'),{attributes:true,subtree:true,attributeFilter:['hidden']});
  ` });
  await page.addScriptTag({ content:read('organization-group-navigation.js') });
  await page.addScriptTag({ content:read('provider-selects.js') });
  await page.evaluate(() => orgController.load());
  if (visible) await page.waitForFunction(() => document.querySelector('.of-count').textContent === '4 из 4');
  return { page, check:async() => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.equal(await page.evaluate(() => orgData.public_booking_enabled), false); checks+=3; } };
}
async function openStep(page, index) {
  if (await page.locator('.of-steps').isHidden()) await page.locator('[data-org-action="manage"]').click();
  const selector = page.locator('[data-org-action="select"][data-org-index="'+index+'"]');
  if (await selector.count()) await selector.click();
  await page.locator('[data-org-action="open"][data-org-index="'+index+'"]' ).click();
}
try {
  for (const width of [390,760,1440]) {
    const f=await fixture(width);const {page}=f;
    try {
      const params=await page.evaluate(()=>calls.find(call=>call.name==='get_minuta_shift_workspace').params);
      assert.deepEqual(params,{p_organization:'org-a',p_start:'2026-10-02',p_end:'2026-10-15'});checks++;
      await openStep(page,0);
      assert.equal(await page.locator('[data-location-card="l1"]').getAttribute('open'),'');
      assert.equal(await page.locator('[data-location-card="l1"] input[name="address"]').inputValue(),'Тестовый адрес');
      assert.equal(await page.locator('#organizationSectionNav').getAttribute('data-active-organization-group'),'team');checks+=3;
      await page.evaluate(()=>enterOverview());await page.waitForFunction(()=>document.querySelector('.of-count').textContent==='4 из 4');
      await openStep(page,1);
      assert.equal(await page.locator('[data-member-card="u1"]').getAttribute('open'),'');
      assert.equal(await page.locator('[data-member-card="u1"] input[name="bookable"]').isChecked(),true);checks+=2;
      await page.evaluate(()=>enterOverview());await page.waitForFunction(()=>document.querySelector('.of-count').textContent==='4 из 4');
      await openStep(page,2);assert.equal(await page.locator('[data-provider-panel="services"]').isVisible(),true);checks++;
      await page.evaluate(()=>enterOverview());await page.waitForFunction(()=>document.querySelector('.of-count').textContent==='4 из 4');
      await openStep(page,3);await page.locator('#shiftWorkspace').waitFor({state:'visible'});
      assert.deepEqual(await page.evaluate(()=>loadedScripts),['team-schedule-ui.js','shift-management.js']);
      assert.equal(await page.locator('link[data-team-schedule-style]').count(),1);checks++;
      await page.locator('#teamScheduleActions [data-shift-new]').click();await page.locator('.ts-drawer[open]').waitFor({state:'visible'});
      assert.equal(await page.locator('#shiftPerformer').inputValue(),'u1');
      assert.equal(await page.locator('#shiftLocation').inputValue(),'l1');checks+=3;
      await page.keyboard.press('Escape');await page.locator('.ts-drawer[open]').waitFor({state:'hidden'});
      const filters=page.locator('#teamScheduleFilters');
      if(await filters.getAttribute('open')===null)await filters.locator('summary').click();
      const locationTrigger=page.locator('#teamScheduleLocation').locator('xpath=following-sibling::button[1]');
      await locationTrigger.click();await page.locator('.pro-select-dialog').waitFor({state:'visible'});
      await page.locator('.pro-select-dialog [data-option-index="1"]').click();
      assert.equal(await page.locator('#teamScheduleLocation').inputValue(),'l1');checks++;
      assert.equal(await page.locator('#shiftPeriod').inputValue(),'7');
      const startBefore=await page.locator('#shiftStartDate').inputValue();
      const dateAfter=days=>new Date(Date.parse(startBefore+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
      const expectedStart=dateAfter(7),expectedEnd=dateAfter(13);
      await page.locator('.ts-navigation [data-shift-week="1"]').click();
      await page.waitForFunction(start=>calls.filter(call=>call.name==='get_minuta_shift_workspace').at(-1)?.params.p_start===start,expectedStart);
      assert.deepEqual(await page.evaluate(()=>calls.filter(call=>call.name==='get_minuta_shift_workspace').at(-1).params),{p_organization:'org-a',p_start:expectedStart,p_end:expectedEnd});checks+=2;
      const periodTrigger=page.locator('#shiftPeriod').locator('xpath=following-sibling::button[1]');
      await periodTrigger.click();await page.locator('.pro-select-dialog').waitFor({state:'visible'});
      await page.locator('.pro-select-dialog [data-option-index]').filter({hasText:/^31 день$/}).click();
      assert.equal(await page.locator('#shiftPeriod').inputValue(),'31');
      const monthEnd=dateAfter(37);
      await page.waitForFunction(end=>calls.filter(call=>call.name==='get_minuta_shift_workspace').at(-1)?.params.p_end===end,monthEnd);
      assert.deepEqual(await page.evaluate(()=>calls.filter(call=>call.name==='get_minuta_shift_workspace').at(-1).params),{p_organization:'org-a',p_start:expectedStart,p_end:monthEnd});checks+=2;
      await page.evaluate(()=>{shiftData.shifts=[];enterOverview();});await page.waitForFunction(()=>document.querySelector('.of-count').textContent==='3 из 4');checks++;
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);checks++;
      await f.check();console.log('PASS full provider navigation/lazy/data/selects '+width);
    }finally{await page.close();}
  }
  const f=await fixture();const {page}=f;
  try {
    const composition=await page.evaluate(()=>{
      const count=(org,data)=>MinutaOrganizationFlow.configuration(org,data,'ready','2026-10-02','2026-10-15').filter(item=>item.done===true).length;
      const variant=(change)=>{const org=structuredClone(orgData),data=structuredClone(shiftData);change(org,data);return count(org,data);};
      return [
        variant((org,data)=>{data.shifts[0].shift_date='2026-10-15';data.shifts[0].end_time='24:00:00';}),
        variant((org,data)=>{data.shifts[0].shift_date='2026-10-16';}),
        variant((org,data)=>{data.shifts[0].shift_date='2026-10-01';}),
        variant((org,data)=>{data.shifts[0].active=false;}),
        variant((org,data)=>{data.absences=[{performer_id:'u1',active:true,starts_on:'2026-10-01',ends_on:'2026-10-03'}];}),
        variant((org,data)=>{org.members.push({user_id:'u2',active:true,is_bookable:true});}),
        variant((org,data)=>{org.locations[0].address=' ';}),
        variant((org,data)=>{data.organization_id='foreign';}),
        variant((org,data)=>{data.services[0].active=false;}),
        variant((org,data)=>{data.services[0].duration_minutes=0;})
      ];
    });
    assert.deepEqual(composition,[4,3,3,3,3,2,2,2,3,3]);checks+=composition.length;
    await page.evaluate(async()=>{readFailure=true;await flow.load();});
    assert.equal(await page.locator('.of-count').innerText(),'2 из 4 · проверка неполная');checks++;
    await page.evaluate(()=>{readFailure=false;});await page.locator('[data-org-action="retry"]').click();await page.waitForFunction(()=>document.querySelector('.of-count').textContent==='4 из 4');checks++;
    await page.evaluate(async()=>{shiftData.absences=null;await flow.load();});assert.equal(await page.locator('.of-count').innerText(),'2 из 4 · проверка неполная');checks++;
    await page.evaluate(async()=>{shiftData.absences=[];await flow.load();});
    await page.locator('[data-org-action="rename"]').click();await page.locator('#organizationName').fill('Отклонённое имя');
    await page.evaluate(()=>{renamePending=true;renameFailure=true;});await page.locator('#organizationForm button[type="submit"]').click();
    await page.waitForFunction(()=>Boolean(window.releaseRename));
    assert.equal(await page.locator('#organizationForm button[type="submit"]').isEnabled(),false);checks++;
    await page.evaluate(()=>{releaseRename();renamePending=false;});await page.locator('#organizationError').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#organizationName').value==='Отклонённое имя');checks++;
    await page.evaluate(()=>{renamePending=true;renameFailure=false;delete window.releaseRename;});await page.locator('#organizationForm button[type="submit"]').click();
    await page.waitForFunction(()=>Boolean(window.releaseRename));await page.locator('#organizationName').fill('Новый черновик');
    await page.evaluate(()=>{releaseRename();renamePending=false;});await page.waitForFunction(()=>document.querySelector('#organizationTitle').textContent==='Отклонённое имя');
    assert.equal(await page.locator('#organizationForm').isVisible(),true);assert.equal(await page.locator('#organizationName').inputValue(),'Новый черновик');checks+=2;
    await page.evaluate(()=>{shiftPending=true;void flow.load();});await page.waitForFunction(()=>Boolean(window.releaseShift));
    await page.evaluate(()=>{logout();shiftPending=false;releaseShift();});
    assert.equal(await page.locator('#organizationWorkspace').isVisible(),false);assert.equal(await page.locator('#organizationForm').isVisible(),false);checks+=2;
    await page.evaluate(async()=>{currentUser={id:'u1'};sessionGeneration++;orgData.name='Следующая сессия';shiftData.shifts=[];await orgController.load();enterOverview();});
    await page.waitForFunction(()=>document.querySelector('.of-count').textContent==='3 из 4');
    assert.equal(await page.locator('#organizationName').inputValue(),'Следующая сессия');assert.equal(await page.locator('#organizationForm').isVisible(),false);checks+=2;
    await f.check();console.log('PASS rename refused/pending/changed draft; actual organization reset/logout');
  }finally{await page.close();}
  const hidden=await fixture(390,'owner',false);
  try{assert.equal(await hidden.page.evaluate(()=>calls.filter(call=>call.name==='get_minuta_shift_workspace').length),0);checks++;await hidden.page.evaluate(()=>enterOverview());await hidden.page.waitForFunction(()=>document.querySelector('.of-count').textContent==='4 из 4');checks++;await hidden.check();console.log('PASS hidden overview defers reading until entry');}finally{await hidden.page.close();}
  const specialist=await fixture(390,'specialist',false);
  try{await specialist.page.evaluate(()=>enterOverview());await specialist.page.waitForFunction(()=>document.querySelector('.of-count').textContent==='2 из 4 · проверка неполная');assert.equal(await specialist.page.locator('[data-org-action="rename"]').isVisible(),false);assert.equal(await specialist.page.evaluate(()=>calls.every(call=>call.name.startsWith('get_'))),true);checks+=2;await specialist.check();console.log('PASS specialist scope/permissions honest partial status');}finally{await specialist.page.close();}
  const scope=await fixture(390,'admin');
  try{
    await scope.page.evaluate(()=>{shiftPending=true;void flow.load();});await scope.page.waitForFunction(()=>Boolean(window.releaseShift));
    await scope.page.evaluate(async()=>{shiftPending=false;orgData.id='org-b';orgData.name='Другая организация';shiftData.organization_id='org-b';shiftData.services=[];await orgController.load();});
    await scope.page.waitForFunction(()=>document.querySelector('.of-count').textContent==='3 из 4');
    await scope.page.evaluate(()=>releaseShift());await scope.page.waitForTimeout(30);
    assert.equal(await scope.page.locator('#organizationTitle').innerText(),'Другая организация');assert.equal(await scope.page.locator('.of-count').innerText(),'3 из 4');assert.equal(await scope.page.locator('[data-org-action="rename"]').isVisible(),true);checks+=3;
    await scope.check();console.log('PASS admin permissions and stale organization response ignored');
  }finally{await scope.page.close();}
  console.log('PASS organization full-provider integration: '+checks+' assertions; synthetic only');
}finally{await browser.close();}
