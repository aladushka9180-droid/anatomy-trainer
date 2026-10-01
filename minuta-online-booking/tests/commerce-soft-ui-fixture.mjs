// Build a local, network-free page from the actual panels and controllers.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
const source = read('provider.html');
const panels = ['commercePanel','benefitsPanel','retentionPanel'].map(id => {
  const marker = source.indexOf(`id="${id}" hidden>`);
  if (marker < 0) throw new Error(`Missing panel ${id}`);
  const start = source.lastIndexOf('<section class="panel organization-section', marker);
  const end = source.indexOf('<section class="panel organization-section', marker + 1);
  return source.slice(start, end).trim();
}).join('\n');
const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
const scripts = ['commerce-soft-ui.js','commerce-management.js','benefit-management.js','retention-management.js'];
const fixture = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка трёх разделов · изолированные данные</title>
<style>${read('styles.css')}\n${read('provider-ux.css')}\n${read('commerce-soft-ui.css')}
body.provider-body {display:block;margin:0;background:#fff6f9;--theme-surface:#fff;--theme-surface-alt:#fdebf3;--theme-accent-soft:#fdebf3;--theme-ink:#302b31;--theme-muted:#756d77;--theme-line:#efdae4;--theme-accent:#b83170;--material-radius:14px;font-family:Arial,sans-serif}
.fixture-wrap{max-width:1100px;margin:24px auto;padding:0 20px}.fixture-tabs{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.fixture-tabs button{min-height:44px;padding:8px 16px}.fixture-note{font-size:12px;color:#756d77;line-height:1.5}.fixture-wrap .organization-section{margin:0}.fixture-wrap .organization-section[hidden]{display:none}
@media(max-width:540px){.fixture-wrap{margin:16px auto;padding:0 12px}.fixture-wrap .organization-section{padding:16px}}
</style><body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="soft"><main class="fixture-wrap"><h2>Организация</h2><p class="fixture-note">Локальная проверка. Все позиции и клиенты вымышлены. Рабочая база не подключена.</p><nav class="fixture-tabs"><button type="button" data-fixture-view="commercePanel">Продажи</button><button type="button" data-fixture-view="benefitsPanel">Абонементы</button><button type="button" data-fixture-view="retentionPanel">Возврат клиентов</button><button type="button" id="fixtureEmpty">Пустые разделы</button><button type="button" id="fixtureRole">Роль: владелец</button><button type="button" id="fixtureTheme">Тёмная тема</button></nav>${panels}<p id="fixtureNotice" role="status"></p><output id="fixtureCalls" class="fixture-note">Запросы: 0</output></main>
${scripts.map(name => {
  let script = read(name).replace(/\r\n/g, '\n');
  if (name === 'commerce-soft-ui.js') script = script.replace("quantity.closest('label')?.setAttribute('for', quantity.id);\n    quantity.setAttribute('aria-label', 'Количество');", "if (!new URLSearchParams(location.search).has('quantity-baseline')) { quantity.closest('label')?.setAttribute('for', quantity.id); quantity.setAttribute('aria-label', 'Количество'); }");
  return `<script>${safeScript(script)}</script>`;
}).join('\n')}
<script>
window.fetch=()=>{throw new Error('Network forbidden in isolated UI fixture')};
window.XMLHttpRequest=function(){throw new Error('Network forbidden in isolated UI fixture')};
const $=selector=>document.querySelector(selector), id='11111111-1111-4111-8111-111111111111', owner='22222222-2222-4222-8222-222222222222', client='33333333-3333-4333-8333-333333333333', product='44444444-4444-4444-8444-444444444444', account='55555555-5555-4555-8555-555555555555';
let empty=false,role='owner',calls=[],current='commercePanel';
const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const goods=[{id:product,name:'Массажное масло',unit:'piece',sku:'OIL-250'},{id:'66666666-6666-4666-8666-666666666666',name:'Перчатки нитриловые',unit:'pack',sku:'GLOVE-M'},{id:'77777777-7777-4777-8777-777777777777',name:'Одноразовые простыни',unit:'piece',sku:'SHEET'},{id:'88888888-8888-4888-8888-888888888888',name:'Антисептик',unit:'ml',sku:'SPRAY'}];
const benefit={id:product,name:'5 посещений',kind:'visit_pass',active:true,visits_count:5,sale_price_rub:11000,sale_price_minor:1100000,validity_days:90,service_ids:[]};
const retention={organization_id:id,current_role:role,enabled:true,inactivity_days:45,cooldown_days:90,message_template:'Здравствуйте, {имя}! Давно вас не было в {организация}. Будем рады видеть снова: {ссылка}',clients:[],deliveries:[],audit:[]};
const db={rpc:async(name,args)=>{
 calls.push(name);$('#fixtureCalls').textContent='Запросы: '+calls.length+' · '+name;
 if(name==='get_minuta_commerce_workspace_v151')return {data:{organization_id:id,finance_enabled:true,benefits_enabled:true,inventory_enabled:true,inventory_items:empty?[]:goods,benefit_products:empty?[]:[benefit],warehouses:empty?[]:[{id:product,name:'Основной склад'}],accounts:empty?[]:[{id:account,name:'Основная касса',account_type:'cash',system_key:null}],sellers:[{id:owner,name:'Владелец',role:'owner'}],clients:[{id:client,name:'Клиент примера'}],bookings:[],sales:empty?[]:[{id:product,status:'paid',occurred_at:'2026-10-01T10:00:00Z',total_minor:120000,refunded_minor:0,line:{item_name:'Массажное масло',quantity:2,unit_price_minor:60000,refunded_quantity:0},client_name:'Клиент примера',seller_name:'Владелец'}],audit:[],recurring_expenses:[]},error:null};
 if(name==='get_minuta_benefit_workspace')return {data:{organization_id:id,current_role:role,enabled:!empty,services:[],clients:[{client_account_id:client,client_name:'Клиент примера',client_phone:''}],bookings:[],products:empty?[]:[benefit,{...benefit,id:account,name:'Подарочный сертификат',kind:'certificate',face_value_rub:5000,sale_price_rub:5000}],instruments:empty?[]:[{id:product,product_id:product,client_account_id:client,product_snapshot:benefit,remaining_visits:3,remaining_amount_rub:0,public_code:'MIN-DEMO',expires_on:'2027-10-01',status:'active'}],redemptions:empty?[]:[{id:account,instrument_id:product,booking_id:product,status:'reserved',units:1}],audit:[]},error:null};
 if(name==='get_minuta_retention_workspace')return {data:{...retention,current_role:role,clients:empty?[]:[{client_account_id:client,client_name:'Клиент примера',client_phone:'',last_visit_on:'2026-07-01',eligible:true,consent_status:'granted',completed_visits:5}],deliveries:empty?[]:[{id:product,client_account_id:client,status:'prepared',prepared_at:'2026-10-01T10:00:00Z',message_snapshot:'Здравствуйте! Приглашаем выбрать время.'}]},error:null};
 if(name==='save_minuta_retention_settings'){Object.assign(retention,{enabled:args.p_enabled,inactivity_days:args.p_inactivity_days,cooldown_days:args.p_cooldown_days,message_template:args.p_message_template});return {data:{organization_id:id,enabled:args.p_enabled},error:null};}
 return {data:null,error:{message:'fixture_write_disabled'}};
}};
const options={db,$,escapeHtml,notify:text=>$('#fixtureNotice').textContent=text,requireWrites:()=>true,getCurrentUser:()=>({id:owner}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true,applyWriteAvailability(){},requestConfirmation:()=>Promise.resolve(false)};
const controllers={commercePanel:window.MinutaCommerce.createController(options),benefitsPanel:window.MinutaBenefits.createController(options),retentionPanel:window.MinutaRetention.createController(options)};
Object.values(controllers).forEach(instance=>instance.bind());
async function show(panel){current=panel;for(const key of Object.keys(controllers))$('#'+key).hidden=key!==panel;await controllers[panel].setOrganization({id,name:'Организация примера',current_role:role});if(panel==='commercePanel'){ $('#commerceSaleCreator').open=true;if(!empty){$('#commerceUnitPrice').value='600';$('#commerceUnitPrice').dispatchEvent(new Event('input',{bubbles:true}));} }document.querySelectorAll('.organization-section').forEach(node=>node.hidden=node.id!==panel);}
document.querySelectorAll('[data-fixture-view]').forEach(control=>control.addEventListener('click',()=>show(control.dataset.fixtureView)));
$('#fixtureEmpty').addEventListener('click',async()=>{empty=!empty;$('#fixtureEmpty').textContent=empty?'Заполненные разделы':'Пустые разделы';Object.values(controllers).forEach(instance=>instance.reset());await show(current)});
$('#fixtureRole').addEventListener('click',async()=>{role=role==='owner'?'admin':'owner';$('#fixtureRole').textContent=role==='owner'?'Роль: владелец':'Роль: администратор';Object.values(controllers).forEach(instance=>instance.reset());await show(current)});
$('#fixtureTheme').addEventListener('click',()=>{const dark=document.body.dataset.providerTheme!=='noir';document.body.dataset.providerTheme=dark?'noir':'pink-porcelain';const colours=dark?{'--theme-surface':'#202220','--theme-surface-alt':'#262924','--theme-accent-soft':'#323c32','--theme-ink':'#ededeb','--theme-muted':'#b0b6ad','--theme-line':'#454b42','--theme-accent':'#cba782'}:{'--theme-surface':'#fff','--theme-surface-alt':'#fdebf3','--theme-accent-soft':'#fdebf3','--theme-ink':'#302b31','--theme-muted':'#756d77','--theme-line':'#efdae4','--theme-accent':'#b83170'};for(const [key,value] of Object.entries(colours))document.body.style.setProperty(key,value);document.body.style.background=dark?'#151715':'#fff6f9';$('#fixtureTheme').textContent=dark?'Светлая тема':'Тёмная тема'});
document.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault()});
show(new URLSearchParams(location.search).get('panel')||'commercePanel').catch(error=>{document.querySelector('#fixtureNotice').textContent='Fixture error: '+error.message;throw error});
</script></body></html>`;
const output = resolve(process.argv[2] || resolve(root,'../outputs/commerce-soft-ui'), 'fixture.html');
mkdirSync(resolve(output,'..'), {recursive:true});
writeFileSync(output, fixture);
// Existing summary/scan icons must match the real panels during visual review.
writeFileSync(resolve(output, '..', 'ui-icons.svg'), read('ui-icons.svg'));
console.log(output);
