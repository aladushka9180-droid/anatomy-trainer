import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const fixtureRequire=createRequire(import.meta.url);
const WebSocketServer=fixtureRequire(resolve(dirname(fixtureRequire.resolve('playwright-core/package.json')),'lib/utilsBundle.js')).wsServer;

// Full original app and vendor SDK. Only config and HTTP data come from this fixture.
// No DOM edits, renderer replacement, production connection, or persisted records.
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const date = process.env.NATIVE_CAPTURE_DATE || new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Samara',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));
const uid = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const orgId = '33333333-3333-4333-8333-333333333333';
const locationId = '44444444-4444-4444-8444-444444444444';
const serviceId = '55555555-5555-4555-8555-555555555555';
const preferences = { version:9, theme:'pink-porcelain', layout:'soft', text_scale:'default', team_calendar_enabled:true, updated_at:1791198000000 };
preferences.booking_card_density='custom'; // Persisted test state, shown by the original settings renderer.
const user = { id:uid, aud:'authenticated', role:'authenticated', email:'example@native-fixture.invalid', email_confirmed_at:date+'T07:00:00Z', app_metadata:{provider:'email',providers:['email']}, user_metadata:{display_name:'Анна · пример',provider_display_preferences:preferences}, identities:[], created_at:'2026-01-01T00:00:00Z' };
const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:uid,aud:'authenticated',role:'authenticated',exp:1924992000})).toString('base64url'),'local-fixture-not-a-credential'].join('.');
const session = { access_token:token, refresh_token:'local-fixture-only', token_type:'bearer', expires_in:3600, expires_at:1924992000, user };
const locations = [{id:locationId,name:'Учебный филиал',address:'Тестовый адрес',active:true}];
const members = [{user_id:uid,id:uid,display_name:'Анна · пример',role:'owner',active:true,is_bookable:true},{user_id:second,id:second,display_name:'Мария · пример',role:'specialist',active:true,is_bookable:true}];
const organization = {id:orgId,name:'Учебный кабинет',public_slug:'local-native-fixture',public_booking_enabled:false,current_role:'owner',can_manage:true,locations,members,invitations:[],audit:[]};
const services = [
 {id:serviceId,performer_id:uid,name:'Массаж спины',duration_minutes:60,price_rub:2500,active:true,created_at:date+'T06:00:00Z',performer_profiles:{display_name:'Анна · пример'}},
 {id:'66666666-6666-4666-8666-666666666666',performer_id:uid,name:'Консультация',duration_minutes:30,price_rub:1500,active:true,created_at:date+'T05:00:00Z',performer_profiles:{display_name:'Анна · пример'}}
];
const bookings = [
 ['77777777-7777-4777-8777-777777777777','Клиент примера А','13:00',uid,'confirmed'],
 ['88888888-8888-4888-8888-888888888888','Клиент примера Б','15:00',uid,'new'],
 ['99999999-9999-4999-8999-999999999999','Клиент примера В','14:00',second,'confirmed']
 ].map(([id,client_name,booking_time,performer_id,status],index)=>({id,booking_code:'EXAMPLE-'+(index+1),performer_id,service_id:serviceId,client_name,client_phone:'7000000000'+(index+1),booking_date:date,booking_time,duration_minutes:60,status,created_at:date+'T06:00:00Z',services:services[0],service_name:services[0].name,performer_name:members.find(m=>m.id===performer_id).display_name,location_id:locationId,location_name:locations[0].name,deposit_amount_rub:0,payment_status:'not_required',original_price_rub:2500,total_price_rub:2500,reschedule_count:0}));
