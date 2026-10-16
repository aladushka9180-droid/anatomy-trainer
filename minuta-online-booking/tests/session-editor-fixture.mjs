import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const source=(await readFile(path.join(root,'provider.js'),'utf8')).replaceAll('\r\n','\n');
const html=await readFile(path.join(root,'provider.html'),'utf8');
function declaration(name) {
  const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
  if(start<0)throw Error('Missing actual renderer '+name);
  return source.slice(start,source.indexOf('\n}',start)+2);
}
function between(start,end) {
  const from=source.indexOf(start),to=source.indexOf(end,from);
  if(from<0||to<0)throw Error('Missing actual session event branch');
  return source.slice(from,to);
}
const clickBranch=between('  if (addSessionItem) {','  if (backBooking)');
const changeStart=source.indexOf("  const sessionControl = event.target.closest(");
const changeBranch=source.slice(changeStart,source.indexOf('\n  }\n',changeStart)+5);
const inputBranch=between("  const sessionInput = event.target.closest(","  const reason = event.target.closest(");
const functions=['bookingSession','bookingSessionDuration','sessionServiceOptions','sessionConflict',
  'sessionComposerItemMarkup','updateSessionServiceLabels','readSessionComposerDraft',
  'updateSessionComposerSummary','renderSessionComposer','openSessionComposer','saveBookingSession'];
const services=[
  {id:'s1',name:'Массаж спины + ШВЗ — углублённый',duration_minutes:60,price_rub:3000},
  {id:'s2',name:'Массаж спины + ШВЗ — базовый',duration_minutes:40,price_rub:2500},
  {id:'minute',name:'Поминутный массаж',duration_minutes:1,price_rub:50}
];
function fixture() {
  const styles=[...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g)]
    .map(match=>'<link rel="stylesheet" href="/'+match[1]+'">').join('\n');
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Состав сеанса — изолированная проверка</title>'+styles+
    '<style>body{margin:0}*,*::before,*::after{animation:none!important;transition:none!important}</style></head>'+
    '<body class="provider-body booking-sheet-open" data-provider-theme="pink-porcelain" data-provider-layout="capsule" data-provider-text-scale="default" data-provider-porcelain-character="petal">'+
    '<div class="booking-sheet booking-sheet-detail booking-sheet-reference" id="bookingSheet"><button class="booking-sheet-backdrop" type="button" aria-label="Закрыть"></button>'+
    '<section class="booking-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="bookingSheetTitle"><button class="booking-sheet-close" type="button" aria-label="Закрыть">×</button>'+
    '<div id="bookingSheetContent"></div></section></div><script src="/theme-catalog.js"></script><script src="/fixture.js"></script>'+
    '<script src="/provider-selects.js" defer></script></body></html>';
}
function script() {
  return [
    'var $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];',
    'var ownServices='+JSON.stringify(services)+';',
    'var allBookings=[],bookingSessionItems=new Map(),sessionComposerDraft=[],sessionItemsRemoteAvailable=true;',
    'var fixtureEffects=[],fixtureRpcError=null,fixturePending=false,fixtureRelease=null,fixtureAllowWrites=true;',
    'var currentUser={id:"fictional-owner"};',
    'var serviceName=v=>String(v||"");',
    'var escapeHtml=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"}[c]));',
    'var money=v=>new Intl.NumberFormat("ru-RU").format(v)+" ₽";',
    'var minutesFromTime=v=>String(v).split(":").slice(0,2).reduce((sum,n,i)=>sum+Number(n)*(i?1:60),0);',
    'var uiIcon=name=>\'<svg class="ui-icon" aria-hidden="true"><use href="/ui-icons.svg#icon-\'+name+\'"></use></svg>\';',
    'var isScheduleBlock=()=>false,requireWrites=()=>fixtureAllowWrites;',
    'var clearFormError=s=>{const e=$(s);e.hidden=true;e.textContent="";};',
    'var showFormError=(s,text)=>{const e=$(s);e.textContent=text;e.hidden=false;};',
    'var writeLocalSessionItems=()=>fixtureEffects.push({type:"local"});',
    'var refreshAfterWrite=async()=>fixtureEffects.push({type:"refresh"});',
    'var notify=text=>fixtureEffects.push({type:"notice",text});',
    'var openBookingSheet=id=>fixtureEffects.push({type:"back",id});',
    'var db={rpc:async(name,args)=>{fixtureEffects.push({type:"rpc",name,args:JSON.parse(JSON.stringify(args))});if(fixturePending)await new Promise(resolve=>fixtureRelease=resolve);return {error:fixtureRpcError};},from:table=>({update:values=>{fixtureEffects.push({type:"fallback",table,values});const chain={eq:()=>chain,then:resolve=>Promise.resolve({error:null}).then(resolve)};return chain;}})};',
    functions.map(declaration).join('\n'),
    'document.addEventListener("click",event=>{const addSessionItem=event.target.closest("[data-add-session-item]"),removeSessionItem=event.target.closest("[data-remove-session-item]");',
    clickBranch,
    'if(event.target.closest("[data-back-booking]"))openBookingSheet("fixture");if(event.target.closest(".booking-sheet-close,.booking-sheet-backdrop")){$("#bookingSheet").hidden=true;fixtureEffects.push({type:"close"});}});',
    'document.addEventListener("change",event=>{',changeBranch,'});',
    'document.addEventListener("input",event=>{',inputBranch,'});',
    'window.applyFixtureTheme=(key="pink-porcelain",scale="default")=>{const theme=MinutaThemeCatalog.theme(key);document.body.dataset.providerTheme=key;document.body.dataset.providerTextScale=scale;Object.entries({bg:theme.palette.bg,surface:theme.palette.surface,"surface-alt":theme.palette.surfaceAlt,ink:theme.palette.ink,muted:theme.palette.muted,line:theme.palette.line,accent:theme.palette.accent,"accent-soft":theme.palette.accentSoft,shadow:theme.palette.shadow,"accent-contrast":theme.palette.contrast}).forEach(([name,value])=>document.body.style.setProperty("--theme-"+name,value));};',
    'window.resetFixture=(options={})=>{fixtureEffects=[];fixtureRpcError=null;fixturePending=false;fixtureRelease=null;fixtureAllowWrites=true;sessionItemsRemoteAvailable=true;bookingSessionItems.clear();const s=ownServices.find(s=>s.id===(options.service||"s1"));allBookings=[{id:"fictional-booking",booking_date:"2026-10-16",booking_time:"12:00:00",status:"confirmed",service_id:s.id,services:s,duration_minutes:options.duration||s.duration_minutes,total_price_rub:options.price??s.price_rub}];if(options.nextTime)allBookings.push({id:"fictional-next",booking_date:"2026-10-16",booking_time:options.nextTime,status:"confirmed",duration_minutes:60});if(options.items)bookingSessionItems.set("fictional-booking",options.items);$("#bookingSheet").hidden=false;applyFixtureTheme(options.theme);openSessionComposer("fictional-booking");};',
    'resetFixture();'
  ].join('\n');
}
export async function startFixture() {
  const server=createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url,'http://localhost').pathname;
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'");
      if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture());return;}
      if(pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(script());return;}
      const target=path.resolve(root,'.'+decodeURIComponent(pathname));
      if(!target.startsWith(root+path.sep))throw Error('Outside fixture root');
      const types={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
      res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');
      res.end(await readFile(target));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(Number(process.env.PORT||0),'127.0.0.1',resolve));
  return {server,url:'http://127.0.0.1:'+server.address().port};
}
if(process.argv.includes('--serve')){const {url}=await startFixture();console.log(url);}
