import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startHeaderFixture} from './header-fixture.mjs';
import {themes,layouts} from './theme-card-fixture.mjs';
const {server,url}=await startHeaderFixture();
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();const failures=[];let combinations=0;
  await page.goto(url);
  for(const width of [320,390,768,1440,1920]){
    await page.setViewportSize({width,height:1000});
    for(const layout of layouts)for(const theme of themes){
      await page.evaluate(({layout,theme})=>{document.body.dataset.providerTheme=theme;document.body.dataset.providerLayout=layout;},{layout,theme});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.evaluate(()=>document.fonts.ready);
      const errors=await page.evaluate(()=>{
        const errors=[],header=document.querySelector('.provider-topbar'),css=getComputedStyle(header),r=header.getBoundingClientRect();
        if(css.backgroundColor!=='rgba(0, 0, 0, 0)'||css.backgroundImage!=='none'||css.boxShadow!=='none')errors.push('opaque header');
        if(parseFloat(css.borderLeftWidth)||parseFloat(css.borderRightWidth)||parseFloat(css.borderTopWidth)||parseFloat(css.borderRadius))errors.push('card frame remains');
        if(r.left<0||r.right>innerWidth+1)errors.push('header overflow');
        const controls=[...header.querySelectorAll('button,a')].filter(e=>e.getClientRects().length);
        for(const control of controls){const rect=control.getBoundingClientRect();if(rect.height<44||rect.width<44)errors.push('small control '+control.id);if(rect.left<r.left-1||rect.right>r.right+1)errors.push('control overflow '+control.id);if(control.scrollWidth>control.clientWidth+2)errors.push('clipped control '+control.id);}
        for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i].getBoundingClientRect(),b=controls[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)errors.push('overlap '+controls[i].id+' '+controls[j].id);}
        const greeting=header.querySelector('h1').getBoundingClientRect();for(const control of controls){const a=control.getBoundingClientRect();if(Math.min(a.right,greeting.right)-Math.max(a.left,greeting.left)>1&&Math.min(a.bottom,greeting.bottom)-Math.max(a.top,greeting.top)>1)errors.push('greeting overlap');}
        if(!document.querySelector('#syncState').getAttribute('aria-label').includes('дополнительные данные'))errors.push('missing details');
        const verified=document.querySelector('#syncVerifiedAt');
        if(!verified.textContent.startsWith('Сверка 05.09'))errors.push('missing verification date');
        const vr=verified.getBoundingClientRect(),sr=document.querySelector('#syncState').getBoundingClientRect();
        if(vr.left<sr.left||vr.right>sr.right||vr.top<sr.top||vr.bottom>sr.bottom)errors.push('verification overflow');
        if(verified.scrollWidth>verified.clientWidth+1)errors.push('clipped verification date');
        return errors;
      });
      failures.push(...errors.map(error=>({theme,layout,width,error})));combinations++;
    }
  }
  assert.deepEqual(failures,[]);
  await page.locator('#syncState').click();await page.getByRole('dialog').waitFor({state:'visible'});
  assert.match(await page.getByRole('dialog').innerText(),/дополнительные данные сохранены/);
  console.log(`Header browser: ${combinations} combinations, transparent frame, 44px targets, no clipping/overlap; full status opens on click.`);
}finally{await browser.close();server.close();}
