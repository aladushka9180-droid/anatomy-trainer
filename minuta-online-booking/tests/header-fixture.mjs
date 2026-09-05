import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const root=fileURLToPath(new URL('../',import.meta.url));
export async function startHeaderFixture(port=0){
  const server=createServer(async(request,response)=>{
    try{
      const url=new URL(request.url,'http://127.0.0.1');
      response.setHeader('Cache-Control','no-store');
      if(url.pathname.startsWith('/assets/')){
        const target=path.resolve(root,decodeURIComponent(url.pathname.slice(8)));
        if(!target.startsWith(root)||!/\.(css|woff2?|ttf|svg|webp|png)$/.test(target)){response.writeHead(404).end();return;}
        const types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
        response.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');response.end(await readFile(target));return;
      }
      const html=await readFile(path.join(root,'provider.html'),'utf8');
      const source=await readFile(path.join(root,'provider.js'),'utf8');
      const functions=source.slice(source.indexOf('function compactSyncLabel('),source.indexOf('async function manualSynchronizeProvider('));
      const verification=source.slice(source.indexOf('function renderProviderVerification('),source.indexOf('async function synchronizePortfolio('));
      const links=[...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g)].map(m=>`<link rel="stylesheet" href="/assets/${m[1]}">`).join('');
      const header=html.match(/<header class="provider-topbar">[\s\S]*?<\/header>/)[0].replaceAll('href="ui-icons.svg','href="/assets/ui-icons.svg');
      const themes=['sage','nordic','warm','graphite','lavender','luxury','loft','eco','hitech','japandi','midnight','mono','desert','rose','botanical','burgundy','coastal','pearl','butter','celadon','snow-leopard'];
      const layouts=['linear','soft','capsule','editorial','bento','split'];
      const theme=themes.includes(url.searchParams.get('theme'))?url.searchParams.get('theme'):'lavender';
      const layout=layouts.includes(url.searchParams.get('layout'))?url.searchParams.get('layout'):'soft';
      response.setHeader('Content-Type','text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка шапки кабинета</title>${links}<style>*,*::before,*::after{transition:none!important;animation:none!important}</style><body class="provider-body" data-provider-theme="${theme}" data-provider-layout="${layout}" data-provider-text-scale="default"><div class="provider-app"><aside class="provider-sidebar"><strong>Тестовый кабинет</strong></aside><div class="provider-workspace">${header}<section class="provider-view active"><h2>Расписание</h2><p class="view-description">Проверка оформления — без клиентов и записей.</p></section></div></div><dialog id="fixtureLog"><h2>Журнал связи</h2><p></p><button>Закрыть</button></dialog><script>
      const $=selector=>document.querySelector(selector);const events=[];const recordConnectionEvent=(kind,text)=>events.push(text);const applyWriteAvailability=()=>{};
      ${functions}
      let lastProviderVerificationAt = new Date('2026-09-05T10:45:00Z').getTime();
      ${verification}
      $('#welcomeName').textContent='Здравствуйте, Рамиль!';$('#todayLabel').textContent='Суббота, 5 сентября';$('#currentTimeLabel').textContent='14:58:59';$('#desktopAppInstallButton').hidden=true;
      setSyncState('warning','Основные данные синхронизированы · дополнительные данные сохранены на этом устройстве');
      $('#syncState').addEventListener('click',()=>{$('#fixtureLog p').textContent=events.at(-1);$('#fixtureLog').showModal()});$('#fixtureLog button').addEventListener('click',()=>$('#fixtureLog').close());
      </script></body></html>`);
    }catch(error){response.writeHead(500).end(String(error));}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv.includes('--serve')){const {url}=await startHeaderFixture(38510);console.log(url);}
