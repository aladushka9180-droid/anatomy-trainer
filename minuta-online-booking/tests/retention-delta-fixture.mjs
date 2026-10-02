import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
export function buildRetentionFixture() {
  const source = read('provider.html');
  const marker = source.indexOf('id="retentionPanel" hidden>');
  const start = source.lastIndexOf('<section class="panel organization-section', marker);
  const end = source.indexOf('<section class="panel organization-section', marker + 1);
  if (marker < 0 || start < 0 || end < 0) throw new Error('Actual retention panel missing');
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Возврат клиентов · изолированная проверка</title>
<style>${['styles.css', 'provider-ux.css', 'commerce-soft-ui.css', 'retention-soft-ui.css'].map(read).join('\n')}
body.provider-body{display:block;margin:0;background:#fff6f9;--theme-surface:#fff;--theme-surface-alt:#fdebf3;--theme-accent-soft:#fdebf3;--theme-ink:#302b31;--theme-muted:#756d77;--theme-line:#efdae4;--theme-accent:#b83170;--material-radius:14px;font-family:Arial,sans-serif}.fixture-wrap{max-width:1100px;margin:24px auto;padding:0 20px}.fixture-wrap .organization-section{margin:0}.fixture-note{color:#756d77;font-size:12px;line-height:1.5}.fixture-neighbor{margin:16px 0;padding:14px;border:1px solid #efdae4;border-radius:12px}@media(max-width:540px){.fixture-wrap{margin:16px auto;padding:0 12px}.fixture-wrap .organization-section{padding:16px}}
</style><body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="soft"><main class="fixture-wrap"><h2>Организация</h2><p class="fixture-note">Изолированная проверка. Клиенты и сообщения вымышлены, рабочая база не подключена.</p><aside class="fixture-neighbor">Продажи · Абонементы · Лояльность</aside>${source.slice(start, end)}<aside class="fixture-neighbor">Соседний блок</aside><output id="fixtureNotice" role="status"></output></main>
${['commerce-soft-ui.js', 'retention-management.js'].map(name => `<script>${safeScript(read(name))}</script>`).join('\n')}
<script>
window.fetch=()=>{throw new Error('Outbound network forbidden')};window.XMLHttpRequest=function(){throw new Error('Outbound network forbidden')};
const f=window.retentionFixture={org:'org-a',user:'owner-a',role:'owner',generation:1,calls:[],notices:[],deliveries:[],writeChecks:0,prepareCount:0,copyMode:'success',copied:[],faults:{},settings:{enabled:true,inactivity_days:45,cooldown_days:90,message_template:'Здравствуйте, {имя}! Приглашаем снова в {организация}: {ссылка}'}};
f.clients=[...['a','b','c','d'].map((id,index)=>({client_account_id:id,client_name:['Клиент А','Клиент Б','Клиент В','Клиент Г'][index],client_phone:'+79990000000',last_visit_on:'2026-06-01',completed_visits:2,consent_status:'granted',eligible:true})),{client_account_id:'draft',client_name:'Уже есть текст',client_phone:'+79990000000',last_visit_on:'2026-06-01',completed_visits:3,consent_status:'granted',eligible:true},{client_account_id:'consent',client_name:'Без согласия',last_visit_on:'2026-06-01',completed_visits:1,consent_status:'unknown',eligible:false},{client_account_id:'inactive',client_name:'Недавний визит',last_visit_on:'2026-10-02',completed_visits:1,consent_status:'granted',eligible:false}];
f.deliveries=[{id:'draft-existing',client_account_id:'draft',status:'prepared',prepared_at:'2026-10-02T09:00:00Z',message_snapshot:'Уже подтверждённый текст: https://booking.synthetic.test/existing'}];
f.fullText=id=>'Здравствуйте, клиент '+id+'! Приглашаем снова:\\nhttps://booking.synthetic.test/organization/very-long-public-slug/book?service=synthetic-service&client='+id+'&context=complete-url-must-survive-copy';
const $=selector=>document.querySelector(selector),escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const db={rpc:async(name,args)=>{
 f.calls.push({name,args:structuredClone(args)});
 if(name==='get_minuta_retention_workspace'){
   if(f.faults.read)throw new Error('synthetic_read_failure');
   return {data:{organization_id:args.p_organization,current_role:f.role,...f.settings,clients:structuredClone(f.clients),deliveries:structuredClone(f.deliveries),audit:[]},error:null};
 }
 if(name==='save_minuta_retention_settings'){
   if(f.faults.holdSave)await new Promise(resolve=>f.releaseSave=resolve);
   if(f.faults.save)throw new Error('synthetic_save_failure');
   Object.assign(f.settings,{enabled:args.p_enabled,inactivity_days:args.p_inactivity_days,cooldown_days:args.p_cooldown_days,message_template:args.p_message_template});
   return {data:{organization_id:args.p_organization,enabled:args.p_enabled},error:null};
 }
 if(name==='prepare_minuta_retention_delivery'){
   const count=++f.prepareCount;
   if(f.faults.holdAt===count)await new Promise(resolve=>f.releasePrepare=resolve);
   if(f.faults.failAt===count)throw new Error('synthetic_prepare_failure');
   if(f.deliveries.some(row=>row.client_account_id===args.p_client_account&&row.status==='prepared'))return {error:{message:'retention_already_prepared'}};
   const row={id:'prepared-'+args.p_client_account,client_account_id:args.p_client_account,status:'prepared',message_snapshot:f.fullText(args.p_client_account),prepared_at:'2026-10-02T10:00:00Z'};
   f.deliveries.push(row);
   if(f.faults.unknownAt===count)return {data:{organization_id:args.p_organization},error:null};
   return {data:{organization_id:args.p_organization,id:row.id,status:'prepared',message:row.message_snapshot,client_phone:'+79990000000'},error:null};
 }
 if(name==='set_minuta_marketing_consent'){
   f.clients.find(row=>row.client_account_id===args.p_client_account).consent_status=args.p_status;
   return {data:{organization_id:args.p_organization,client_account_id:args.p_client_account,status:args.p_status},error:null};
 }
 if(name==='finish_minuta_retention_delivery'){
   f.deliveries.find(row=>row.id===args.p_delivery).status=args.p_action;
   return {data:{organization_id:args.p_organization,id:args.p_delivery,status:args.p_action},error:null};
 }
 throw new Error('Unexpected synthetic RPC: '+name);
}};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{f.copied.push(text);if(f.copyMode==='hold')await new Promise((resolve,reject)=>{f.releaseCopy=resolve;f.rejectCopy=reject});if(f.copyMode==='error')throw new Error('synthetic_clipboard_denied')}}});
const options={db,$,escapeHtml,notify:text=>{f.notices.push(text);$('#fixtureNotice').textContent=text},requireWrites:()=>{f.writeChecks++;f.beforeWrite?.(f.writeChecks);return f.writesAllowed!==false},getCurrentUser:()=>f.user?{id:f.user}:null,getSessionGeneration:()=>f.generation,sessionIsCurrent:(user,generation)=>user===f.user&&generation===f.generation,applyWriteAvailability(){},requestConfirmation:()=>Promise.resolve(false)};
window.retentionController=window.MinutaRetention.createController(options);retentionController.bind();
window.retentionReady=retentionController.setOrganization({id:f.org,name:'Организация примера',current_role:f.role});
document.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault()});
</script></body></html>`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] || 'outputs/retention-next', 'fixture.html');
  mkdirSync(resolve(output, '..'), { recursive:true });
  writeFileSync(output, buildRetentionFixture());
  console.log(output);
}
