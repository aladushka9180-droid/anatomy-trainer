import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function startSettingsNavFixture(){
 const html=await readFile(path.join(root,'provider.html'),'utf8');
 const links=(html.match(/<link[^>]+rel="stylesheet"[^>]*>/g)||[]).join('');
 const nav=html.match(/<nav class="provider-section-nav" aria-label="Навигация по настройкам">[\s\S]*?<\/nav>/)[0];
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${links}<link rel="stylesheet" href="settings-nav-scroll.css"><body class="provider-body" data-provider-theme="snow-leopard" data-provider-layout="soft"><main data-provider-panel="settings" style="margin:16px">${nav}<p>Проверка вкладок: без данных клиентов</p></main><script src="settings-nav-scroll.js"></script></body>`);return;}
  const name=decodeURIComponent(url.pathname.slice(1));if(name.includes('..'))throw Error();
  res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(await readFile(path.join(root,name)));
 }catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,url:`http://127.0.0.1:${server.address().port}/`};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const fixture=await startSettingsNavFixture();console.log(fixture.url);}
