import assert from 'node:assert/strict';
import {launch,createFixture,fillSale,submitSale,workspace,ids} from './commerce-recovery-fixture.mjs';

const browser=await launch();
let passed=0;
async function check(name,run,options={}) {
  if (process.env.MINUTA_COMMERCE_RECOVERY_ONLY && !name.includes(process.env.MINUTA_COMMERCE_RECOVERY_ONLY)) return;
  const fixture=await createFixture(browser,options);
  try {
    await run(fixture.page,fixture);
    assert.deepEqual(fixture.errors,[],name+': no page errors');
    assert.deepEqual(fixture.rejected,[],name+': no external requests');
    passed++;
    console.log('PASS commerce recovery:',name);
  } finally {await fixture.context.close();}
}

try {
  await check('fractional sale matches decimal server amounts',async page=>{
    for(const [quantity,price,expected] of [['0.009','15',14],['0.007','15',11],['1.005','1',101],['0.001','15',2],['0.999','1',100],['3','499.99',149997]]){
      await fillSale(page,{quantity,price,discount:'0'});
      const result=await page.evaluate(()=>({text:document.querySelector('#commerceSaleTotal').textContent,disabled:document.querySelector('#commerceSaleSubmit').disabled,valid:document.querySelector('#commerceSaleForm').checkValidity()}));
      assert.equal(Math.round(Number(result.text.replace(/[^\d,-]/g,'').replace(',','.'))*100),expected);
      assert.equal(result.disabled,false);assert.equal(result.valid,true);
    }
  });
  await check('unavailable storage blocks both attempts before any sale',async page=>{
    await fillSale(page);
    for(let attempt=0;attempt<2;attempt++)await submitSale(page,{expectError:true});
    const result=await page.evaluate(()=>({sales:auditData.sales.length,calls:auditCalls.filter(c=>c.name==='sell_minuta_commercial_product_v151').length,error:document.querySelector('#commerceSaleError').textContent,disabled:document.querySelector('#commerceSaleSubmit').disabled}));
    assert.equal(result.sales,0);assert.equal(result.calls,0);assert.match(result.error,/хранение данных/);assert.equal(result.disabled,false);
  },{blockedStorage:true});
  await check('silent storage failure also blocks a sale',async page=>{
    await page.evaluate(()=>Object.defineProperty(Storage.prototype,'setItem',{value(){},configurable:true}));
    await fillSale(page);await submitSale(page,{expectError:true});
    assert.equal(await page.evaluate(()=>auditCalls.filter(c=>c.name==='sell_minuta_commercial_product_v151').length),0);
  });
  await check('lost response is uncertain and identical retry creates one sale',async page=>{
    await fillSale(page);await page.evaluate(()=>auditDropReplies=1);await submitSale(page,{expectError:true});
    const error=await page.locator('#commerceSaleError').textContent();assert.match(error,/не подтверждён/);assert.doesNotMatch(error,/Данные не изменены|безопасно повторить/);
    await submitSale(page);
    const result=await page.evaluate(()=>({sales:auditData.sales.length,ids:auditCalls.filter(c=>c.name==='sell_minuta_commercial_product_v151').map(c=>c.args.p_request_id)}));
    assert.equal(result.sales,1);assert.equal(result.ids.length,2);assert.equal(new Set(result.ids).size,1);
  });
  await check('storage becoming unavailable cannot create a fresh retry',async page=>{
    await fillSale(page);await page.evaluate(()=>auditDropReplies=1);await submitSale(page,{expectError:true});
    await page.evaluate(()=>Object.defineProperty(Storage.prototype,'getItem',{value(){throw new DOMException('Denied','SecurityError')},configurable:true}));
    await submitSale(page,{expectError:true});
    assert.deepEqual(await page.evaluate(()=>[auditData.sales.length,auditCalls.filter(c=>c.name==='sell_minuta_commercial_product_v151').length]),[1,1]);
  });
  await check('new organization loads while old read is pending; stale error is ignored',async page=>{
    await page.evaluate(()=>{auditHoldReads=true;window.firstLoad=auditController.setOrganization(auditOrganization);});
    await page.waitForFunction(()=>Boolean(auditPendingReads[auditIds.organization]));
    await page.evaluate(async()=>{
      auditData.organization_id=auditIds.secondOrganization;auditData.clients[0].name='Current organization client';auditHoldReads=false;
      await auditController.setOrganization({id:auditIds.secondOrganization,current_role:'owner'});
      auditPendingReads[auditIds.organization]({data:null,error:{message:'Old organization failed'}});await firstLoad;
    });
    assert.equal(await page.locator('#commerceWorkspace').evaluate(e=>e.hidden),false);
    assert.equal(await page.locator('#commerceUnavailable').evaluate(e=>e.hidden),true);
    assert.match(await page.locator('#commerceClient').textContent(),/Current organization client/);
  },{boot:false});
  await check('A to B to A ignores an earlier response from the same organization',async page=>{
    await page.evaluate(()=>{auditHoldReads=true;window.oldSnapshot=structuredClone(auditData);window.firstLoad=auditController.setOrganization(auditOrganization);});
    await page.waitForFunction(()=>Boolean(auditPendingReads[auditIds.organization]));
    await page.evaluate(async()=>{
      auditHoldReads=false;auditData.organization_id=auditIds.secondOrganization;
      await auditController.setOrganization({id:auditIds.secondOrganization,current_role:'owner'});
      auditData.organization_id=auditIds.organization;auditData.clients[0].name='Latest client';
      await auditController.setOrganization(auditOrganization);
      auditPendingReads[auditIds.organization]({data:oldSnapshot,error:null});await firstLoad;
    });
    assert.match(await page.locator('#commerceClient').textContent(),/Latest client/);
  },{boot:false});
  await check('reset ignores a late read error and hides loading',async page=>{
    await page.evaluate(()=>{auditHoldReads=true;window.firstLoad=auditController.setOrganization(auditOrganization);});
    await page.waitForFunction(()=>Boolean(auditPendingReads[auditIds.organization]));
    await page.evaluate(async()=>{auditSessionGeneration++;auditController.reset();auditPendingReads[auditIds.organization]({data:null,error:{message:'Late error'}});await firstLoad;});
    assert.deepEqual(await page.evaluate(()=>['commerceWorkspace','commerceUnavailable','commerceLoading'].map(id=>document.getElementById(id).hidden)),[true,true,true]);
  },{boot:false});
  await check('forced reload keeps the newest response for the same organization',async page=>{
    await page.evaluate(()=>{auditHoldReads=true;window.oldSnapshot=structuredClone(auditData);window.firstRead=auditController.load({force:true});});
    await page.waitForFunction(()=>Boolean(auditPendingReads[auditIds.organization]));
    await page.evaluate(async()=>{
      const firstReply=auditPendingReads[auditIds.organization];
      const secondRead=auditController.load({force:true});
      const newest=structuredClone(auditData);newest.clients[0].name='Newest forced response';
      auditPendingReads[auditIds.organization]({data:newest,error:null});await secondRead;
      firstReply({data:oldSnapshot,error:null});await firstRead;
    });
    assert.match(await page.locator('#commerceClient').textContent(),/Newest forced response/);
  });
  await check('late saved sale after reset has no stale notice or unhandled error',async page=>{
    await fillSale(page);
    await page.evaluate(()=>{window.unhandled=[];window.addEventListener('unhandledrejection',e=>unhandled.push(String(e.reason)));auditHoldSaleReply=true;document.querySelector('#commerceSaleForm').requestSubmit();});
    await page.waitForFunction(()=>Boolean(auditReleaseSaleReply));
    await page.evaluate(()=>{auditSessionGeneration++;auditController.reset();auditReleaseSaleReply();});
    await page.waitForFunction(()=>document.querySelector('#commerceSaleSubmit').textContent!=='Проводим…');
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const result=await page.evaluate(()=>({unhandled,notices:auditNotices,hidden:document.querySelector('#commerceWorkspace').hidden,sales:auditData.sales.length}));
    assert.deepEqual(result,{unhandled:[],notices:[],hidden:true,sales:1});
  });
  await check('late old sale cannot reset the new organization form',async page=>{
    await fillSale(page);
    await page.evaluate(()=>{auditHoldSaleReply=true;document.querySelector('#commerceSaleForm').requestSubmit();});
    await page.waitForFunction(()=>Boolean(auditReleaseSaleReply));
    await page.evaluate(async()=>{auditData.organization_id=auditIds.secondOrganization;await auditController.setOrganization({id:auditIds.secondOrganization,current_role:'owner'});});
    await fillSale(page,{quantity:'7',price:'30',discount:'0'});
    await page.evaluate(()=>auditReleaseSaleReply());
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await page.locator('#commerceQuantity').inputValue(),'7');assert.equal(await page.locator('#commerceSaleCreator').evaluate(e=>e.open),true);
    assert.deepEqual(await page.evaluate(()=>auditNotices),[]);
  });
  const inactive={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeee151',name:'Inactive rule',supplier_name:'Synthetic supplier',amount_minor:100000,day_of_month:1,active:false,last_occurred_on:null};
  await check('late prior-session sale releases busy state without resetting a new form',async page=>{
    await fillSale(page);
    await page.evaluate(()=>{auditHoldSaleReply=true;document.querySelector('#commerceSaleForm').requestSubmit();});
    await page.waitForFunction(()=>Boolean(auditReleaseSaleReply));
    await page.evaluate(async()=>{auditSessionGeneration++;auditController.reset();await auditController.setOrganization(auditOrganization);});
    await fillSale(page,{quantity:'7',price:'30',discount:'0'});
    assert.equal(await page.locator('#commerceSaleSubmit').isDisabled(),true);
    await page.evaluate(()=>auditReleaseSaleReply());
    await page.waitForFunction(()=>!document.querySelector('#commerceSaleSubmit').disabled);
    assert.equal(await page.locator('#commerceQuantity').inputValue(),'7');assert.deepEqual(await page.evaluate(()=>auditNotices),[]);
  });
  await check('inactive expense is disabled and scripted click cannot call RPC',async page=>{
    const button=page.locator('[data-commerce-record-expense]');assert.equal(await button.isDisabled(),true);assert.equal(await button.textContent(),'Неактивен');
    await button.evaluate(e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    assert.equal(await page.evaluate(()=>auditCalls.filter(c=>c.name==='record_minuta_recurring_expense_v147').length),0);
  },{data:{...workspace(),recurring_expenses:[inactive]}});
  const large=workspace();
  large.inventory_items=Array.from({length:1000},(_,i)=>({id:'item-'+i,name:'Synthetic product '+i,sku:'SKU-'+i,unit:'ml'}));
  large.sales=Array.from({length:1000},(_,i)=>({id:'sale-'+i,organization_id:ids.organization,status:'paid',payment_method:'cash',total_minor:10000,refunded_minor:0,occurred_at:'2026-10-15T10:00:00Z',seller_id:ids.owner,seller_name:'Synthetic owner',line:{item_name:'Synthetic product '+i,item_kind:'inventory_item',quantity:1,refunded_quantity:0,unit_price_minor:10000}}));
  await check('large history and catalog retain the last sale, refund and product',async page=>{
    assert.equal(await page.locator('.commerce-sale-row').count(),1000);
    assert.equal(await page.locator('#commerceSalesCount').textContent(),'1000');
    await page.locator('.commerce-sale-row').last().getByRole('button',{name:'Возврат'}).click();
    assert.equal(await page.locator('#commerceRefundSale').inputValue(),'sale-999');
    await fillSale(page);
    await page.locator('.cs-product-choice').click();
    assert.equal(await page.locator('.cs-picker-row').count(),1000);
    await page.locator('.cs-picker-search').fill('SKU-999');
    assert.equal(await page.locator('.cs-picker-row').count(),1);
    await page.locator('.cs-picker-row').click();
    assert.equal(await page.locator('#commerceItem').inputValue(),'item-999');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  },{data:large});
} finally {await browser.close();}
console.log(`Commerce recovery regression checks passed: ${passed}`);
