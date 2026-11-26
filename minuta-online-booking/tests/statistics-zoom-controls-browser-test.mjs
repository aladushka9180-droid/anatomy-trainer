import assert from 'node:assert/strict';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root=process.env.MINUTA_PROJECT_ROOT||fileURLToPath(new URL('../',import.meta.url));
const read=name=>readFileSync(resolve(root,name),'utf8');
const html=read('provider.html');
const binding=read('statistics-audit-provider.js');
const header=binding.slice(0,binding.indexOf('  function restoreVisitOverview('))+
  'refreshReferenceHeader("30 дней · Вся команда · Демо"); })();';
const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"?]+\.css)(?:\?[^"]*)?"[^>]*>/g)].map(m=>read(m[1]));
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||undefined});
const output=process.env.MINUTA_VISUAL_OUTPUT;if(output)mkdirSync(output,{recursive:true});
try {
  for(const width of [390,760,1440])for(const scale of [1,2]) {
    const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});
    await page.route('**/*',r=>r.abort());
    await page.setContent('<!doctype html><html lang="ru"><body class="provider-body" data-provider-theme="warm" data-provider-layout="soft"><main id="dashboard" data-active-view="analytics"><div class="provider-workspace"></div></main></body></html>');
    await page.evaluate(source=>{
      const doc=new DOMParser().parseFromString(source,'text/html');
      const view=doc.querySelector('#analyticsView');
      document.querySelector('.provider-workspace').append(document.importNode(view,true));
      const a=document.querySelector('#analyticsView');a.hidden=false;
      Object.assign(a.dataset,{reportTab:'overview',reportSource:'demo',reportLoadState:'ready',reportEmpty:'false'});
      document.querySelector('#reportFilterSummary').textContent='30 дней · Вся команда · Демо';
      const p=document.querySelector('#reportPerformerFilterWrap');p.hidden=false;
      p.querySelector('select').innerHTML='<option>Вся команда</option>';
      const acts=document.querySelector('#reportSmartActions');
      acts.innerHTML='<article class="report-smart-action"><span>!</span><div><strong>Проверить оплаты</strong><small>Подтверждённый долг 5 600 ₽</small><i>Оплачено 97% стоимости услуг</i><b>Покажем визиты с отметкой «Не оплачено»</b></div><button type="button">Проверить →</button></article>';
      document.querySelectorAll('details').forEach(e=>e.open=true);
      document.body.style.cssText='margin:0;display:block';
    },html);
    for(const content of styles)await page.addStyleTag({content});
    await page.addStyleTag({content:read('statistics-audit-ui.css')});
    await page.addScriptTag({content:header});
    await page.evaluate(s=>document.documentElement.style.fontSize=16*s+'px',scale);
    const result=await page.evaluate(()=>{
      const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();
      return {period:box('#reportFilterToggle'),text:box('.report-smart-action>div'),button:box('.report-smart-action>button'),overflow:document.documentElement.scrollWidth-innerWidth};
    });
    assert.ok(result.period.width>=200,`${width}/${scale}: readable period width ${result.period.width}`);
    assert.ok(result.button.top>=result.text.bottom-1,`${width}/${scale}: action overlaps text`);
    assert.ok(result.button.width>=44&&result.button.height>=44,`${width}/${scale}: action target`);
    assert.ok(result.overflow<=1,`${width}/${scale}: horizontal overflow ${result.overflow}`);
    if(output)await page.screenshot({path:resolve(output,`controls-${width}-${scale}.png`),fullPage:true});
    await page.close();
  }
  console.log('PASS: period and action controls at 390/760/1440, normal and enlarged text; isolated, no backend requests');
}finally{await browser.close();}
