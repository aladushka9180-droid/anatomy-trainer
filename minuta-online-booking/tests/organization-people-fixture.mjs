import { readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(app, file), 'utf8');
// This page has no credentials or real transport. It uses the production DOM,
// styles, selects and organization controllers; RPCs mutate synthetic objects.
export function fixtureHtml(theme = 'pink-porcelain', role = 'owner') {
  let html = read('provider.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i, '');
  const setup = `
    document.documentElement.classList.remove('provider-booting','requires-top-level');
    document.getElementById('providerBoot')?.remove(); document.getElementById('dashboard').hidden=false;
    document.querySelectorAll('.provider-view').forEach(node=>node.hidden=node.dataset.providerPanel!=='organization');
    Object.assign(document.body.dataset,{providerTheme:${JSON.stringify(theme)},providerLayout:'soft',providerPorcelainCharacter:'pearl',providerTextScale:'default'});
    document.querySelectorAll('body > section').forEach(node=>{if(node.id!=='dashboard')node.hidden=true;});
    window.testRole=${JSON.stringify(role)}; window.actor='u1';window.generation=1;window.calls=[];window.notices=[];
    window.writeMode='ok';window.readMode='ok';window.delayWrite=false;window.delayRead=false;
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Samara',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    window.orgData={id:'org-a',name:'Синтетическая организация',public_slug:'fixture-only',can_manage:['owner','admin'].includes(testRole),current_role:testRole,public_booking_enabled:false,
      locations:[{id:'l1',name:'Основной филиал',address:'Самара, тестовый адрес',timezone:'Europe/Samara',active:true,is_primary:true},{id:'l2',name:'Филиал у парка',address:'Тестовая улица, 2',timezone:'Europe/Samara',active:true,is_primary:false}],
      members:[{user_id:'u1',display_name:'Анна',email:'anna@example.invalid',role:'owner',active:true,is_bookable:true,is_current_user:true},{user_id:'u2',display_name:'Мария',email:'maria@example.invalid',role:'specialist',active:true,is_bookable:true}],
      invitations:[{id:'i1',email:'waiting@example.invalid',role:'owner',expires_at:new Date(Date.now()+86400000).toISOString()}],audit:[]};
    window.orgB={...structuredClone(orgData),id:'org-b',name:'Другая тестовая организация',public_slug:'fixture-b'};
    window.shiftData={organization_id:'org-a',services:[{performer_id:'u1',name:'Массаж',duration_minutes:60,active:true}],shifts:[{performer_id:'u1',location_id:'l1',shift_date:today,start_time:'10:00',end_time:'18:00',active:true}],absences:[]};
    const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const payload=()=>({organizations:[structuredClone(orgData),structuredClone(orgB)],pending_invitations:[]});
    const db={rpc:async(name,p)=>{
      calls.push({name,p});
      if(name==='get_minuta_workspace')return {data:payload()};
      if(name==='get_minuta_shift_workspace'){
        if(delayRead)await new Promise(resolve=>window.releaseRead=resolve);
        if(readMode==='error')return {error:{code:'READ_FAILED'}};
        return {data:readMode==='foreign'?{...shiftData,organization_id:'other'}:structuredClone(shiftData)};
      }
      if(!['create_minuta_location','invite_minuta_member','update_minuta_location','update_minuta_member','cancel_minuta_invitation'].includes(name))throw Error('Unapproved RPC '+name);
      if(delayWrite)await new Promise(resolve=>window.releaseWrite=resolve);
      if(writeMode==='throw')throw Error('Synthetic network failure');
      if(writeMode==='refuse')return {error:{code:'WRITE_REFUSED'}};
      let action;
      if(name==='create_minuta_location'){orgData.locations.push({id:'l'+(orgData.locations.length+1),name:p.p_name,address:p.p_address,timezone:p.p_timezone,active:true,is_primary:false});action='location_created';}
      if(name==='invite_minuta_member'){orgData.invitations.push({id:'i'+(orgData.invitations.length+1),email:p.p_email,role:p.p_role,expires_at:new Date(Date.now()+86400000*14).toISOString()});action='member_invited';}
      if(name==='update_minuta_location'){Object.assign(orgData.locations.find(x=>x.id===p.p_location),{name:p.p_name,address:p.p_address,active:p.p_active,is_primary:p.p_is_primary});action='location_updated';}
      if(name==='update_minuta_member'){Object.assign(orgData.members.find(x=>x.user_id===p.p_user),{role:p.p_role,active:p.p_active,is_bookable:p.p_is_bookable});action='member_updated';}
      if(name==='cancel_minuta_invitation'){orgData.invitations=orgData.invitations.filter(x=>x.id!==p.p_invitation);action='invitation_cancelled';}
      orgData.audit.unshift({actor_id:'u1',action,created_at:new Date().toISOString()});
      return {data:{workspace:payload(),status:name==='invite_minuta_member'?'pending':undefined}};
    }};
    window.controller=MinutaOrganization.createController({db,$:s=>document.querySelector(s),$$:s=>[...document.querySelectorAll(s)],escapeHtml,
      notify:value=>notices.push(value),requireWrites:()=>Boolean(actor&&orgData.can_manage),getCurrentUser:()=>actor?{id:actor}:null,
      getSessionGeneration:()=>generation,sessionIsCurrent:(id,gen)=>actor===id&&generation===gen,applyWriteAvailability(){}});
    controller.bind();
    const show=id=>{
      document.querySelectorAll('#organizationWorkspace > .provider-section-anchor').forEach(node=>node.hidden=node.id!==id);
      document.getElementById('invitationsPanel').hidden=id!=='organizationPeopleSection'||!orgData.can_manage||!orgData.invitations.length;
      document.getElementById('organizationAuditPanel').hidden=id!=='organizationPeopleSection'||!orgData.can_manage;
      document.querySelectorAll('#organizationSectionNav [data-section-target]').forEach(node=>{node.classList.toggle('active',node.dataset.sectionTarget===id);node.setAttribute('aria-current',node.dataset.sectionTarget===id?'location':'false');});
    };
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-section-target]');if(button){event.preventDefault();show(button.dataset.sectionTarget);}
    });
    window.logout=()=>{generation++;actor=null;controller.reset();};
    controller.load().then(()=>show('organizationPeopleSection'));
  `;
  return html.replace('</body>', () => '<link rel="stylesheet" href="organization-people.css"><script src="organization-people.js"></script><script src="organization.js"></script><script>' + setup + '</script><script src="provider-selects.js"></script><script src="organization-group-navigation.js"></script></body>');
}
export async function fixture(page, options = {}) {
  const errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://people.test') { unexpected.push(url.href); return route.abort(); }
    if (url.pathname === '/people-preview.html') return route.fulfill({body:fixtureHtml(options.theme, options.role),contentType:'text/html'});
    const file = resolve(app, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(app)) return route.abort();
    try { return route.fulfill({body:readFileSync(file),contentType:({'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.js':'text/javascript','.png':'image/png'})[extname(file)]||'application/octet-stream'}); }
    catch { return route.fulfill({status:404,body:''}); }
  });
  await page.goto('http://people.test/people-preview.html');
  await page.locator('#organizationPeopleSection[data-people-ready]').waitFor({state:'visible'});
  await page.waitForFunction(()=>{const note=document.querySelector('[data-people-workplace]');return note && !note.textContent.includes('Проверяем график');});
  return { errors, unexpected };
}
// Explicit local preview; all RPCs still use the fixture above.
if (process.argv.includes('--serve')) {
  const { createServer } = await import('node:http');
  createServer((req,res)=>{
    const url = new URL(req.url,'http://localhost');
    if(url.pathname==='/people-preview.html'){res.setHeader('Content-Type','text/html');res.end(fixtureHtml());return;}
    const file=resolve(app,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(app)){res.writeHead(403).end();return;}
    try{res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}
    catch{res.writeHead(404).end();}
  }).listen(4178,'127.0.0.1',()=>console.log('Synthetic preview http://127.0.0.1:4178/people-preview.html'));
}
