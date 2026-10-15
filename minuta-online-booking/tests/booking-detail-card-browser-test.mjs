import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {startFixture} from './booking-detail-card-fixture.mjs';

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture();
const browser=await chromium.launch({headless:true});
const errors=[];
try {
  const page=await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  // The fixture serves real renderers and the production stylesheet cascade, without any backend.
  await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
  await page.goto(url);
  // Production configures Porcelain action colors through its palette matrix.
  await page.addScriptTag({content:readFileSync(new URL('../provider-porcelain-matrix.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{
    const palette=MinutaProviderPorcelainMatrix.paletteFor('petal','gentle-pink');
    document.body.style.setProperty('--porcelain-action-bg',palette.actionBg);
    document.body.style.setProperty('--porcelain-action-ink',palette.actionInk);
  });
  assert.deepEqual(errors,[],'Actual booking renderer loads');
  await page.locator('.booking-sheet-reference').waitFor();
  for(const width of [360,390,760,1440]) {
    await page.setViewportSize({width,height:900});
    const metrics=await page.evaluate(()=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect();
      const buttons=[...document.querySelectorAll('.booking-repeat-actions>:is(button,a)')].map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,height:r.height,overflow:node.scrollWidth-node.clientWidth};});
      const panel=document.querySelector('.booking-sheet-panel');
      return {buttons,viewport:innerWidth,panel:rect('.booking-sheet-panel').toJSON(),overflow:panel.scrollWidth-panel.clientWidth,
        services:rect('.booking-session-summary').top,outcome:rect('.booking-outcome-disclosure').top,extra:rect('.detail-card-extras').top,
        titleSize:getComputedStyle(document.querySelector('#bookingSheetTitle')).fontSize};
    });
    assert.equal(metrics.buttons.length,4,`${width}: four quick actions`);
    assert.equal(metrics.buttons[0].left,metrics.buttons[2].left,`${width}: left column`);
    assert.equal(metrics.buttons[0].right,metrics.buttons[2].right,`${width}: left column width`);
    assert.equal(metrics.buttons[1].left,metrics.buttons[3].left,`${width}: right column`);
    assert.ok(metrics.buttons[0].top<metrics.buttons[2].top,`${width}: two rows`);
    assert.ok(metrics.buttons.every(button=>button.height>=44&&button.overflow<2),`${width}: tap targets and full labels`);
    assert.ok(metrics.panel.left>=0&&metrics.panel.right<=width+1&&metrics.overflow<=1,`${width}: no horizontal overflow`);
    assert.ok(metrics.services<metrics.outcome&&metrics.outcome<metrics.extra,`${width}: approved section order`);
    if(process.env.MINUTA_CARD_SCREENSHOTS){mkdirSync(process.env.MINUTA_CARD_SCREENSHOTS,{recursive:true});await page.locator('.booking-sheet-panel').screenshot({path:`${process.env.MINUTA_CARD_SCREENSHOTS}/card-${width}.png`});}
  }
  for(const theme of ['pink-porcelain','sage','noir-rose','midnight']) {
    await page.locator('body').evaluate((body,value)=>body.dataset.providerTheme=value,theme);
    for(const width of [390,760,1440]) {
      await page.setViewportSize({width,height:900});
      const colors=await page.evaluate(()=>{
        const body=getComputedStyle(document.body);
        const sheet=document.querySelector('#bookingSheet');
        const panel=getComputedStyle(sheet.querySelector('.booking-sheet-panel'));
        const close=getComputedStyle(sheet.querySelector('.booking-sheet-close'));
        const primary=getComputedStyle(sheet.querySelector('.booking-repeat-actions>.primary'));
        const soft=getComputedStyle(sheet.querySelector('.booking-repeat-actions>:not(.primary)'));
        const sample=document.createElement('span');document.body.append(sample);
        const resolve=value=>{sample.style.color=value;return getComputedStyle(sample).color};
        const expected={surface:resolve(body.getPropertyValue('--theme-surface')),ink:resolve(body.getPropertyValue('--theme-ink')),
          accent:resolve(body.getPropertyValue('--theme-accent')),soft:resolve(body.getPropertyValue('--theme-accent-soft')),
          contrast:resolve(body.getPropertyValue('--theme-accent-contrast')),surfaceAlt:resolve(body.getPropertyValue('--theme-surface-alt')),
          actionBg:resolve(body.getPropertyValue('--porcelain-action-bg')),actionInk:resolve(body.getPropertyValue('--porcelain-action-ink'))};
        sample.remove();
        return {expected,panel:panel.backgroundColor,ink:panel.color,close:close.backgroundColor,closeInk:close.color,
          primary:primary.backgroundColor,primaryInk:primary.color,soft:soft.backgroundColor,softInk:soft.color,
          overflow:sheet.querySelector('.booking-sheet-panel').scrollWidth-sheet.querySelector('.booking-sheet-panel').clientWidth};
      });
      assert.equal(colors.panel,colors.expected.surface,`${theme}/${width}: panel follows theme surface`);
      assert.equal(colors.ink,colors.expected.ink,`${theme}/${width}: text follows theme ink`);
      assert.equal(colors.close,colors.expected.surfaceAlt,`${theme}/${width}: close control follows theme surface`);
      assert.equal(colors.closeInk,colors.expected.ink,`${theme}/${width}: close icon stays readable`);
      assert.equal(colors.primary,theme==='pink-porcelain'?colors.expected.actionBg:colors.expected.accent,`${theme}/${width}: primary action follows selected action palette`);
      assert.equal(colors.primaryInk,theme==='pink-porcelain'?colors.expected.actionInk:colors.expected.contrast,`${theme}/${width}: primary label follows selected action contrast`);
      assert.equal(colors.soft,colors.expected.soft,`${theme}/${width}: secondary actions follow theme tint`);
      assert.equal(colors.softInk,colors.expected.accent,`${theme}/${width}: secondary labels follow theme accent`);
      assert.ok(colors.overflow<=1,`${theme}/${width}: no horizontal overflow`);
      if(process.env.MINUTA_CARD_SCREENSHOTS){await page.locator('.booking-sheet-panel').screenshot({path:`${process.env.MINUTA_CARD_SCREENSHOTS}/card-${theme}-${width}.png`});}
    }
  }
  await page.locator('body').evaluate(body=>body.dataset.providerTheme='pink-porcelain');
  assert.equal(await page.locator('.booking-outcome-disclosure').getAttribute('open'),null,'Payment editor collapsed');
  assert.match(await page.locator('.booking-outcome-disclosure>summary').textContent(),/Получено 5\s?800 ₽ · Перевод/);
  assert.match(await page.locator('.detail-card-sync').textContent(),/Сохранено на устройствеОжидает синхронизации/);
  assert.ok((await page.locator('[data-repeat-booking]').getAttribute('class')).includes('primary'));
  assert.equal(await page.locator('.detail-card-call').getAttribute('href'),'tel:+79000000001');
  await page.locator('.booking-client-overview>summary').click();
  assert.equal(await page.locator('.booking-client-overview').getAttribute('open'),'','History opens');
  for(const selector of ['.booking-labels-disclosure','.booking-note-disclosure','.booking-client-result-disclosure','.booking-color-compact','.booking-outcome-disclosure']){
    await page.locator(selector+'>summary').click();
    assert.equal(await page.locator(selector).getAttribute('open'),'',`${selector}: original editor reachable`);
    await page.locator(selector+'>summary').click();
  }
  await page.locator('.booking-outcome-disclosure>summary').click();
  assert.equal(await page.locator('#outcomeAmount').inputValue(),'5800');
  await page.locator('#bookingOutcomeForm button[type=submit]').click();
  assert.ok(await page.evaluate(()=>fixtureEffects.includes('outcome')),'Original payment submit listener retained');
  // No real messages, calls, bookings, payments or deletes are performed.
  for(const selector of ['[data-open-client-profile]','[data-message-client]','[data-repeat-booking]','[data-commerce-booking-sale]','[data-edit-booking-session]'])await page.locator(selector).click();
  assert.ok(await page.evaluate(()=>fixtureEffects.includes('openClientProfile')&&fixtureEffects.includes('repeatBooking')&&fixtureEffects.includes('editBookingSession')));
  await page.evaluate(()=>renderFixture({outcome:{_sync_pending:false,completion_source:'manual',amount_rub:0,payment_method:'unpaid'}}));
  assert.equal(await page.locator('.detail-card-sync').count(),0,'No fictitious sync message');
  assert.match(await page.locator('.booking-outcome-disclosure>summary').textContent(),/Не оплачено/,'Zero payment is not replaced by service price');
  await page.evaluate(()=>renderFixture({item:{client_name:'Очень длинное имя клиента с длинной фамилией',client_phone:''},outcome:{visit_status:'scheduled'}}));
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.locator('.detail-card-call').count(),0,'No empty telephone link');
  assert.equal(await page.locator('[data-edit-booking]').count(),1,'Rescheduling is preserved');
  await page.evaluate(()=>renderFixture({demo:true}));
  assert.equal(await page.locator('.booking-sheet-reference').count(),0,'Demo write controls are not exposed');
  assert.deepEqual(errors,[]);
  console.log('booking detail card: render, layout 360/390/760/1440, original actions, disclosure forms and truthful pending/unpaid states PASS');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
