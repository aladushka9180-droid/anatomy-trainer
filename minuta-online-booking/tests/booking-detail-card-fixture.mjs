import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const source=(await readFile(path.join(root,'provider.js'),'utf8')).replaceAll('\r\n','\n');
const providerHtml=await readFile(path.join(root,'provider.html'),'utf8');
function declaration(name){
  const start=source.search(new RegExp(`^function ${name}\\(`,'m'));
  if(start<0)throw new Error(`Missing renderer ${name}`);
  const lineEnd=source.indexOf('\n',start);
  return source.slice(start,source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',start)+2);
}
const functions=['openBookingSheet','bookingDetailHeaderMarkup','bookingDetailClientMarkup',
  'bookingClientProfileActionMarkup','bookingDetailSeriesMarkup','bookingClientOverviewMarkup',
  'clientCompletedVisits','clientNextBookingAfter','reportVisitWord','bookingSessionMarkup',
  'bookingClientLabelsMarkup','compactBookingColorPicker','bookingColorPicker','bookingClientResultMarkup',
  'clientMessageButtonMarkup','providerConversationButtonMarkup','trapBookingSheetFocus','clientFramedAvatarMarkup','clientAvatarEditorMarkup'];
function fixture(){
  const styles=[...providerHtml.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g)]
    .map(match=>`<link rel="stylesheet" href="/${match[1]}">`).join('\n');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Карточка записи — тестовые данные</title>${styles}<link rel="stylesheet" href="/provider-clients-premium.css"><link rel="stylesheet" href="/booking-detail-card.css?v=2"><style>body{margin:0}*,*::before,*::after{animation:none!important;transition:none!important}</style></head><body class="provider-body booking-sheet-open" data-provider-theme="pink-porcelain" data-provider-layout="capsule" data-provider-text-scale="default" data-provider-porcelain-character="petal"><div class="booking-sheet" id="bookingSheet" hidden><button class="booking-sheet-backdrop" type="button" aria-label="Закрыть карточку записи"></button><section class="booking-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="bookingSheetTitle"><button class="booking-sheet-close" type="button" aria-label="Закрыть">×</button><div id="bookingSheetContent"></div></section></div><script src="/client-loyalty-frames.js"></script><script src="/booking-detail-card.js"></script><script src="/fixture.js"></script></body></html>`;
}
function script(){return `
var $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
var fixtureBooking={id:'11111111-1111-4111-8111-111111111111',booking_date:'2026-09-27',booking_time:'16:00:00',status:'confirmed',duration_minutes:120,client_name:'Сергей',client_phone:'+7 (900) 000-00-01',services:{name:'Комплексный массаж всего тела',duration_minutes:120,price_rub:5800},total_price_rub:5800};
var fixtureOutcome={visit_status:'completed',payment_method:'transfer',amount_rub:5800,_sync_pending:true,completion_source:'auto'};
var allBookings=[fixtureBooking],fixtureEffects=[],fixtureMode='normal',notificationAddress='Тестовый адрес';
var bookingSourceItems=()=>allBookings,isScheduleBlock=item=>item.is_block===true;
var escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
var normalizePhone=v=>String(v||'').replace(/\\D/g,'');
var money=v=>new Intl.NumberFormat('ru-RU').format(v)+' ₽';
var serviceName=v=>v,uiIcon=n=>'<svg class="ui-icon" aria-hidden="true"><use href="/ui-icons.svg#icon-'+n+'"></use></svg>';
var bookingOutcome=item=>item.past?{visit_status:'completed',amount_rub:3000}:fixtureOutcome;
var bookingStatus=()=>fixtureBooking.status==='cancelled'?'Отменена':fixtureOutcome.visit_status==='completed'?'Состоялся автоматически':fixtureOutcome.visit_status==='no_show'?'Не пришёл':'Подтверждена';
var bookingStatusClass=()=>fixtureOutcome.visit_status==='completed'?'visited':'confirmed';
var bookingDisplayNote=()=>'',bookingVisitComment=()=>'',bookingReviewLink=()=>'',bookingMinuteRate=()=>0,isPerMinuteBooking=()=>false;
var bookingSession=item=>[{kind:'primary',title:item.services.name,duration_minutes:item.duration_minutes,price_rub:item.total_price_rub,extends_duration:true}];
var bookingSessionDuration=items=>items.reduce((sum,item)=>sum+item.duration_minutes,0),bookingSessionTotal=item=>item.total_price_rub;
var autoCompleteSettingsActionMarkup=()=>'',automaticOutcomeHint=()=>fixtureOutcome._sync_pending?'Ожидает синхронизации':'';
var outcomeVisitLabel=()=>bookingStatus(),quickVisitOutcomeMarkup=()=>'',bookingIsCompleted=()=>fixtureOutcome.visit_status!=='scheduled';
var clientLabel=()=>({}),clientBadgeMarkup=()=>'',clientAvatarContent=()=>fixtureBooking.client_name.slice(0,1);
var clientAvatar=()=>null,clientAvatarsRemoteAvailable=true;
var buildClients=()=>[{phone:normalizePhone(fixtureBooking.client_phone),bookings:[fixtureBooking,{...fixtureBooking,id:'past',past:true,booking_date:'2026-09-20'}]}];
var favoriteServiceNameKey=v=>String(v||''),clientFavoriteServiceFacts=()=>[];
var BOOKING_COLOR_KEYS=['auto','sage','rose'],BOOKING_COLOR_LABELS={auto:'Авто',sage:'Шалфей',rose:'Розовый'},validBookingColor=v=>BOOKING_COLOR_KEYS.includes(v)?v:'auto',bookingColor=()=> 'auto';
var applyClientHighlightClasses=()=>{},bookingUsesDemoData=()=>fixtureMode==='demo';
var clientResultsController={mount:()=>{}},saveBookingVisitResult=e=>{e.preventDefault();fixtureEffects.push('result')},saveBookingOutcome=e=>{e.preventDefault();fixtureEffects.push('outcome')},savePrepaymentStatus=e=>e.preventDefault(),saveBookingSheetNote=e=>{e.preventDefault();fixtureEffects.push('note')},saveBookingBlockNote=e=>e.preventDefault(),toggleOutcomePaymentFields=()=>{},updateOutcomeMinuteCalculation=()=>{};
${functions.map(declaration).join('\n')}
window.renderFixture=(changes={})=>{
  fixtureMode=changes.demo?'demo':'normal';
  Object.assign(fixtureBooking,changes.item||{}); Object.assign(fixtureOutcome,changes.outcome||{});
  openBookingSheet(fixtureBooking.id);
};
document.querySelector('#bookingSheet').addEventListener('keydown',trapBookingSheetFocus);
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-open-client-profile],[data-repeat-booking],[data-message-client],[data-commerce-booking-sale],[data-edit-booking-session],[data-delete-booking]');
  if(action)fixtureEffects.push(Object.keys(action.dataset)[0]);
  if(event.target.closest('.booking-sheet-close,.booking-sheet-backdrop'))document.querySelector('#bookingSheet').hidden=true;
});
renderFixture();
`;}
export async function startFixture(){
  const server=createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(fixture());return;}
      if(pathname==='/fixture.js'){res.setHeader('content-type','text/javascript; charset=utf-8');res.end(script());return;}
      const file=path.resolve(root,'.'+decodeURIComponent(pathname));
      if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
      const types={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'};
      res.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(Number(process.env.PORT||0),'127.0.0.1',resolve));
  return {server,url:'http://127.0.0.1:'+server.address().port};
}
if(process.argv.includes('--serve')){const {url}=await startFixture();console.log(url);}
