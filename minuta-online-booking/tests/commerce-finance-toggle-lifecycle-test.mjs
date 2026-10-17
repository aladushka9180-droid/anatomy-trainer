import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Real sibling module; DOM, RPC, identity, storage and timers stay synthetic.
const source=readFileSync(new URL('../commerce-management.js',import.meta.url),'utf8');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();await new Promise(setImmediate);await new Promise(setImmediate);};
let unhandled=[];const listener=()=>unhandled.push('SYNTHETIC_HANDLER_REJECTION');process.on('unhandledRejection',listener);
function fixture(){
 const nodes=new Map(),calls=[],notices=[],toggleGates=[];let actor='actor-A',generation=1,allow=true;
 const finance=new Map([['org-A',false],['org-B',false]]);
 function node(selector){
  if(!nodes.has(selector)){
   const events=new Map(),classes=new Set();
   const n={id:selector.slice(1),value:'',textContent:'',hidden:true,disabled:false,checked:false,open:false,required:false,options:[],dataset:{},style:{},
    classList:{toggle(k,v){if(v)classes.add(k);else classes.delete(k);},remove(...ks){ks.forEach(k=>classes.delete(k));},add(...ks){ks.forEach(k=>classes.add(k));}},
    setAttribute(){},removeAttribute(){},focus(){},scrollIntoView(){},closest(){return null;},
    addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},
    querySelector(sel){return node(selector+' '+sel);},querySelectorAll(){return[];},
    reset(){this.value='';},_events:events};
   let html='';Object.defineProperty(n,'innerHTML',{get(){return html;},set(s){html=String(s);n.options=[...html.matchAll(/<option value="([^"]*)"/g)].map(m=>({value:m[1]}));if(n.options.length&&!n.options.some(o=>o.value===n.value))n.value=n.options[0].value;}});
   nodes.set(selector,n);
  }
  return nodes.get(selector);
 }
 const workspace=org=>({organization_id:org,finance_enabled:finance.get(org)===true,clients:[],sellers:[],warehouses:[],accounts:[],benefit_products:[],inventory_items:[],bookings:[],sales:[],audit:[],recurring_expenses:[]});
 const store=new Map();const box=vm.createContext({window:{},document:{body:node('#syntheticBody')},navigator:{onLine:true,clipboard:{writeText(){throw new Error('FORBIDDEN_CLIPBOARD');}}},
  crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
  clearTimeout(){},setTimeout(){return 1;},fetch(){throw new Error('FORBIDDEN_NETWORK');}});
 vm.runInContext(source,box,{filename:'actual-commerce-main-controller',timeout:1000});
 const controller=box.window.MinutaCommerce.createController({$:node,escapeHtml:x=>String(x??''),notify:m=>notices.push(m),
  requireWrites:()=>allow,getCurrentUser:()=>({id:actor}),getSessionGeneration:()=>generation,
  sessionIsCurrent:(id,g)=>id===actor&&g===generation,applyWriteAvailability(){},
  db:{rpc(name,params){
   calls.push({name,params});
   if(name==='get_minuta_commerce_workspace_v151')return Promise.resolve({data:workspace(params.p_organization),error:null});
   if(name==='set_minuta_finance_enabled_v133'){
    const d=defer();toggleGates.push({d,params});return d.promise.then(result=>{if(!result.error)finance.set(params.p_organization,params.p_enabled);return result;});
   }
   throw new Error('UNEXPECTED_RPC_PORT');
  }}});
 controller.bind();
 const toggle=node('#commerceFinanceEnabled');
 function dispatch(checked){toggle.checked=checked;const event={currentTarget:toggle};for(const fn of toggle._events.get('change')||[])fn(event);event.currentTarget=null;return event;}
 return {controller,calls,notices,toggle,toggleGates,node,dispatch,allow:v=>{allow=v;},actor:(id,g)=>{actor=id;generation=g;},
  resolve:(i,error=null)=>toggleGates[i].d.resolve({data:{},error}),workspaceCalls:org=>calls.filter(c=>c.name==='get_minuta_commerce_workspace_v151'&&c.params.p_organization===org).length};
}
const requireCase=(b,code)=>{if(!b)throw new Error(code);};
const cases=[
 ['NATIVE_EVENT_LIFETIME_CURRENT_SUCCESS',async()=>{
  const f=fixture();await f.controller.setOrganization({id:'org-A',current_role:'owner'});f.dispatch(true);f.resolve(0);await settle();
  requireCase(!f.toggle.disabled&&f.toggle.checked&&f.notices.at(-1)==='Единый финансовый учёт включён'&&unhandled.length===0,'SUCCESS_LEAVES_DISABLED_OR_REJECTION');
  requireCase(f.toggleGates[0].params.p_organization==='org-A'&&f.toggleGates[0].params.p_enabled===true,'NORMAL_RPC_CHANGED');
 }],
 ['NATIVE_EVENT_LIFETIME_CURRENT_REFUSAL',async()=>{
  const f=fixture();await f.controller.setOrganization({id:'org-A',current_role:'owner'});f.dispatch(true);f.resolve(0,{message:'finance_disabled'});await settle();
  requireCase(!f.toggle.disabled&&!f.toggle.checked&&f.notices.at(-1)==='Сначала включите единый финансовый учёт.'&&unhandled.length===0,'REFUSAL_CLEANUP_OR_NOTICE_MISSING');
 }],
 ['RETIRED_ORGANIZATION_SUCCESS_NO_NEW_SCOPE_FOLLOWUP',async()=>{
  const f=fixture();await f.controller.setOrganization({id:'org-A',current_role:'owner'});f.dispatch(true);
  await f.controller.setOrganization({id:'org-B',current_role:'owner'});const reads=f.workspaceCalls('org-B');f.resolve(0);await settle();
  requireCase(f.workspaceCalls('org-B')===reads&&f.notices.length===0&&unhandled.length===0,'RETIRED_TOGGLE_LOAD_OR_NOTICE_IN_NEW_SCOPE');
 }],
 ['RETIRED_ERROR_CANNOT_RELEASE_NEW_PENDING',async()=>{
  const f=fixture();await f.controller.setOrganization({id:'org-A',current_role:'owner'});f.dispatch(true);
  await f.controller.setOrganization({id:'org-B',current_role:'owner'});f.dispatch(true);requireCase(f.toggleGates.length===2,'NEW_OWNER_NOT_STARTED');
  f.resolve(0,{message:'finance_disabled'});await settle();const kept=f.toggle.disabled&&f.toggle.checked&&f.notices.length===0&&unhandled.length===0;
  f.resolve(1);await settle();requireCase(kept&&!f.toggle.disabled&&f.notices.length===1&&unhandled.length===0,'OLD_ERROR_OR_FINALLY_CHANGED_NEW_PENDING');
 }],
 ['ORDINARY_WRITE_REFUSAL_BEFORE_AWAIT',async()=>{
  const f=fixture();await f.controller.setOrganization({id:'org-A',current_role:'owner'});f.allow(false);f.dispatch(true);await settle();
  requireCase(f.toggleGates.length===0&&!f.toggle.checked&&!f.toggle.disabled&&f.notices.length===1&&unhandled.length===0,'WRITE_GUARD_CONTROL_CHANGED');
 }],
 ['ORDINARY_BIND_RESET_RELOAD_CONTROL',async()=>{
  const f=fixture();f.controller.bind();requireCase(f.toggle._events.get('change').length===1,'DUPLICATE_BIND');
  await f.controller.setOrganization({id:'org-A',current_role:'owner'});f.controller.reset();await f.controller.setOrganization({id:'org-B',current_role:'owner'});
  requireCase(f.workspaceCalls('org-A')===1&&f.workspaceCalls('org-B')===1&&!f.node('#commerceWorkspace').hidden&&f.toggleGates.length===0,'RESET_RELOAD_CONTROL_CHANGED');
 }]
];

const results=[];
try{
 try{for(const [id,run]of cases){unhandled=[];try{await run();results.push({id,pass:true,handlerRejections:unhandled.length});}catch(e){results.push({id,pass:false,failure:e.message,handlerRejections:unhandled.length});}await settle();}}
 finally{process.removeListener('unhandledRejection',listener);}
 const result={format:'commerce-finance-toggle-lifecycle-noio-v1',results,
  total:results.length,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,
  boundaries:{source:'Whole real commerce module, exported createController, bind and change listener.',
   synthetic:'DOM currentTarget lifetime; RPC/workspace/identity/storage/timers.',
   actualSalesOrFinanceChanges:0,realDbOrNetwork:0,browser:0,private:0}};
 console.log(JSON.stringify(result));
 if(result.failed!==0)process.exitCode=1;
}catch{
 console.error('FIXTURE_OR_TEST_SETUP_FAILURE');
 process.exitCode=2;
}
