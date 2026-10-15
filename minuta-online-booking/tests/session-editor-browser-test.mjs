import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {startFixture} from './session-editor-fixture.mjs';

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture();
const browser=await chromium.launch({headless:true});
const before=process.argv.includes('--before');
const output=process.env.MINUTA_SESSION_SCREENSHOTS;
if(output)mkdirSync(output,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
  await page.goto(url);
  assert.deepEqual(errors,[],'fixture renders actual editor without errors');
  await page.locator('#sessionComposerForm .pro-select-trigger').waitFor();
  const catalogue=await page.evaluate(()=>JSON.stringify(ownServices));
  if(output)await page.locator('.booking-sheet-panel').screenshot({path:output+'/initial-390.png'});
  if(!before) {
    for(const theme of ['pink-porcelain','sage','noir-rose','midnight']) {
      await page.evaluate(theme=>resetFixture({theme}),theme);
      for(const width of [320,390,760,1440]) {
        await page.setViewportSize({width,height:844});
        const m=await page.evaluate(()=>{
          const form=document.querySelector('#sessionComposerForm');
          const panel=form.closest('.booking-sheet-panel');
          const [duration,price]=form.querySelectorAll('.session-composer-fields input');
          const rect=e=>e.getBoundingClientRect().toJSON();
          const summary=form.querySelector('.session-composer-summary');
          const total=document.querySelector('#sessionComposerTotal');
          return {duration:rect(duration),price:rect(price),panel:rect(panel),overflow:panel.scrollWidth-panel.clientWidth,
            summary:rect(summary),total:rect(total),durationTotal:rect(document.querySelector('#sessionComposerDuration')),
            panelImage:getComputedStyle(panel).backgroundImage,
            card:getComputedStyle(form.querySelector('.session-composer-item')).backgroundColor,
            action:[...form.querySelectorAll('[data-add-session-item],#sessionComposerSave')].map(e=>({rect:rect(e),image:getComputedStyle(e).backgroundImage,color:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor})),
            close:rect(document.querySelector('.booking-sheet-close'))};
        });
        assert.ok(m.price.left>m.duration.right,theme+'/'+width+': fields side by side');
        assert.ok(Math.abs(m.duration.top-m.price.top)<1,theme+'/'+width+': input baselines align');
        assert.ok(m.duration.height>=44&&m.price.height>=44,theme+'/'+width+': input targets');
        assert.ok(m.panel.left>=0&&m.panel.right<=width+1&&m.overflow<=1,theme+'/'+width+': no horizontal overflow');
        assert.equal(m.panelImage,'none');
        assert.ok(m.action.every(a=>a.rect.height>=44&&a.image==='none'),'flat accessible actions');
        assert.ok(m.close.width>=44&&m.close.height>=44&&m.close.left>=m.panel.left&&m.close.right<=m.panel.right,'close stays inside');
        const back=await page.locator('.booking-editor-back').evaluate(e=>({color:getComputedStyle(e).color,bg:getComputedStyle(e.closest('.booking-sheet-panel')).backgroundColor,rect:e.getBoundingClientRect().toJSON()}));
        assert.notEqual(back.color,back.bg,theme+': back action remains visible');
        assert.ok(Math.abs(back.rect.top+back.rect.height/2-m.close.top-m.close.height/2)<1,'header controls share a centre line');
        assert.equal(await page.locator('.session-service-name').isVisible(),false,'no repeated service title');
        assert.equal(await page.locator('.pro-select-value').innerText(),'Массаж спины + ШВЗ — углублённый');
        if(width>=390)assert.ok(Math.abs(m.total.top-m.durationTotal.top)<2,'compact one-line totals');
        if(theme==='pink-porcelain') {
          assert.equal(m.card,'rgba(0, 0, 0, 0)','no pink nested service card');
          assert.equal(m.action[1].bg,'rgb(251, 224, 235)');
          assert.equal(m.action[1].color,'rgb(189, 23, 103)');
        }
        if(output&&width!==320)await page.locator('.booking-sheet-panel').screenshot({path:output+'/'+theme+'-'+width+'.png'});
      }
    }
    await page.setViewportSize({width:390,height:844});
  }
  await page.evaluate(()=>resetFixture());
  await page.locator('.pro-select-trigger').click();
  await page.locator('.pro-select-option').filter({hasText:'базовый'}).click();
  assert.equal(await page.locator('[data-session-duration]').inputValue(),'40');
  assert.equal(await page.locator('[data-session-price]').inputValue(),'2500');
  assert.match(await page.locator('#sessionComposerTotal').textContent(),/2\s*500/);
  await page.locator('[data-session-duration]').fill('90');
  await page.locator('[data-session-price]').fill('4000');
  assert.equal(await page.locator('#sessionComposerDuration').textContent(),'90 мин');
  await page.locator('[data-add-session-item]').click();
  const addon=page.locator('[data-session-item="1"]');
  await addon.locator('[data-session-price]').fill('500');
  await addon.locator('[data-session-duration]').fill('20');
  assert.equal(await page.locator('#sessionComposerDuration').textContent(),'90 мин','non-extending addon changes price only');
  assert.match(await page.locator('#sessionComposerTotal').textContent(),/4\s*500/);
  await addon.locator('[data-session-extends]').check();
  assert.equal(await page.locator('#sessionComposerDuration').textContent(),'110 мин');
  if(output)await page.locator('.booking-sheet-panel').screenshot({path:output+'/addon-390.png'});
  await page.locator('[data-remove-session-item]').click();
  assert.equal(await page.locator('#sessionComposerDuration').textContent(),'90 мин');
  assert.match(await page.locator('#sessionComposerTotal').textContent(),/4\s*000/);
  await page.evaluate(()=>resetFixture({service:'minute',duration:30,price:1500}));
  assert.match(await page.locator('.pro-select-value').innerText(),/\/мин/,'minute rate remains visible');
  await page.locator('[data-session-duration]').fill('45');
  await page.locator('[data-session-price]').fill('60');
  assert.match(await page.locator('#sessionComposerTotal').textContent(),/2\s*700/,'actual minute-rate calculation retained');
  await page.evaluate(()=>resetFixture({nextTime:'13:00:00'}));
  await page.locator('[data-session-duration]').fill('90');
  assert.equal(await page.locator('#sessionComposerWarning').isVisible(),true);
  assert.equal(await page.locator('#sessionComposerSave').isDisabled(),true);
  await page.locator('[data-session-duration]').fill('40');
  assert.equal(await page.locator('#sessionComposerWarning').isVisible(),false);
  assert.equal(await page.locator('#sessionComposerSave').isEnabled(),true);
  await page.locator('[data-session-duration]').fill('0');
  assert.equal(await page.locator('#sessionComposerSave').isDisabled(),true);
  assert.equal(await page.locator('#sessionComposerForm').evaluate(f=>f.checkValidity()),false);
  await page.evaluate(()=>{resetFixture();fixturePending=true;});
  await page.locator('#sessionComposerSave').click();
  assert.equal(await page.locator('#sessionComposerSave').innerText(),'Сохраняем…');
  assert.equal(await page.locator('#sessionComposerSave').isDisabled(),true);
  await page.evaluate(()=>fixtureRelease());
  await page.waitForFunction(()=>fixtureEffects.some(e=>e.type==='refresh'));
  const call=await page.evaluate(()=>fixtureEffects.find(e=>e.type==='rpc'));
  assert.equal(call.name,'save_booking_session');
  assert.deepEqual(call.args.p_items,[{kind:'primary',service_id:'s1',title:'Массаж спины + ШВЗ — углублённый',duration_minutes:60,price_rub:3000,extends_duration:true}]);
  await page.evaluate(()=>{resetFixture();fixtureRpcError={message:'synthetic refusal'};});
  await page.locator('#sessionComposerSave').click();
  await page.waitForFunction(()=>!document.querySelector('#sessionComposerError').hidden);
  assert.equal(await page.locator('#sessionComposerSave').isEnabled(),true);
  assert.equal(await page.evaluate(()=>fixtureEffects.filter(e=>e.type==='fallback').length),0,'server refusal does not turn into an apparent success');
  await page.evaluate(()=>{resetFixture();fixtureRpcError={message:'Could not find the function save_booking_session'};});
  await page.locator('#sessionComposerSave').click();
  await page.waitForFunction(()=>fixtureEffects.some(e=>e.type==='refresh'));
  assert.equal(await page.evaluate(()=>fixtureEffects.filter(e=>e.type==='fallback').length),1,'existing missing-RPC fallback retained with fake storage');
  assert.equal(await page.evaluate(()=>JSON.stringify(ownServices)),catalogue,'catalogue unchanged');
  if(!before) {
    await page.evaluate(()=>resetFixture());
    await page.setViewportSize({width:390,height:460});
    await page.locator('[data-session-price]').focus();
    await page.locator('#sessionComposerSave').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.booking-sheet-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'short viewport keeps controls readable');
    const fallback=await browser.newPage({viewport:{width:390,height:844}});
    await fallback.route('**/*',r=>r.request().url().includes('/provider-selects.js')?r.abort():r.request().url().startsWith(url)?r.continue():r.abort());
    await fallback.goto(url);
    assert.equal(await fallback.locator('[data-session-service]').isVisible(),true,'native select survives optional enhancer failure');
    assert.equal(await fallback.locator('.session-service-name').isVisible(),true,'native fallback keeps full service name');
    await fallback.locator('[data-session-service]').selectOption('s2');
    assert.equal(await fallback.locator('[data-session-duration]').inputValue(),'40');
    await fallback.close();
    await page.setViewportSize({width:390,height:844});
  }
  await page.evaluate(()=>{resetFixture();fixtureAllowWrites=false;});
  await page.locator('#sessionComposerSave').click();
  assert.equal(await page.evaluate(()=>fixtureEffects.some(e=>e.type==='rpc'||e.type==='fallback')),false);
  assert.deepEqual(errors,[],'no page errors');
  console.log('Session editor '+(before?'baseline':'presentation')+': actual renderers/events, calculations, addons, minute rate, overlap, validation and synthetic save/error paths PASS');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
