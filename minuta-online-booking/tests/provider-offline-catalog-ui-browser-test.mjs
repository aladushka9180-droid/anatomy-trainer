import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync,readFileSync } from 'node:fs';
import { dirname,extname,resolve,sep } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const providerHtml=readFileSync(resolve(root,'provider.html'),'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const providerSource=readFileSync(resolve(root,'provider.js'),'utf8');
const renderStart=providerSource.indexOf('function renderOfflineCatalogDrafts() {');
const renderEnd=providerSource.indexOf('\nlet priceListImageUrls',renderStart);
assert.ok(renderStart>=0 && renderEnd>renderStart);
const renderSource=providerSource.slice(renderStart,renderEnd);
const server=createServer((request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    const relative=pathname.replace(/^\/minuta-online-booking\//,'');
    const target=resolve(root,relative);
    if(!target.startsWith(root+sep)) throw new Error('path_escape');
    const body=relative==='provider.html' ? providerHtml : readFileSync(target);
    const type=({'.html':'text/html; charset=utf-8','.css':'text/css','.svg':'image/svg+xml',
      '.woff2':'font/woff2','.webp':'image/webp','.png':'image/png'})[extname(target)] || 'application/octet-stream';
    response.writeHead(200,{'content-type':type});response.end(body);
  } catch { response.writeHead(404);response.end(); }
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const { chromium }=await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'chrome'});
const base=`http://127.0.0.1:${server.address().port}/minuta-online-booking/`;
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const org='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const service='ffffffff-ffff-4fff-8fff-ffffffffffff';
const item='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
try {
  for(const width of [390,760,1440]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',bypassCSP:true});
    const page=await context.newPage();
    await page.goto(base+'provider.html');
    for(const name of ['reliability.js','offline-catalog-drafts.js','offline-catalog-panel.js'])
      await page.addScriptTag({content:readFileSync(resolve(root,name),'utf8')});
    await page.evaluate(()=>{
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('provider-ready','top-level');
      document.querySelector('#providerBoot').hidden=true;
      document.querySelector('#authCard').hidden=true;
      const dashboard=document.querySelector('#dashboard');dashboard.hidden=false;dashboard.dataset.activeView='services';
      document.querySelectorAll('[data-provider-panel]').forEach(view=>{
        view.hidden=view.dataset.providerPanel!=='services';
      });
      document.querySelector('#serviceManageList').textContent='Массаж · 60 мин · 2500 ₽';
    });
    await page.addScriptTag({content:`
      const $=selector=>document.querySelector(selector);
      let currentUser={id:'${user}'};
      let activeClientOrganizationId='${org}';
      let sessionGeneration=1;
      let providerSessionTrust='verified';
      let writesAllowed=true;
      let offlineCatalogPanel=null,offlineCatalogPanelScope='',offlineCatalogPanelCatalogKey='';
      let ownServices=[{id:'${service}',name:'Массаж',duration_minutes:60,price_rub:2500,active:true}];
      const organizationController={getActiveOrganization:()=>({id:'${org}'})};
      function sessionIsCurrent(expected,generation){return expected===currentUser?.id&&generation===sessionGeneration;}
      window.catalogRpcCalls=[];
      const db={rpc:async(name,args)=>{
        window.catalogRpcCalls.push(name);
        if(name==='get_minuta_inventory_workspace_v186') return {data:{organization_id:'${org}',items:[
          {id:'${item}',name:'Масло',sku:'M1',unit:'ml',low_stock_threshold:2,active:true,
            etag:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}]}};
        return {error:{message:'unexpected_test_rpc'}};
      }};
      ${renderSource}
      window.testRenderOfflineCatalogDrafts=renderOfflineCatalogDrafts;
    `});
    await page.evaluate(()=>window.testRenderOfflineCatalogDrafts());
    await page.getByRole('heading',{name:'Черновики каталога'}).waitFor();
    const panel=page.locator('#offlineCatalogDrafts');
    await panel.getByRole('button',{name:'Обновить материалы для черновика'}).click();
    await panel.getByLabel('Что добавить или изменить').selectOption('inventory');
    await panel.locator(`select[name="target"] option[value="${item}"]`).waitFor({state:'attached'});
    await panel.getByLabel('Действие').selectOption(item);
    await panel.getByRole('status').getByText('Сохранённые поля загружены. При отправке сервер проверит изменения.').waitFor();
    assert.equal(await panel.getByLabel('Артикул').inputValue(),'M1');
    await panel.getByLabel('Название',{exact:true}).fill('Масло для массажа');
    await panel.getByRole('button',{name:'Сохранить на этом устройстве'}).click();
    await panel.getByText('На этом устройстве',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.catalogRpcCalls),['get_minuta_inventory_workspace_v186']);
    const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,
      panel:document.querySelector('#offlineCatalogDrafts').getBoundingClientRect().width,
      viewport:innerWidth}));
    assert.equal(state.overflow,false,`provider overflow ${width}px: ${JSON.stringify(state)}`);
    assert.ok(state.panel<=state.viewport,`panel width ${width}px: ${JSON.stringify(state)}`);
    if(process.env.MINUTA_AUDIT_SCREENSHOTS){
      mkdirSync(process.env.MINUTA_AUDIT_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOTS,`provider-offline-catalog-${width}.png`),fullPage:true});
    }
    await context.close();
    console.log(`provider offline catalog synthetic screen ${width}px PASS`);
  }
} finally {
  await browser.close();server.closeAllConnections();
  await new Promise(resolveClose=>server.close(resolveClose));
}
