import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.MINUTA_JSDOM_PACKAGE || import.meta.url);
const { JSDOM } = require('jsdom');
const html = readFileSync(join(root, 'provider.html'), 'utf8');
const source = readFileSync(join(root, 'resource-management.js'), 'utf8');
const selects = readFileSync(join(root, 'provider-selects.js'), 'utf8');
const marker = html.indexOf('id="resourcesPanel" hidden>');
const start = html.lastIndexOf('<section class="panel organization-section', marker);
const end = html.indexOf('<section class="panel organization-section', marker + 1);
assert.ok(marker > 0 && start > 0 && end > start);
const clone = value => JSON.parse(JSON.stringify(value));
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function seed() {
  return { organization_id:'org', can_manage:true,
    locations:[{id:'loc-1',name:'Первый',active:true},{id:'loc-2',name:'Второй',active:true}],
    groups:[{id:'grp-1',name:'Кабинеты',kind:'room',description:'',active:true},{id:'grp-2',name:'Столы',kind:'table',description:'',active:true}],
    resources:[{id:'res-1',name:'Кабинет 1',location_id:'loc-1',group_id:'grp-1',location_name:'Первый',group_name:'Кабинеты',kind:'room',active:true},{id:'res-2',name:'Стол 2',location_id:'loc-2',group_id:'grp-2',location_name:'Второй',group_name:'Столы',kind:'table',active:true}],
    services:[{id:'svc-1',name:'Массаж',performer_name:'Тест'},{id:'svc-2',name:'Процедура',performer_name:'Тест'}],
    requirements:[{service_id:'svc-1',group_id:'grp-1',quantity:1,active:true}], audit:[] };
}
async function harness(initial = seed()) {
  const dom = new JSDOM(`<!doctype html><body>${html.slice(start,end)}</body>`, {url:'https://isolated-fixture.invalid/',runScripts:'outside-only'});
  const {window} = dom; const {document} = window;
  const $ = selector => document.querySelector(selector);
  const listeners = {};
  const originalAdd = document.addEventListener.bind(document);
  document.addEventListener = (type, handler, options) => { (listeners[type] ||= []).push(handler); originalAdd(type,handler,options); };
  const deny = () => { throw new Error('Network forbidden in resource regression'); };
  window.fetch = deny; window.XMLHttpRequest = deny; window.WebSocket = deny;
  window.eval(source);
  let state=clone(initial), readFailure=null, writeFailure=null, thrownWrite=null, loseResponse=false, holdWrite=null, readHook=null;
  const calls=[],notices=[];
  const rpc=async(name,args)=>{
    calls.push({name,args:clone(args)});
    if(name==='get_minuta_resource_workspace') {
      if(readHook){const result=readHook(args);if(result!==undefined)return result;}
      if(readFailure instanceof Error)throw readFailure;
      return readFailure?{data:null,error:readFailure}:{data:clone(state),error:null};
    }
    if(thrownWrite)throw thrownWrite;
    if(writeFailure)return{data:null,error:writeFailure};
    if(name==='create_minuta_resource_group')state.groups.push({id:`new-${state.groups.length}`,name:args.p_name,kind:args.p_kind,description:args.p_description,active:true});
    else if(name==='create_minuta_resource')state.resources.push({id:`new-resource-${state.resources.length}`,name:args.p_name,location_id:args.p_location,group_id:args.p_group,active:true});
    else if(name==='update_minuta_resource')Object.assign(state.resources.find(r=>r.id===args.p_resource),{name:args.p_name,location_id:args.p_location,group_id:args.p_group,active:args.p_active});
    else if(name==='update_minuta_resource_group')Object.assign(state.groups.find(r=>r.id===args.p_group),{name:args.p_name,kind:args.p_kind,description:args.p_description,active:args.p_active});
    else if(name==='replace_minuta_service_resource_requirements')state.requirements=state.requirements.filter(r=>r.service_id!==args.p_service).concat(args.p_requirements.map(r=>({...r,service_id:args.p_service,active:true})));
    else throw new Error(`Unexpected RPC ${name}`);
    if(holdWrite)await holdWrite.promise;
    return loseResponse?{data:null,error:{message:'Failed to fetch after unknown write outcome'}}:{data:clone(state),error:null};
  };
  const controller=window.MinutaResources.createController({db:{rpc},$,escapeHtml,notify:m=>notices.push(m),requireWrites:()=>state.can_manage,getCurrentUser:()=>({id:'fixture-owner'}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true,applyWriteAvailability(){}});
  controller.bind();await controller.setOrganization({id:state.organization_id});
  const submit=form=>{assert.ok(form.checkValidity(),'fixture submission must satisfy native form validity');return listeners.submit[0]({target:form,submitter:form.querySelector('button[type=submit]'),preventDefault(){}});};
  const click=selector=>listeners.click[0]({target:$(selector),preventDefault(){}});
  const input=value=>{$('#resourceListSearch').value=value;return listeners.input[0]({target:$('#resourceListSearch')});};
  const change=(selector,value)=>{$(selector).value=value;return listeners.change[0]({target:$(selector)});};
  return {window,document,$,controller,submit,click,input,change,calls,notices,card:id=>$(`[data-resource-card="${id}"]`),state:()=>clone(state),setState:value=>{state=clone(value);},readError:value=>{readFailure=value;},writeError:value=>{writeFailure=value;},throwWrite:value=>{thrownWrite=value;},loseReply:()=>{loseResponse=true;},hold:()=>{holdWrite=pending();return holdWrite;},readHook:value=>{readHook=value;},writes:()=>calls.filter(c=>c.name!=='get_minuta_resource_workspace'),close:()=>window.close()};
}
let passed=0;
async function check(title,run,initial){const h=await harness(initial);try{await run(h);passed++;}catch(error){throw new Error(title,{cause:error});}finally{h.close();}}
await check('rejected read completes loading and can retry',async h=>{
 h.readError(new TypeError('synthetic read rejected'));await h.controller.load();assert.equal(h.controller.availability,'error');assert.equal(h.$('#resourcesLoading').hidden,true);h.readError(null);await h.controller.load();assert.equal(h.controller.availability,'ready');
});
await check('ACL error is not missing RPC',async h=>{
 h.readError({code:'42501',message:'permission denied for function get_minuta_resource_workspace'});await h.controller.load();assert.equal(h.controller.availability,'error');assert.equal(h.$('#resourcesPanel').hidden,false);
});
await check('existing requirements accessible at zero active resources',async h=>{assert.equal(h.$('#resourceRequirementsPanel').hidden,false);assert.equal(h.$('#resourceRequirementsDisclosure').hidden,false);},({...seed(),resources:seed().resources.map(r=>({...r,active:false}))}));
await check('neighbor save preserves creator scope',async h=>{
 h.$('#resourceCreator').open=true;h.$('#resourceName').value='Несохранённый ресурс';h.$('#resourceLocation').value='loc-2';h.$('#resourceGroup').value='grp-2';h.card('res-1').querySelector('input[name=name]').value='Сохранено';await h.submit(h.card('res-1').querySelector('form'));assert.equal(h.$('#resourceLocation').value,'loc-2');assert.equal(h.$('#resourceGroup').value,'grp-2');assert.equal(h.$('#resourceName').value,'Несохранённый ресурс');
});
await check('restored creator values update the custom select labels',async h=>{
 h.document.body.classList.add('provider-body');h.window.eval(selects);h.document.dispatchEvent(new h.window.Event('DOMContentLoaded'));h.$('#resourceName').value='Черновик';h.$('#resourceLocation').value='loc-2';h.$('#resourceGroup').value='grp-2';await h.submit(h.card('res-1').querySelector('form'));await Promise.resolve();assert.equal(h.$('#resourceLocation').nextElementSibling.querySelector('.pro-select-value').textContent,'Второй');assert.match(h.$('#resourceGroup').nextElementSibling.querySelector('.pro-select-value').textContent,/Столы/);
});
await check('neighbor save preserves group and resource drafts',async h=>{
 const group=h.$('[data-resource-group-card="grp-1"]');group.open=true;group.querySelector('input[name=name]').value='Черновик группы';h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Черновик ресурса';h.card('res-2').querySelector('input[name=name]').value='Записано';await h.submit(h.card('res-2').querySelector('form'));assert.equal(h.$('[data-resource-group-card="grp-1"] input[name=name]').value,'Черновик группы');assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Черновик ресурса');
});
await check('rejected save retains input and actionable explanation',async h=>{
 h.writeError({code:'P0001',message:'resource_scope_is_immutable_after_use'});h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Не терять';await h.submit(h.card('res-1').querySelector('form'));assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Не терять');assert.match(h.card('res-1').querySelector('.form-error').textContent,/после использования/);
});
await check('search and location filter retain temporarily hidden draft',async h=>{
 h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Скрытый черновик';h.input('Стол');h.input('');assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Скрытый черновик');h.change('#resourceListLocation','loc-2');h.change('#resourceListLocation','');assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Скрытый черновик');
});
await check('cancel removes a cached hidden draft',async h=>{
 h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Отменить';h.input('Стол');h.input('');await h.click('[data-resource-card="res-1"] [data-resource-cancel]');h.input('Стол');h.input('');assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Кабинет 1');assert.equal(h.writes().length,0);
});
await check('context switch clears resource and creator drafts',async h=>{
 h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Старый контекст';h.$('#resourceName').value='Старое создание';h.setState({...seed(),organization_id:'next'});await h.controller.setOrganization({id:'next'});assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Кабинет 1');assert.equal(h.$('#resourceName').value,'');
});
await check('refreshing the same context retains drafts and filters',async h=>{
 h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Черновик при перечитывании';h.$('#resourceName').value='Новый ресурс';h.$('#resourceLocation').value='loc-2';h.input('Кабинет');await h.controller.setOrganization({id:'org'});assert.equal(h.$('#resourceListSearch').value,'Кабинет');assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Черновик при перечитывании');assert.equal(h.$('#resourceName').value,'Новый ресурс');assert.equal(h.$('#resourceLocation').value,'loc-2');
});
await check('lost update reply reconciles confirmed state',async h=>{
 h.loseReply();h.card('res-1').querySelector('input[name=name]').value='Подтверждено';await h.submit(h.card('res-1').querySelector('form'));assert.equal(h.state().resources[0].name,'Подтверждено');assert.ok(h.notices.some(m=>/подтверждено/i.test(m)));assert.equal(h.writes().length,1);
});
await check('lost create reply reconciles one new group',async h=>{
 h.loseReply();h.$('#resourceGroupName').value='Созданная группа';await h.submit(h.$('#resourceGroupForm'));assert.equal(h.state().groups.filter(g=>g.name==='Созданная группа').length,1);assert.equal(h.$('#resourceGroupName').value,'');assert.ok(h.notices.some(m=>/подтверждено/i.test(m)));assert.equal(h.writes().length,1);
});
await check('unconfirmed transport failure retains draft without auto retry',async h=>{
 h.writeError({message:'Failed to fetch'});h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Результат неизвестен';await h.submit(h.card('res-1').querySelector('form'));assert.match(h.card('res-1').querySelector('.form-error').textContent,/Не удалось подтвердить/);assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Результат неизвестен');assert.equal(h.writes().length,1);assert.equal(h.notices.length,0);
});
await check('explicit server rejection is not reconciled as success',async h=>{
 h.writeError({code:'23505',message:'duplicate key value'});h.$('#resourceGroupName').value='Кабинеты';await h.submit(h.$('#resourceGroupForm'));assert.match(h.$('#resourceGroupError').textContent,/уже используется/);assert.equal(h.notices.length,0);
});
await check('unknown completion code remains uncertain',async h=>{
 h.writeError({code:'40003',message:'statement completion unknown'});h.card('res-1').querySelector('input[name=name]').value='Неизвестный результат';await h.submit(h.card('res-1').querySelector('form'));assert.match(h.card('res-1').querySelector('.form-error').textContent,/Не удалось подтвердить/);assert.equal(h.notices.length,0);
});
await check('structured rejection retains its SQL code when thrown',async h=>{
 h.throwWrite({code:'42501',message:'resource_management_denied'});await h.submit(h.card('res-1').querySelector('form'));assert.match(h.card('res-1').querySelector('.form-error').textContent,/Изменение не сохранено/);assert.equal(h.notices.length,0);
});
await check('typing during an update remains a new unsaved draft',async h=>{
 const held=h.hold();h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Отправлено';const save=h.submit(h.card('res-1').querySelector('form'));h.card('res-1').querySelector('input[name=name]').value='Введено позже';held.resolve();await save;assert.equal(h.state().resources[0].name,'Отправлено');assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Введено позже');assert.equal(h.card('res-1').open,true);
});
await check('typing during create preserves the next draft and scope',async h=>{
 const held=h.hold();h.$('#resourceCreator').open=true;h.$('#resourceName').value='Первый объект';const save=h.submit(h.$('#resourceForm'));h.$('#resourceName').value='Следующий объект';h.$('#resourceLocation').value='loc-2';h.$('#resourceGroup').value='grp-2';held.resolve();await save;assert.equal(h.state().resources.at(-1).name,'Первый объект');assert.equal(h.$('#resourceName').value,'Следующий объект');assert.equal(h.$('#resourceLocation').value,'loc-2');assert.equal(h.$('#resourceCreator').open,true);
});
await check('neighbor save preserves unsaved requirement quantities',async h=>{
 h.$('[data-requirement-group="grp-1"]').value='2';h.card('res-2').querySelector('input[name=name]').value='Новое имя';await h.submit(h.card('res-2').querySelector('form'));assert.equal(h.$('[data-requirement-group="grp-1"]').value,'2');assert.equal(h.state().requirements[0].quantity,1);
});
await check('successful save closes its editor and shows authoritative value',async h=>{
 h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Новое сохранённое имя';await h.submit(h.card('res-1').querySelector('form'));assert.equal(h.card('res-1').open,false);assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Новое сохранённое имя');
});
await check('cancel returns focus and requests center visibility',async h=>{
 const target=h.$('#resourceMainAction');const scrolls=[];target.scrollIntoView=options=>scrolls.push(options);h.$('#resourceCreator').open=true;h.$('#resourceName').value='Отмена';await h.click('#resourceCreator [data-resource-cancel]');assert.equal(h.document.activeElement,target);assert.equal(scrolls.length,1);assert.equal(scrolls[0].block,'center');assert.equal(h.$('#resourceName').value,'');
});
await check('Escape also returns focus and requests center visibility',async h=>{
 const target=h.$('#resourceMainAction');const scrolls=[];target.scrollIntoView=options=>scrolls.push(options);h.$('#resourceGroupCreator').open=true;const field=h.$('#resourceGroupName');field.value='Черновик';field.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.$('#resourceGroupCreator').open,false);assert.equal(h.document.activeElement,target);assert.equal(scrolls[0].block,'center');assert.equal(field.value,'');
});
await check('another service draft survives the preceding service save',async h=>{
 const held=h.hold();h.$('[data-requirement-group="grp-1"]').value='2';const save=h.submit(h.$('#resourceRequirementForm'));h.change('#resourceRequirementService','svc-2');h.$('[data-requirement-group="grp-1"]').value='3';held.resolve();await save;assert.equal(h.$('#resourceRequirementService').value,'svc-2');assert.equal(h.$('[data-requirement-group="grp-1"]').value,'3');assert.equal(h.state().requirements.find(r=>r.service_id==='svc-1').quantity,2);
});
await check('filtering during save does not discard subsequent typing',async h=>{
 const held=h.hold();h.card('res-1').open=true;h.card('res-1').querySelector('input[name=name]').value='Отправленная версия';const save=h.submit(h.card('res-1').querySelector('form'));h.input('Стол');h.input('');h.card('res-1').querySelector('input[name=name]').value='Новейший черновик';held.resolve();await save;assert.equal(h.card('res-1').querySelector('input[name=name]').value,'Новейший черновик');assert.equal(h.state().resources[0].name,'Отправленная версия');
});
await check('reconciliation cannot report into a different organization',async h=>{
 h.writeError({message:'Failed to fetch'});const read=pending();h.readHook(args=>args.p_organization==='org'?read.promise:undefined);h.card('res-1').querySelector('input[name=name]').value='Старое изменение';const save=h.submit(h.card('res-1').querySelector('form'));await Promise.resolve();h.setState({...seed(),organization_id:'next'});await h.controller.setOrganization({id:'next'});read.resolve({data:seed(),error:null});await save;assert.equal(h.notices.length,0);assert.equal(h.controller.availability,'ready');
});
console.log(`resource reliability regression: ${passed}/${passed} passed (DOM emulator, network disabled; no visual acceptance)`);
