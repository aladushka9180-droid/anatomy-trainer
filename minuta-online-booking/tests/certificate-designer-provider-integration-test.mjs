import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(resolve(app,'provider.js'),'utf8');
const html=readFileSync(resolve(app,'provider.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const navigation=source.slice(source.indexOf('function providerSectionViewKey('),source.indexOf('function canUseIosTransitions('));
const features=source.slice(source.indexOf('const organizationFeatureDefinitions ='),source.indexOf('\nbatchBookingsController =',source.indexOf('const organizationFeatureDefinitions =')));
const clients=source.slice(source.indexOf('function resetClientCertificates()'),source.indexOf('\norganizationController =',source.indexOf('function resetClientCertificates()')));
// Only the certificate glue; intervening unrelated controller construction stays out of the fixture.
const clientGlue=clients.slice(0,clients.indexOf('\nclientDirectoryController =')>0?clients.indexOf('\nclientDirectoryController ='):clients.indexOf('\nclientBookingController =')>0?clients.indexOf('\nclientBookingController ='):clients.length);
const end=clientGlue.indexOf('\n}',clientGlue.indexOf('async function openClientCertificate('))+2;
assert.ok(end>2);
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true});
const output=process.env.MINUTA_CERTIFICATE_OUTPUT;
if(output)mkdirSync(output,{recursive:true});
const image=process.env.MINUTA_CERTIFICATE_TEMPLATE?'data:image/png;base64,'+readFileSync(process.env.MINUTA_CERTIFICATE_TEMPLATE).toString('base64'):null;
let checks=0;
async function fixture(width=390,{role='specialist',selected='organizationOverviewSection'}={}){
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block',bypassCSP:true,reducedMotion:'reduce'});
  const errors=[],unexpected=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.origin!=='https://certificate-provider.test'){unexpected.push(u.href);return route.abort();}
    const file=resolve(app,'.'+decodeURIComponent(u.pathname));
    if(!file.startsWith(app))return route.abort();
    try{return route.fulfill({body:file.endsWith('provider.html')?html:readFileSync(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto('https://certificate-provider.test/provider.html');
  await page.addStyleTag({content:'*,*::before,*::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}'});
  await page.evaluate(({role,selected,image})=>{
    document.documentElement.classList.remove('provider-booting','requires-top-level');
    document.querySelector('#providerBoot')?.remove();document.querySelector('#authCard')?.setAttribute('hidden','');
    document.querySelector('#dashboard').hidden=false;document.querySelector('#dashboard').dataset.activeView='organization';
    Object.assign(document.body.dataset,{providerTheme:'pink-porcelain',providerLayout:'soft'});
    document.querySelectorAll('.provider-view').forEach(p=>p.hidden=p.dataset.providerPanel!=='organization');
    document.querySelector('#organizationWorkspace').hidden=false;document.querySelector('#organizationLoading').hidden=true;
    localStorage.setItem('minuta-provider-subsection-v1:organization',selected);
    Object.assign(window,{activeOrg:{id:'org-a',current_role:role},calls:[],scripts:[],notices:[],fail:false,hold:false,templateImage:image});
  },{role,selected,image});
  await page.addScriptTag({path:resolve(app,'provider-feature-assets.js')});
  await page.addScriptTag({content:`
    const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
    const providerSectionSelections=new Map(),providerSectionPresentation=new Map(),PROVIDER_SECTION_STORAGE_PREFIX='minuta-provider-subsection-v1',PROVIDER_SECTION_COMPANIONS={};
    let sectionNavigationFrame=0,currentUser={id:'user-a'},sessionGeneration=1;
    let certificateController=null,clientCertificateController=null,clientCertificateRevision=0,resourceController=null,shiftController=null,payrollController=null,commerceController=null,benefitController=null,loyaltyController=null,inventoryController=null,retentionController=null;
    const organizationFeatureRequests=new Map();let organizationFeatureContext='',organizationFeatureContextRevision=0;
    const organizationController={getActiveOrganization:()=>window.activeOrg};
    const escapeHtml=v=>String(v),notify=v=>notices.push(v),requireWrites=()=>true,applyWriteAvailability=()=>{},requestProviderConfirmation=async()=>false;
    const sessionIsCurrent=(id,g)=>currentUser?.id===id&&sessionGeneration===g;
    const db={rpc:async(name,p)=>{
      calls.push({name,p});const org=p.p_organization;
      if(name==='get_minuta_certificate_design_workspace')return{data:{organization_id:org,current_role:activeOrg.current_role,today:'2026-10-03',next_number:'267',templates:[{id:'template-a',name:'Мой макет'}],services:[{id:'service-a',name:'Массаж спины+швз — углубленный',duration_minutes:60},{id:'service-b',name:'Уход за лицом',duration_minutes:45}]}};
      if(name==='get_minuta_certificate_design'){
        if(!templateImage){const c=document.createElement('canvas');c.width=700;c.height=990;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,700,990);templateImage=c.toDataURL();}
        return{data:{organization_id:org,template:{id:'template-a',name:'Мой макет',image_data:templateImage,layout:structuredClone(MinutaCertificateRenderer.fields),font_files:{}}}};
      }
      if(name==='get_minuta_client_certificates')return{data:{organization_id:org,client_phone:p.p_phone,today:'2026-10-03',records:[{id:'issue-a',number:'267',procedure:p.p_phone==='client-b'?'Уход за лицом':'Массаж спины+швз — углубленный (1 час/1 сеанс)',issued_on:'2026-10-03',expires_on:'2027-04-03',sessions:1,service_id:'service-a',template_id:'template-a',layout:structuredClone(MinutaCertificateRenderer.fields),font_family:'Times New Roman',remind_days:14}],next_cursor:null}};
      if(name==='get_minuta_certificate_issue_history')return{data:{organization_id:org,today:'2026-10-03',records:[],expiring_count:0,next_cursor:null}};
      if(name==='get_minuta_certificate_drafts')return{data:{organization_id:org,drafts:[],next_cursor:null}};
      throw Error('Unapproved fixture RPC '+name);
    }};
    const pending=new Map();
    async function loadProviderFeatureScript(path){
      if(pending.has(path))return pending.get(path);
      const task=(async()=>{scripts.push(path);if(hold)await new Promise(r=>window.release=r);if(fail)throw Error('fixture failure');
        await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL(path,location.href);s.onload=resolve;s.onerror=reject;document.head.append(s);});})();
      pending.set(path,task);try{await task;}catch(e){pending.delete(path);throw e;}
    }
    async function setProviderView(view){
      resetClientCertificates();$$('.provider-view').forEach(p=>p.hidden=p.dataset.providerPanel!==view);$('#dashboard').dataset.activeView=view;if(view==='clients'){$('#clientProfileContent').hidden=false;$('#clientsLayout').classList.add('is-detail');}refreshSectionNavigation();
    }
    ${navigation}
    ${features}
    ${clientGlue.slice(0,end)}
    document.addEventListener('click',e=>{const b=e.target.closest('[data-section-target]');if(b){e.preventDefault();scrollToProviderSection(b);}});
    new MutationObserver(refreshSectionNavigation).observe($('#dashboard'),{attributes:true,subtree:true,attributeFilter:['hidden']});
    prepareOrganizationFeatures(activeOrg);refreshSectionNavigation();
  `});
  await page.addScriptTag({path:resolve(app,'organization-group-navigation.js')});
  return{page,check:()=>{assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);checks+=2;}};
}
async function open(page){await page.locator('[data-organization-group="sales"]').click();await page.locator('#organizationSectionNav [data-section-target="certificateDesignerPanel"]').click();await page.locator('#certificateDesignerPanel [data-canvas]').waitFor({state:'visible'});}
try{
  for(const width of[390,760,1440]){
    const f=await fixture(width);try{
      assert.deepEqual(await f.page.evaluate(()=>scripts),[]);checks++;
      await open(f.page);
      assert.deepEqual(await f.page.evaluate(()=>scripts),['certificate-renderer.js','certificate-designer.js']);
      assert.equal(await f.page.locator('#organizationSectionNav').getAttribute('data-active-organization-group'),'sales');
      assert.equal(await f.page.locator('[data-number]').inputValue(),'267');
      assert.equal(await f.page.locator('[data-number-mode]').inputValue(),'auto');
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);checks+=5;
      for(const name of['Черновики','История','Создать'])await f.page.getByRole('tab',{name,exact:true}).click();
      await f.page.locator('[data-canvas]').waitFor({state:'visible'});checks++;
      await f.page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await f.page.waitForFunction(()=>scrollY===0);
      assert.equal(await f.page.locator('[data-tab="create"]').isVisible(),true);checks++;
      if(output)await f.page.screenshot({path:resolve(output,'provider-certificate-'+width+'.png'),fullPage:true});
      f.check();
    }finally{await f.page.close();}
  }
  const retry=await fixture();try{
    await retry.page.evaluate(()=>{fail=true;});
    await retry.page.locator('[data-organization-group="sales"]').click();await retry.page.locator('#organizationSectionNav [data-section-target="certificateDesignerPanel"]').click();
    await retry.page.waitForFunction(()=>notices.length>0);
    await retry.page.evaluate(()=>{fail=false;});await retry.page.locator('#organizationSectionNav [data-section-target="certificateDesignerPanel"]').click();
    await retry.page.locator('[data-canvas]').waitFor({state:'visible'});assert.equal(await retry.page.evaluate(()=>Boolean(certificateController)),true);checks++;retry.check();
  }finally{await retry.page.close();}
  for(const change of['organization','logout']){
    const f=await fixture();try{
      await f.page.evaluate(()=>{hold=true;});
      await f.page.locator('[data-organization-group="sales"]').click();await f.page.locator('#organizationSectionNav [data-section-target="certificateDesignerPanel"]').click();
      await f.page.waitForFunction(()=>typeof release==='function');
      await f.page.evaluate(change=>{hold=false;if(change==='logout'){currentUser=null;sessionGeneration++;}else activeOrg={id:'org-b',current_role:'specialist'};prepareOrganizationFeatures(activeOrg);release();},change);
      await f.page.waitForFunction(()=>scripts.includes('certificate-designer.js'));
      await f.page.evaluate(()=>Promise.all([...pending.values()]));
      if(change==='logout'){assert.equal(await f.page.evaluate(()=>certificateController),null);assert.deepEqual(await f.page.evaluate(()=>calls),[]);}
      else assert.equal(await f.page.evaluate(()=>calls.some(c=>c.p.p_organization==='org-a')),false);
      checks+=2;f.check();
    }finally{await f.page.close();}
  }
  const c=await fixture();try{
    await c.page.evaluate(async()=>{await setProviderView('clients');await loadClientCertificates({phone:'client-a'});});
    await c.page.locator('#clientCertificateDesigns').getByRole('button',{name:'Открыть сертификат'}).click();
    await c.page.locator('[data-canvas]').waitFor({state:'visible'});
    assert.equal(await c.page.locator('[data-number]').inputValue(),'267');assert.equal(await c.page.locator('[data-number]').isDisabled(),true);checks+=2;
    await c.page.evaluate(async()=>{await setProviderView('clients');await loadClientCertificates({phone:'client-b'});await organizationFeatureOptions().onIssued();});
    assert.equal(await c.page.locator('#clientCertificateDesigns').getByText(/Уход за лицом/).count(),1);
    assert.equal(await c.page.evaluate(()=>calls.filter(c=>c.name==='get_minuta_client_certificates').at(-1).p.p_phone),'client-b');checks+=2;
    await c.page.locator('#clientCertificateDesigns').getByRole('button',{name:'Открыть сертификат'}).click();await c.page.locator('[data-canvas]').waitFor({state:'visible'});checks++;
    await c.page.evaluate(async()=>{resetClientCertificates();await certificateController.setOrganization(null);});
    assert.equal(await c.page.locator('#clientCertificateDesigns').isHidden(),true);assert.equal(await c.page.locator('#certificateDesignerPanel').isHidden(),true);checks+=2;c.check();
  }finally{await c.page.close();}
  const stale=await fixture();try{
    await stale.page.evaluate(()=>{hold=true;window.cardLoad=loadClientCertificates({phone:'client-a'});});await stale.page.waitForFunction(()=>typeof release==='function');
    await stale.page.evaluate(async()=>{resetClientCertificates();hold=false;release();await cardLoad;});
    assert.equal(await stale.page.evaluate(()=>clientCertificateController),null);assert.deepEqual(await stale.page.evaluate(()=>calls),[]);checks+=2;stale.check();
  }finally{await stale.page.close();}
  console.log('Certificate provider integration: PASS ('+checks+' assertions; synthetic RPC only)');
}finally{await browser.close();}
