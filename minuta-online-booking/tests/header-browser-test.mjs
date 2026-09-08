import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {startHeaderFixture} from './header-fixture.mjs';
import {themes,layouts} from './theme-card-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startHeaderFixture();
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const page=await browser.newPage();const failures=[];let combinations=0;
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(url);
  assert.deepEqual(pageErrors,[],'Header fixture must execute real status/verification initialization');
  for(const width of [320,390,760,761,768,1440,1920]){
    await page.setViewportSize({width,height:1000});
    for(const layout of layouts)for(const theme of themes)for(const scale of ['default','large']){
      await page.evaluate(scale=>{document.body.dataset.providerTextScale=scale;},scale);
      await page.evaluate(({layout,theme})=>{document.body.dataset.providerTheme=theme;document.body.dataset.providerLayout=layout;},{layout,theme});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.evaluate(()=>document.fonts.ready);
      const errors=await page.evaluate(()=>{
        const errors=[],header=document.querySelector('.provider-topbar'),css=getComputedStyle(header),r=header.getBoundingClientRect();
        const tigerMobile=['apricot-tiger','pearl-zebra'].includes(document.body.dataset.providerTheme)&&innerWidth<=760;
        if(css.backgroundColor!=='rgba(0, 0, 0, 0)'||css.boxShadow!=='none')errors.push('opaque header');
        if(tigerMobile){if(!css.backgroundImage.startsWith('linear-gradient('))errors.push('missing tiger header veil');}
        else if(css.backgroundImage!=='none')errors.push('unexpected header image');
        if(parseFloat(css.borderLeftWidth)||parseFloat(css.borderRightWidth)||parseFloat(css.borderTopWidth)||parseFloat(css.borderRadius))errors.push('card frame remains');
        if(r.left<0||r.right>innerWidth+1)errors.push('header overflow');
        const controls=[...header.querySelectorAll('button,a')].filter(e=>e.getClientRects().length);
        for(const control of controls){const rect=control.getBoundingClientRect();if(rect.height<44||rect.width<44)errors.push('small control '+control.id);if(rect.left<r.left-1||rect.right>r.right+1)errors.push('control overflow '+control.id);if(control.scrollWidth>control.clientWidth+2)errors.push('clipped control '+control.id);}
        for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i].getBoundingClientRect(),b=controls[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)errors.push('overlap '+controls[i].id+' '+controls[j].id);}
        const greeting=header.querySelector('h1').getBoundingClientRect();for(const control of controls){const a=control.getBoundingClientRect();if(Math.min(a.right,greeting.right)-Math.max(a.left,greeting.left)>1&&Math.min(a.bottom,greeting.bottom)-Math.max(a.top,greeting.top)>1)errors.push('greeting overlap');}
        if(tigerMobile){
          const moment=header.querySelector('.provider-current-moment').getBoundingClientRect();
          for(const control of controls){const a=control.getBoundingClientRect();if(Math.min(a.right,moment.right)-Math.max(a.left,moment.left)>1&&Math.min(a.bottom,moment.bottom)-Math.max(a.top,moment.top)>1)errors.push('date overlap');}
          if(parseFloat(getComputedStyle(header.querySelector('#openVoiceAssistant')).borderTopWidth)&&getComputedStyle(header.querySelector('#openVoiceAssistant')).borderTopColor!=='rgba(0, 0, 0, 0)')errors.push('assistant frame remains');
        }
        if(!document.querySelector('#syncState').getAttribute('aria-label').includes('дополнительные данные'))errors.push('missing details');
        const verified=document.querySelector('#syncVerifiedAt');
        if(!verified.textContent.startsWith('Сверка 05.09'))errors.push('missing verification date');
        const vr=verified.getBoundingClientRect(),sr=document.querySelector('#syncState').getBoundingClientRect();
        if(vr.left<sr.left||vr.right>sr.right||vr.top<sr.top||vr.bottom>sr.bottom)errors.push('verification overflow');
        if(verified.scrollWidth>verified.clientWidth+1)errors.push('clipped verification date');
        return errors;
      });
      failures.push(...errors.map(error=>({theme,layout,width,scale,error})));combinations++;
    }
  }
  let menuCombinations=0;
  for(const width of [320,390,760,1440]){
    await page.setViewportSize({width,height:1000});
    for(const layout of layouts)for(const theme of themes)for(const scale of ['default','large']){
      await page.evaluate(({layout,theme,scale})=>{
        document.body.dataset.providerTheme=theme;
        document.body.dataset.providerLayout=layout;
        document.body.dataset.providerTextScale=scale;
        document.querySelector('#desktopAppInstallButton').hidden=false;
        document.querySelector('.provider-topbar-tools').open=true;
      },{layout,theme,scale});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const errors=await page.evaluate(()=>{
        const errors=[];
        const menu=document.querySelector('.provider-topbar-tools>div');
        const summary=document.querySelector('.provider-topbar-tools>summary');
        const menuRect=menu.getBoundingClientRect();
        const summaryRect=summary.getBoundingClientRect();
        const items=[...menu.querySelectorAll(':scope>:is(button,a)')];
        const rects=items.map(item=>item.getBoundingClientRect());
        if(items.length!==4)errors.push('wrong tool count');
        if(menuRect.width>253||menuRect.height>107)errors.push(`large menu ${menuRect.width}x${menuRect.height}`);
        if(menuRect.left<0||menuRect.right>innerWidth+1)errors.push('menu overflow');
        if(Math.abs(menuRect.right-summaryRect.right)>1)errors.push('menu is not right aligned');
        const rows=new Set(rects.map(rect=>Math.round(rect.top)));
        const columns=new Set(rects.map(rect=>Math.round(rect.left)));
        if(rows.size!==2||columns.size!==2)errors.push('menu is not a 2x2 grid');
        for(let index=0;index<items.length;index++){
          const item=items[index],rect=rects[index],label=item.querySelector('span');
          if(rect.width<44||rect.height<44)errors.push(`small menu control ${item.id}`);
          if(rect.left<menuRect.left||rect.right>menuRect.right||rect.top<menuRect.top||rect.bottom>menuRect.bottom)errors.push(`menu control overflow ${item.id}`);
          if(label.scrollWidth>label.clientWidth+1)errors.push(`clipped menu label ${item.id}`);
          if(!item.getAttribute('aria-label'))errors.push(`missing menu label ${item.id}`);
        }
        for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
          const a=rects[i],b=rects[j];
          if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)errors.push(`menu overlap ${items[i].id} ${items[j].id}`);
        }
        return errors;
      });
      failures.push(...errors.map(error=>({theme,layout,width,scale,error})));menuCombinations++;
    }
  }
  assert.deepEqual(failures,[]);
  await page.evaluate(()=>{document.querySelector('.provider-topbar-tools').open=false;document.querySelector('#desktopAppInstallButton').hidden=true;});
  await page.locator('#syncState').click();await page.getByRole('dialog').waitFor({state:'visible'});
  assert.match(await page.getByRole('dialog').innerText(),/дополнительные данные сохранены/);
  assert.deepEqual(pageErrors,[],'Header matrix and dialog must not hide script errors');
  console.log(`Header browser: ${combinations} header combinations and ${menuCombinations} compact-menu combinations; transparent frame, 44px targets, no clipping/overlap; full status opens on click.`);
}finally{await browser?.close();server.close();}
