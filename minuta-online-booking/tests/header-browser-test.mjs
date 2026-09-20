import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startHeaderFixture,root} from './header-fixture.mjs';
import {themes,layouts} from './theme-card-fixture.mjs';
const playwright=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const chromium=playwright.chromium||playwright.default?.chromium;
const {server,url}=await startHeaderFixture();
const requestedSections=new Set((process.env.MINUTA_HEADER_SECTIONS||'geometry,tools,appearance').split(',').map(value=>value.trim()).filter(Boolean));
const providerHtml=fs.readFileSync(path.join(root,'provider.html'),'utf8');
const providerSource=fs.readFileSync(path.join(root,'provider.js'),'utf8');
assert.match(providerHtml,/id="providerTopbarToolsButton"[^>]*aria-haspopup="menu"[^>]*aria-controls="providerTopbarToolsMenu"[^>]*aria-expanded="false"/,'Tools trigger lost menu semantics');
assert.match(providerHtml,/id="providerTopbarToolsMenu" role="menu" aria-labelledby="providerTopbarToolsButton"/,'Tools popover lost menu semantics');
assert.match(providerSource,/providerTopbarToolsButton\?\.setAttribute\('aria-expanded', String\(providerTopbarTools\.open\)\)/,'Tools expanded state is not synchronized');
assert.match(providerSource,/event\.key === 'Escape' && providerTopbarTools\.open[\s\S]*?providerTopbarToolsButton\?\.focus\(\)/,'Escape does not return focus to the tools trigger');
assert.match(providerSource,/\['ArrowDown','ArrowUp','Home','End'\][\s\S]*?items\[nextIndex\]\?\.focus\(\)/,'Tools keyboard navigation is missing');
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const page=await browser.newPage();const failures=[];let combinations=0;
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(url);
  assert.deepEqual(pageErrors,[],'Header fixture must execute real status/verification initialization');
  if(requestedSections.has('geometry'))for(const width of [320,360,390,430,760,761,768,1440,1920]){
    await page.setViewportSize({width,height:1000});
    for(const layout of layouts)for(const theme of themes)for(const scale of ['default','large']){
      await page.evaluate(scale=>{document.body.dataset.providerTextScale=scale;},scale);
      await page.evaluate(({layout,theme})=>{document.body.dataset.providerTheme=theme;document.body.dataset.providerLayout=layout;},{layout,theme});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.evaluate(()=>document.fonts.ready);
      const errors=await page.evaluate(()=>{
        const errors=[],header=document.querySelector('.provider-topbar'),css=getComputedStyle(header),r=header.getBoundingClientRect();
        const wildlifeMobile=['pearl-zebra'].includes(document.body.dataset.providerTheme)&&innerWidth<=760;
        if(css.backgroundColor!=='rgba(0, 0, 0, 0)'||css.boxShadow!=='none')errors.push('opaque header');
        if(wildlifeMobile){if(!css.backgroundImage.startsWith('linear-gradient('))errors.push('missing wildlife header veil');}
        else if(css.backgroundImage!=='none')errors.push('unexpected header image');
        if(parseFloat(css.borderLeftWidth)||parseFloat(css.borderRightWidth)||parseFloat(css.borderTopWidth)||parseFloat(css.borderRadius))errors.push('card frame remains');
        if(r.left<0||r.right>innerWidth+1)errors.push('header overflow');
        const controls=[...header.querySelectorAll('button,a,summary')].filter(e=>e.getClientRects().length);
        for(const control of controls){const rect=control.getBoundingClientRect();if(rect.height<44||rect.width<44)errors.push('small control '+control.id);if(rect.left<r.left-1||rect.right>r.right+1)errors.push('control overflow '+control.id);if(control.scrollWidth>control.clientWidth+2)errors.push('clipped control '+control.id);}
        for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i].getBoundingClientRect(),b=controls[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)errors.push('overlap '+controls[i].id+' '+controls[j].id);}
        const greeting=header.querySelector('h1').getBoundingClientRect();for(const control of controls){const a=control.getBoundingClientRect();if(Math.min(a.right,greeting.right)-Math.max(a.left,greeting.left)>1&&Math.min(a.bottom,greeting.bottom)-Math.max(a.top,greeting.top)>1)errors.push('greeting overlap');}
        if(wildlifeMobile){
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
    console.log(`Header geometry: ${width}px checked`);
  }
  let menuCombinations=0;
  if(requestedSections.has('tools'))for(const width of [320,360,390,430,760,1440]){
    await page.setViewportSize({width,height:1000});
    for(const layout of layouts)for(const theme of themes)for(const scale of ['default','large']){
      await page.evaluate(({layout,theme,scale})=>{
        document.body.dataset.providerTheme=theme;
        document.body.dataset.providerLayout=layout;
        document.body.dataset.providerTextScale=scale;
        document.querySelector('#desktopAppInstallButton').hidden=false;
        document.querySelector('.provider-topbar-tools').open=false;
      },{layout,theme,scale});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const before=await page.evaluate(()=>{
        const header=document.querySelector('.provider-topbar').getBoundingClientRect();
        const content=document.querySelector('.provider-view').getBoundingClientRect();
        return {header:{top:header.top,height:header.height},contentTop:content.top,scrollY,scrollHeight:document.documentElement.scrollHeight};
      });
      await page.evaluate(()=>{
        document.querySelector('.provider-topbar-tools').open=true;
      });
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const errors=await page.evaluate(before=>{
        const errors=[];
        const header=document.querySelector('.provider-topbar').getBoundingClientRect();
        const content=document.querySelector('.provider-view').getBoundingClientRect();
        const menu=document.querySelector('.provider-topbar-tools>div');
        const summary=document.querySelector('.provider-topbar-tools>summary');
        const menuRect=menu.getBoundingClientRect();
        const summaryRect=summary.getBoundingClientRect();
        const items=[...menu.querySelectorAll(':scope>:is(button,a)')];
        const rects=items.map(item=>item.getBoundingClientRect());
        const mobile=innerWidth<=760;
        if(items.length!==6)errors.push('wrong tool count');
        if(menuRect.width>(mobile?245:269)||menuRect.height>295)errors.push(`large menu ${menuRect.width}x${menuRect.height}`);
        if(menuRect.left<0||menuRect.right>innerWidth+1)errors.push('menu overflow');
        if(Math.abs(menuRect.right-summaryRect.right)>1)errors.push('menu is not right aligned');
        if(Math.abs(header.top-before.header.top)>1||Math.abs(header.height-before.header.height)>1||Math.abs(content.top-before.contentTop)>1)errors.push('menu changed page geometry');
        if(Math.abs(scrollY-before.scrollY)>1)errors.push('menu changed scroll position');
        if(Math.abs(document.documentElement.scrollHeight-before.scrollHeight)>1)errors.push('menu changed document height');
        if(summary.getAttribute('aria-haspopup')!=='menu'||summary.getAttribute('aria-controls')!=='providerTopbarToolsMenu')errors.push('menu trigger aria changed');
        if(menu.getAttribute('role')!=='menu'||items.some(item=>item.getAttribute('role')!=='menuitem'))errors.push('menu roles changed');
        const rows=new Set(rects.map(rect=>Math.round(rect.top)));
        const columns=new Set(rects.map(rect=>Math.round(rect.left)));
        if(rows.size!==6||columns.size!==1)errors.push('tools must be one vertical list');
        const expectedLabels=['Помощник','Открыть PrimeTime','Ссылка для записи','Поделиться','Обновить','Установить'];
        if(items.some((item,index)=>item.textContent.trim()!==expectedLabels[index]))errors.push('tool order or label changed');
        for(let index=0;index<items.length;index++){
          const item=items[index],rect=rects[index];
          if(rect.width<44||rect.height<44)errors.push(`small menu control ${item.id}`);
          if(rect.left<menuRect.left||rect.right>menuRect.right||rect.top<menuRect.top||rect.bottom>menuRect.bottom)errors.push(`menu control overflow ${item.id}`);
          if(item.scrollWidth>item.clientWidth+1)errors.push(`clipped menu label ${item.id}`);
          if(!item.getAttribute('aria-label'))errors.push(`missing menu label ${item.id}`);
          if(!item.dataset.compactLabel)errors.push(`missing compact menu label ${item.id}`);
          const itemStyle=getComputedStyle(item);
          if(itemStyle.display!=='flex'||itemStyle.flexDirection!=='row'||itemStyle.alignItems!=='center'||!['flex-start','start'].includes(itemStyle.justifyContent))errors.push(`uneven menu content ${item.id} (${itemStyle.display}/${itemStyle.flexDirection}/${itemStyle.alignItems}/${itemStyle.justifyContent})`);
          if(itemStyle.color!==getComputedStyle(document.body).color)errors.push(`foreign tool text color ${item.id}`);
        }
        for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
          const a=rects[i],b=rects[j];
          if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)errors.push(`menu overlap ${items[i].id} ${items[j].id}`);
        }
        return errors;
      },before);
      failures.push(...errors.map(error=>({theme,layout,width,scale,error})));menuCombinations++;
    }
    console.log(`Header tools: ${width}px checked`);
  }
  let appearanceCombinations=0;
  if(requestedSections.has('appearance'))for(const width of [320,390,760,1440]){
    await page.setViewportSize({width,height:1000});
    for(const layout of layouts)for(const theme of themes)for(const scale of ['default','large']){
      await page.evaluate(({layout,theme,scale})=>{
        document.body.dataset.providerTheme=theme;
        document.body.dataset.providerLayout=layout;
        document.body.dataset.providerTextScale=scale;
        document.querySelector('.provider-topbar-tools').open=false;
        document.querySelector('#providerAppearanceMenu').open=true;
      },{layout,theme,scale});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const errors=await page.evaluate(()=>{
        const errors=[];
        const holder=document.querySelector('.provider-topbar-actions');
        const menu=document.querySelector('.provider-appearance-popover');
        const summary=document.querySelector('#providerAppearanceMenu>summary');
        const modes=[...menu.querySelectorAll('[data-provider-color-mode]')];
        const link=menu.querySelector('#openProviderAppearanceSettings');
        const menuRect=menu.getBoundingClientRect();
        const holderRect=holder.getBoundingClientRect();
        const summaryRect=summary.getBoundingClientRect();
        if(modes.length!==3)errors.push('wrong appearance mode count');
        if(menuRect.width>293||menuRect.height>250)errors.push(`large appearance menu ${menuRect.width}x${menuRect.height}`);
        if(menuRect.left<0||menuRect.right>innerWidth+1)errors.push('appearance menu overflow');
        if(Math.abs(menuRect.right-holderRect.right)>1)errors.push('appearance menu is not action-aligned');
        if(summaryRect.width<44||summaryRect.height<44)errors.push('small appearance summary');
        for(const item of [...modes,link]){
          const rect=item.getBoundingClientRect();
          if(rect.width<44||rect.height<44)errors.push(`small appearance control ${item.id||item.dataset.providerColorMode}`);
          if(rect.left<menuRect.left||rect.right>menuRect.right||rect.top<menuRect.top||rect.bottom>menuRect.bottom)errors.push('appearance control overflow');
          if(!item.getAttribute('aria-label'))errors.push(`missing appearance label ${item.id||item.dataset.providerColorMode}`);
        }
        const pressed=modes.filter(item=>item.getAttribute('aria-pressed')==='true');
        if(pressed.length!==1)errors.push('appearance selection is ambiguous');
        return errors;
      });
      failures.push(...errors.map(error=>({theme,layout,width,scale,error})));appearanceCombinations++;
    }
    console.log(`Header appearance: ${width}px checked`);
  }
  await page.evaluate(()=>{document.querySelector('#providerAppearanceMenu').open=false;});
  assert.equal(failures.length,0,`Header matrix failures (${failures.length}): ${JSON.stringify(failures.slice(0,50))}`);
  await page.evaluate(()=>{document.querySelector('.provider-topbar-tools').open=false;document.querySelector('#desktopAppInstallButton').hidden=true;});
  if(requestedSections.has('geometry')){
    await page.locator('#syncState').click();await page.getByRole('dialog').waitFor({state:'visible'});
    assert.match(await page.getByRole('dialog').innerText(),/дополнительные данные сохранены/);
  }
  assert.deepEqual(pageErrors,[],'Header matrix and dialog must not hide script errors');
  console.log(`Header browser: ${combinations} headers, ${menuCombinations} tool menus and ${appearanceCombinations} appearance menus; 44px targets, no clipping/overlap.`);
}finally{await browser?.close();server.close();}
