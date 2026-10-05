import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Original public client app, original SDK and original rendering.
// Only transport configuration and response data are isolated fixtures.
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const fixtureDate = '2026-10-05';
export const ids = { organization:'33333333-3333-4333-8333-333333333333', location:'44444444-4444-4444-8444-444444444444', service:'55555555-5555-4555-8555-555555555555', performer:'11111111-1111-4111-8111-111111111111', token:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const service = { id:ids.service, performer_id:ids.performer, active:true, name:'Массаж · учебный пример', duration_minutes:60, price_rub:2500, performer_profiles:{display_name:'Анна · пример'} };
const organization = { id:ids.organization, slug:'local-client-fixture', public_slug:'local-client-fixture', name:'Учебная студия', public_booking_enabled:true };
const booking = { id:'77777777-7777-4777-8777-777777777777', organization_id:ids.organization, location_id:ids.location, service_id:ids.service, booking_code:'EXAMPLE-CLIENT', status:'confirmed', service_name:service.name, performer_name:'Анна · пример', client_name:'Клиент · пример', booking_date:'2026-10-07', booking_time:'14:00:00', duration_minutes:60, price_rub:2500, reschedule_allowed:true, cancel_allowed:true, reschedule_deadline:'2026-10-07T02:00:00+04:00', cancel_deadline:'2026-10-07T02:00:00+04:00', reschedules_remaining:2, deposit_amount_rub:0, payment_status:'not_required' };
function slots(parameters) {
 const first=new Date((parameters.p_start||fixtureDate)+'T12:00:00Z');
 return Array.from({length:14},(_,i)=>{const day=new Date(first);day.setUTCDate(day.getUTCDate()+i);return ['11:00:00','13:00:00','15:00:00','17:00:00'].map(time=>({booking_date:day.toISOString().slice(0,10),booking_time:time}));}).flat();
}
const readHandlers = {
 get_public_minuta_catalog_v5:()=>({organization,locations:[{id:ids.location,name:'Учебный филиал',address:'Тестовый адрес',active:true}],services:[service],client_page:{theme_key:'pink-porcelain',headline_key:'massage-time',porcelain:{shade:'gentle-pink',character:'petal'}},resource_scheduling:false,branch_shift_scheduling:false}),
 // Optional public detail cards are absent for this valid minimal test catalog.
 get_public_service_cards_v159:()=>[],
 get_public_booking_reviews:()=>[],get_public_minuta_group_events:()=>[],
 get_available_slots_v101:slots,get_public_minuta_available_slots_v101:slots,get_reschedule_slots_v101:slots,
 get_booking_management_v2:()=>[booking],get_booking_management:()=>[booking],
 get_yookassa_payment_capability:()=>({available:false,can_create:false,reason:'not_required'}),
 get_minuta_phone_auth_capability:()=>true
};
const telemetry = new Set(['track_public_booking_funnel_event','upsert_public_booking_presence','register_public_booking_visit']);
export async function serveNativeClientCaptureFixture() {
 const requests=[],unsupported=[],blockedMutations=[],discardedTelemetry=[],servedSourceHashes={};
 const csp="default-src 'self'; script-src 'self' https://telegram.org/js/telegram-widget.js; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
 const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),pathname=url.pathname;
  const record={method:req.method,path:pathname,status:0};requests.push(record);
  const send=(status,type,body)=>{record.status=status;res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'}).end(body);};
  let body='';for await(const part of req)body+=part;
  if(pathname==='/auth/v1/settings'&&req.method==='GET')return send(200,'application/json',JSON.stringify({external:{phone:true}}));
  if(pathname==='/auth/v1/user'&&req.method==='GET')return send(401,'application/json',JSON.stringify({message:'No client auth session in fixture'}));
  if(pathname==='/functions/v1/telegram-client-notify/auth-config'&&req.method==='GET')return send(200,'application/json',JSON.stringify({ok:true,bot_id:'123456789',connected:false}));
  if(pathname.startsWith('/rest/v1/rpc/')&&req.method==='POST') {
   const rpc=pathname.split('/').at(-1);record.rpc=rpc;
   if(readHandlers[rpc])return send(200,'application/json',JSON.stringify(readHandlers[rpc](JSON.parse(body||'{}'))));
   if(telemetry.has(rpc)){discardedTelemetry.push(rpc);return send(200,'application/json','true');}
   unsupported.push(rpc);if(!rpc.startsWith('get_'))blockedMutations.push(rpc);
   return send(404,'application/json',JSON.stringify({code:'PGRST202',message:'Not supported by isolated client fixture: '+rpc}));
  }
  if(pathname==='/rest/v1/portfolio_items'&&req.method==='GET')return send(200,'application/json','[]');
  if(req.method!=='GET'){blockedMutations.push(pathname);return send(405,'application/json','{"error":"fixture_writes_forbidden"}');}
  if(pathname.endsWith('/config.js'))return send(200,'application/javascript',`window.MINUTA_CONFIG=Object.freeze({supabaseUrl:location.origin,supabaseKey:'local-fixture-public-placeholder',defaultOrganizationSlug:'local-client-fixture',socialAuthProviders:Object.freeze({telegram:false,vk:false,yandex:false})});`);
  const relative=decodeURIComponent(pathname.replace(/^\/minuta-online-booking\//,'')),target=resolve(appRoot,relative);
  if(!target.startsWith(appRoot+sep)||!mime[extname(target)])return send(403,'text/plain','forbidden');
  try{const source=readFileSync(target);servedSourceHashes[relative]=createHash('sha256').update(source).digest('hex');return send(200,mime[extname(target)],source);}
  catch{unsupported.push(relative);return send(404,'text/plain','not found');}
 });
 server.on('upgrade',(req,socket)=>{requests.push({method:'WEBSOCKET',path:new URL(req.url,'http://127.0.0.1').pathname,status:403});socket.destroy();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,origin:'http://127.0.0.1:'+server.address().port,requests,unsupported,blockedMutations,discardedTelemetry,servedSourceHashes};
}
