import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateProvider } from './statistics-clarity-provider-patch.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function fixtureHtml() {
  const html=readFileSync(resolve(root,'provider.html'),'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
    .replace(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i,'')
    .replace(/<link[^>]+rel="manifest"[^>]*>/i,'');
  return html.replace('</head>','<link rel="stylesheet" href="statistics-audit-ui.css"></head>')
    .replace('</body>',`<aside style="margin:90px 20px 120px;padding:16px;border:1px solid #aaa;border-radius:12px">
      <strong>Изолированная проверка · тестовые данные</strong><br>
      <label>Сценарий <select id="fixtureMode"><option value="audit">Как в аудите</option><option value="scenario">Предоплата, доплата, возврат, аренда, товары</option><option value="empty">Пустой период</option><option value="unavailable">Недоступный источник</option></select></label>
      <p id="fixtureJournalResult" hidden></p>
    </aside>
    <script src="report-reconciliation.js"></script><script src="finance-center.js"></script>
    <script src="finance-center-provider.js"></script><script src="statistics-audit-ui.js"></script>
    <script src="tests/statistics-clarity-fixture.js"></script><script src="tests/statistics-clarity-provider-functions.js"></script><script src="statistics-audit-provider.js"></script></body>`);
}
export async function serveFixture(port=0) {
  const server=createServer((req,res)=>{
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    const path=new URL(req.url,'http://localhost').pathname;
    const relative=decodeURIComponent(path.replace(/^\/minuta-online-booking\//,''));
    const target=resolve(root,relative);
    if(!target.startsWith(root+sep)){res.writeHead(403).end();return;}
    if(relative==='provider.html'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self'; worker-src 'none'; object-src 'none'"}).end(fixtureHtml());return;
    }
    if(relative==='tests/statistics-clarity-provider-functions.js'){
      const source=candidateProvider(readFileSync(resolve(root,'provider.js'),'utf8'));
      const functions=source.slice(source.indexOf('function reportPerformerName()'),source.indexOf('\nasync function loadReportAvailability('));
      res.writeHead(200,{'content-type':'text/javascript'}).end(functions);return;
    }
    if(!['.css','.js','.svg','.png','.webp','.woff2'].includes(extname(target))){res.writeHead(403).end();return;}
    try {res.writeHead(200,{'content-type':({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[extname(target)]}).end(readFileSync(target));}
    catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}/minuta-online-booking/provider.html`};
}
if(process.argv.includes('--serve')){
  const fixture=await serveFixture(Number(process.env.MINUTA_FIXTURE_PORT)||4319);
  console.log(fixture.url);
}
