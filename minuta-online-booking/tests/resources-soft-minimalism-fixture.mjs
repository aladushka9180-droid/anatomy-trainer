// Only fixture records and an in-memory RPC adapter; never connects to the live database.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export function buildResourceFixture(outputDir = resolve(root, '../outputs/resources-soft-minimalism')) {
  const read = name => readFileSync(resolve(root, name), 'utf8');
  const html = read('provider.html');
  const marker = html.indexOf('id="resourcesPanel" hidden>');
  const start = html.lastIndexOf('<section class="panel organization-section', marker);
  const end = html.indexOf('<section class="panel organization-section', marker + 1);
  if (marker < 0 || start < 0 || end < 0) throw new Error('Resources panel not found');
  const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
  const page = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ресурсы · изолированная проверка</title>
  <style>${read('styles.css')}\n${read('provider-ux.css')}
  body.provider-body{display:block;margin:0;background:#fff6f9;--theme-surface:#fff;--theme-surface-alt:#fdebf3;--theme-accent-soft:#fdebf3;--theme-ink:#302b31;--theme-muted:#756d77;--theme-line:#efdae4;--theme-accent:#b83170;--material-radius:14px}
  .fixture-wrap{max-width:1200px;margin:24px auto;padding:0 24px}.fixture-note{margin:10px 0;color:var(--theme-ink);font-size:12px;line-height:1.5}.fixture-tools{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.fixture-tools label{font-size:12px}.fixture-tools select{min-height:44px}.fixture-nav{display:flex;gap:20px;margin:20px 0;color:var(--theme-ink);font-size:14px}.fixture-nav span:last-child{color:var(--theme-accent);border-bottom:2px solid;padding-bottom:10px}.fixture-wrap .organization-section{margin:0}
  @media(max-width:540px){.fixture-wrap{margin:16px auto;padding:0 12px}.fixture-wrap .organization-section{padding:16px}.fixture-nav{gap:14px;font-size:12px;flex-wrap:wrap}}
  </style><link id="resourceSoftMinimalismStyles" rel="stylesheet" href="resources-soft-minimalism.css?v=1"></head>
  <body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="soft"><main class="fixture-wrap"><h2>Организация</h2><p class="fixture-note">Изолированная проверка. Все ресурсы вымышлены; рабочая база не подключена.</p><div class="fixture-tools"><label>Ответ сервера <select id="fixtureFailure"><option value="">Сохранение успешно</option><option value="duplicate key">Название занято</option><option value="resource_has_future_bookings">Есть будущие записи</option><option value="resource_unavailable">Не хватает ресурсов</option><option value="network">Ошибка сети</option></select></label></div><nav class="fixture-nav"><span>Люди и филиалы</span><span>Ресурсы</span></nav>${html.slice(start, end)}<p id="fixtureNotice" role="status"></p><output id="fixtureCalls" class="fixture-note">Запросы: 0</output></main>
  <script>${safeScript(read('resource-management.js'))}</script>
  <script>
  window.fetch=()=>{throw new Error('Network forbidden in isolated resources fixture')};window.XMLHttpRequest=function(){throw new Error('Network forbidden in isolated resources fixture')};
  const $=selector=>document.querySelector(selector),org='org-fixture';
  const params=new URLSearchParams(location.search),mode=params.get('mode')||'ready';
  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const locations=[{id:'loc-1',name:'Основной филиал',active:true},{id:'loc-2',name:'Филиал на Садовой',active:true},{id:'loc-3',name:'Неактивный филиал',active:false}];
  const groups=[{id:'grp-room',name:'Массажные кабинеты',kind:'room',description:'Для индивидуальных процедур',active:true},{id:'grp-table',name:'Массажные столы',kind:'table',description:'Для выездного массажа',active:true},{id:'grp-equipment',name:'Оборудование',kind:'equipment',description:'Общее оборудование',active:true},{id:'grp-other',name:'Архивная группа',kind:'other',description:'Не используется',active:false}];
  const resources=Array.from({length:26},(_,i)=>{
    const group=groups[i<16?0:i<21?1:i<25?2:3],location=locations[i<12?0:i<25?1:2];
    return {id:'res-'+(i+1),name:(group.kind==='room'?'Кабинет ':group.kind==='table'?'Массажный стол ':group.kind==='equipment'?'Аппарат ':'Ресурс ')+String(i+1).padStart(2,'0'),location_id:location.id,location_name:location.name,group_id:group.id,group_name:group.name,kind:group.kind,active:i!==10&&i!==25};
  });
  resources[0].name='Кабинет 01 <тест>';
  resources[1].name='Кабинет с длинным названием для процедур и индивидуальных консультаций';
  let state={organization_id:org,can_manage:mode!=='readonly',locations:mode==='no-location'?[]:locations,groups:['empty','no-location'].includes(mode)?[]:groups,resources:['empty','groups','no-location'].includes(mode)?[]:resources,services:[{id:'svc-1',name:'Классический массаж',performer_name:'Анна',active:true}],requirements:[{service_id:'svc-1',group_id:'grp-room',quantity:1,active:true}],audit:[{action:'resource_created',subject_id:'res-1',created_at:'2026-10-01T10:00:00Z',details:{name:'Кабинет 01'}}]};
  const clone=()=>JSON.parse(JSON.stringify(state));window.fixtureCalls=[];
  const db={rpc:async(name,args)=>{
    window.fixtureCalls.push({name,args});$('#fixtureCalls').textContent='Запросы: '+window.fixtureCalls.length+' · '+name;
    if(name==='get_minuta_resource_workspace')return {data:clone(),error:null};
    if(!state.can_manage)return {data:null,error:{message:'permission_denied'}};
    const fail=$('#fixtureFailure').value;if(fail==='network')throw new Error('Fixture network failure');if(fail)return {data:null,error:{message:fail}};
    if(name==='create_minuta_resource_group')state.groups.push({id:'grp-new-'+state.groups.length,name:args.p_name,kind:args.p_kind,description:args.p_description,active:true});
    else if(name==='create_minuta_resource'){
      const group=state.groups.find(item=>item.id===args.p_group),location=state.locations.find(item=>item.id===args.p_location);
      state.resources.push({id:'res-new-'+state.resources.length,name:args.p_name,location_id:location.id,location_name:location.name,group_id:group.id,group_name:group.name,kind:group.kind,active:true});
    }else if(name==='update_minuta_resource_group'){
      const group=state.groups.find(item=>item.id===args.p_group);Object.assign(group,{name:args.p_name,kind:args.p_kind,description:args.p_description,active:args.p_active});state.resources.filter(item=>item.group_id===group.id).forEach(item=>Object.assign(item,{group_name:group.name,kind:group.kind}));
    }else if(name==='update_minuta_resource'){
      const group=state.groups.find(item=>item.id===args.p_group),location=state.locations.find(item=>item.id===args.p_location);
      Object.assign(state.resources.find(item=>item.id===args.p_resource),{name:args.p_name,location_id:location.id,location_name:location.name,group_id:group.id,group_name:group.name,kind:group.kind,active:args.p_active});
    }else if(name==='replace_minuta_service_resource_requirements')state.requirements=args.p_requirements.map(item=>({...item,service_id:args.p_service,active:true}));
    else return {data:null,error:{message:'Unexpected fixture RPC'}};
    return {data:clone(),error:null};
  }};
  if(params.get('theme')==='noir'){document.body.dataset.providerTheme='noir';const colours={'--theme-surface':'#202220','--theme-surface-alt':'#262924','--theme-accent-soft':'#323c32','--theme-ink':'#ededeb','--theme-muted':'#b0b6ad','--theme-line':'#454b42','--theme-accent':'#cba782'};for(const [key,value] of Object.entries(colours))document.body.style.setProperty(key,value);document.body.style.background='#151715'}
  const controller=window.MinutaResources.createController({db,$,escapeHtml,notify:text=>$('#fixtureNotice').textContent=text,requireWrites:()=>state.can_manage,getCurrentUser:()=>({id:'fixture-owner'}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true,applyWriteAvailability(){}});
  controller.bind();controller.setOrganization({id:org}).then(()=>document.body.dataset.ready='true');
  </script></body></html>`;
  mkdirSync(outputDir,{recursive:true});
  writeFileSync(resolve(outputDir,'fixture.html'),page);
  for (const file of ['ui-icons.svg','resource-icons.svg','resources-soft-minimalism.css']) writeFileSync(resolve(outputDir,file),read(file));
  return resolve(outputDir,'fixture.html');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(buildResourceFixture(process.argv[2]));
