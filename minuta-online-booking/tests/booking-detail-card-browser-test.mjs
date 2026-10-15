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
      const buttons=[...document.querySelectorAll('.booking-repeat-actions>:is(button,a)')].map(node=>{
        const r=node.getBoundingClientRect(), walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text,labelLines=0;
        while(text=walker.nextNode())if(text.textContent.trim()){const range=document.createRange();range.selectNodeContents(text);labelLines=Math.max(labelLines,range.getClientRects().length);}
        return {left:r.left,right:r.right,top:r.top,height:r.height,overflow:node.scrollWidth-node.clientWidth,labelLines};
      });
      const panel=document.querySelector('.booking-sheet-panel');
      return {buttons,viewport:innerWidth,panel:rect('.booking-sheet-panel').toJSON(),overflow:panel.scrollWidth-panel.clientWidth,
        services:rect('.booking-session-summary').top,outcome:rect('.booking-outcome-disclosure').top,extra:rect('.detail-card-extras').top,
        titleSize:getComputedStyle(document.querySelector('#bookingSheetTitle')).fontSize};
    });
    assert.equal(metrics.buttons.length,4,`${width}: four quick actions`);
    assert.equal(metrics.buttons[0].left,metrics.buttons[1].left,`${width}: full-width repeat begins at the secondary row`);
    assert.equal(metrics.buttons[0].right,metrics.buttons[3].right,`${width}: full-width repeat spans three actions`);
    assert.equal(metrics.buttons[1].top,metrics.buttons[2].top,`${width}: secondary row aligned`);
    assert.equal(metrics.buttons[2].top,metrics.buttons[3].top,`${width}: all three secondary controls aligned`);
    assert.ok(Math.abs((metrics.buttons[1].right-metrics.buttons[1].left)-(metrics.buttons[3].right-metrics.buttons[3].left))<1,`${width}: secondary columns equal`);
    assert.ok(metrics.buttons[0].top<metrics.buttons[1].top,`${width}: primary first`);
    assert.ok(metrics.buttons.every(button=>button.height>=44&&button.overflow<2),`${width}: tap targets and full labels`);
    assert.ok(metrics.buttons.every(button=>button.labelLines===1),`${width}: no broken or wrapped quick-action label`);
    assert.ok(metrics.panel.left>=0&&metrics.panel.right<=width+1&&metrics.overflow<=1,`${width}: no horizontal overflow`);
    assert.ok(metrics.services<metrics.outcome&&metrics.outcome<metrics.extra,`${width}: approved section order`);
    assert.equal(metrics.titleSize,'24px',`${width}: selected reference heading size, rather than the compact card`);
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
          actionBg:resolve(body.getPropertyValue('--porcelain-action-bg')),actionInk:resolve(body.getPropertyValue('--porcelain-action-ink')),
          quietClose:resolve(`color-mix(in srgb,${body.getPropertyValue('--theme-ink')} 4%,${body.getPropertyValue('--theme-surface')})`),
          referencePrimary:resolve('#fbe0eb'),referenceAccent:resolve('#bd1767')};
        sample.remove();
        return {expected,panel:panel.backgroundColor,ink:panel.color,close:close.backgroundColor,closeInk:close.color,primaryIcon:getComputedStyle(sheet.querySelector('.booking-repeat-actions>.primary svg')).color,primaryImage:primary.backgroundImage,
          primary:primary.backgroundColor,primaryInk:primary.color,soft:soft.backgroundColor,softInk:soft.color,
          overflow:sheet.querySelector('.booking-sheet-panel').scrollWidth-sheet.querySelector('.booking-sheet-panel').clientWidth};
      });
      assert.equal(colors.panel,colors.expected.surface,`${theme}/${width}: panel follows theme surface`);
      assert.equal(colors.ink,colors.expected.ink,`${theme}/${width}: text follows theme ink`);
      assert.equal(colors.close,theme==='pink-porcelain'?colors.expected.quietClose:colors.expected.surfaceAlt,`${theme}/${width}: quiet close control stays within the theme`);
      assert.equal(colors.closeInk,colors.expected.ink,`${theme}/${width}: close icon stays readable`);
      assert.equal(colors.primary,theme==='pink-porcelain'?colors.expected.referencePrimary:colors.expected.accent,`${theme}/${width}: repeat keeps the approved light fill despite the general action palette`);
      assert.equal(colors.primaryInk,theme==='pink-porcelain'?colors.expected.referenceAccent:colors.expected.contrast,`${theme}/${width}: repeat label and icon use the reference accent`);
      assert.equal(colors.primaryIcon,colors.primaryInk,`${theme}/${width}: the repeat icon is not recolored by the general palette`);
      assert.equal(colors.primaryImage,'none',`${theme}/${width}: the repeat fill has no gradient`);
      assert.equal(colors.soft,colors.expected.surface,`${theme}/${width}: secondary actions use the sheet surface`);
      assert.equal(colors.softInk,theme==='pink-porcelain'?colors.expected.referenceAccent:colors.expected.accent,`${theme}/${width}: secondary labels follow the card accent`);
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
  await page.locator('.detail-card-call').click();
  assert.ok(await page.evaluate(()=>fixtureEffects.includes('openClientProfile')&&fixtureEffects.includes('repeatBooking')&&fixtureEffects.includes('messageClient')&&fixtureEffects.includes('commerceBookingSale')&&fixtureEffects.includes('editBookingSession')&&fixtureEffects.includes('call')));
  await page.evaluate(()=>renderFixture({outcome:{_sync_pending:false,completion_source:'manual',amount_rub:0,payment_method:'unpaid'}}));
  assert.equal(await page.locator('.detail-card-sync').count(),0,'No fictitious sync message');
  assert.match(await page.locator('.booking-outcome-disclosure>summary').textContent(),/Не оплачено/,'Zero payment is not replaced by service price');
  await page.evaluate(()=>renderFixture({firstVisit:true,item:{booking_date:'2026-10-16',booking_time:'12:00:00',duration_minutes:60,services:{name:'Массаж спины + ШВЗ — углублённый',duration_minutes:60,price_rub:3000},total_price_rub:3000},outcome:{visit_status:'scheduled',_sync_pending:false,completion_source:'manual'}}));
  await page.setViewportSize({width:390,height:900});
  assert.match(await page.locator('.booking-outcome-disclosure>summary').textContent(),/Запланирован/);
  assert.match(await page.locator('.booking-detail-heading .booking-status').textContent(),/Подтверждена/);
  assert.equal(await page.locator('.client-framed-count').textContent(),'0','Original first-visit gold frame level stays zero');
  const avatarStyle=await page.locator('.client-avatar-picker').evaluate(a=>({background:getComputedStyle(a).backgroundColor,width:a.getBoundingClientRect().width,icon:getComputedStyle(document.querySelector('.detail-card-call .detail-card-icon')).width}));
  assert.equal(avatarStyle.background,'rgba(0, 0, 0, 0)','Only the square avatar backing is cleared');
  assert.equal(avatarStyle.icon,'20px','Secondary actions match the selected reference icon size');
  assert.equal(await page.locator('[data-message-client]').innerText(),'Написать');
  assert.equal(await page.locator('[data-message-client]').getAttribute('aria-label'),'Написать клиенту','Full accessible action label retained');
  if(process.env.MINUTA_CARD_SCREENSHOTS)await page.locator('.booking-sheet-panel').screenshot({path:`${process.env.MINUTA_CARD_SCREENSHOTS}/card-first-visit-390.png`});
  await page.evaluate(()=>renderFixture({item:{client_name:'Очень длинное имя клиента с длинной фамилией',client_phone:''},outcome:{visit_status:'scheduled'}}));
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.locator('.detail-card-call').count(),0,'No empty telephone link');
  assert.equal(await page.locator('[data-edit-booking]').count(),1,'Rescheduling is preserved');
  await page.evaluate(()=>renderFixture({demo:true}));
  assert.equal(await page.locator('.booking-sheet-reference').count(),0,'Demo write controls are not exposed');
  assert.deepEqual(errors,[]);
  console.log('booking detail card: render, layout 360/390/760/1440, original actions, disclosure forms and truthful pending/unpaid states PASS');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
