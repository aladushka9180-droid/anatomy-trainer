// Real provider panel/controller/styles; every RPC is an isolated fixture.
// External URLs, production requests and service workers are denied.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {connectCatalog} from './commerce-catalog-controller-hook.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const provider=readFileSync(resolve(root,'provider.html'),'utf8');
const begin=provider.indexOf('<section class="panel organization-section commerce-panel"'),end=provider.indexOf('<section class="panel organization-section organization-benefits"',begin);
assert.ok(begin>0&&end>begin);
const panel=provider.slice(begin,end).replace('id="commercePanel" hidden','id="commercePanel"');
const controller=readFileSync(resolve(root,'commerce-management.js'),'utf8').replaceAll('\r\n','\n');
const hooked=connectCatalog(controller);assert.ok(Buffer.byteLength(hooked)<=Buffer.byteLength(controller),'Do not increase startup bytes');new Function(hooked);
const output=resolve(process.env.MINUTA_CATALOG_SCREENSHOTS||resolve(root,'outputs','sales-catalog-integration'));mkdirSync(output,{recursive:true});
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
const pageErrors=[],unexpected=[],requested=[];
const fixture=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="commerce-soft-ui.css"><style>
body{--theme-surface:#fff;--theme-ink:#302b31;--theme-muted:#756d77;--theme-line:#efdae4;--theme-accent:#b83170;--theme-accent-soft:#fdebf3;background:#fff6fa;margin:0;padding:16px;}main{width:100%;max-width:1400px;margin:auto;}[hidden]{display:none!important}
</style></head><body class="provider-body" data-provider-theme="pink-porcelain"><main>${panel}</main><nav class="provider-mobile-nav">Разделы кабинета</nav><script src="commerce-management.js?v=fixture"></script><script src="commerce-soft-ui.js?v=fixture"></script><script>
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
window.ids={org:id(1),actor:id(2),client:id(3),cream:id(4),cash:id(5),warehouse:id(6),ball:id(7),benefit:id(8),otherClient:id(9),otherOrg:id(90)};
const {org,actor,client,cream,cash,warehouse,ball,benefit,otherClient}=window.ids;
window.actor=actor;window.generation=1;window.calls=[];window.notices=[];window.mode='confirmed';window.catalogMode='ready';window.historyMode='ready';window.claimMode='confirmed';window.receipts=[];
const product={active:true,catalog_ready:true,unit:'ml',base_unit:'ml',sale_unit:'pack',stock_per_sale_unit:500,sale_price_minor:89900,metadata_version:1,purpose:'both',category:'Домашний уход',icon:'jar',description:'Уход для дома.'};
window.catalog={organization_id:org,capabilities:{catalog:true,atomic_cart:true,import_preview:true,bundles:true,writes_enabled:true},items:[{...product,id:cream,name:'Крем для тела',sku:'CARE-500',variant_label:'500 мл'},{...product,id:ball,name:'Массажный мяч',sku:'BALL-01',category:'Аксессуары',unit:'piece',base_unit:'piece',sale_unit:'piece',stock_per_sale_unit:1,sale_price_minor:65000,purpose:'retail',icon:'ball'}],warehouses:[{id:warehouse,name:'Основной склад',active:true}],balances:[{warehouse_id:warehouse,inventory_item_id:cream,quantity:5000},{warehouse_id:warehouse,inventory_item_id:ball,quantity:10}],bundles:[]};
window.workspace={organization_id:org,finance_enabled:true,inventory_enabled:true,clients:[{id:client,name:'Клиент примера'},{id:otherClient,name:'Другой клиент'}],sellers:[{id:actor,name:'Владелец',role:'owner',active:true}],accounts:[{id:cash,name:'Основная касса',account_type:'cash',system_key:null,active:true}],warehouses:[{id:warehouse,name:'Основной склад',active:true}],inventory_items:window.catalog.items,benefit_products:[{id:benefit,name:'Абонемент 5 визитов',kind:'subscription',price_minor:100000}],bookings:[],sales:[],audit:[],recurring_expenses:[]};
window.makeReceipt=p=>({found:true,id:crypto.randomUUID(),organization_id:p.p_organization,client_account_id:p.p_client_account,booking_id:p.p_booking,seller_id:p.p_seller,payment_method:p.p_payment_method,payment_account_id:p.p_payment_account,request_id:p.p_request_id,intent_lines:structuredClone(p.p_lines),occurred_at:'2026-10-03T09:00:00Z',total_minor:p.p_lines.reduce((sum,l)=>sum+Math.round(l.quantity*l.unit_price_minor)-(l.discount_minor||0),0),refunded_minor:0,lines:p.p_lines.map(l=>({...l,sale_id:crypto.randomUUID(),item_name:window.catalog.items.find(x=>x.id===l.inventory_item_id).name,sale_quantity:l.quantity,sale_unit:window.catalog.items.find(x=>x.id===l.inventory_item_id).sale_unit,total_minor:Math.round(l.quantity*l.unit_price_minor)-(l.discount_minor||0),refunded_minor:0,refunded_quantity:0,bundle_id:null,bundle_version:null}))});
window.keepReceipt=r=>{window.receipts.push(r);for(const line of r.lines)window.workspace.sales.push({id:line.sale_id,organization_id:r.organization_id,total_minor:line.total_minor,refunded_minor:0,status:'paid',occurred_at:r.occurred_at,client_name:'Клиент примера',seller_name:'Владелец',line:{...line,quantity:line.sale_quantity}});};
const rpc=async(name,p)=>{window.calls.push({name,p:structuredClone(p)});const orgId=p.p_organization||org;
if(name==='get_minuta_commerce_workspace_v151'){if(window.holdWorkspace)await new Promise(resolve=>window.releaseWorkspace=()=>{window.holdWorkspace=false;resolve();});return {data:{...structuredClone(window.workspace),organization_id:orgId}};}
if(name==='get_minuta_sales_catalog_candidate'){if(window.catalogMode==='missing')return {error:{code:'PGRST202',message:'schema cache'}};if(window.catalogMode==='denied')return {error:{code:'42501',message:'financial_manager_role_required'}};return {data:{...structuredClone(window.catalog),organization_id:orgId}};}
if(name==='get_minuta_sales_history_candidate'){if(window.historyMode==='error')return {error:{message:'network_error'}};const purchases=window.receipts.filter(x=>x.organization_id===orgId),gross=purchases.reduce((n,r)=>n+r.total_minor,0),refunded=purchases.reduce((n,r)=>n+r.refunded_minor,0);return {data:{organization_id:orgId,grouped:true,filter_client:false,grouped_count:purchases.length,gross_minor:gross,refunded_minor:refunded,net_minor:gross-refunded,purchases:structuredClone(purchases),next_cursor:null}};}
if(name==='sell_minuta_inventory_cart_candidate'){let r=window.receipts.find(x=>x.request_id===p.p_request_id);if(!r){r=window.makeReceipt(p);window.keepReceipt(r);}if(window.mode==='unknown')throw Error('Response lost');if(window.mode==='badReceipt')return {data:{...r,client_account_id:otherClient}};return {data:structuredClone(r)};}
if(name==='get_minuta_sales_cart_candidate')return {data:structuredClone(window.receipts.find(x=>x.organization_id===orgId&&x.request_id===p.p_request_id&&x.client_account_id===p.p_client_account)||{found:false})};
if(name==='create_minuta_financial_account_v129'){const account={id:crypto.randomUUID(),organization_id:orgId,name:p.p_name,account_type:p.p_account_type,system_key:null,active:true};window.workspace.accounts.push(account);return {data:account};}
if(name==='refund_minuta_commercial_sale_v147'){for(const r of window.receipts){const line=r.lines.find(x=>x.sale_id===p.p_sale);if(line){line.refunded_minor+=p.p_amount_minor;line.refunded_quantity+=p.p_quantity;r.refunded_minor+=p.p_amount_minor;const sale=window.workspace.sales.find(x=>x.id===p.p_sale);sale.refunded_minor=line.refunded_minor;sale.line.refunded_quantity=line.refunded_quantity;}}return {data:{id:crypto.randomUUID(),organization_id:orgId}};}
if(name==='sell_minuta_commercial_product_v151')return {data:{id:crypto.randomUUID(),organization_id:orgId,status:'paid'}};
if(name==='issue_client_identity_sale_claim_v155')return window.claimMode==='error'?{error:{message:'fixture_claim_unavailable'}}:{data:[{claim_token:'PTS1-A1B2-C3D4-E5F6-A1B2',claim_expires_at:new Date(Date.now()+9*60*1000).toISOString()}]};
throw Error('Unexpected fixture RPC '+name);};
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.manager=window.MinutaCommerce.createController({db:{rpc},$:s=>document.querySelector(s),escapeHtml,notify:m=>window.notices.push(String(m)),getCurrentUser:()=>({id:window.actor}),getSessionGeneration:()=>window.generation,sessionIsCurrent:(a,g)=>a===window.actor&&g===window.generation,requireWrites:()=>true,applyWriteAvailability:()=>{}});
window.ready=false;window.manager.bind();window.manager.setOrganization({id:org,current_role:'owner'}).then(()=>{window.ready=true;});
</script></body></html>`;
async function pageFor(width,{holdAdapter=false}={}){const page=await browser.newPage({viewport:{width,height:1050},serviceWorkers:'block'});page.setDefaultTimeout(8000);page.on('pageerror',e=>pageErrors.push(e.message));let adapterRoute;const adapterRequested=new Promise(resolve=>adapterRoute=resolve);
await page.route('**/*',route=>{const u=new URL(route.request().url());requested.push(u.href);if(u.hostname!=='localhost'){unexpected.push(u.href);return route.abort();}if(u.pathname==='/')return route.fulfill({body:fixture,contentType:'text/html'});if(u.pathname==='/commerce-management.js')return route.fulfill({body:hooked,contentType:'text/javascript'});if(holdAdapter&&u.pathname==='/commerce-catalog-adapter.js'){adapterRoute(route);return;}if(!/^\/[a-z0-9./-]+$/.test(u.pathname)||u.pathname.includes('..'))return route.abort();try{return route.fulfill({body:readFileSync(resolve(root,u.pathname.slice(1))),contentType:extname(u.pathname)==='.css'?'text/css':extname(u.pathname)==='.svg'?'image/svg+xml':'text/javascript'});}catch{return route.abort();}});
await page.goto('http://localhost:47823/',{waitUntil:holdAdapter?'domcontentloaded':'load'});if(holdAdapter)return {page,adapterRequested};await page.waitForFunction(()=>window.ready);return page;}
const writeCalls=page=>page.evaluate(()=>window.calls.filter(x=>!x.name.startsWith('get_')));
const saleCalls=page=>page.evaluate(()=>window.calls.filter(x=>x.name.startsWith('sell_minuta_')));
async function open(page){await page.evaluate(()=>window.manager.startSale({clientId:window.ids.client}));await page.waitForFunction(()=>!document.querySelector('#commerceCatalogMount')?.hidden&&Boolean(document.querySelector('#commerceCatalogMount button[aria-label="Добавить Массажный мяч"]')));}
async function add(page,name){await page.getByRole('button',{name:'Добавить '+name,exact:true}).click();}
try{
for(const width of [390,760,1440]){
 const page=await pageFor(width);assert.equal(await page.locator('#commerceCatalogMount').count(),1);assert.equal((await writeCalls(page)).length,0);await open(page);
 assert.equal(await page.locator('#commerceItem').isVisible(),false);assert.equal(await page.locator('#commerceSaleSubmit').isVisible(),false);assert.equal(await page.locator('#commerceAccountSetup').count(),1);
 await add(page,'Крем для тела');await add(page,'Массажный мяч');await page.screenshot({path:resolve(output,'integration-cart-'+width+'.png'),fullPage:true});
 assert.equal(await page.locator('.cc-cart .cc-field').first().evaluate(e=>getComputedStyle(e).marginTop),'0px','Existing form margins must not inflate cart rows');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No overflow '+width);
 if(width===390){assert.equal(await page.locator('.provider-mobile-nav').isVisible(),false);const footer=await page.locator('.cc-cart-footer').boundingBox();assert.ok(Math.abs(footer.y+footer.height-1050)<2);}
 await page.getByRole('button',{name:'Провести продажу',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#commerceSalesCount').textContent==='1');
 const writes=await saleCalls(page);assert.equal(writes.length,1);assert.equal(writes[0].name,'sell_minuta_inventory_cart_candidate');assert.equal(writes[0].p.p_lines.length,2);assert.equal(await page.locator('#commerceSalesList .commerce-sale-row').count(),1);assert.match(await page.locator('#commerceGross').textContent(),/1.?549/);
  await page.locator('#commerceClientAccessCode').waitFor({state:'visible'});
  const claims=await page.evaluate(()=>window.calls.filter(x=>x.name==='issue_client_identity_sale_claim_v155'));
  assert.equal(claims.length,1,'Modern paid cart must retain client purchase access');
 assert.equal(claims[0].p.p_sale,await page.evaluate(()=>window.receipts[0].lines[0].sale_id),'One existing item anchors access to the whole client purchase');
 await page.locator('#commerceSalesList summary').click();await page.locator('#commerceSalesList [data-commerce-refund]').first().click();assert.equal(await page.locator('#commerceRefundCreator').evaluate(e=>e.open),true);
 await page.locator('#commerceRefundQuantity').fill('1');await page.locator('#commerceRefundQuantity').dispatchEvent('input');await page.locator('#commerceRefundReason').fill('Синтетический возврат');await page.locator('#commerceRefundReason').dispatchEvent('input');assert.equal(await page.locator('#commerceRefundSubmit').isDisabled(),false);
 // Only inspect refund readiness; no production or real refund is performed.
 await page.locator('#commerceItemKind').selectOption('benefit_product');assert.equal(await page.locator('#commerceCatalogMount').isVisible(),false);assert.equal(await page.locator('.cs-product-choice').isVisible(),true);
 await page.locator('#commerceClient').selectOption(await page.evaluate(()=>window.ids.client));await page.locator('#commerceUnitPrice').fill('1000');await page.locator('#commerceUnitPrice').dispatchEvent('input');
 await page.locator('#commerceSaleForm').evaluate(e=>e.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 try { await page.waitForFunction(()=>window.calls.some(x=>x.name==='sell_minuta_commercial_product_v151')); }
 catch(e) { console.log(await page.evaluate(()=>({calls:window.calls.map(x=>x.name),notices:window.notices,values:Object.fromEntries(['commerceClient','commerceSeller','commerceItemKind','commerceItem','commerceUnitPrice','commercePaymentAccount','commerceSaleError'].map(id=>[id,document.getElementById(id).value??document.getElementById(id).textContent]))}))); throw e; }
 assert.equal((await writeCalls(page)).filter(x=>x.name==='sell_minuta_commercial_product_v151').length,1,'Benefit remains on existing single-sale API');
 await page.close();
}
for(const width of [390,760,1440]){
 const bundlePage=await pageFor(width);
 await bundlePage.evaluate(()=>{
  const bundle={id:'11111111-1111-4111-8111-000000000020',name:'Набор примера',version:1,active:true,
    items:[{inventory_item_id:window.ids.cream,quantity:1},{inventory_item_id:window.ids.ball,quantity:2}]};
  window.catalog.bundles=[bundle];const ordinaryReceipt=window.makeReceipt;
  window.makeReceipt=p=>{
   const parent=p.p_lines[0],expanded=parent.components.map((component,i)=>({...component,line_id:parent.line_id+':'+(i+1),
     warehouse_id:parent.warehouse_id,quantity:parent.quantity*bundle.items[i].quantity,discount_minor:0}));
   const saved=ordinaryReceipt({...p,p_lines:expanded});saved.intent_lines=structuredClone(p.p_lines);
   saved.lines=saved.lines.map(line=>({...line,bundle_id:parent.bundle_id,bundle_version:parent.bundle_version}));return saved;
  };
  window.mode='unknown';return window.manager.load();
 });
 await open(bundlePage);await bundlePage.locator('.cc-bundles').getByRole('button',{name:'Добавить',exact:true}).click();
 await bundlePage.getByRole('button',{name:'Провести продажу',exact:true}).click();await bundlePage.getByRole('button',{name:'Проверить продажу',exact:true}).waitFor();
 const saved=await bundlePage.evaluate(()=>structuredClone(window.receipts[0]));assert.equal(saved.intent_lines[0].quantity,1);
 await bundlePage.evaluate(()=>{
  const key=Object.keys(localStorage).find(k=>k.startsWith('minuta.catalog.draft.v2:')),draft=JSON.parse(localStorage.getItem(key));
  draft.pending.payload.p_lines[0].quantity=2;localStorage.setItem(key,JSON.stringify(draft));
 });
 await bundlePage.reload();await bundlePage.waitForFunction(()=>window.ready);await open(bundlePage);
 await bundlePage.evaluate(saved=>window.keepReceipt(saved),saved);await bundlePage.getByRole('button',{name:'Проверить продажу',exact:true}).click();
 await bundlePage.waitForFunction(()=>window.calls.some(x=>x.name==='get_minuta_sales_cart_candidate')&&Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Проверить продажу'&&!b.disabled));
 assert.equal(await bundlePage.locator('.cc-cart-row').count(),1,'Mismatched bundle recovery must not clear the cart');
 assert.equal((await saleCalls(bundlePage)).length,0,'Status recovery performs no sale');
 assert.equal(await bundlePage.evaluate(()=>window.calls.filter(x=>x.name==='issue_client_identity_sale_claim_v155').length),0,'Mismatched receipt cannot issue access');
 assert.equal(await bundlePage.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('minuta.catalog.draft.v2:')))).pending.payload.p_lines[0].quantity),2,'The unresolved intent is preserved');
 await bundlePage.screenshot({path:resolve(output,'integration-bundle-mismatch-'+width+'.png'),fullPage:true});
 // Restore the original saved request in the isolated fixture; matching recovery remains available.
 await bundlePage.evaluate(saved=>{
  const key=Object.keys(localStorage).find(k=>k.startsWith('minuta.catalog.draft.v2:')),draft=JSON.parse(localStorage.getItem(key));
  draft.pending.payload.p_lines=structuredClone(saved.intent_lines);localStorage.setItem(key,JSON.stringify(draft));
 },saved);
 await bundlePage.reload();await bundlePage.waitForFunction(()=>window.ready);await open(bundlePage);
 await bundlePage.evaluate(saved=>window.keepReceipt(saved),saved);await bundlePage.getByRole('button',{name:'Проверить продажу',exact:true}).click();
 await bundlePage.waitForFunction(()=>document.querySelectorAll('.cc-cart-row').length===0&&document.querySelector('#commerceLoading').hidden);
 assert.equal((await saleCalls(bundlePage)).length,0,'Matching recovery never resells');await bundlePage.locator('#commerceClientAccessCode').waitFor({state:'visible'});
 await bundlePage.close();
}
const page=await pageFor(390);await open(page);await add(page,'Массажный мяч');await page.evaluate(()=>window.mode='unknown');await page.getByRole('button',{name:'Провести продажу',exact:true}).click();
await page.getByRole('button',{name:'Проверить продажу',exact:true}).waitFor();const first=(await writeCalls(page))[0].p;assert.equal(await page.getByRole('button',{name:'Добавить Массажный мяч',exact:true}).isDisabled(),true);
await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Проверить продажу',exact:true}).waitFor();
// Server receipt persists independently of page-local fixture state.
await page.evaluate(p=>{window.keepReceipt(window.makeReceipt(p));},first);await page.getByRole('button',{name:'Проверить продажу',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.cc-cart-row').length===0&&document.querySelector('#commerceLoading').hidden);
assert.equal((await saleCalls(page)).length,0,'Recovery never creates a new sale');
await page.locator('#commerceClientAccessCode').waitFor({state:'visible'});
await page.evaluate(()=>{window.workspace.accounts=[];});await page.evaluate(()=>window.manager.load());
await page.locator('.cc-settings>summary').click();await page.locator('.cc-account-options>summary').click();
await page.locator('#commerceAccountName').fill('Касса примера');await page.locator('#commerceAccountSubmit').click();await page.waitForFunction(()=>window.calls.some(x=>x.name==='create_minuta_financial_account_v129')&&document.querySelector('#commerceLoading').hidden);
assert.equal(await page.locator('#commerceAccountSetup').count(),1);assert.ok(await page.locator('select[aria-label="Касса или счёт"]').locator('option').count()>1,'New account reaches modern selector');
// A refresh must not restore the initial client and erase their editable cart.
await page.locator('select[aria-label="Клиент"]').selectOption(await page.evaluate(()=>window.ids.otherClient));await add(page,'Массажный мяч');await page.evaluate(()=>window.manager.load());
assert.equal(await page.locator('select[aria-label="Клиент"]').inputValue(),await page.evaluate(()=>window.ids.otherClient));assert.equal(await page.locator('.cc-cart-row').count(),1);
await page.evaluate(()=>window.historyMode='error');await page.evaluate(()=>window.manager.load());assert.equal(await page.locator('#commerceSalesCount').textContent(),'—');assert.match(await page.locator('#commerceSalesList').textContent(),/не загружена/);
await page.evaluate(()=>window.catalogMode='denied');await page.evaluate(()=>window.manager.load());await page.locator('#commerceSaleForm').evaluate(e=>e.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal((await writeCalls(page)).filter(x=>x.name==='sell_minuta_commercial_product_v151').length,0,'Permission failure never uses legacy fallback');
await page.evaluate(()=>{window.catalogMode='missing';});await page.evaluate(()=>window.manager.load());assert.equal(await page.locator('#commerceCatalogMount').isVisible(),false);assert.equal(await page.locator('.cs-product-choice').isVisible(),true);
await page.evaluate(()=>{window.catalogMode='ready';});await page.evaluate(()=>window.manager.load());assert.equal(await page.locator('#commerceCatalogMount').isVisible(),true);
await page.evaluate(()=>window.manager.setOrganization({id:window.ids.otherOrg,current_role:'owner'}));assert.equal(await page.locator('.cc-cart-row').count(),0,'Organization change never loads old cart');
await page.evaluate(()=>window.manager.reset());assert.equal(await page.locator('#commerceCatalogMount').count(),0);assert.equal(await page.locator('#commerceSaleOptions #commerceAccountSetup').count(),1,'Existing account controls return to old parent');
await page.close();
const claimPage=await pageFor(390);await open(claimPage);await add(claimPage,'Массажный мяч');await claimPage.evaluate(()=>window.claimMode='error');
await claimPage.getByRole('button',{name:'Провести продажу',exact:true}).click();await claimPage.locator('#commerceClientAccessRetry').waitFor({state:'visible'});
const firstClaim=await claimPage.evaluate(()=>window.calls.find(x=>x.name==='issue_client_identity_sale_claim_v155').p.p_request_id);
await claimPage.evaluate(()=>window.claimMode='confirmed');await claimPage.locator('#commerceClientAccessRetry').click();await claimPage.locator('#commerceClientAccessCode').waitFor({state:'visible'});
assert.equal((await saleCalls(claimPage)).length,1,'Retrying the access code must not sell the cart again');
assert.deepEqual(await claimPage.evaluate(()=>window.calls.filter(x=>x.name==='issue_client_identity_sale_claim_v155').map(x=>x.p.p_request_id)),[firstClaim,firstClaim]);
await claimPage.locator('.cc-settings>summary').click();
await claimPage.locator('select[aria-label="Клиент"]').selectOption(await claimPage.evaluate(()=>window.ids.otherClient));
assert.equal(await claimPage.locator('#commerceClientAccessCode').isVisible(),false,'Changing cart client clears the previous access code');
await add(claimPage,'Массажный мяч');await claimPage.evaluate(()=>window.mode='unknown');await claimPage.getByRole('button',{name:'Провести продажу',exact:true}).click();
await claimPage.getByRole('button',{name:'Проверить продажу',exact:true}).waitFor();assert.equal(await claimPage.locator('#commerceClientAccessCode').isVisible(),false);
assert.equal(await claimPage.evaluate(()=>window.calls.filter(x=>x.name==='issue_client_identity_sale_claim_v155').length),2,'An unknown sale does not issue an access code');await claimPage.close();
const stalePage=await pageFor(390);await open(stalePage);await add(stalePage,'Массажный мяч');await stalePage.evaluate(()=>window.holdWorkspace=true);
await stalePage.getByRole('button',{name:'Провести продажу',exact:true}).click();await stalePage.waitForFunction(()=>typeof window.releaseWorkspace==='function');
await stalePage.evaluate(()=>{window.manager.reset();window.actor=window.ids.otherClient;window.generation++;window.releaseWorkspace();});
await stalePage.waitForFunction(()=>document.querySelector('#commerceLoading').hidden);await stalePage.waitForTimeout(100);
assert.equal(await stalePage.evaluate(()=>window.calls.filter(x=>x.name==='issue_client_identity_sale_claim_v155').length),0,'A delayed confirmed purchase cannot issue a code after logout or actor change');
assert.equal(await stalePage.locator('#commerceClientAccessCode').isVisible(),false);await stalePage.close();
// Logout/reset can happen before the first lazy import settles. Its failure
// must not create an unhandled rejection or mount anything after reset.
const held=await pageFor(390,{holdAdapter:true});const heldRoute=await held.adapterRequested;
await held.page.evaluate(()=>window.manager.reset());await heldRoute.abort();
await held.page.waitForFunction(()=>window.ready);await held.page.waitForTimeout(100);
assert.equal(await held.page.locator('#commerceCatalogMount').count(),0);
assert.equal((await writeCalls(held.page)).length,0);await held.page.close();
assert.deepEqual(unexpected,[]);assert.deepEqual(pageErrors,[]);
assert.ok(requested.filter(x=>/commerce-catalog.*\.(?:js|css)/.test(x)).every(x=>new URL(x).searchParams.get('v')==='fixture'),'Lazy resources share release version');
console.log('PASS: actual provider panel/controller/styles at 390/760/1440; atomic sale/grouped history/benefits/refund/account setup/client access; pending recovery, context refresh, claim-only retry, fallback and lazy/reset safety. Synthetic fixture only.');
}finally{await browser.close();}
