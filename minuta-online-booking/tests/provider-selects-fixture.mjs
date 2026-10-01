import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(path.join(root, 'provider.html'), 'utf8');
const source = (await readFile(path.join(root, 'provider.js'), 'utf8')).replaceAll('\r\n','\n');
const styles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g)].map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('\n');
const inventory = [...html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map(match => match[0]).join('\n');
function declaration(name) {
  const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
  if (start < 0) throw new Error(`Missing renderer ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const services = [
  ['Массаж спины, шеи и плеч',150,3333],['Массаж спины + ШВЗ — базовый',40,2500],
  ['Спортивный массаж',60,3000],['Массаж ног или рук',60,3000],
  ['Комплексный массаж всего тела',120,5800],['Общий массаж с обеих сторон',90,4300],
  ['Массаж задней поверхности тела',60,3000],['Массаж спины, рук и головы',60,3000],
  ['Массаж спины + ШВЗ — углублённый',60,3000]
].map(([name,duration_minutes,price_rub],index) => ({id:`service-${index}`,name,duration_minutes,price_rub}));
function fixture() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Выбор услуги — тестовые данные</title>${styles}<link rel="stylesheet" href="/provider-selects.css"><style>body{margin:0}*,*::before,*::after{animation:none!important;transition:none!important}.fixture-background{padding:32px;color:var(--theme-ink)}.fixture-background p{color:var(--theme-muted)}.fixture-controls{margin-top:18px;display:grid;gap:12px}.fixture-controls>label{margin:0}#inventory{display:none!important}</style></head><body class="provider-body booking-sheet-open" data-provider-theme="pink-porcelain" data-provider-layout="capsule" data-provider-text-scale="default" data-provider-porcelain-character="petal"><main class="fixture-background"><h1>Расписание</h1><p>Изолированный экран с тестовыми данными</p></main><div class="booking-sheet" id="bookingSheet"><button class="booking-sheet-backdrop" type="button" aria-label="Закрыть карточку"></button><section class="booking-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="bookingSheetTitle"><div id="bookingSheetContent"><small class="booking-sheet-kicker">Только для этой записи</small><h2 id="bookingSheetTitle">Состав сеанса</h2><form class="booking-editor-form session-composer" id="sessionForm"><div id="sessionItems"></div><button class="primary" type="submit">Сохранить состав</button></form><div class="fixture-controls"><label>Способ оплаты<select id="payment" name="payment"><option value="cash">Наличные</option><option value="card">Карта</option><option value="transfer" disabled>Перевод недоступен</option></select></label><form id="requiredForm"><label>Филиал<select id="branch" name="branch" required><option value="">Выберите филиал</option><option value="center">Центр</option></select></label><button type="submit">Продолжить</button></form></div></div></section></div><div id="inventory" hidden>${inventory}</div><script src="/theme-catalog.js"></script><script src="/fixture.js"></script><script src="/provider-selects.js" defer></script></body></html>`;
}
function script() {
  return `var ownServices=${JSON.stringify(services)};
  var escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  var serviceName=v=>v,money=v=>new Intl.NumberFormat('ru-RU').format(v)+' ₽',uiIcon=()=>'';
  ${declaration('sessionServiceOptions')}
  ${declaration('sessionComposerItemMarkup')}
  document.querySelector('#sessionItems').innerHTML=sessionComposerItemMarkup({kind:'primary',service_id:'service-8',title:ownServices[8].name,duration_minutes:60,price_rub:3000},0);
  window.fixtureEvents=[];window.fixtureSubmits=0;
  document.querySelector('[data-session-service]').addEventListener('input',()=>fixtureEvents.push('input'));
  document.querySelector('[data-session-service]').addEventListener('change',()=>fixtureEvents.push('change'));
  document.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();fixtureSubmits++}));
  window.applyFixtureTheme=(key,scale='default')=>{
    const theme=MinutaThemeCatalog.theme(key);document.body.dataset.providerTheme=key;document.body.dataset.providerTextScale=scale;
    Object.entries({bg:theme.palette.bg,surface:theme.palette.surface,'surface-alt':theme.palette.surfaceAlt,ink:theme.palette.ink,muted:theme.palette.muted,line:theme.palette.line,accent:theme.palette.accent,'accent-soft':theme.palette.accentSoft,shadow:theme.palette.shadow,'accent-contrast':theme.palette.contrast}).forEach(([name,value])=>document.body.style.setProperty('--theme-'+name,value));
  };applyFixtureTheme('pink-porcelain');`;
}

export async function createProviderSelectsFixture() {
  const server = createServer(async (request,response) => {
    const pathname = new URL(request.url,'http://127.0.0.1').pathname;
    try {
      if (pathname === '/') { response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixture());return; }
      if (pathname === '/fixture.js') { response.setHeader('Content-Type','application/javascript; charset=utf-8');response.end(script());return; }
      const target=path.resolve(root,`.${pathname}`);
      if (!target.startsWith(root)) throw new Error('Outside fixture root');
      response.setHeader('Content-Type',pathname.endsWith('.css')?'text/css; charset=utf-8':pathname.endsWith('.js')?'application/javascript; charset=utf-8':pathname.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
      response.end(await readFile(target));
    } catch { response.statusCode=404;response.end('Not found'); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`,inventoryCount:[...html.matchAll(/<select\b/g)].length};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {url}=await createProviderSelectsFixture();console.log(url);
}
