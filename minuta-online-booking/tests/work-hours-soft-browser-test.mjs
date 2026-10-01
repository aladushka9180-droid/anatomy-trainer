import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { fixture } from './work-hours-soft-fixture.mjs';

const {chromium}=process.env.MINUTA_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href) : createRequire(import.meta.url)('playwright');
const output=process.env.MINUTA_HOURS_SCREENSHOTS;
if(output)mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true});
let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const [hi,lo]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(hi+.05)/(lo+.05);};
try {
  for(const theme of ['pink-porcelain','celadon','oled-mono'])for(const width of [390,760,1440]) {
    const page=await browser.newPage({viewport:{width,height:1100},serviceWorkers:'block',reducedMotion:'reduce'});
    page.setDefaultTimeout(6000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {blocked}=await fixture(page,{theme});
    await page.locator('.work-hours-soft').waitFor();
    check(errors.length===0,`Fixture startup errors: ${errors.join(', ')}`);
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
      icons:document.querySelectorAll('.work-hours-soft .hours-icon').length,
      checked:[...document.querySelectorAll('[data-schedule-quick-day]')].filter(e=>e.checked).map(e=>e.dataset.scheduleQuickDay),
      fields:[...document.querySelectorAll('.work-hours-soft input[type=time]')].filter(e=>e.getClientRects().length).map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),
      working:getComputedStyle(document.querySelector('.monthly-schedule-day.is-working:not([data-hours-partial])')).backgroundColor,
      off:getComputedStyle(document.querySelector('.monthly-schedule-day.is-weekly-closed')).backgroundColor,
      closed:getComputedStyle(document.querySelector('.monthly-schedule-day.is-closed')).backgroundColor,
      chevron:getComputedStyle(document.querySelector('#scheduleWeekEditor>summary .hours-chevron')).transform}));
    check(layout.width===width&&layout.scroll<=width,`${theme}/${width}: page overflow`);
    check(layout.icons===5,`${theme}/${width}: five consistent decorative icons`);
    check(layout.checked.join(',')==='2,3,4,5,6,7','Initial work days preserved');
    const dayMarks=await page.locator('.schedule-quick-days input:checked+span').evaluateAll(elements=>elements.map(e=>getComputedStyle(e,'::after').content));
    check(dayMarks.every(content=>content==='none'||content==='normal'),'Selected weekdays have no decorative checkmarks');
    check(layout.fields.every(f=>f.height>=44&&f.width>=95),'Time fields are tappable and visible');
    check(layout.working!==layout.off&&layout.working!==layout.closed,'Calendar separates ordinary days and exceptions');
    const calendar=await page.evaluate(()=>{
      const legend=document.querySelector('.monthly-schedule-legend'),style=getComputedStyle(legend);
      const grid=document.querySelector('#monthlyScheduleGrid').getBoundingClientRect();
      const item=document.querySelector('#daysOffList .day-off-item').getBoundingClientRect();
      return {font:parseFloat(style.fontSize),fg:style.color,
        surface:getComputedStyle(legend.closest('.panel')).backgroundColor,gap:item.top-grid.bottom,
        labels:[...legend.children].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scroll:e.scrollWidth};})};
    });
    check(calendar.font>=14&&calendar.labels.every(e=>Math.ceil(e.width)>=e.scroll&&e.left>=0&&e.right<=width),`${theme}/${width}: calendar labels are readable and contained ${JSON.stringify(calendar)}`);
    check(contrast(calendar.fg,calendar.surface)>=4.5,`${theme}/${width}: calendar legend contrast`);
    check(await page.locator('#daysOffList .day-off-item').count()===2&&calendar.gap>=12&&calendar.gap<=32,`${theme}/${width}: exception list stays visible with a compact gap ${calendar.gap}`);
    check(!(await page.locator('#monthlyScheduleStatus').isVisible()),'Empty calendar status does not reserve space');
    const step=await page.locator('.booking-step-setting').evaluate(e=>{
      const text=e.firstElementChild.getBoundingClientRect(),control=e.lastElementChild.getBoundingClientRect();
      return {textWidth:text.width,textRight:text.right,controlLeft:control.left,parentWidth:e.getBoundingClientRect().width,
        display:getComputedStyle(e.firstElementChild).display,flex:getComputedStyle(e.firstElementChild).flex,
        controlWidth:control.width,controlFlex:getComputedStyle(e.lastElementChild).flex};
    });
    check(step.textWidth>=150&&step.controlLeft>=step.textRight+10,`${theme}/${width}: interval label and menu overlap ${JSON.stringify(step)}`);
    check(await page.locator('[data-monthly-schedule-date="2026-10-02"]').getAttribute('aria-current')==='date','Business today is marked');
    check(await page.locator('[data-monthly-schedule-date="2026-10-03"]').getAttribute('data-hours-partial')==='true','Partial closure is marked');
    const readable=await page.locator('.schedule-quick-days input:checked+span').first().evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor,vars:Object.fromEntries(['--hours-action','--hours-soft','--porcelain-action-bg','--theme-accent-soft','--hours-surface'].map(k=>[k,getComputedStyle(e).getPropertyValue(k)]))}));
    check(contrast(readable.fg,readable.bg)>=4.5,`${theme}: selected day text contrast ${JSON.stringify(readable)}`);
    const action=await page.locator('#applyQuickSchedule').evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));
    check(contrast(action.fg,action.bg)>=4.5,`${theme}: primary action text contrast`);
    if(output&&theme==='pink-porcelain') {
      await page.screenshot({path:path.join(output,`candidate-${width}.png`),fullPage:true});
      await page.locator('.schedule-quick-days').screenshot({path:path.join(output,`days-${width}.png`)});
    }
    await page.getByRole('button',{name:'Будни',exact:true}).click();
    check(await page.locator('[data-schedule-quick-day]:checked').count()===5,'Weekdays preset');
    await page.locator('[data-schedule-quick-day="6"] + span').click();
    check(await page.locator('[data-schedule-quick-preset="six-days"]').getAttribute('aria-pressed')==='true','Manual day selection synchronizes preset');
    await page.locator('#scheduleQuickBreak').check();
    check(await page.locator('#scheduleQuickBreakTimes').isVisible(),'Break inputs become visible');
    await page.locator('#scheduleQuickBreakStart').fill('12:30');await page.locator('#scheduleQuickBreakEnd').fill('13:15');
    await page.locator('#scheduleQuickStart').fill('09:00');await page.locator('#scheduleQuickEnd').fill('18:00');
    await page.getByRole('button',{name:'Применить часы',exact:true}).click();
    check(await page.locator('#scheduleQuickStatus').getAttribute('data-state')==='ready','Apply remains an unsaved draft');
    check((await page.evaluate(()=>window.hoursFixtureWrites)).length===0,'Applying a template does not write');
    check(await page.getByRole('button',{name:'Сохранить',exact:true}).isVisible(),'Save remains available');
    check((await page.locator('#weeklyScheduleSummary').innerText()).includes('09:00–18:00'),'Summary reflects draft');
    await page.getByRole('button',{name:/Шаг записи: 5 мин/}).click();
    await page.getByRole('option',{name:'15 мин',exact:true}).click();
    check(await page.locator('#slotInterval').inputValue()==='15','Real themed interval menu preserves selection');
    await page.evaluate(()=>{window.hoursFixtureFailure=true;});
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.locator('#scheduleError:not([hidden])').waitFor();
    check((await page.locator('#scheduleError').innerText()).includes('Не удалось сохранить'),'Failed save is truthful');
    check(await page.locator('#scheduleQuickStart').inputValue()==='09:00','Failed save preserves draft');
    await page.evaluate(()=>{window.hoursFixtureFailure=false;});
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#scheduleQuickStatus').dataset.state==='saved');
    const writes=await page.evaluate(()=>window.hoursFixtureWrites);
    check(writes.length===1&&writes[0].length===7,'Successful save uses the existing seven-row persistence');
    check(writes[0].filter(r=>r.enabled).every(r=>r.start_time==='09:00'&&r.end_time==='18:00'&&r.break_start==='12:30'&&r.slot_interval_minutes===15),'Hours, break and interval preserved');
    await page.locator('#scheduleQuickEnd').fill('08:00');
    await page.getByRole('button',{name:'Применить часы',exact:true}).click();
    check(await page.locator('#scheduleQuickStatus').getAttribute('data-state')==='error','Invalid hours rejected');
    check((await page.evaluate(()=>window.hoursFixtureWrites)).length===1,'Invalid draft cannot write');
    await page.locator('[data-monthly-schedule-date="2026-10-03"]').click();
    check(await page.locator('[data-monthly-schedule-date="2026-10-03"]').getAttribute('aria-pressed')==='true','Calendar selection preserved');
    check(await page.locator('#monthlyScheduleDetails').isVisible(),'Date detail opens without writing');
    check((await page.evaluate(()=>window.hoursFixtureWrites)).length===1,'Calendar selection does not write');
    await page.locator('#scheduleWeekEditor > summary').click();
    check(!(await page.locator('#scheduleQuickStart').isVisible()),'Collapse hides the editor');
    await page.locator('#scheduleWeekEditor > summary').press('Enter');
    check(await page.locator('#scheduleQuickStart').isVisible(),'Keyboard reopens the editor');
    await page.locator('#weeklyScheduleDetails > summary').click();
    check(await page.locator('[data-schedule-day="2"] [data-schedule-start]').isVisible(),'Per-day editor remains usable');
    await page.locator('[data-schedule-day="2"] [data-schedule-start]').fill('10:30');
    await page.locator('[data-schedule-day="2"] [data-schedule-start]').dispatchEvent('change');
    check((await page.locator('#weeklyScheduleSummary').innerText()).includes('разные часы'),'Individual edits preserve the summary');
    await page.locator('[data-monthly-schedule-shift="1"]').click();
    check(await page.locator('#monthlyScheduleMonth').inputValue()==='2026-11','Month navigation works');
    check(await page.locator('[data-hours-today]').count()===0,'Today marker is not copied into another month');
    await page.evaluate(()=>{document.querySelector('#monthlyScheduleStatus').textContent='Сохраняем…';});
    check(await page.locator('#monthlyScheduleStatus').isVisible(),'Calendar feedback remains visible when present');
    await page.evaluate(()=>{document.querySelector('#monthlyScheduleStatus').textContent='';daysOff.splice(0);renderDaysOff();});
    check(await page.locator('#daysOffList .days-off-empty').isVisible(),'Empty exceptions explanation remains available');
    await page.evaluate(()=>{document.querySelector('#daysOffList').replaceChildren();});
    check(!(await page.locator('.schedule-date-secondary').isVisible()),'Unpopulated exception area has no empty divider');
    await page.evaluate(()=>{document.querySelector('#dayOffEditor').hidden=false;});
    check(await page.locator('#dayOffForm').isVisible(),'Date editor remains visible without list entries');
    await page.addScriptTag({path:fileURLToPath(new URL('../work-hours-soft.js',import.meta.url))});
    check(await page.locator('.work-hours-soft .hours-icon').count()===5,'Enhancement is idempotent');
    check(errors.length===0,`Browser errors: ${errors.join(', ')}`);
    check(blocked.every(url=>!/^https?:/.test(url)),'No network access to production in the fixture');
    await page.close();
  }
  console.log(`Working hours: ${checks} browser checks passed; 3 themes × 390/760/1440. Synthetic data only.`);
} finally {await browser.close();}
