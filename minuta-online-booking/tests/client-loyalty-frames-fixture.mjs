import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {extname,resolve,sep} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
export async function startFixture(){
  const source=readFileSync(resolve(root,'provider.html'),'utf8');
  const styles=[...source.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)].map(m=>m[0]).join('\n');
  const head=source.slice(source.indexOf('<div class="client-profile-head">'),source.indexOf('<section class="client-reliability-card"'));
  const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles}<body class="provider-body client-profile-detail-open" data-provider-theme="pink-porcelain" data-provider-layout="quiet"><main style="max-width:900px;margin:auto;padding:16px"><section class="client-profile"><div id="clientProfileContent">${head}</div></section></main><script src="client-loyalty-frames.js?v=1"></script><script src="fixture.js"></script></body>`;
  const script=`document.querySelector('#clientName').textContent='Тестовый клиент';document.querySelector('#clientPhone').textContent='+7 (900) 000-00-00';document.querySelector('#clientAvatar').textContent='В';
    window.renderCount=(count,complete=true)=>{document.querySelector('#clientVisits').textContent=count;window.PrimeTimeLoyaltyFrames.render({client:{phone:'fixture',imported:{visit_count:count},bookings:[]},scope:'isolated-fixture',outcome:item=>item.outcome,complete});};renderCount(100);`;
  const server=createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://fixture').pathname);if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}if(pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(script);return;}const path=resolve(root,`.${pathname}`);if(!path.startsWith(root+sep)&&!path.startsWith(root))throw Error('path');res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:`http://127.0.0.1:${server.address().port}/`};
}
if(process.argv.includes('--serve')){const {url}=await startFixture();console.log(url);}
