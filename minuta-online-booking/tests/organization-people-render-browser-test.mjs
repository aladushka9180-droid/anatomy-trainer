import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {fixture} from './organization-people-fixture.mjs';

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true});
try {
  for(const width of [390,760,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
    try {
      const check=await fixture(page);
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReturnAsStream'});
      const elapsed=await page.evaluate(async()=>{
        orgData.locations=Array.from({length:5},(_,i)=>({id:'l'+i,name:'Тестовый филиал '+i,address:'Вымышленный адрес',timezone:'Europe/Samara',active:true,is_primary:i===0}));
        orgData.members=Array.from({length:50},(_,i)=>({user_id:'u'+(i+1),display_name:'Тестовый сотрудник '+(i+1),email:'member'+i+'@example.invalid',role:i===0?'owner':'specialist',active:true,is_bookable:true,is_current_user:i===0}));
        shiftData={organization_id:'org-a',services:[],shifts:[],absences:[]};
        const start=performance.now();await controller.load();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return performance.now()-start;
      });
      const tracingDone=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
      await cdp.send('Tracing.end');
      const {stream}=await tracingDone;let trace='';
      while(true){const piece=await cdp.send('IO.read',{handle:stream});trace+=piece.base64Encoded?Buffer.from(piece.data,'base64').toString('utf8'):piece.data;if(piece.eof)break;}
      await cdp.send('IO.close',{handle:stream});
      const stylePasses=JSON.parse(trace).traceEvents.filter(event=>event.ph==='X'&&event.name==='UpdateLayoutTree').length;
      // The previous enhancer forced over 100 style passes for this render.
      // Count browser work rather than impose a machine-dependent elapsed-time threshold.
      assert.ok(stylePasses<=20,`${width}: ${stylePasses} style passes for 50 members`);
      assert.equal(await page.locator('[data-member-card]').count(),50);
      assert.equal(await page.locator('[data-member-card] select.pro-select-native').count(),50);
      assert.equal(await page.locator('[data-member-card] .pro-select-trigger').count(),50);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2);
      const member=page.locator('[data-member-card]').nth(1);
      await member.locator('summary').click();
      await member.locator('.pro-select-trigger').click();
      await page.locator('.pro-select-dialog').getByRole('option',{name:'Администратор',exact:true}).click();
      assert.equal(await member.locator('select').inputValue(),'admin');
      assert.match(await member.locator('.pro-select-trigger').innerText(),/Администратор/);
      assert.deepEqual(check.errors,[]);assert.deepEqual(check.unexpected,[]);
      console.log(JSON.stringify({width,members:50,branches:5,stylePasses,elapsedMs:+elapsed.toFixed(1),scope:'isolated synthetic fixture; excludes real transport and full startup'}));
    } finally {await page.close();}
  }
  console.log('PASS: bulk rendering avoids per-field style recalculation; all 50 selectors and role changes remain functional at 390/760/1440.');
} finally {await browser.close();}
