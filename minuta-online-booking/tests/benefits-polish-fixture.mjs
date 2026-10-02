// Actual panel/controllers/styles, with only synthetic in-memory RPC data.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(process.argv[2]||resolve(root,'../outputs/benefits-polish/current'));
mkdirSync(out,{recursive:true});
execFileSync(process.execPath,[resolve(root,'tests/commerce-soft-ui-fixture.mjs'),out]);
const provider=readFileSync(resolve(root,'provider.html'),'utf8').replace(/<template\b[^>]*>[\s\S]*?<\/template>/g,'');
let css=[...provider.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(([tag])=>{
  const name=tag.match(/href="([^"?]+)/)?.[1];
  if(!name||/^(?:https?:|\/)/.test(name))throw new Error('Unexpected stylesheet '+name);
  if(name==='benefits-soft-polish.css')return '';
  const text=readFileSync(resolve(root,name),'utf8');
  const media=tag.match(/media="([^"]+)/)?.[1];
  return media?`@media ${media}{${text}}`:text;
}).join('\n');
if(process.argv.includes('--polish'))css+='\n'+readFileSync(resolve(root,'benefits-soft-polish.css'),'utf8');
let page=readFileSync(resolve(out,'fixture.html'),'utf8');
if(process.argv.includes('--baseline')) {
  const safe=text=>text.replace(/\r\n/g,'\n').replace(/<\/script/gi,'<\\/script');
  const current=safe(readFileSync(resolve(root,'benefit-management.js'),'utf8'));
  const baselineRef=process.argv.find(arg=>arg.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length);
  if(!baselineRef)throw new Error('--baseline requires --baseline-ref=<git-ref>');
  const original=safe(execFileSync('git',['show',`${baselineRef}:minuta-online-booking/benefit-management.js`],{cwd:root,encoding:'utf8'}));
  if(!page.includes(current))throw new Error('Missing controller baseline boundary');
  page=page.replace(current,original);
}
const start=page.indexOf('<style>')+7,end=page.indexOf('body.provider-body {',start);
if(start<7||end<start)throw new Error('Missing fixture style boundary');
page=page.slice(0,start)+css+'\n'+page.slice(end);
page=page.replace("client_account_id:client,client_name:'Клиент примера',client_phone:''","id:client,client_account_id:client,client_name:'Анна · пример',client_phone:''");
page=page.replace("const retention=",`const gift={...benefit,id:account,name:'Подарочный сертификат',kind:'certificate',face_value_rub:5000,sale_price_rub:5000};
const longBenefit={...benefit,id:'77777777-7777-4777-8777-777777777777',name:'Курс восстановительного массажа и ухода за телом',visits_count:12};
const retention=`);
page=page.replace("products:empty?[]:[benefit,{...benefit,id:account,name:'Подарочный сертификат',kind:'certificate',face_value_rub:5000,sale_price_rub:5000}]","products:empty?[]:[benefit,gift,longBenefit]");
page=page.replace("bookings:[],products:empty?[]:[benefit,gift,longBenefit]",`bookings:[{id:product,client_account_id:client,client_name:'Анна · пример',service_name:'Массаж спины',status:'completed',booking_date:'2026-10-01'}],products:empty?[]:[benefit,gift,longBenefit]`);
page=page.replace("instruments:empty?[]:[{id:product,product_id:product,client_account_id:client,product_snapshot:benefit,remaining_visits:3,remaining_amount_rub:0,public_code:'MIN-DEMO',expires_on:'2027-10-01',status:'active'}]",`instruments:empty?[]:[
{id:product,product_id:product,client_account_id:client,product_snapshot:benefit,remaining_visits:3,remaining_amount_rub:0,public_code:'MIN-DEMO',expires_on:'2027-10-01',status:'active'},
{id:account,product_id:account,client_account_id:client,product_snapshot:gift,remaining_visits:0,remaining_amount_rub:2000,public_code:'MIN-GIFT',expires_on:'2027-10-01',status:'active'},
{id:'66666666-6666-4666-8666-666666666666',product_id:longBenefit.id,client_account_id:client,product_snapshot:longBenefit,remaining_visits:8,remaining_amount_rub:0,public_code:'MIN-FROZEN',expires_on:'2027-10-01',status:'frozen'},
{id:'99999999-9999-4999-8999-999999999999',product_id:product,client_account_id:client,product_snapshot:benefit,remaining_visits:2,remaining_amount_rub:0,public_code:'MIN-EXPIRED',expires_on:'2026-01-01',status:'active'}]`);
page=page.replace("redemptions:empty?[]:[{id:account,instrument_id:product,booking_id:product,status:'reserved',units:1}]",`redemptions:empty?[]:[
{id:account,instrument_id:product,booking_id:product,status:'reserved',units:1},
{id:'88888888-8888-4888-8888-888888888888',instrument_id:account,booking_id:product,status:'redeemed',amount_rub:1000},
{id:'99999999-9999-4999-8999-999999999999',instrument_id:product,booking_id:product,status:'released',units:1}]`);
page=page.replace(/\$\('#fixtureTheme'\)\.addEventListener\('click',[^\n]+/,
  `$('#fixtureTheme').addEventListener('click',()=>{const dark=document.body.dataset.providerTheme!=='noir-safari';document.body.dataset.providerTheme=dark?'noir-safari':'pink-porcelain';$('#fixtureTheme').textContent=dark?'Светлая тема':'Тёмная тема'});`);
if(process.argv.includes('--preview')) {
  page=page.replace(/<h2>Организация<\/h2>[\s\S]*?<\/nav>/,
    `<header class="benefits-preview-head"><div><small>PrimeTime Pro · вариант оформления</small><h1>Абонементы</h1></div><p>Демонстрация на вымышленных данных</p></header><nav class="fixture-tabs"><button type="button" id="fixtureEmpty">Пустой пример</button><button type="button" id="fixtureRole">Роль: владелец</button><button type="button" id="fixtureTheme">Тёмная тема</button></nav>`);
  page=page.replace("show(new URLSearchParams(location.search).get('panel')||'commercePanel')","show('benefitsPanel')");
  page=page.replace('</style>',`.benefits-preview-head{display:flex;align-items:center;justify-content:space-between;gap:20px}.benefits-preview-head h1{margin:6px 0 0;font-size:28px;letter-spacing:-.6px}.benefits-preview-head :is(small,p){color:var(--theme-muted);font-size:12px}.fixture-tabs button{font:inherit;font-size:13px;border:1px solid var(--theme-line);border-radius:10px;background:var(--theme-surface);color:var(--theme-ink)}#fixtureCalls{display:none}@media(max-width:540px){.benefits-preview-head{display:block}.fixture-tabs{gap:8px}}\n</style>`);
}
if(process.argv.includes('--connection')) {
  page=page.replace('const db={rpc:', `let connectionLinked=false;
const connectionRow={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',organization_id:id,client_account_id:null,client_name:'ТЕСТ — подключение клиента',client_phone:'+70000000000',booking_date:'2026-09-22',booking_time:'12:00:00',status:'confirmed',payment_status:'not_required'};
const db={from:name=>{if(name!=='bookings')throw Error('Unexpected fixture table');const filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},is:()=>q,neq:()=>q,or:()=>q,order:()=>q,limit:async()=>({data:connectionLinked?[]:[connectionRow],error:null}),maybeSingle:async()=>({data:{...connectionRow,client_account_id:connectionLinked?client:null},error:null})};return q;},rpc:`);
  page=page.replace(/if\(name==='get_minuta_benefit_workspace'\)return \{data:\{[\s\S]+?\},error:null\};/,
    `if(name==='issue_client_identity_claim_grant_v155'){connectionLinked=true;return {data:[{claim_token:'SECRET-FIXTURE-DO-NOT-DISPLAY'}],error:null};}
if(name==='get_minuta_benefit_workspace')return {data:{organization_id:id,current_role:role,enabled:!empty,services:[],clients:connectionLinked?[{id:client,client_name:connectionRow.client_name,client_phone:connectionRow.client_phone}]:[],bookings:[],products:[benefit,gift],instruments:[],redemptions:[],audit:[]},error:null};`);
  page=page.replace('<script>\nwindow.fetch=',`<script>${readFileSync(resolve(root,'provider-selects.js'),'utf8').replace(/<\/script/gi,'<\\/script')}</script><script>\nwindow.fetch=`);
}
writeFileSync(resolve(out,'fixture.html'),page);
console.log(resolve(out,'fixture.html'));
