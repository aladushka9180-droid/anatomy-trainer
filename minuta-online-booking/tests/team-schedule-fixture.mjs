import { readFileSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function fixtureHtml({ ui = true, theme = 'pink-porcelain', role = 'owner', empty = false } = {}) {
  let html = readFileSync(resolve(app, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i, '');
  // This fixture never imports Supabase or sends RPCs. All records are fictional.
  const setup = `
    document.documentElement.classList.remove('provider-booting','requires-top-level');
    document.getElementById('providerBoot')?.remove();
    document.getElementById('dashboard').hidden=false;
    document.querySelectorAll('body > section').forEach(n=>n.hidden=n.id!=='dashboard');
    document.querySelectorAll('.provider-view').forEach(n=>n.hidden=n.dataset.providerPanel!=='organization');
    document.getElementById('organizationWorkspace').hidden=false;
    document.getElementById('organizationLoading').hidden=true;
    document.getElementById('organizationRoleBadge').textContent='Демонстрация';
    document.getElementById('organizationSectionSelect').value='shiftsPanel';
    document.querySelectorAll('#organizationWorkspace > .provider-section-anchor').forEach(n=>n.hidden=n.id!=='shiftsPanel');
    document.getElementById('organizationAuditPanel').hidden=true;
    document.querySelectorAll('#organizationSectionNav [data-section-target]').forEach(n=>n.classList.toggle('active',n.dataset.sectionTarget==='shiftsPanel'));
    Object.assign(document.body.dataset,{providerTheme:${JSON.stringify(theme)},providerLayout:'soft',providerPorcelainCharacter:'pearl',providerTextScale:'default'});
    const today=(()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)})();
    const add=(date,n)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
    const role=${JSON.stringify(role)}; let actor='u1',generation=1,writeMode='ok',allowed=true,org='org-a';
    const names=['Анна','Мария','Елена','Анастасия Константинопольская',...Array.from({length:26},(_,i)=>'Специалист '+(i+5))];
    const initial={organization_id:org,current_role:role,can_manage_team:['owner','admin'].includes(role),enabled:false,
      locations:[{id:'l1',name:'Основной филиал',active:true},{id:'l2',name:'Северный',active:true}],
      performers:${empty ? '[]' : "names.map((display_name,i)=>({id:'u'+(i+1),display_name}))"},
      shifts:[],absences:[],bookings:[{id:'b1',booking_date:today,booking_time:'12:00',service_name:'Массаж',performer_id:'u1',status:'confirmed',duration_minutes:60}],
      services:[{id:'srv1',performer_id:'u1',name:'Массаж',duration_minutes:60},{id:'srv2',performer_id:'u2',name:'Массаж',duration_minutes:60}],utilization:[],audit:[]};
    for(const p of initial.performers)for(const offset of [0,1,3,4])initial.shifts.push({id:'s-'+p.id+'-'+offset,performer_id:p.id,location_id:p.id==='u4'?'l2':'l1',shift_date:add(today,offset),start_time:'10:00',end_time:'18:00',break_start:'14:00',break_end:'15:00',active:true,note:''});
    if(initial.performers.length)initial.absences.push({id:'a1',performer_id:'u3',starts_on:add(today,2),ends_on:add(today,2),kind:'vacation',active:true});
    if(!initial.performers.length){initial.bookings=[];initial.services=[];}
    const storageKey='team-schedule-fixture:'+role+':${empty}';
    let state;try{state=JSON.parse(sessionStorage.getItem(storageKey)||'null')}catch{};state=state||initial;
    const calls=[];const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const persist=()=>sessionStorage.setItem(storageKey,JSON.stringify(state));
    const audit=()=>{document.getElementById('testCalls').textContent=JSON.stringify(calls)};
    const payload=p=>{
      const d=structuredClone(state);d.organization_id=org;
      if(role==='specialist'){d.performers=d.performers.filter(x=>x.id===actor);d.shifts=d.shifts.filter(x=>x.performer_id===actor);d.absences=d.absences.filter(x=>x.performer_id===actor);}
      d.shifts=d.shifts.filter(x=>x.shift_date>=p.p_start&&x.shift_date<=p.p_end);
      d.absences=d.absences.filter(x=>x.starts_on<=p.p_end&&x.ends_on>=p.p_start);
      d.utilization=d.performers.map(x=>({performer_id:x.id,location_id:'l1',shift_minutes:d.shifts.filter(s=>s.active&&s.performer_id===x.id).length*420,booked_minutes:x.id==='u1'?60:0,percent:0}));return d;
    };
    const db={rpc:async(name,p)=>{
      calls.push({name,parameters:p});audit();
      if(name==='get_minuta_shift_workspace')return {data:payload(p)};
      if(writeMode==='error')return {error:{message:'shift_overlaps_absence'}};
      if(role==='specialist'&&p.p_performer&&p.p_performer!==actor)return {error:{message:'foreign_performer_denied'}};
      if(name==='upsert_minuta_staff_shift'){
        const id=p.p_shift||'created-'+Date.now();const row={id,performer_id:p.p_performer,location_id:p.p_location,shift_date:p.p_date,start_time:p.p_start,end_time:p.p_end,break_start:p.p_break_start,break_end:p.p_break_end,note:p.p_note,active:true};
        const idx=state.shifts.findIndex(x=>x.id===id);if(idx>=0)state.shifts[idx]=row;else state.shifts.push(row);
      }else if(name==='create_minuta_staff_absence')state.absences.push({id:'created-a-'+Date.now(),performer_id:p.p_performer,starts_on:p.p_start,ends_on:p.p_end,kind:p.p_kind,note:p.p_note,active:true});
      else if(name==='cancel_minuta_staff_shift')state.shifts.find(x=>x.id===p.p_shift).active=false;
      else if(name==='cancel_minuta_staff_absence')state.absences.find(x=>x.id===p.p_absence).active=false;
      else if(name==='substitute_minuta_booking')state.bookings.find(x=>x.id===p.p_booking).performer_id=state.services.find(x=>x.id===p.p_new_service).performer_id;
      else if(name==='set_minuta_branch_shifts_enabled')state.enabled=p.p_enabled;
      else throw Error('Unexpected fixture RPC '+name);
      state.audit.push({action:name==='upsert_minuta_staff_shift'?'shift_created':'absence_created',created_at:new Date().toISOString()});persist();return {data:{ok:true}};
    }};
    const tools=document.createElement('aside');tools.id='scheduleTestControls';tools.style.cssText='padding:12px;background:#f4f0f3;font:13px Arial';
    tools.innerHTML='<strong>Изолированная проверка · только вымышленные данные</strong> <button type="button" data-test-mode="error">Ошибка сохранения</button> <button type="button" data-test-mode="ok">Сохранение разрешено</button> <button type="button" data-test-scope>Другая организация</button> <button type="button" data-test-lock>Запрет записи</button> <button type="button" data-test-logout>Выход</button><details><summary>Вызовы тестового RPC</summary><pre id="testCalls" style="white-space:pre-wrap"></pre></details>';
    document.body.prepend(tools);
    const controller=window.MinutaShifts.createController({db,escapeHtml:escape,notify:message=>{document.getElementById('testStatus').textContent=message},requireWrites:()=>allowed,applyWriteAvailability:()=>{if(!allowed)document.querySelectorAll('[data-shift-write]').forEach(x=>x.disabled=true)},getCurrentUser:()=>actor?{id:actor}:null,getSessionGeneration:()=>generation,sessionIsCurrent:(id,g)=>id===actor&&g===generation});
    const status=document.createElement('p');status.id='testStatus';status.setAttribute('role','status');tools.append(status);
    tools.addEventListener('click',event=>{const e=event.target;
      if(e.dataset.testMode)writeMode=e.dataset.testMode;
      if(e.hasAttribute('data-test-scope')){org=org==='org-a'?'org-b':'org-a';controller.setOrganization({id:org});}
      if(e.hasAttribute('data-test-lock')){allowed=false;document.querySelectorAll('[data-shift-write]').forEach(x=>x.disabled=true);}
      if(e.hasAttribute('data-test-logout')){actor=null;generation++;controller.reset();}
    });
    controller.bind();controller.setOrganization({id:org});
  `;
  return html.replace('</body>', () => (ui ? '<link rel="stylesheet" href="team-schedule-ui.css"><script src="team-schedule-ui.js"></script>' : '') + '<script src="shift-management.js"></script><script>' + setup + '</script><script src="provider-selects.js"></script></body>');
}
if (process.argv.includes('--serve')) {
  const port = Number(process.env.TEAM_SCHEDULE_PREVIEW_PORT || 57231);
  createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/schedule-preview.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'");
      res.end(fixtureHtml({ ui: url.searchParams.get('ui') !== '0', theme: url.searchParams.get('theme') || 'pink-porcelain', role: url.searchParams.get('role') || 'owner', empty: url.searchParams.get('empty') === '1' })); return;
    }
    const file = resolve(app, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(app + sep)) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', ({ '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' })[extname(file)] || 'application/octet-stream'); res.end(readFileSync(file)); }
    catch { res.writeHead(404).end(); }
  }).listen(port, '127.0.0.1', () => console.log('Synthetic native schedule http://127.0.0.1:' + port));
}