const schedule = Array.from({length:7},(_,index)=>({id:'schedule-'+(index+1),performer_id:uid,weekday:index+1,enabled:true,start_time:index===1?'11:00':'10:00',end_time:index===2?'17:00':'18:00',break_start:null,break_end:null,slot_interval_minutes:30}));
const policy = {performer_id:uid,cancel_cutoff_hours:12,reschedule_cutoff_hours:12,max_reschedules:2,deposit_enabled:false,auto_complete_visits:false,visitor_notifications_enabled:false,booking_buffer_enabled:false};
const tables = {
 services,bookings,provider_schedule:schedule,performer_profiles:[{id:uid,display_name:'Анна · пример'}],booking_policies:[policy],
 provider_days_off:[],group_booking_events:[],client_notes:[],client_labels:[],booking_session_items:[],booking_outcomes:[],notification_templates:[],notification_marks:[],notification_outbox:[],booking_page_visits:[],client_page_visits:[],portfolio_items:[],client_avatars:[],waitlist_requests:[],booking_colors:[],
 staff_location_shifts:[],staff_absences:[],financial_transactions:[],commercial_sales:[],organization_memberships:[{organization_id:orgId,user_id:uid,role:'owner',active:true}]
};
const resourceId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const resourceGroupId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clientId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const productId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const warehouseId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const materialId='ffffffff-ffff-4fff-8fff-ffffffffffff';
const resources=[{id:resourceId,group_id:resourceGroupId,name:'Учебный кабинет 1',group_name:'Кабинеты',location_id:locationId,location_name:'Учебный филиал',kind:'room',capacity:1,active:true}];
const shifts=members.map(m=>({id:'shift-'+m.id,performer_id:m.id,location_id:locationId,shift_date:date,start_time:'10:00',end_time:'18:00',active:true}));
const clients=[{id:clientId,client_account_id:clientId,client_name:'Клиент примера А',client_phone:'70000000001'}];
bookings.forEach(booking=>{booking.organization_id=orgId;booking.client_account_id=clientId;});
bookings[1].series_id='12121212-1212-4212-8212-121212121212';bookings[1].series_occurrence=1;bookings[1].booking_series={occurrence_count:3};
tables.portfolio_photos=[];
tables.portfolio_items=[{id:'13131313-1313-4313-8313-131313131313',performer_id:uid,procedure_name:'Учебный пример работы',body_area:'Описание без фотографий',session_count:1,description:'Учебный черновик для проверки меню управления.',published:false,sort_order:0,created_at:date+'T06:00:00Z',consent_confirmed_at:null}];
tables.portfolio_items.push({...tables.portfolio_items[0],id:'14141414-1414-4414-8414-141414141414',procedure_name:'Второй учебный пример',sort_order:1});
services.forEach(service=>{service.organization_id=orgId;});
const benefit={id:productId,name:'Учебный абонемент на 5 визитов',kind:'visit_pass',active:true,visits_count:5,sale_price_rub:11000,sale_price_minor:1100000,validity_days:90,service_ids:[serviceId]};
const material={id:materialId,name:'Учебный расходный материал',unit:'ml',kind:'material',sku:'EXAMPLE-001',active:true};
const warehouse={id:warehouseId,name:'Учебный склад',location_id:locationId,active:true};
const rule={id:'example-rule',enabled:true,goal_visits:10,reward_kind:'percent',reward_value:1000,reward_title:'Скидка 10% на следующий визит',reward_terms:'Один учебный визит',validity_days:90};
const reads = {
 get_minuta_benefit_lifecycle_v150:args=>({organization_id:orgId,client_account_id:args.p_client_account,instruments:[],redemptions:[],audit:[]}),
 get_minuta_client_commerce_v147:()=>({organization_id:orgId,sales:[]}),
 get_minuta_client_result_v171:()=>({enabled:false,can_enable:true,result:null,media:[]}),
 get_minuta_client_result_v120:()=>({enabled:false,can_enable:true,result:null,media:[]}),
 get_minuta_commerce_workspace_v151:()=>({organization_id:orgId,current_role:'owner',enabled:true,can_manage:true,settings:{},products:[],warehouses:[],balances:[],sales:[],recent_sales:[],refunds:[],returns:[],movements:[],clients:[],sellers:members,accounts:[],inventory_items:[],benefit_products:[],audit:[],cash_accounts:[],categories:[]}),
 get_minuta_retention_workspace:()=>({organization_id:orgId,current_role:'owner',enabled:false,inactivity_days:45,cooldown_days:90,message_template:'Учебное сообщение',clients:[],deliveries:[],audit:[]}),
 has_minuta_provider_access:()=>true,
 get_minuta_workspace:()=>({organizations:[organization],pending_invitations:[]}),
 get_minuta_team_calendar_v3:()=>({available:true,organization,performers:members,locations,resources,services,bookings,shifts,absences:[],dispatcher_actions:true}),
 get_available_slots_v101:()=>['11:00','16:00','17:00'].map(booking_time=>({booking_time})),
 get_available_slots:()=>['11:00','16:00','17:00'].map(booking_time=>({booking_time})),
 get_minuta_feedback_capability:()=>({available:false}),
 get_minuta_batch_booking_workspace:()=>({organization_id:orgId,current_role:'owner',enabled:true,max_items:12,locations,services,recent_batches:[]}),
 get_minuta_booking_policy_workspace:()=>({organization_id:orgId,current_role:'owner',can_manage:true,enabled:false,locations,services,rules:[],audit:[]}),
 get_minuta_group_booking_admin:()=>({organization_id:orgId,current_role:'owner',enabled:true,locations,performers:members.map(m=>({...m,name:m.display_name})),services,events:[]}),
 get_minuta_client_field_workspace:()=>({organization_id:orgId,current_role:'owner',fields:[],values:[]}),
 get_minuta_imported_clients:()=>({organization_id:orgId,can_import:true,clients:[],recent_batches:[],has_more:false}),
 get_minuta_provider_transfer_journal_v144:()=>({organization_id:orgId,batches:[]}),
 get_minuta_team_analytics:()=>({organization_id:orgId,can_view_team:true,performers:members.map(m=>({performer_id:m.id,performer_name:m.display_name,completed_visits:0,payment_known_visits:0,unique_clients:0,worked_minutes:0,revenue_rub:0,payroll_rub:0}))}),
 get_minuta_staff_report_bookings_v97:args=>({organization_id:orgId,bookings:bookings.filter(b=>b.booking_date>=args.p_start&&b.booking_date<=args.p_end&&(!args.p_performer||b.performer_id===args.p_performer)),has_more:false}),
 get_minuta_staff_report_availability:()=>({organization_id:orgId,available_minutes:960,configured_performers:2,total_performers:2,completeness_version:2,complete:true}),
 get_minuta_client_records:()=>({organization_id:orgId,enabled:true,can_manage:true,entries:[],has_more:false}),
 get_minuta_client_results_v171:()=>({organization_id:orgId,enabled:false,can_enable:true,results:[]}),
 get_minuta_utm_funnel_v107:()=>({organization_id:orgId,rows:[]}),
 get_minuta_finance_screen_v163:args=>({schema:'minuta-finance-screen-v1',ledger_version:163,organization_id:orgId,currency:'RUB',timezone:'Europe/Samara',finance_enabled:true,period:{start:args.p_start,end:args.p_end,bucket_grain:'day'},selected_performer_id:args.p_performer||null,summary:{received_minor:0,expense_minor:0,net_minor:0,services_minor:0,debt_minor:0},confidence:{completed_visits:0,payment_marked_visits:0,ledger_posted_visits:0,unposted_payment_visits:0,unknown_payment_visits:0,service_value_known_visits:0,is_complete:true,result_reliable:true},expense_readiness:{finance_enabled:true,has_payment_account:true,active_category_count:1,can_record:true},performers:members.map(m=>({id:m.id,name:m.display_name})),accounts:[{id:warehouseId,name:'Учебная касса',account_type:'cash'}],categories:[{id:materialId,name:'Учебные материалы',active:true}],series:[],expense_structure:[],operations:[],has_more:false,next_cursor:null}),
 get_provider_block_slots_v141:()=>['11:00','16:00','17:00'].map(booking_time=>({booking_time})),
 get_provider_service_preset_state_v160:()=>({catalog_version:160,profession_ids:[]}),
 get_minuta_data_governance_workspace_v110:()=>({organization_id:orgId,current_role:'owner',can_manage:true,export_enabled:false,retention:[],jobs:[],audit:[]}),
 get_minuta_resource_workspace:()=>({organization_id:orgId,current_role:'owner',can_manage:true,services,groups:[{id:resourceGroupId,name:'Кабинеты',kind:'room',active:true}],resources,requirements:[{id:'requirement-example',service_id:serviceId,resource_group_id:resourceGroupId,quantity:1}],locations,audit:[]}),
 get_minuta_shift_workspace:()=>({organization_id:orgId,current_role:'owner',can_manage_team:true,enabled:true,locations,performers:members.map(m=>({...m,id:m.user_id})),services:[...services,{...services[0],id:'second-service',performer_id:second}],shifts,absences:[],bookings,utilization:[],audit:[]}),
 get_minuta_payroll_ledger_workspace_v136:()=>({organization_id:orgId,current_role:'owner',enabled:true,can_manage:true,summary:{},members,locations,plans:[{id:'example-plan',performer_id:uid,name:'Учебное правило',base_minor:0,base_amount_minor:0,percent_bps:3000,base_rate_bps:3000,effective_from:'2026-10-01',starts_on:'2026-10-01',ends_on:null,active:true,tiers:[]}],periods:[{id:'example-period',name:'Учебный черновик',starts_on:'2026-10-01',ends_on:'2026-10-31',status:'draft'}],items:[],adjustments:[],typed_adjustments:[],accruals:[],payments:[],advances:[],advance_offsets:[],debts:[],ledger_accounts:[],payment_accounts:[],cash_accounts:[],transactions:[],history:[],audit:[]}),
 get_minuta_payment_workspace:()=>({organization_id:orgId,current_role:'owner',settings:{enabled:false,environment:'test',fiscalization_enabled:false},recent_attempts:[{id:'example-payment',status:'succeeded',provider_status:'succeeded',environment:'test',booking_id:bookings[0].id,client_name:bookings[0].client_name,amount_rub:1000,amount_minor:100000,captured_amount_minor:100000,refunded_amount_minor:0,refunded_amount_rub:0,created_at:date+'T07:00:00Z'}],recent_refunds:[],recent_reconciliations:[]}),
 get_minuta_provider_connector_read_model_v144:()=>({organization_id:orgId,current_role:'owner',connectors:[],attempts:[],events:[]}),
 get_minuta_notification_workspace:()=>({organization_id:orgId,current_role:'owner',enabled:false,rules:[],queue:[],channels:[],audit:[]}),
 get_minuta_loyalty_program_workspace_v166:()=>({organization_id:orgId,enabled:true,can_manage:true,current_role:'owner',rule,stats:{},clients,accounts:[{id:'example-account',client_account_id:clientId,current_visits:7,progress_visits:7,progress:7,goal_visits:10}],rewards:[{id:'example-reward',client_account_id:clientId,status:'pending',reward_kind:'percent',reward_value:1000,reward_title:rule.reward_title,expires_at:'2027-01-01T00:00:00Z',reward_terms:rule.reward_terms}],history:[]}),
 get_minuta_benefit_workspace:()=>({organization_id:orgId,current_role:'owner',enabled:true,services,clients,bookings:bookings.map(b=>({...b,client_account_id:clientId})),products:[benefit],instruments:[{id:'example-instrument',product_id:productId,client_account_id:clientId,product_snapshot:benefit,remaining_visits:3,remaining_amount_rub:0,public_code:'EXAMPLE-ONLY',expires_on:'2027-01-01',status:'active'}],redemptions:[],audit:[]}),
 get_minuta_inventory_workspace_v130:()=>({organization_id:orgId,current_role:'owner',enabled:true,auto_deduct_completed_visits:false,transfers_enabled:true,transfer_version:130,locations,services,items:[material],warehouses:[warehouse],balances:[{warehouse_id:warehouseId,inventory_item_id:materialId,quantity:1000}],usage:[{service_id:serviceId,inventory_item_id:materialId,warehouse_id:warehouseId,quantity:10}],movements:[],audit:[],transfer_documents:[]}),
 get_minuta_service_public_details_v159:()=>services.map(s=>({...s,description:'Учебная услуга',public_visible:true})),
 get_minuta_provider_automatic_breaks_v158:()=>[],get_minuta_provider_schedule_move_v157:()=>[],
 get_provider_booking_reviews:()=>[{id:'example-review',booking_id:bookings[0].id,client_name:'Учебный клиент',rating:5,review_text:'Учебный отзыв для демонстрации управления публикацией.',text:'Учебный отзыв для демонстрации управления публикацией.',published:false,created_at:date+'T06:00:00Z'}],get_minuta_booking_events_v97:()=>[],get_minuta_booking_events:()=>[],
 get_minuta_client_profile_v135:()=>({can_edit:true,can_manage_block:true,birthday:null,online_booking_blocked:false}),
 get_minuta_imported_booking_history:()=>[],
 get_minuta_client_page_settings_v177:()=>({}),get_minuta_client_page_settings_v118:()=>({}),
 get_public_minuta_catalog_v5:()=>({organization,locations,services,performers:members}),
 get_public_minuta_group_events:()=>[],get_minuta_feedback_availability:()=>({available:false}),
 get_minuta_client_fields:()=>({fields:[]}),get_minuta_client_import_workspace:()=>({clients:[],bookings:[]}),
 get_minuta_client_record_workspace:()=>({records:[],groups:[],states:[]})
};
function selectRows(rows, params) {
 return rows.filter(row=>[...params].every(([column,value])=>{
  if(['select','order','limit','offset'].includes(column)||column.includes('('))return true;
  const dot=value.indexOf('.'),op=value.slice(0,dot),wanted=value.slice(dot+1),actual=row[column];
  if(actual===undefined)return true;
  if(op==='eq')return String(actual)===wanted;
  if(op==='neq')return String(actual)!==wanted;
  if(op==='gte')return String(actual)>=wanted;
  if(op==='lte')return String(actual)<=wanted;
  return true;
 }));
}
export async function serveNativeCaptureFixture() {
 const requests=[],unsupported=[],mutations=[],sourceHashes={};
const csp="default-src 'self'; script-src 'self'; connect-src 'self' ws://127.0.0.1:__PORT__; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
  const record={method:req.method,path,status:0};requests.push(record);
  const send=(status,type,body)=>{record.status=status;res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':csp.replace('__PORT__',String(server.address().port)),'X-Content-Type-Options':'nosniff'}).end(body);};
  let body='';for await(const chunk of req)body+=chunk; // Never log tokens, credentials, or bodies.
  if(path==='/auth/v1/token'&&req.method==='POST') {
   const values=JSON.parse(body||'{}');
   if(url.searchParams.get('grant_type')==='password'&&(values.email!==user.email||values.password!=='local-fixture-example'))return send(400,'application/json','{"error":"fixture_credentials_only"}');
   return send(200,'application/json',JSON.stringify(session));
  }
  if(path==='/auth/v1/user'&&req.method==='GET')return send(200,'application/json',JSON.stringify(user));
  if(path==='/auth/v1/settings'&&req.method==='GET')return send(200,'application/json','{"external":{"email":true}}');
  if(path==='/functions/v1/notification-dispatcher'&&req.method==='GET')return send(200,'application/json','{"enabled":false,"channels":[],"queue":[]}');
  if(path.startsWith('/rest/v1/rpc/')&&req.method==='POST') {
   const name=path.split('/').at(-1);
   if(reads[name])return send(200,'application/json',JSON.stringify(reads[name](JSON.parse(body||'{}'))));
   unsupported.push(name);
   if(!name.startsWith('get_')&&!name.startsWith('has_'))mutations.push(name);
   return send(404,'application/json',JSON.stringify({code:'PGRST202',message:'Unavailable in isolated native capture fixture: '+name}));
  }
  if(path.startsWith('/rest/v1/')&&req.method==='GET') {
   const table=path.split('/').at(-1);
   if(!Object.hasOwn(tables,table)){unsupported.push(table);return send(404,'application/json',JSON.stringify({code:'42P01',message:'Fixture table unavailable: '+table}));}
   const rows=selectRows(tables[table],url.searchParams);
   res.setHeader('Content-Range',`0-${Math.max(0,rows.length-1)}/${rows.length}`);
   return send(200,'application/json',JSON.stringify(req.headers.accept?.includes('object+json')?rows[0]||null:rows));
  }
  if(req.method!=='GET'){mutations.push(path);return send(405,'application/json','{"error":"writes_forbidden"}');}
  if(path.endsWith('/config.js'))return send(200,'application/javascript',`window.MINUTA_CONFIG=Object.freeze({supabaseUrl:location.origin,supabaseKey:'local-fixture-public-placeholder',defaultOrganizationSlug:'local-native-fixture',assistantRemoteUnderstanding:false,assistantCloudSpeechEnabled:false,socialAuthProviders:Object.freeze({telegram:false,vk:false,yandex:false})});`);
  if(path.startsWith('/realtime/'))return send(404,'text/plain','fixture has no realtime');
  const relative=decodeURIComponent(path.replace(/^\/minuta-online-booking\//,''));
  const target=resolve(appRoot,relative);
  if(!target.startsWith(appRoot+sep)||!['.html','.js','.css','.svg','.webp','.png','.woff2','.json'].includes(extname(target)))return send(403,'text/plain','forbidden');
  try{const bytes=readFileSync(target);sourceHashes[relative]=createHash('sha256').update(bytes).digest('hex');return send(200,({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.json':'application/json'})[extname(target)],bytes);}
  catch{return send(404,'text/plain','not found');}
 });
 // Local protocol acknowledgments preserve the SDK's real read subscription state.
 // No row changes, broadcasts or persistence are accepted or produced.
 const realtime=new WebSocketServer({noServer:true});
 server.on('upgrade',(req,socket,head)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path!=='/realtime/v1/websocket'){socket.destroy();return;}
  requests.push({method:'WEBSOCKET',path,status:101});
  realtime.handleUpgrade(req,socket,head,client=>{
   client.on('message',bytes=>{
    let value;try{value=JSON.parse(bytes.toString());}catch{client.close(1003);return;}
    const tuple=Array.isArray(value),event=tuple?value[3]:value.event;
    if(!['phx_join','phx_leave','heartbeat','access_token'].includes(event)){mutations.push('realtime:'+event);client.close(1008);return;}
    if(event==='access_token')return;
    const joinPayload=tuple?value[4]:value.payload;
    const payload={status:'ok',response:event==='phx_join'?{postgres_changes:(joinPayload?.config?.postgres_changes||[]).map((binding,index)=>({...binding,id:index+1}))}: {}};
    client.send(JSON.stringify(tuple?[value[0],value[1],value[2],'phx_reply',payload]:{ref:value.ref,topic:value.topic,event:'phx_reply',payload}));
   });
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,requests,unsupported,mutations,sourceHashes,origin:'http://127.0.0.1:'+server.address().port,credentials:{email:user.email,password:'local-fixture-example'}};
}
