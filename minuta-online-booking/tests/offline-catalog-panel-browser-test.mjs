import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root=new URL('../',import.meta.url);
const scripts=['reliability.js','offline-catalog-drafts.js','offline-catalog-panel.js'];
const source=Object.fromEntries(scripts.map(name=>['/'+name,readFileSync(new URL(name,root),'utf8')]));
const css=readFileSync(new URL('offline-catalog-panel.css',root),'utf8');
const providerHtml=readFileSync(new URL('provider.html',root),'utf8');
const worker=readFileSync(new URL('sw.js',root),'utf8');
for(const name of ['offline-catalog-drafts.js','offline-catalog-panel.js','offline-catalog-panel.css']){
  assert.match(providerHtml,new RegExp(name.replaceAll('.','\\.')));
  assert.match(worker,new RegExp(name.replaceAll('.','\\.')));
}
assert.match(providerHtml,/id="offlineCatalogDrafts"/);
const server=createServer((request,response)=>{
  if(request.url==='/'){
    response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    response.end(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/offline-catalog-panel.css"><style>body{font:16px Arial,sans-serif;max-width:760px;margin:20px auto;padding:0 16px}input,select,button{font:inherit;padding:8px}</style><main id="root"></main>${scripts.map(name=>`<script src="/${name}"></script>`).join('')}</html>`);
    return;
  }
  if(request.url==='/offline-catalog-panel.css'){
    response.writeHead(200,{'content-type':'text/css; charset=utf-8'});
    response.end(css);return;
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
    version:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    values:{name:'Массаж обновлённый',durationMinutes:70,priceRub:3000,active:true}}),{user,org,service});
  await page.getByLabel('Действие').selectOption('');
  await page.getByLabel('Действие').selectOption(service);
  await page.getByRole('status').getByText('Сохранённые поля загружены. При отправке сервер проверит изменения.').waitFor();
  assert.equal(await page.getByLabel('Название').inputValue(),'Массаж обновлённый');
  assert.equal(await page.getByLabel('Цена, ₽').inputValue(),'3000');
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
  await context.setOffline(true);
  await page.getByLabel('Действие').selectOption('');
  await page.getByLabel('Название').fill('Новая услуга без сети');
  await page.getByRole('button',{name:'Сохранить на этом устройстве'}).click();
  const newCard=page.locator('.offline-catalog-panel-item').filter({hasText:'Новая услуга без сети'});
  await newCard.getByText('На этом устройстве',{exact:true}).waitFor();
  assert.equal(await newCard.getByRole('button',{name:'Проверить и отправить'}).isDisabled(),true);
  await context.setOffline(false);
  await page.evaluate(({user,org,service})=>{
    window.testPanel.dispose();
    window.testPanel=window.MinutaOfflineCatalogPanel.mount({
      root:document.querySelector('#root'),userId:user,organizationId:org,
      catalog:[{kind:'service',id:service,organizationId:org,name:'Массаж'}],
      drafts:window.MinutaOfflineCatalogDrafts,
      rpc:async()=>({data:{saved:false,reason:'service_catalog_version_conflict'}}),
      isCurrent:()=>window.testCurrent
    });
  },{user,org,service});
  const conflictCard=page.locator('.offline-catalog-panel-item').filter({hasText:'Новая услуга без сети'});
  await conflictCard.getByRole('button',{name:'Проверить и отправить'}).click();
  await conflictCard.getByText('Конфликт — проверьте актуальные данные').waitFor();
  saved=await page.evaluate(({user,org})=>window.MinutaOfflineCatalogDrafts.list(user,org),{user,org});
  assert.equal(saved.drafts.find(item=>item.fields.name==='Новая услуга без сети').status,'conflict');
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
  console.log('offline catalog panel: version gate, offline persistence, confirmation/conflict, 390/760/1440 PASS');
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
