import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './organization-people-fixture.mjs';
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true });
const output = process.env.MINUTA_SCREENSHOT_DIR ? resolve(process.env.MINUTA_SCREENSHOT_DIR) : '';
if (output) mkdirSync(output, { recursive: true });
let checks = 0;
const eq = (a,b,message) => { assert.deepEqual(a,b,message); checks++; };
const ok = (a,message) => { assert.ok(a,message); checks++; };
const openCreator = async (page,id) => {
  if (!(await page.locator('#'+id).evaluate(node=>node.open))) await page.locator('[data-people-open="'+id+'"]').click();
};
async function textContrasts(page) {
  return page.evaluate(()=>{
    const ctx=document.createElement('canvas').getContext('2d');
    const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
    const blend=(top,under)=>top.slice(0,3).map((v,i)=>v*top[3]+under[i]*(1-top[3]));
    const lum=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('#organizationPeopleSection .organization-row-main > strong,#organizationPeopleSection .organization-row-main > small,#organizationPeopleSection .organization-member-states > span,#organizationPeopleSection .settings-hint')].map(e=>{
      const chain=[];for(let n=e;n;n=n.parentElement)chain.unshift(n);
      const bg=chain.reduce((color,n)=>blend(rgba(getComputedStyle(n).backgroundColor),color),[255,255,255]);
      const ink=blend(rgba(getComputedStyle(e).color),bg),a=lum(ink),b=lum(bg);
      return {text:e.textContent.trim().slice(0,60),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
  });
}
try {
  for (const theme of process.argv.includes('--scenarios-only') ? [] : ['pink-porcelain','celadon','oled-mono']) {
    for (const width of [390,760,1440]) {
      const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
      const f=await fixture(page,{theme});
      try {
        eq(await page.locator('#locationsCount').innerText(),'2','active locations count');
        eq(await page.locator('#membersCount').innerText(),'2','pending owner is not a member');
        eq(await page.locator('#invitationsCount').innerText(),'1','separate invitations');
        eq(await page.locator('.people-panel-title h3 .ui-icon').count(),2);
        ok(await page.locator('[data-member-card="u1"] .organization-row-main').innerText().then(x=>x.includes('Доступ открыт')&&x.includes('Принимает клиентов')));
        ok(!(await page.locator('[data-member-card="u1"] .organization-row-main small').innerText()).includes('·'),'email and statuses do not duplicate');
        const shape=await page.evaluate(()=>({
          overflow:document.documentElement.scrollWidth-innerWidth,
          heads:[...document.querySelectorAll('#organizationPeopleSection h3')].map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,line:parseFloat(getComputedStyle(e).lineHeight)})),
          names:[...document.querySelectorAll('#organizationPeopleSection .organization-row-main > strong')].map(e=>parseFloat(getComputedStyle(e).fontSize)),
          actions:[...document.querySelectorAll('[data-people-open]')].map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))
        }));
        ok(shape.overflow<=2,'no page overflow '+theme+'/'+width+' '+shape.overflow);
        ok(shape.heads.every(h=>h.w>100&&h.h<=h.line*1.3),'single-line headings');
        ok(shape.names.every(n=>n>=16),'readable row names');
        ok(shape.actions.every(a=>a.h>=44&&a.w>60),'usable primary actions');
        const contrast=await textContrasts(page);
        ok(contrast.every(c=>c.ratio>=4.5),'text contrast '+theme+' '+JSON.stringify(contrast.filter(c=>c.ratio<4.5)));
        if(output)await page.screenshot({path:resolve(output,'people-'+theme+'-'+width+'.png'),fullPage:true});
        await page.locator('[data-member-card="u1"] summary').click();
        await page.locator('[data-member-card="u1"] [data-people-workplace]').waitFor({state:'visible'});
        await page.locator('[data-member-card="u1"] [data-people-workplace]').scrollIntoViewIfNeeded();
        await page.waitForFunction(()=>document.querySelector('[data-member-card="u1"] [data-people-workplace]').textContent.includes('По графику'));
        eq(await page.locator('[data-member-card="u1"] select[name="role"]').isEnabled(),false,'last active owner cannot be downgraded');
        eq(await page.locator('[data-member-card="u1"] input[name="active"]').isEnabled(),false,'last active owner cannot be disabled');
        ok((await page.locator('[data-member-card="u1"] [data-people-workplace]').innerText()).includes('Основной филиал'),'saved shift workplace');
        ok((await page.locator('[data-member-card="u1"] [data-people-workplace]').innerText()).includes('Онлайн-запись команды выключена'),'accepting is not online availability');
        await openCreator(page,'locationCreator');await page.locator('#locationName').fill('Черновик филиала');
        await openCreator(page,'memberCreator');await page.locator('#memberEmail').fill('draft@example.invalid');
        if(width<=760)eq(await page.locator('#organizationPeopleSection details[open]').count(),1,'one mobile form');
        await openCreator(page,'locationCreator');
        eq(await page.locator('#locationName').inputValue(),'Черновик филиала','switching forms retains draft');
        await page.reload();
        await page.locator('#organizationPeopleSection[data-people-ready]').waitFor({state:'visible'});
        eq(await page.locator('#locationName').inputValue(),'Черновик филиала','refresh retains account/org draft');
        eq(await page.locator('#memberEmail').inputValue(),'draft@example.invalid','other draft survives refresh');
        await openCreator(page,'locationCreator');
        await page.locator('#locationForm [data-people-cancel]').click();
        eq(await page.locator('#locationName').inputValue(),'','explicit cancel clears draft');
        eq(await page.evaluate(()=>calls.filter(x=>!x.name.startsWith('get_')).length),0,'no write in visual/draft checks');
        eq(f.errors,[]);eq(f.unexpected,[]);
        console.log('PASS people visuals/drafts '+theme+' '+width);
      }finally{await page.close();}
    }
  }
  const page=await browser.newPage({viewport:{width:390,height:1000},serviceWorkers:'block'});
  const f=await fixture(page);
  try {
    await openCreator(page,'locationCreator');await page.locator('#locationName').fill('Новый филиал');
    await page.locator('#locationAddress').fill('Тестовый адрес, 10');
    await page.evaluate(()=>{writeMode='refuse';});
    await page.locator('#locationForm button[type="submit"]').click();
    await page.locator('#locationError').waitFor({state:'visible'});
    eq(await page.locator('#locationName').inputValue(),'Новый филиал','refusal retains values');
    eq(await page.locator('#locationsCount').innerText(),'2','refusal keeps counts');
    eq(await page.locator('#locationCreator').evaluate(n=>n.open),true,'refusal stays open');
    await page.evaluate(()=>{writeMode='ok';delayWrite=true;});
    await page.locator('#locationForm button[type="submit"]').click();
    await page.waitForFunction(()=>Boolean(window.releaseWrite));
    eq(await page.locator('#locationForm button[type="submit"]').isEnabled(),false,'busy state');
    await page.evaluate(()=>document.querySelector('#locationForm').dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:document.querySelector('#locationForm button[type="submit"]')})));
    eq(await page.evaluate(()=>calls.filter(x=>x.name==='create_minuta_location').length),2,'duplicate submit suppressed');
    await page.evaluate(()=>{delayWrite=false;releaseWrite();});
    await page.waitForFunction(()=>document.querySelector('#locationsCount').textContent==='3');
    eq(await page.locator('#locationName').inputValue(),'','success clears only saved draft');
    eq(await page.locator('#auditCount').innerText(),'1','ack updates journal');
    eq(await page.locator('[data-people-live]').innerText(),'Филиал добавлен','accessible success');
    await openCreator(page,'memberCreator');await page.locator('#memberEmail').fill('new@example.invalid');
    await page.locator('#memberInviteForm button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('#invitationsCount').textContent==='2');
    eq(await page.locator('#membersCount').innerText(),'2','invite does not create accepted membership');
    eq(await page.locator('#memberInviteShare').isVisible(),true,'share contract retained');
    await openCreator(page,'locationCreator');await page.locator('#locationName').fill('Первый вариант');
    await page.evaluate(()=>{delayWrite=true;delete window.releaseWrite;});
    await page.locator('#locationForm button[type="submit"]').click();
    await page.waitForFunction(()=>Boolean(window.releaseWrite));
    await page.locator('#locationName').fill('Следующий черновик');
    await page.evaluate(()=>{delayWrite=false;releaseWrite();});
    await page.waitForFunction(()=>document.querySelector('#locationsCount').textContent==='4');
    eq(await page.locator('#locationName').inputValue(),'Следующий черновик','typing during save survives acknowledgement');
    eq(await page.locator('#locationCreator').evaluate(n=>n.open),true,'next draft remains open');
    await page.evaluate(()=>{writeMode='throw';});
    await page.locator('#locationForm button[type="submit"]').click();
    await page.locator('#locationError').waitFor({state:'visible'});
    ok((await page.locator('#locationError').innerText()).includes('могло сохраниться'),'uncertain write is honest');
    const before=await page.evaluate(()=>calls.filter(x=>x.name==='create_minuta_location').length);
    await page.locator('#locationForm button[type="submit"]').click();
    eq(await page.evaluate(()=>calls.filter(x=>x.name==='create_minuta_location').length),before,'uncertain create cannot be blindly repeated');
    await page.locator('[data-people-reload]').click();
    await page.evaluate(()=>{writeMode='ok';});
    await page.locator('#locationForm button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('#locationsCount').textContent==='5');
    await openCreator(page,'locationCreator');await page.locator('#locationName').fill('Только организация A');
    await page.evaluate(()=>{const s=document.querySelector('#organizationSwitcher');s.value='org-b';s.dispatchEvent(new Event('change',{bubbles:true}));});
    eq(await page.locator('#locationName').inputValue(),'','draft not exposed to another organization');
    await page.evaluate(()=>{const s=document.querySelector('#organizationSwitcher');s.value='org-a';s.dispatchEvent(new Event('change',{bubbles:true}));});
    eq(await page.locator('#locationName').inputValue(),'Только организация A','switch back restores matching draft');
    await page.evaluate(()=>{readMode='error';});
    await page.locator('[data-people-reload]').click();
    await page.locator('[data-member-card="u1"] summary').click();
    await page.waitForFunction(()=>document.querySelector('[data-member-card="u1"] [data-people-workplace]')?.textContent.includes('Не удалось проверить'));
    ok((await page.locator('[data-member-card="u1"] [data-people-workplace]').innerText()).includes('Не удалось проверить'),'read failure is unknown, not unassigned');
    await page.evaluate(()=>{readMode='foreign';});
    await openCreator(page,'locationCreator');
    await page.locator('[data-member-card="u1"] summary').click();
    await page.locator('[data-member-card="u1"] [data-people-retry]').click();
    await page.waitForFunction(()=>document.querySelector('[data-member-card="u1"] [data-people-workplace]').textContent.includes('Не удалось проверить'));
    ok(!(await page.locator('[data-member-card="u1"] [data-people-workplace]').innerText()).includes('По графику'),'foreign organization response is rejected');
    await page.evaluate(()=>{readMode='ok';delayRead=true;delete window.releaseRead;});
    await page.locator('[data-member-card="u1"] [data-people-retry]').click();
    await page.waitForFunction(()=>Boolean(window.releaseRead));
    await page.evaluate(()=>logout());
    await page.evaluate(()=>{delayRead=false;releaseRead();});
    eq(await page.locator('#organizationWorkspace').isVisible(),false,'logout hides people');
    eq(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('minuta-people-drafts-v1:')).length),0,'logout purges private drafts');
    eq(f.errors,[]);eq(f.unexpected,[]);
  }finally{await page.close();}
  for(const role of ['admin','specialist']){
    const page=await browser.newPage({viewport:{width:390,height:900},serviceWorkers:'block'});
    const f=await fixture(page,{role});
    try{
      eq(await page.locator('[data-member-card="u1"]').count(),0,'owner not editable by '+role);
      if(role==='admin'){
        await openCreator(page,'memberCreator');
        eq(await page.locator('#memberRole option[value="owner"]').getAttribute('disabled'),'');
        eq(await page.locator('#memberRole option[value="admin"]').getAttribute('disabled'),'');
        await page.locator('#memberRole + .pro-select-trigger').click();
        eq(await page.getByRole('option',{name:'Владелец',exact:true}).isEnabled(),false,'actual owner option disabled');
        eq(await page.getByRole('option',{name:'Администратор',exact:true}).isEnabled(),false,'actual administrator option disabled');
        await page.keyboard.press('Escape');
        eq(await page.locator('[data-member-card="u2"]').count(),1);
      }else{
        eq(await page.locator('[data-people-open]').first().isVisible(),false);
        eq(await page.locator('#invitationsPanel').isVisible(),false);
        ok((await page.locator('[data-people-member="u2"] [data-people-workplace]').innerText()).includes('недоступен'),'restricted read is not an empty team claim');
      }
      eq(await page.evaluate(()=>calls.filter(x=>!x.name.startsWith('get_')).length),0);
      eq(f.errors,[]);eq(f.unexpected,[]);
    }finally{await page.close();}
  }
  {
    const page=await browser.newPage({viewport:{width:390,height:900},serviceWorkers:'block'});
    const f=await fixture(page);
    try{
      await page.evaluate(()=>{orgData.public_booking_enabled=true;orgData.members[1].active=false;});
      await page.locator('[data-people-reload]').click();
      await page.locator('[data-member-card="u2"] summary').click();
      await page.waitForFunction(()=>document.querySelector('[data-member-card="u2"] [data-people-workplace]').textContent.includes('Доступ отключён'));
      ok((await page.locator('[data-member-card="u2"] .organization-member-states').textContent()).includes('Приём недоступен'),'inactive member cannot appear to accept clients');
      await page.evaluate(()=>{orgData.members[1].active=true;orgData.members[1].is_bookable=false;shiftData.shifts[0].end_time='27:00';});
      await page.locator('[data-people-reload]').click();
      await page.locator('[data-member-card="u2"] summary').click();
      await page.waitForFunction(()=>document.querySelector('[data-member-card="u2"] [data-people-workplace]').textContent.includes('Приём клиентов выключен'));
      ok((await page.locator('[data-member-card="u1"] [data-people-workplace]').textContent()).includes('В графике нет смен'),'invalid shift hours are excluded');
      await openCreator(page,'locationCreator');await page.locator('#locationName').fill('Запрос до выхода');
      await page.evaluate(()=>{delayWrite=true;delete window.releaseWrite;});
      await page.locator('#locationForm button[type="submit"]').click();
      await page.waitForFunction(()=>Boolean(window.releaseWrite));
      eq(await page.locator('#locationForm [data-people-cancel]').isEnabled(),false,'cannot discard an in-flight save');
      const notices=await page.evaluate(()=>window.notices.length);
      await page.evaluate(()=>{logout();delayWrite=false;releaseWrite();});
      await page.waitForFunction(()=>calls.filter(x=>x.name==='create_minuta_location').length===1);
      eq(await page.locator('#organizationWorkspace').isVisible(),false,'late write does not reopen another session');
      eq(await page.evaluate(()=>window.notices.length),notices,'late write does not report a success in logged-out session');
      eq(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('minuta-people-drafts-v1:')).length),0);
      eq(f.errors,[]);eq(f.unexpected,[]);
    }finally{await page.close();}
  }
  console.log('Organization people PASS: '+checks+' assertions; synthetic transport only.');
}finally{await browser.close();}
