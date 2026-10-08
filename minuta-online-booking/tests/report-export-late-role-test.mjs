import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const modulePath = process.argv[2] || new URL('../report-export-provider.js', import.meta.url);
const source = readFileSync(modulePath, 'utf8');
const results = [];
async function check(name, work) { try { await work(); results.push({name, pass:true}); } catch(error) { results.push({name, pass:false, error:error.message}); } }
function harness({ role='owner', privacy='masked', performer='all', team=true, location='all', segment='all' }={}) {
  const state = {role, privacy, performer, team, location, segment, user:'actor-a', auth:'actor-a', generation:1,
    org:'org-a', active:'org-a', consent:true, source:'own', period:'last30', status:'ready', key:'ready-a',
    workspaceReads:0, afterWorkspace:null, afterRpc:null, mismatch:null};
  const downloads=[], notices=[], calls=[], built=[];
  const booking=(id, branch, key, prior, person='actor-a') => ({ id, organization_id:'org-a', location_id:branch,
    performer_id:person, client_export_key:key, client_name:'Fictional '+id, client_phone:'', booking_date:'2026-09-12',
    booking_time:'10:00', visit_status:'completed', client_had_previous:prior });
  const live=[booking('visit-a','branch-a','record:new',false),booking('visit-b','branch-b','record:returning',true,'actor-b')];
  const imports=[{...booking('imported-history:a',null,'record:import',false),is_imported_history:true}];
  const c={Blob, state, downloads, notices, calls, built,
    get currentUser(){return {id:state.user}}, get sessionGeneration(){return state.generation},
    get reportDataSource(){return state.source}, get reportPeriod(){return state.period},
    get reportCanViewTeam(){return state.team}, get reportPerformerFilter(){return state.performer},
    get reportScopedBookingsState(){return {key:state.key,status:state.status}},
    organizationController:{getActiveOrganization:()=>({id:state.active})}, reportOrganizationId:()=>state.org,
    reportRange:()=>({start:'2026-09-01',end:'2026-09-30'}), previousReportRange:()=>null,
    reportForecastEnd:r=>r.end, reportDataQueryRange:r=>r, reportSessionKey:()=> 'ready-a', reportUsesScopedBookings:()=>state.team,
    document:{querySelector:selector=>selector==='#reportExportLocation'?{value:state.location}
      :selector==='#reportExportSegment'?{value:state.segment}:state.consent?{checked:true}:null},
    db:{auth:{getUser:async()=>({data:{user:{id:state.auth}}})},rpc:async(name,params)=>{
      calls.push({name,params});
      if(name==='get_minuta_workspace') { state.workspaceReads++; const role=state.role;
        state.afterWorkspace?.(state.workspaceReads); return {data:{organizations:[{id:state.org,current_role:role,status:'active',locations:[{id:'branch-a'},{id:'branch-b'}]}]}}; }
      // This is a fictitious RPC response, not SQL execution or a proof of deployed SQL.
      const effective=['owner','admin'].includes(state.role)?params.p_performer:state.user;
      const rows=(name==='get_minuta_report_export_bookings'?live:imports)
        .filter(r=>(!params.p_location||r.location_id===params.p_location)&&(!effective||r.performer_id===effective))
        .map(r=>({...r,client_phone:params.p_phone_mode==='none'?'':params.p_phone_mode==='full'?'+7 000 000-00-01':'+7 *** ***-00-01'}));
      const payload={organization_id:state.org,location_id:params.p_location,performer_id:effective,
        phone_mode:params.p_phone_mode,bookings:rows,has_more:false};
      if(state.mismatch==='phone'&&rows.length) rows[0].client_phone='+7 000 000-00-01';
      if(state.mismatch==='branch'&&rows.length) rows[0].location_id='branch-b';
      state.afterRpc?.(name); return {data:payload};
    }},
    reportCompletedItems:rows=>rows.filter(r=>r.visit_status==='completed'),reportClientIdentity:r=>r.client_export_key,
    reportExportData:(mode,items,scope)=> {built.push({mode,items,scope});return {range:{start:scope.start,end:scope.end},headers:['Fictional name','Phone'],rows:(items||[]).map(r=>[r.client_name,r.client_phone])}},
    reportExportFilename:(_,ext)=>'fictitious.'+ext, reportExportSheets:d=>[d],
    reportProfessionalWorkbook:sheets=>new Blob([JSON.stringify(sheets)]), notify:x=>notices.push(x),
    reportExportDownload:blob=>downloads.push(blob), $:()=>null,
    window:{Worker:true,Blob:true,URL:true},setTimeout:()=>1,clearTimeout(){},
    Worker:class {constructor(){state.worker=this}postMessage(){}terminate(){state.terminated=true}}
  };
  vm.createContext(c);
  vm.runInContext(source.slice(0,source.indexOf('function reportPdfText')),c);
  vm.runInContext(source.slice(source.indexOf('async function exportBookingsXlsxInBackground(')),c);
  return {state,downloads,notices,calls,built,run:expr=>vm.runInContext(expr,c)};
}
async function workerCase(format, mutation) {
  const h=harness({privacy:format}); const promise=h.run(`exportBookingsXlsxInBackground('${format}')`);
  for(let turn=0;turn<80&&!h.state.worker;turn++) await Promise.resolve();
  assert.ok(h.state.worker,'worker started after fictitious data was prepared');
  assert.equal(h.built[0].items.length,3,'populated team data was prepared');
  mutation(h.state);
  h.state.worker.onmessage({data:{blob:new Blob(['fictional worker file'])}}); await promise;
  assert.equal(h.downloads.length,0,'stale team file must not be delivered');
}
for(const initial of ['owner','admin']) for(const mode of ['none','masked'])
  await check(`late worker ${initial}->specialist ${mode}`,async()=>{
    const h=harness({role:initial}); const promise=h.run(`exportBookingsXlsxInBackground('${mode}')`);
    for(let turn=0;turn<80&&!h.state.worker;turn++) await Promise.resolve(); assert.ok(h.state.worker);
    assert.equal(h.built[0].items.length,3);h.state.role='specialist';
    h.state.worker.onmessage({data:{blob:new Blob(['fictional worker file'])}});await promise;
    assert.equal(h.downloads.length,0,'late demotion must not deliver team data');
  });
