import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {fixture} from './organization-people-fixture.mjs';

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true});
let assertions=0;
const equal=(actual,expected,message)=>{assert.equal(actual,expected,message);assertions++;};
try {
  for(const scenario of [
    {reply:'success',sameActor:false,beforeNext:false},
    {reply:'reject',sameActor:false,beforeNext:false},
    {reply:'unconfirmed',sameActor:true,beforeNext:false},
    {reply:'reject',sameActor:false,beforeNext:true}
  ]) {
    const page=await browser.newPage({viewport:{width:390,height:1000},serviceWorkers:'block'});
    try {
      const check=await fixture(page);
      await page.evaluate(()=>{window.heldWrites=[];window.oldWorkspace={organizations:[structuredClone(orgData)],pending_invitations:[]};});
      await page.locator('[data-people-open="locationCreator"]').click();
      await page.locator('#locationName').fill('Старый черновик');
      await page.locator('#locationForm button[type=submit]').click();
      await page.waitForFunction(()=>heldWrites.length===1);
      equal(await page.locator('#locationForm button[type=submit]').isDisabled(),true,'The first write owns the busy state');

      const loaded=await page.evaluate(async sameActor=>{
        controller.reset();generation++;if(!sameActor)actor='next-owner';
        orgData={...structuredClone(orgData),id:'next-org',name:'Следующая тестовая организация',invitations:[],audit:[]};
        orgData.members[0].user_id=actor;orgB={...structuredClone(orgB),id:'next-other'};
        shiftData={organization_id:orgData.id,services:[],shifts:[],absences:[]};
        return controller.load();
      },scenario.sameActor);
      equal(loaded.ok,true,'The next session loads without waiting for the old write');
      equal(await page.evaluate(()=>controller.getActiveOrganization()?.id),'next-org');
      equal(await page.locator('#locationName').inputValue(),'','Old drafts do not cross sessions');
      equal(await page.locator('#locationForm button[type=submit]').isEnabled(),true,'Reset releases the old form controls');

      const settleOld=()=>page.evaluate(reply=>{
        if(reply==='reject')heldWrites[0].reject(new Error('Synthetic lost response'));
        else heldWrites[0].resolve(reply==='unconfirmed'?{error:{code:'UNCONFIRMED_WRITE'}}:{data:{workspace:oldWorkspace}});
      },scenario.reply);
      if(scenario.beforeNext){await settleOld();await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));}
      await page.locator('[data-people-open="locationCreator"]').click();
      await page.locator('#locationName').fill('Новый филиал');
      await page.locator('#locationForm button[type=submit]').click();
      await page.waitForFunction(()=>heldWrites.length===2);
      await page.locator('#locationName').fill('Новый черновик после отправки');
      if(!scenario.beforeNext)await settleOld();
      await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));

      equal(await page.evaluate(()=>controller.getActiveOrganization()?.id),'next-org','An old response cannot replace the new workspace');
      equal(await page.locator('#locationName').inputValue(),'Новый черновик после отправки','An old response cannot clear a new draft');
      equal(await page.locator('#locationForm button[type=submit]').isDisabled(),true,'An old response cannot release the next write');
      equal(await page.locator('#locationForm button[type=submit]').innerText(),'Сохраняем…');
      equal(await page.locator('[data-people-reload]').isDisabled(),true,'Refresh remains blocked for the current write');
      equal(await page.evaluate(()=>notices.length),0,'Stale success and failure are silent');
      equal((await page.evaluate(()=>controller.load())).busy,true,'Only the current write blocks workspace reads');
      await page.locator('#locationForm').evaluate(form=>form.requestSubmit());
      equal(await page.evaluate(()=>heldWrites.length),2,'An old response cannot allow duplicate writes');

      await page.evaluate(()=>{
        orgData.locations.push({id:'new-location',name:'Новый филиал',address:'',timezone:'Europe/Samara',active:true,is_primary:false});
        heldWrites[1].resolve({data:{workspace:{organizations:[structuredClone(orgData),structuredClone(orgB)],pending_invitations:[]}}});
      });
      await page.waitForFunction(()=>notices.includes('Филиал добавлен'));
      equal(await page.locator('#locationForm button[type=submit]').isEnabled(),true,'The current completion releases its own controls');
      equal(await page.locator('[data-people-reload]').isEnabled(),true);
      equal(await page.locator('#locationName').inputValue(),'Новый черновик после отправки','Edits made while saving remain available');
      equal(await page.evaluate(()=>notices.length),1,'Only the current write announces success');
      equal(await page.evaluate(()=>controller.getActiveOrganization().locations.some(x=>x.id==='new-location')),true);
      assert.deepEqual(check.errors,[]);assert.deepEqual(check.unexpected,[]);assertions+=2;
    } finally {await page.close();}
  }
  console.log(`PASS: session reset, actor/generation changes, late success/rejection/unconfirmed response, next-write ownership, duplicate suppression and draft preservation; ${assertions} assertions.`);
} finally {await browser.close();}
