import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Actual payment module + provider HTML + native submit/controls. Controller
// reset/setOrganization are explicit lifecycle boundaries; actual provider wiring
// is covered separately by the VM test. RPC/Edge are local deferred fixtures.
// Each invocation is a distinct explicit operation, never a lost-reply retry.
// No provider, JWT, money or lost-reply recovery evidence.
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const source = readFileSync(process.env.MINUTA_PAYMENT_SOURCE || new URL('../payment-management.js', import.meta.url), 'utf8');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true,
  ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const url = 'https://refund-context.test/';
const cases = [];
async function fixture() {
  const page = await browser.newPage({ serviceWorkers:'block', viewport:{width:390,height:844} });
  page.setDefaultTimeout(5000);
  const errors = [], traffic = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url() !== url) { traffic.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><meta charset="utf-8"><body></body></html>' });
  });
  await page.goto(url);
  await page.evaluate(html => {
    const panel = new DOMParser().parseFromString(html, 'text/html').getElementById('paymentProviderPanel');
    if (!panel) throw Error('Actual payment panel missing');
    document.body.append(document.importNode(panel, true));
  }, html);
  await page.addStyleTag({content:'[hidden]{display:none!important}label{display:block}svg{width:18px;height:18px}input,button,select{font:16px sans-serif}'});
  await page.addScriptTag({content:source});
  await page.evaluate(async () => {
    const state = window.state = {calls:[],loads:[],notices:[],errors:[],tasks:[],pendingInvokes:[],pendingLoads:[],deferLoads:false};
    const realAdd = document.addEventListener.bind(document);
    document.addEventListener = (name, handler, options) => realAdd(name, name === 'submit' ? event => {
      // Observe actual native-dispatched async handler completion; a rejection is
      // recorded and fails assertions, never silently converted into a pass.
      const task = Promise.resolve(handler(event)).catch(error => state.errors.push(error.message));
      state.tasks.push(task);
    } : handler, options);
    state.workspace = organization => ({organization_id:organization,current_role:'owner',settings:{enabled:false,environment:'test'},
      recent_attempts:[{id:`attempt-${organization}`,amount_minor:1000,captured_amount_minor:1000,refunded_amount_minor:0,
        status:'succeeded',created_at:'2026-09-01T12:00:00Z'}]});
    const db = {
      rpc(name, args) {
        if (name !== 'get_minuta_payment_workspace') throw Error(`Unexpected RPC ${name}`);
        state.loads.push(args.p_organization);
        if (state.deferLoads) return new Promise((resolve,reject) => state.pendingLoads.push({organization:args.p_organization,resolve,reject}));
        return Promise.resolve({data:state.workspace(args.p_organization),error:null});
      },
      functions:{invoke(name,args) {
        state.calls.push({name,body:structuredClone(args.body)});
        return new Promise((resolve,reject) => state.pendingInvokes.push({resolve,reject}));
      }}
    };
    window.controller = MinutaPayments.createController({db,$:s=>document.querySelector(s),
      escapeHtml:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
      notify:message=>state.notices.push(message),requireWrites:()=>true});
    controller.bind();
    document.addEventListener = realAdd;
    await controller.setOrganization({id:'A',current_role:'owner'});
  });
  return {page,errors,traffic};
}
async function begin(page, expectedCalls=1) {
  await page.locator('#paymentRefundAmount').fill('5.00');
  await page.locator('#paymentRefundReason').fill('Возврат по просьбе клиента A');
  await page.locator('#paymentRefundForm button[type=submit]').click();
  assert.equal(await page.evaluate(()=>state.calls.length),expectedCalls);
}
async function complete(page,outcome,index=0) {
  await page.evaluate(async ({outcome,index}) => {
    const pending=state.pendingInvokes[index];
    if (outcome === 'throw') pending.reject(Error('transport_lost'));
    else pending.resolve(outcome === 'error' ? {data:null,error:{message:'Failed to fetch'}} : {data:{ok:true,status:'succeeded'},error:null});
    await state.tasks[index];
  },{outcome,index});
}
async function snapshot(page) {
  return page.evaluate(()=>({
    values:['paymentRefundAttempt','paymentRefundAmount','paymentRefundReason'].map(id=>document.getElementById(id).value),
    disabled:[...document.querySelectorAll('#paymentProviderPanel button,input,select')].map(node=>node.disabled),
    hidden:document.getElementById('paymentProviderPanel').hidden,
    workspaceHidden:document.getElementById('paymentProviderWorkspace').hidden,
    unavailableHidden:document.getElementById('paymentProviderUnavailable').hidden,
    unavailableText:document.getElementById('paymentProviderUnavailableText').textContent,
    workspace:document.getElementById('paymentAttemptsList').innerHTML,
    attemptOptions:document.getElementById('paymentRefundAttempt').innerHTML,
    loads:[...state.loads],notices:[...state.notices]
  }));
}
for (const transition of ['org','org-roundtrip','reset','reset-same-org']) {
  for (const outcome of ['success','error','throw']) {
    cases.push([`${transition}: late ${outcome} cannot change the native destination`,async page=>{
      await begin(page);
      await page.evaluate(async transition=>{
        if (transition.startsWith('reset')) controller.reset();
        if (transition==='org'||transition==='org-roundtrip') await controller.setOrganization({id:'B',current_role:'owner'});
        if (transition==='org-roundtrip'||transition==='reset-same-org') await controller.setOrganization({id:'A',current_role:'owner'});
        // Seed a distinct destination draft. The baseline wrongly keeps controls
        // disabled; that is asserted separately, not bypassed as user interaction.
        document.getElementById('paymentRefundAmount').value='3.00';
        document.getElementById('paymentRefundReason').value='Отдельный черновик нового контекста';
      },transition);
      const before=await snapshot(page);
      await complete(page,outcome);
      assert.deepEqual(await snapshot(page),before);
      assert.deepEqual(await page.evaluate(()=>state.errors),[]);
      assert.equal(await page.evaluate(()=>state.calls.length),1);
    }]);
  }
}
cases.push(['new organization controls do not inherit an old refund busy state',async page=>{
  await begin(page);
  await page.evaluate(()=>controller.setOrganization({id:'B',current_role:'owner'}));
  assert.equal(await page.locator('#paymentRefundForm button[type=submit]').isEnabled(),true);
  await page.locator('#paymentRefundAttempt').selectOption('attempt-B');
  await page.locator('#paymentRefundAmount').fill('3.00');
  await complete(page,'success');
  assert.equal(await page.locator('#paymentRefundAmount').inputValue(),'3.00');
}]);
for (const outcome of ['success','error','throw']) {
  cases.push([`current ${outcome} settles with usable controls and truthful status`,async page=>{
    await begin(page);
    await complete(page,outcome);
    assert.equal(await page.locator('#paymentRefundForm button[type=submit]').isEnabled(),true);
    assert.deepEqual(await page.evaluate(()=>state.errors),[]);
    const notices=await page.evaluate(()=>state.notices);
    if(outcome==='success') assert.ok(notices.includes('Возврат выполнен'));
    else {
      assert.match(notices.at(-1),/не подтвержд|не удалось подтверд|проверьте/i);
      assert.equal(notices.some(message=>/Возврат выполнен|деньги не|откат/i.test(message)),false);
      assert.equal(await page.locator('#paymentRefundAmount').inputValue(),'5.00');
    }
  }]);
}
cases.push(['same-organization refresh preserves a valid current refund',async page=>{
  await begin(page);
  await page.evaluate(()=>controller.setOrganization({id:'A',current_role:'owner'}));
  await complete(page,'success');
  assert.ok(await page.evaluate(()=>state.notices.includes('Возврат выполнен')));
  assert.deepEqual(await page.evaluate(()=>state.errors),[]);
}]);
for (const outcome of ['success','error','throw']) {
  cases.push([`old A ${outcome} must not release independently submitted B busy state`,async page=>{
    await begin(page);
    await page.evaluate(()=>controller.setOrganization({id:'B',current_role:'owner'}));
    await page.locator('#paymentRefundAttempt').selectOption('attempt-B');
    await begin(page,2);
    const before=await snapshot(page);
    await complete(page,outcome,0);
    assert.deepEqual(await snapshot(page),before);
    assert.equal(await page.locator('#paymentRefundForm button[type=submit]').isEnabled(),false);
    await complete(page,'success',1);
    assert.equal(await page.locator('#paymentRefundForm button[type=submit]').isEnabled(),true);
    assert.deepEqual(await page.evaluate(()=>state.calls.map(call=>call.body.organization_id)),['A','B']);
    assert.equal(await page.evaluate(()=>state.notices.filter(message=>message==='Возврат выполнен').length),1);
    assert.deepEqual(await page.evaluate(()=>state.errors),[]);
  }]);
}
for (const destination of ['idle','busy']) {
for (const outcome of ['success','error','throw']) {
  cases.push([`workspace A late ${outcome} cannot overwrite ${destination} B`,async page=>{
    await page.evaluate(async()=>{
      state.deferLoads=true;
      state.oldLoad=controller.load().catch(error=>state.errors.push(error.message));
      state.deferLoads=false;
      await controller.setOrganization({id:'B',current_role:'owner'});
    });
    if(destination==='busy') {
      await page.locator('#paymentRefundAttempt').selectOption('attempt-B');
      await begin(page);
    }
    const before=await snapshot(page);
    await page.evaluate(async outcome=>{
      const pending=state.pendingLoads[0];
      if(outcome==='throw') pending.reject(Error('old_load_failed'));
      else pending.resolve(outcome==='error'?{data:null,error:{code:'42501',message:'payment_access_denied'}}:{data:state.workspace('A'),error:null});
      await state.oldLoad;
    },outcome);
    assert.deepEqual(await snapshot(page),before);
    assert.deepEqual(await page.evaluate(()=>state.errors),[]);
  }]);
}
}
const failures=[];
try {
  for(const [name,run] of cases) {
    const {page,errors,traffic}=await fixture();
    try {await run(page);assert.deepEqual(errors,[]);assert.deepEqual(traffic,[]);console.log(`PASS ${name}`);}
    catch(error){failures.push(name);console.log(`FAIL ${name}: ${String(error.message).slice(0,180)}`);}
    finally {await page.close();}
  }
  console.log(`${cases.length-failures.length}/${cases.length} native payment context cases passed; mocked Edge, no real payments or provider bootstrap`);
  if(failures.length)process.exitCode=1;
} finally {await browser.close();}
