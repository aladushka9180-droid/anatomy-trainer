import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Run normally with node --test. Optional direct-run arguments:
// --source=<provider.js> --sha=<raw SHA256> --observations=<new JSON file>.
// Fixtures/ports are local and synthetic; only actual selected Source functions
// and its existing WeakMap/begin/release helpers run in VM. No provider bootstrap.
// No files are written unless --observations is explicitly supplied.
const options = {};
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index], split = argument.indexOf('=');
  const name = split < 0 ? argument : argument.slice(0, split);
  assert(['--source', '--sha', '--observations'].includes(name), 'known optional test argument');
  const value = split < 0 ? process.argv[++index] : argument.slice(split + 1);
  assert(value && !value.startsWith('--') && !Object.hasOwn(options, name.slice(2)), 'one nonempty argument value');
  options[name.slice(2)] = value;
}
if (options.sha) assert(/^[0-9a-f]{64}$/i.test(options.sha), 'SHA256 syntax');
const sourcePath = options.source ? resolve(options.source) : fileURLToPath(new URL('../provider.js', import.meta.url));
const raw = readFileSync(sourcePath);
const sha = value => createHash('sha256').update(value).digest('hex');
if (options.sha) assert.equal(sha(raw), options.sha.toLowerCase(), 'selected raw Source pin');
const source = raw.toString('utf8').replace(/\r\n/g, '\n'), seams = {};
function actual(name) {
  const pattern = new RegExp('^(?:async )?function ' + name + '\\(', 'm');
  const start = source.search(pattern); assert(start >= 0, 'selected Source function exists: ' + name);
  const next = source.slice(start + 1).search(/^(?:async )?function /m); assert(next >= 0);
  const text = source.slice(start, start + 1 + next);
  seams[name] = { bytes:Buffer.byteLength(text), sha256:sha(text) };
  return text;
}
const ownerStart = source.indexOf('const clientProfileWriteOwners = new WeakMap();');
const ownerEnd = source.indexOf('async function saveClientIdentity(', ownerStart);
assert(ownerStart >= 0 && ownerEnd > ownerStart, 'existing button owner Source closure');
const helper = source.slice(ownerStart, ownerEnd);
const common = helper + '\n' + actual('sessionIsCurrent');
const telegramSource = common + '\n' + ['normalizeTelegramContactUsername', 'normalizeTelegramClientSettings', 'renderTelegramClientSettings', 'saveTelegramClientSettings'].map(actual).join('\n');
const policySource = common + '\n' + ['autoCompleteStorageKey', 'saveBookingPolicy'].map(actual).join('\n');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function dom(){const nodes=new Map();return id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',checked:false,disabled:false,hidden:false,focus(){}});return nodes.get(id);};}
function telegramFixture(){
  const $=dom(),gate=deferred(),calls=[],notices=[],errors=[];
  const box={$,currentUser:{id:'synthetic-A'},sessionGeneration:1,telegramClientSettings:{contact_username:'synthetic_a',confirmation:true,reminder:true,rescheduled:true,cancelled:true},
    clearFormError:id=>{$(id).textContent='';},showFormError:(id,message)=>{$(id).textContent=message;errors.push(message);},notify:message=>notices.push(message),
    db:{auth:{updateUser:input=>{calls.push(input);return gate.promise;}}}};
  vm.createContext(box);vm.runInContext(telegramSource,box,{filename:'actual-telegram-settings-only.js',timeout:1000});
  $('#telegramContactUsername').value='@synthetic_a';
  for(const id of ['#telegramNotifyConfirmation','#telegramNotifyReminder','#telegramNotifyRescheduled','#telegramNotifyCancelled'])$(id).checked=true;
  const button=$('#telegramClientSettingsForm button[type="submit"]');
  const invoke=()=>box.saveTelegramClientSettings({preventDefault(){},submitter:button});
  function switchContext(){
    box.sessionGeneration++;box.currentUser={id:'synthetic-B'};
    box.telegramClientSettings={contact_username:'synthetic_b',confirmation:false,reminder:false,rescheduled:false,cancelled:false};
    $('#telegramContactUsername').value='@synthetic_b';$('#telegramClientSettingsStatus').textContent='Synthetic B current status';
    $('#telegramClientSettingsError').textContent='';
  }
  const view=()=>JSON.stringify({actor:box.currentUser.id,settings:box.telegramClientSettings,input:$('#telegramContactUsername').value,status:$('#telegramClientSettingsStatus').textContent,error:$('#telegramClientSettingsError').textContent,notices});
  const reply=error=>error?{data:null,error:{code:'42501',message:'Synthetic refusal'}}:{data:{user:{id:'synthetic-A',user_metadata:{}}},error:null};
  return{box,$,button,gate,calls,notices,errors,invoke,switchContext,view,reply};
}
function policyFixture(){
  const $=dom(),gate=deferred(),calls=[],notices=[],errors=[],storage=[],snapshots=[],automatic=[],renders=[];
  const box={$,currentUser:{id:'synthetic-A'},sessionGeneration:1,bookingPolicy:{performer_id:'synthetic-A',marker:'original-A'},paymentController:null,
    requireWrites:()=>true,clearFormError:id=>{$(id).textContent='';},showFormError:(id,message)=>{$(id).textContent=message;errors.push(message);},notify:message=>notices.push(message),
    normalizedOutcomePaymentMethod:value=>value,localStorage:{setItem:(key,value)=>storage.push({key,value})},
    renderBookingPolicyForm:()=>renders.push('policy'),renderBookings:()=>renders.push('bookings'),
    saveProviderOfflineSnapshot:async(userId,generation)=>{snapshots.push({userId,generation});return true;},
    applyAutomaticVisitOutcomes:async()=>{automatic.push({userId:box.currentUser.id,generation:box.sessionGeneration});return 0;},
    db:{from:table=>{assert.equal(table,'booking_policies');return{upsert:(record,options)=>{calls.push({record,options});return gate.promise;}};}}};
  vm.createContext(box);vm.runInContext(policySource,box,{filename:'actual-policy-settings-only.js',timeout:1000});
  for(const [id,value] of Object.entries({cancelCutoffHours:'12',rescheduleCutoffHours:'12',maxReschedules:'2',depositAmount:'0',paymentUrlTemplate:'',autoCompletePaymentMethod:'unpaid',bookingBufferMinutes:'60'}))$('#'+id).value=value;
  const button={disabled:false,textContent:'Synthetic Save'};
  const invoke=()=>box.saveBookingPolicy({preventDefault(){},submitter:button});
  function switchContext(){box.sessionGeneration++;box.currentUser={id:'synthetic-B'};box.bookingPolicy={performer_id:'synthetic-B',marker:'current-B'};$('#bookingPolicyError').textContent='';}
  return{box,$,button,gate,calls,notices,errors,storage,snapshots,automatic,renders,invoke,switchContext};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function setup(kind,{nullable=false,deferStage=null}={}){
  const f=kind==='telegram'?telegramFixture():policyFixture();
  const gates=[],owners=[],events=[],stageGate=deferred();
  f.box.Date={now:()=>1700000000000};
  if(kind==='telegram'){
    f.box.db.auth.updateUser=input=>{
      assert.deepEqual(Object.keys(input),['data']);assert.deepEqual(Object.keys(input.data),['telegram_client_settings']);
      const next=input.data.telegram_client_settings;
      assert.deepEqual(Object.keys(next),['contact_username','confirmation','reminder','rescheduled','cancelled','version','updated_at']);assert.equal(next.version,1);assert.equal(next.updated_at,1700000000000);
      owners.push({userId:f.box.currentUser.id,generation:f.box.sessionGeneration});f.calls.push(input);const gate=deferred();gates.push(gate);events.push('request');return gate.promise;
    };
    if(nullable){const original=f.box.$;f.box.$=id=>id==='#telegramClientSettingsForm button[type="submit"]'?null:original(id);}
  }else{
    f.box.db.from=table=>{assert.equal(table,'booking_policies');return{upsert:(record,options)=>{
      assert.deepEqual(Object.keys(record),['performer_id','cancel_cutoff_hours','reschedule_cutoff_hours','max_reschedules','deposit_enabled','deposit_amount_rub','payment_url_template','auto_complete_visits','auto_complete_payment_method','booking_buffer_enabled','booking_buffer_minutes']);assert.equal(options.onConflict,'performer_id');
      owners.push({userId:f.box.currentUser.id,generation:f.box.sessionGeneration});f.calls.push({record,options});const gate=deferred();gates.push(gate);events.push('request');return gate.promise;
    }};};
    f.box.saveProviderOfflineSnapshot=async(userId,generation)=>{f.snapshots.push({userId,generation});events.push('snapshot');return deferStage==='snapshot'?stageGate.promise:true;};
    f.box.applyAutomaticVisitOutcomes=async()=>{f.automatic.push({userId:f.box.currentUser.id,generation:f.box.sessionGeneration});events.push('automatic');return deferStage==='automatic'?stageGate.promise:0;};
  }
  f.box.notify=message=>{f.notices.push(message);events.push('notify');};
  const invoke=()=>kind==='telegram'?f.box.saveTelegramClientSettings({preventDefault(){},submitter:nullable?null:f.button}):f.invoke();
  const reply=(index,error=false)=>error?{data:null,error:{code:'42501',message:'Synthetic refusal'}}:kind==='telegram'?{data:{user:{id:owners[index].userId,user_metadata:{}}},error:null}:{error:null};
  function transition(epochOnly=false){f.switchContext();if(epochOnly){f.box.currentUser={id:'synthetic-A'};if(kind==='policy')f.box.bookingPolicy={performer_id:'synthetic-A',marker:'new-epoch-A'};}}
  const state=()=>kind==='telegram'?f.view():JSON.stringify({actor:f.box.currentUser.id,policy:f.box.bookingPolicy,error:f.$('#bookingPolicyError').textContent,notices:f.notices});
  return{f,gates,owners,events,stageGate,invoke,reply,transition,state,nullable};
}
function successControl(c,kind,user='synthetic-A'){
  const f=c.f;assert.equal(f.box.currentUser.id,user);assert.equal(f.notices.length,1);assert.equal(f.errors.length,0);assert.equal(f.button.disabled,false);
  if(kind==='telegram')assert.equal(f.box.telegramClientSettings.contact_username,user==='synthetic-A'?'synthetic_a':'synthetic_b');
  else{assert.equal(f.box.bookingPolicy.performer_id,user);assert.equal(f.storage.length,1);assert.equal(f.storage[0].key,'massage-auto-complete-visits-'+user);assert.equal(f.snapshots.length,1);assert.equal(f.snapshots[0].userId,user);assert.equal(f.automatic.length,1);assert.equal(f.automatic[0].userId,user);assert.deepEqual(c.events,['request','snapshot','automatic','notify']);}
}

const registeredIds = [], observations = [];
function register(id, body) {
  registeredIds.push(id);
  test(id, async () => {
    const record = { id, status:'PASS', observed:null };
    try { await body(value => { record.observed = value; }); }
    catch (error) { record.status = 'FAIL'; throw error; }
    finally { observations.push(record); }
  });
}
  for(const kind of ['telegram','policy'])for(const error of [false,true]){
    register(kind+'-current-'+(error?'refusal':'success'),async observe=>{
      const c=setup(kind),initial=c.f.box.bookingPolicy,pending=c.invoke();assert.equal(c.f.button.disabled,true);c.gates[0].resolve(c.reply(0,error));await pending;
      observe({requests:c.f.calls.length,buttonDisabled:c.f.button.disabled,errors:c.f.errors.length,notices:c.f.notices.length});assert.equal(c.f.calls.length,1);
      if(!error)successControl(c,kind);else{assert.equal(c.f.button.disabled,false);assert.equal(c.f.errors.length,1);assert.equal(c.f.notices.length,0);if(kind==='policy'){assert.equal(c.f.box.bookingPolicy,initial);assert.equal(c.f.storage.length,0);assert.equal(c.f.snapshots.length,0);assert.equal(c.f.automatic.length,0);}}
    });
    register(kind+'-retired-'+(error?'refusal':'success')+'-no-new-owner',async observe=>{
      const c=setup(kind),pending=c.invoke();c.transition();const expected=c.state();c.gates[0].resolve(c.reply(0,error));await pending;
      observe({requests:c.f.calls.length,currentContextPreserved:c.state()===expected,buttonDisabled:c.f.button.disabled,errors:c.f.errors.length,notices:c.f.notices.length});
      assert.equal(c.f.calls.length,1);assert.equal(c.state(),expected);assert.equal(c.f.button.disabled,false);if(kind==='policy'){assert.equal(c.f.storage.length,0);assert.equal(c.f.snapshots.length,0);assert.equal(c.f.automatic.length,0);}
    });
  }
  for(const kind of ['telegram','policy']){
    register(kind+'-newer-owner-retains-button',async observe=>{
      const c=setup(kind),old=c.invoke();c.transition();
      if(kind==='policy')c.f.button.textContent='Synthetic B Save';
      const current=c.invoke(),expected=c.state();c.gates[0].resolve(c.reply(0));await old;
      const observed={requests:c.f.calls.length,buttonDisabledAfterOldAck:c.f.button.disabled,visibleStatePreserved:c.state()===expected,labelPreserved:kind==='telegram'||c.f.button.textContent==='Сохраняем…'};
      c.gates[1].resolve(c.reply(1));await current;observe(observed);
      assert.equal(observed.requests,2);assert.equal(observed.buttonDisabledAfterOldAck,true);assert.equal(observed.visibleStatePreserved,true);assert.equal(observed.labelPreserved,true);assert.equal(c.f.button.disabled,false);assert.equal(c.f.box.currentUser.id,'synthetic-B');assert.equal(c.f.notices.length,1);
      if(kind==='policy'){assert.equal(c.f.button.textContent,'Synthetic B Save');assert.equal(c.f.storage.length,1);assert.equal(c.f.snapshots.length,1);assert.equal(c.f.automatic.length,1);}
    });
    register(kind+'-retired-epoch-only-success',async observe=>{
      const c=setup(kind),pending=c.invoke();c.transition(true);const expected=c.state();c.gates[0].resolve(c.reply(0));await pending;
      observe({sameActor:true,newEpoch:true,currentContextPreserved:c.state()===expected,buttonDisabled:c.f.button.disabled,notices:c.f.notices.length});assert.equal(c.state(),expected);assert.equal(c.f.button.disabled,false);assert.equal(c.f.calls.length,1);if(kind==='policy'){assert.equal(c.f.storage.length,0);assert.equal(c.f.snapshots.length,0);assert.equal(c.f.automatic.length,0);}
    });
  }
  for(const retired of [false,true])register('telegram-null-button-'+(retired?'retired':'current'),async observe=>{
    const c=setup('telegram',{nullable:true}),pending=c.invoke();if(retired)c.transition();const expected=c.state();c.gates[0].resolve(c.reply(0));await pending;
    observe({requests:c.f.calls.length,contextPreserved:retired?c.state()===expected:null,notices:c.f.notices.length,nullableButtonSupported:true});assert.equal(c.f.calls.length,1);if(retired)assert.equal(c.state(),expected);else successControl(c,'telegram');
  });
  for(const stage of ['snapshot','automatic'])for(const transition of ['current','actor','epoch'])register('policy-deferred-'+stage+'-'+transition,async observe=>{
    const c=setup('policy',{deferStage:stage}),pending=c.invoke();c.gates[0].resolve(c.reply(0));await flush();
    assert.equal(c.f.snapshots.length,1);assert.equal(c.f.snapshots[0].userId,'synthetic-A');assert.equal(c.f.snapshots[0].generation,1);assert.equal(c.f.storage[0].key,'massage-auto-complete-visits-synthetic-A');
    assert.equal(c.f.automatic.length,stage==='automatic'?1:0);assert.equal(c.f.notices.length,0);
    if(transition!=='current')c.transition(transition==='epoch');const expected=c.state(),automaticBefore=c.f.automatic.length;
    c.stageGate.resolve(true);await pending;
    observe({capturedSnapshotActorA:true,capturedSnapshotEpoch:1,transition,automaticBefore,automaticAfter:c.f.automatic.length,noticeCount:c.f.notices.length,currentContextPreserved:transition==='current'?null:c.state()===expected,automaticBEntries:c.f.automatic.filter(v=>v.userId==='synthetic-B').length});
    if(transition==='current')successControl(c,'policy');else{assert.equal(c.state(),expected);assert.equal(c.f.notices.length,0);assert.equal(c.f.automatic.length,automaticBefore);}
  });

test.after(() => {
  assert.equal(registeredIds.length, 20, 'twenty settings cases registered');
  assert.equal(new Set(registeredIds).size, 20, 'unique case identifiers');
  assert.equal(observations.length, 20, 'twenty settings cases completed');
  if (options.observations) {
    const ordered = registeredIds.map(id => observations.find(record => record.id === id));
    const passed = ordered.filter(record => record.status === 'PASS').length;
    const result = {
      format:'provider-settings-session-scope-noio-v1',
      status:passed === 20 ? 'PASS_SOURCE_NOIO' : 'FAILED_SOURCE_NOIO',
      source:{ path:sourcePath, bytes:raw.length, sha256:sha(raw) },
      seams, helperSha256:sha(helper), cases:ordered,
      counts:{ total:ordered.length, passed, failed:ordered.length - passed },
      limits:{ actualSelectedFunctionsAndOwnerHelpers:true, portsSynthetic:true,
        providerBootstrap:false, actualAuth:false, actualDb:false, actualStorage:false,
        actualAutomation:false, network:false, browser:false, realSdkInterleavingProved:false,
        actualDbCommitProved:false, alreadyStartedOperationsCancelled:false,
        automationInternalsQualified:false, transportThrowRecoveryQualified:false }
    };
    writeFileSync(resolve(options.observations), JSON.stringify(result, null, 2) + '\n', { flag:'wx' });
  }
});