for(const mode of ['none','masked']) await check(`CSV final recheck owner->specialist ${mode}`,async()=>{
  const h=harness();h.state.afterWorkspace=n=>{if(n===4) h.state.role='specialist'};
  await h.run(`exportBookingsCsv('${mode}')`);assert.equal(h.built[0].items.length,3);assert.equal(h.downloads.length,0);
});
for(const role of ['owner','admin','specialist']) for(const mode of ['none','masked','full'])
 await check(`stable ${role} ${mode}`,async()=>{
  const h=harness({role,team:role!=='specialist'});await h.run(`exportBookingsCsv('${mode}')`);
  const allowed=mode!=='full'||role==='owner';assert.equal(h.downloads.length,allowed?1:0);
  if(allowed)assert.equal(h.built[0].items.length,role==='specialist'?2:3);
 });
for(const location of ['all','branch-a','branch-b']) for(const segment of ['all','new','returning'])
 await check(`filled ${location}/${segment}`,async()=>{
  const h=harness({location,segment});await h.run("exportBookingsCsv('masked')");assert.equal(h.downloads.length,1);
  const expected=location==='all'?(segment==='all'?3:segment==='new'?2:1):location==='branch-a'?(segment==='returning'?0:1):(segment==='new'?0:1);
  assert.equal(h.built[0].items.length,expected);
  assert.equal(h.calls.some(c=>c.name==='get_minuta_report_export_imported_history'),location==='all');
 });
for(const [label,change] of Object.entries({account:s=>{s.auth='actor-b'},generation:s=>{s.generation++},
  organization:s=>{s.active='org-b'},branch:s=>{s.location='branch-a'},segment:s=>{s.segment='returning'},
  period:s=>{s.period='last7'},roleFull:s=>{s.role='admin'}}))
 await check(`late worker ${label}`,()=>workerCase(label==='roleFull'?'full':'masked',change));
await check('worker error fallback after demotion',async()=>{
 const h=harness();const promise=h.run("exportBookingsXlsxInBackground('masked')");
 for(let turn=0;turn<80&&!h.state.worker;turn++)await Promise.resolve();assert.ok(h.state.worker);
 h.state.role='specialist';h.state.worker.onerror({error:new Error('fictional worker error')});await promise;assert.equal(h.downloads.length,0);
});
await check('specialist stale all performer rejected before RPC',async()=>{
 const h=harness({role:'specialist'});await h.run("exportBookingsCsv('masked')");assert.equal(h.downloads.length,0);
 assert.equal(h.calls.some(c=>c.name==='get_minuta_report_export_bookings'),false);
});
await check('full owner without consent denied',async()=>{const h=harness();h.state.consent=false;await h.run("exportBookingsCsv('full')");assert.equal(h.built.length,0);assert.equal(h.downloads.length,0)});
await check('unknown branch denied',async()=>{const h=harness({location:'foreign'});await h.run("exportBookingsCsv('masked')");assert.equal(h.downloads.length,0)});
for(const mismatch of ['phone','branch'])await check(`bad RPC ${mismatch} rejected`,async()=>{
 const h=harness({location:'branch-a'});h.state.mismatch=mismatch;await h.run("exportBookingsCsv('masked')");assert.equal(h.downloads.length,0);
});
await check('late RPC branch change never builds file',async()=>{
 const h=harness();h.state.afterRpc=()=>{h.state.location='branch-a'};await h.run("exportBookingsCsv('masked')");assert.equal(h.built.length,0);assert.equal(h.downloads.length,0);
});
const result={format:'s10-vm-synthetic-v1',module:String(modulePath),passed:results.filter(x=>x.pass).length,total:results.length,
 databaseExecuted:false,browserUsed:false,productionDataUsed:false,tests:results};
if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
console.log(`S10 late role export: ${result.passed}/${result.total} passed`);if(result.passed!==result.total)process.exitCode=1;
