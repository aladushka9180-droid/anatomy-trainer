import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {extname,resolve,sep} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
export async function startFixture(){
 const source=readFileSync(resolve(root,'provider.html'),'utf8');
 const provider=readFileSync(resolve(root,'provider.js'),'utf8').replaceAll('\r\n','\n');
 const tabStart=provider.indexOf('function activateClientProfileJump(');
 const tabsFunction=provider.slice(tabStart,provider.indexOf('\n}',tabStart)+2);
 const styles=[...source.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)].map(m=>m[0]).join('\n');
 const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles}<link rel="stylesheet" href="client-profile-card.css"><body class="provider-body client-profile-detail-open" data-provider-theme="pink-porcelain" data-provider-layout="standard"><main style="max-width:900px;margin:auto;padding:12px"><div id="fixture"></div></main><script src="client-loyalty-frames.js"></script><script src="client-profile-card.js"></script><script src="fixture.js"></script></body></html>`;
 const script=`(async()=>{
 const parsed=new DOMParser().parseFromString(await(await fetch('provider.html')).text(),'text/html');
 document.querySelector('#fixture').append(document.importNode(parsed.querySelector('.client-profile'),true));
 const $=s=>document.querySelector(s);$('#clientProfileContent').hidden=false;$('#clientProfileEmpty').hidden=true;
 $('#clientName').textContent='Тестовая Виолетта';$('#clientAvatar').textContent='В';$('#clientRelationshipTitle').textContent='Вернулась';$('#clientPhone').textContent='+7 (900) 000-00-00';
 $('#clientQuickRepeat').hidden=false;$('#clientContactButton').hidden=false;$('#clientMoreButton').hidden=false;
 $('#clientVisits').textContent='100';$('#clientSpent').textContent='30 000 ₽';$('#clientMilestoneCard').hidden=false;$('#clientMilestoneText').textContent='3 из 10 визитов';$('#clientMilestoneHint').textContent='Ещё 7 визитов до награды';$('#clientMilestoneProgress').setAttribute('aria-valuenow','30');
 $('#clientBirthdayInfo').hidden=false;$('#clientBirthdayDisplay').textContent='Не указан';
 $('#clientRecords').hidden=false;$('#clientRecords').innerHTML='<div data-cr-view="history">Старая история</div><div data-cr-view="notes" hidden>Заметки сохранены</div><div data-cr-view="files" hidden>Файлы сохранены</div>';
 window.fixtureClicks=[];for(const id of ['clientQuickRepeat','clientContactButton','clientMoreButton','clientBirthdayEdit','clientLoyaltyOpenSettings','clientCopyPhone'])$('#'+id).addEventListener('click',()=>fixtureClicks.push(id));
 document.addEventListener('click',event=>{const booking=event.target.closest('[data-open-booking]');if(booking)fixtureClicks.push(booking.dataset.openBooking);});
 const $$=s=>[...document.querySelectorAll(s)];const clientRecordsController={setView:key=>$('#clientRecords').querySelectorAll('[data-cr-view]').forEach(view=>view.hidden=view.dataset.crView!==key)};
 ${tabsFunction}
 document.querySelectorAll('[data-client-profile-jump]').forEach(button=>button.addEventListener('click',()=>activateClientProfileJump(button.dataset.clientProfileJump,{scroll:false})));
 const row=(id,day,visit,status='confirmed',amount=0)=>({id,booking_date:day,booking_time:'15:00:00',status,services:{name:'Массаж спины + ШВЗ — углублённый',duration_minutes:60,price_rub:3000},outcome:{visit_status:visit,amount_rub:amount}});
 window.fixtureClient={phone:'79000000000',imported:{visit_count:99,last_visit_on:'2026-08-19'},bookings:[row('future','2099-09-29','scheduled'),row('done','2026-08-19','completed','confirmed',2000),{...row('import','2026-07-01','completed','confirmed',3000),is_imported_history:true},row('old-scheduled','2020-01-01','scheduled'),row('cancelled','2020-01-02','scheduled','cancelled'),row('no-show','2020-01-03','no_show')]};
 window.profileOptions={client:fixtureClient,visits:100,scope:'synthetic-only',outcome:item=>item.outcome,status:item=>item.status==='cancelled'?'Отменена':item.outcome.visit_status==='no_show'?'Не пришёл':'Подтверждена',value:item=>item.services.price_rub,money:value=>value.toLocaleString('ru-RU')+' ₽',serviceName:value=>value};
 window.renderProfile=()=>{PrimeTimeLoyaltyFrames.render({...profileOptions,complete:true});PrimeTimeClientProfileCard.render(profileOptions);};
 renderProfile();window.fixtureReady=true;
 })();`;
 const server=createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://fixture').pathname);if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}if(pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(script);return;}const path=resolve(root,`.${pathname}`);if(!path.startsWith(root.endsWith(sep)?root:root+sep))throw Error('path');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:`http://127.0.0.1:${server.address().port}/`};
}
if(process.argv.includes('--serve')){const {url}=await startFixture();console.log(url);}
