import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root=new URL('../',import.meta.url);
const scripts=['reliability.js','offline-catalog-drafts.js','offline-catalog-panel.js'];
const source=Object.fromEntries(scripts.map(name=>['/'+name,readFileSync(new URL(name,root),'utf8')]));
const server=createServer((request,response)=>{
  if(request.url==='/'){
    response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    response.end(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
      body{font:16px Arial,sans-serif;max-width:760px;margin:20px auto;padding:0 16px}
      .offline-catalog-panel-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px}
      label{display:grid;gap:4px}input,select,button{font:inherit;max-width:100%;box-sizing:border-box;padding:8px}
      .offline-catalog-panel-item{border:1px solid #ccc;border-radius:8px;padding:12px;margin:12px 0}
      [hidden]{display:none!important}
    </style><main id="root"></main>${scripts.map(name=>`<script src="/${name}"></script>`).join('')}</html>`);
    return;
  }
  if(source[request.url]){
    response.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});
    response.end(source[request.url]);return;
  }
  response.writeHead(404);response.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const { chromium }=await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'chrome'});
const context=await browser.newContext();
const page=await context.newPage();
const url=`http://127.0.0.1:${server.address().port}/`;
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const org='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const service='ffffffff-ffff-4fff-8fff-ffffffffffff';
try {
  await page.goto(url);
  await page.evaluate(({user,org,service})=>{
    window.testCurrent=true;
    window.testRpc=async()=>({data:{saved:true,id:service,organization_id:org,
      etag:'0123456789abcdef0123456789abcdef'}});
    window.testMount=()=>window.MinutaOfflineCatalogPanel.mount({
      root:document.querySelector('#root'),userId:user,organizationId:org,
      catalog:[{kind:'service',id:service,organizationId:org,name:'Массаж',
        fields:{durationMinutes:60,priceRub:2500,active:true}}],
      drafts:window.MinutaOfflineCatalogDrafts,rpc:window.testRpc,
      isCurrent:()=>window.testCurrent
    });
    window.testPanel=window.testMount();
  },{user,org,service});
  await page.getByLabel('Действие').selectOption(service);
  await page.getByRole('button',{name:'Сохранить на этом устройстве'}).click();
  await page.getByRole('status').getByText('Для изменения нужно сначала загрузить актуальную версию с сервера.').waitFor();
  assert.match(await page.getByRole('status').textContent(),/сначала загрузить актуальную версию/);
  assert.equal((await page.evaluate(({user,org})=>window.MinutaOfflineCatalogDrafts.list(user,org),{user,org})).drafts.length,0);
  await page.evaluate(({user,org,service})=>window.MinutaOfflineCatalogDrafts.rememberVersion({
    userId:user,organizationId:org,kind:'service',entityId:service,
    version:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}),{user,org,service});
  await page.getByRole('button',{name:'Сохранить на этом устройстве'}).click();
  await page.getByText('На этом устройстве',{exact:true}).waitFor();
  let saved=await page.evaluate(({user,org})=>window.MinutaOfflineCatalogDrafts.list(user,org),{user,org});
  assert.equal(saved.drafts.length,1);
  assert.equal(saved.drafts[0].expectedVersion,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(saved.drafts[0].status,'local');
  await page.reload();
  await page.evaluate(({user,org,service})=>{
    window.testCurrent=true;
    window.testPanel=window.MinutaOfflineCatalogPanel.mount({root:document.querySelector('#root'),userId:user,organizationId:org,
      catalog:[{kind:'service',id:service,organizationId:org,name:'Массаж'}],
      drafts:window.MinutaOfflineCatalogDrafts,rpc:async()=>({data:{saved:true,id:service,
        organization_id:org,etag:'0123456789abcdef0123456789abcdef'}}),
      isCurrent:()=>window.testCurrent});
  },{user,org,service});
  await page.getByText('На этом устройстве',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Проверить и отправить'}).click();
  await page.getByText('Подтверждено сервером',{exact:true}).waitFor();
  saved=await page.evaluate(({user,org})=>window.MinutaOfflineCatalogDrafts.list(user,org),{user,org});
  assert.equal(saved.drafts[0].status,'applied');
  for(const width of [390,760,1440]){
    await page.setViewportSize({width,height:850});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,
      `horizontal overflow at ${width}px`);
  }
  await page.evaluate(async()=>{
    window.testCurrent=false;
    await window.testPanel.refresh();
  });
  assert.equal(await page.locator('.offline-catalog-panel').count(),0);
  console.log('offline catalog panel: version gate, local persistence, explicit server confirmation, 390/760/1440 PASS');
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
