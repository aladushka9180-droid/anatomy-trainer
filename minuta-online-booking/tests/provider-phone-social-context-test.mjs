import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { extractFunctionDeclaration } from './source-function-fixture.mjs';

// Actual local Source only; no provider bootstrap, SDK import, real Auth or writes.
// Browser/DOM/Auth/storage are synthetic ports. Enabled social providers below
// exist only in the VM fixture and do not activate application configuration.
const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const phoneHelper = readFileSync(new URL('../phone-auth.js', import.meta.url), 'utf8');
const socialHelper = readFileSync(new URL('../social-auth.js', import.meta.url), 'utf8');
const functionNames = ['sessionIsCurrent', 'beginClientProfileWrite', 'releaseClientProfileWrite',
  'renderProviderPhoneState', 'submitProviderPhoneLink', 'initializePhoneAuth',
  'renderProviderSocialState', 'startProviderSocialLink', 'initializeSocialAuth'];
function actualFunction(name) {
  if (name !== 'sessionIsCurrent') return extractFunctionDeclaration(source, name);
  // This existing declaration is one line; do not scan to a later closing brace.
  const lines = source.split('\n').filter(line => /^function sessionIsCurrent\(/.test(line));
  assert.equal(lines.length, 1, 'one actual sessionIsCurrent declaration');
  new vm.Script('(' + lines[0] + '\n)', { filename:'fixture-sessionIsCurrent.js' });
  return lines[0];
}
const actualFunctions = functionNames.map(actualFunction);
const declarationNames = ['providerLinkPhone', 'providerLinkCodeRequested', 'providerLinkScope',
  'providerSocialLinkScope', 'clientProfileWriteOwners'];
const actualDeclarations = declarationNames.map(name => {
  const matches = source.split('\n').filter(line => new RegExp('^(?:let|const) ' + name + ' = [^\\n]+;$').test(line));
  assert.equal(matches.length, 1, 'one actual ' + name + ' state declaration');
  new vm.Script(matches[0], { filename:'fixture-state-' + name + '.js' });
  return matches[0];
});
// Only currentUser and sessionGeneration are synthetic Source state.
const fixtureGlobals = "let currentUser = {id:'A',phone:''};\nlet sessionGeneration = 1;\n"
  + actualDeclarations.join('\n') + '\n';
const deferred = () => {let resolve, reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function environment() {
  const nodes=new Map(), storage=new Map(), calls=[], notices=[], errors=[];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id,{id,hidden:true,disabled:false,readOnly:false,value:'',textContent:'',dataset:{},
      classList:{toggle(){}},setAttribute(){},focus(){},querySelector(){return null;}});
    return nodes.get(id);
  }
  const social=node('socialTelegram'); social.dataset.socialAuthProvider='telegram';
  const socialAlt=node('socialVk');socialAlt.dataset.socialAuthProvider='vk';
  const socialState=node('socialState');social.querySelector=()=>socialState;
  node('providerPhoneLinkInput').value='+79000000001';
  node('providerPhoneLinkCode').value='123456';
  node('showPhoneLoginButton').disabled=false;
  node('providerPhoneLinkSubmit').textContent='Привязать телефон';
  const controls={
    update:async()=>({error:null}), verify:async()=>({data:{},error:null}),
    user:async()=>({data:{user:{id:'A',phone:'+79000000001'}},error:null}), link:async()=>({data:{},error:null})
  };
  const all=selector=>selector==='[data-social-auth-link]' || selector==='[data-social-auth-provider]' ? [social,socialAlt] : [];
  const context=vm.createContext({
    window:{MINUTA_CONFIG:{socialAuthProviders:{telegram:true,vk:true,yandex:false}}},
    document:{querySelectorAll:all}, navigator:{onLine:true}, location:{href:'https://fixture.invalid/provider.html'},URL,
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    $:s=>node(s.replace(/^#/,'')), $$:all,
    db:{auth:{
      updateUser:p=>{calls.push({kind:'update',payload:p});return controls.update(p);},
      verifyOtp:p=>{calls.push({kind:'verify',payload:p});return controls.verify(p);},
      getUser:()=>{calls.push({kind:'user'});return controls.user();},
      linkIdentity:p=>{calls.push({kind:'link',payload:p});return controls.link(p);},
      signInWithOAuth:()=>{throw new Error('UNEXPECTED_LOGIN_PORT');}
    }},
    clearFormError:s=>{node(s.replace(/^#/,'' )).hidden=true;},
    showFormError:(s,m)=>{const e=node(s.replace(/^#/,''));e.hidden=false;e.textContent=m;errors.push(m);},
    notify:m=>notices.push(m),setTimeout:fn=>{fn();return 1;},
    fetch:()=>{throw new Error('FORBIDDEN_NETWORK');},
  });
  vm.runInContext(phoneHelper,context,{filename:'public-phone-helper'});
  vm.runInContext(socialHelper,context,{filename:'public-social-helper'});
  vm.runInContext(fixtureGlobals+'\n'+actualFunctions.join('\n')+'\n'+
    'globalThis.testApi={phone:submitProviderPhoneLink,social:startProviderSocialLink,renderPhone:renderProviderPhoneState,renderSocial:renderProviderSocialState};',context,{filename:'exact-selected-provider-functions'});
  const state=()=>JSON.parse(vm.runInContext('JSON.stringify({userId:currentUser?.id||null,generation:sessionGeneration,codeRequested:providerLinkCodeRequested,linkPhone:providerLinkPhone})',context));
  const scope=(id,generation)=>{context.testScope={id,generation};vm.runInContext('currentUser=testScope.id?{id:testScope.id,phone:""}:null;sessionGeneration=testScope.generation;renderProviderPhoneState();renderProviderSocialState();',context);};
  const seedPhone=()=>vm.runInContext('providerLinkPhone="+79000000001";providerLinkCodeRequested=true;',context);
  context.testApi.renderPhone();context.testApi.renderSocial();
  return {node,controls,calls,notices,errors,state,scope,seedPhone,api:context.testApi,social,socialAlt,
    flow:()=>context.window.MinutaSocialAuth.flow(),event:{preventDefault(){}}};
}
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function requireCase(value,code){if(!value)throw new Error(code);}
const cases=[
  ['PHONE_REQUEST_RETIRED_SCOPE',async()=>{
    const e=environment(),d=deferred();e.controls.update=()=>d.promise;
    const pending=e.api.phone(e.event);e.scope('B',2);const hint=e.node('providerPhoneLinkHint').textContent;
    d.resolve({error:null});await pending;
    requireCase(!e.state().codeRequested && !e.node('providerPhoneLinkInput').readOnly && e.node('providerPhoneLinkHint').textContent===hint,'STALE_REQUEST_CHANGED_NEW_FORM');
  }],
  ['PHONE_GETUSER_RETIRED_SCOPE',async()=>{
    const e=environment(),d=deferred();e.seedPhone();e.controls.user=()=>d.promise;
    const pending=e.api.phone(e.event);await tick();requireCase(e.calls.some(c=>c.kind==='user'),'USER_PORT_NOT_REACHED');e.scope('B',2);
    d.resolve({data:{user:{id:'A',phone:'+79000000001'}},error:null});await pending;
    requireCase(e.state().userId==='B' && e.notices.length===0,'STALE_READBACK_REPLACED_NEW_USER');
  }],
  ['SOCIAL_RETIRED_ERROR_NEW_PENDING',async()=>{
    const e=environment(),a=deferred(),b=deferred();let n=0;e.controls.link=()=>++n===1?a.promise:b.promise;
    const pendingA=e.api.social(e.social);e.scope('B',2);const pendingB=e.api.social(e.social);
    requireCase(e.calls.filter(c=>c.kind==='link').length===2,'SECOND_OWNER_NOT_STARTED');
    a.resolve({error:{message:'synthetic conflict'}});await pendingA;
    const preserved=Boolean(e.flow()) && e.social.disabled && e.node('providerSocialLinkError').hidden;
    b.resolve({data:{},error:null});await pendingB;
    requireCase(preserved,'STALE_SOCIAL_ERROR_CLEARED_NEW_FLOW_OR_PENDING');
  }],

  ['PHONE_OTP_RETIRED_NO_READBACK',async()=>{
    const e=environment(),d=deferred();e.seedPhone();e.controls.verify=()=>d.promise;
    const pending=e.api.phone(e.event);e.scope('B',2);d.resolve({data:{},error:null});await pending;
    requireCase(!e.calls.some(c=>c.kind==='user') && e.notices.length===0 && e.state().userId==='B','STALE_VERIFY_CONTINUED');
  }],
  ['PHONE_NEW_PENDING_OWNER_SURVIVES_OLD_FINALLY',async()=>{
    const e=environment(),a=deferred(),b=deferred();let n=0;e.controls.update=()=>++n===1?a.promise:b.promise;
    const pendingA=e.api.phone(e.event);e.scope('B',2);e.node('providerPhoneLinkInput').value='+79000000002';
    const pendingB=e.api.phone(e.event);a.resolve({error:null});await pendingA;
    requireCase(e.node('providerPhoneLinkSubmit').disabled && !e.state().codeRequested,'OLD_FINALLY_RELEASED_NEW_OWNER');
    b.resolve({error:null});await pendingB;requireCase(e.state().codeRequested && !e.node('providerPhoneLinkSubmit').disabled,'NEW_OWNER_DID_NOT_COMPLETE');
  }],
  ['PHONE_COMPLETED_CHALLENGE_RETIRED_ON_SCOPE',async()=>{
    const e=environment();await e.api.phone(e.event);e.scope('B',2);
    requireCase(!e.state().codeRequested && !e.state().linkPhone && !e.node('providerPhoneLinkInput').readOnly && e.node('providerPhoneLinkCodeStep').hidden,'OLD_CHALLENGE_REUSED_BY_NEW_ACTOR');
  }],
  ['PHONE_RETIRED_READBACK_REJECTION_SILENT',async()=>{
    const e=environment(),d=deferred();e.seedPhone();e.controls.user=()=>d.promise;
    const pending=e.api.phone(e.event);await tick();e.scope('B',2);d.reject(new Error('synthetic rejected readback'));await pending;
    requireCase(e.node('providerPhoneLinkError').hidden && e.notices.length===0 && e.state().userId==='B','OLD_REJECTION_REPORTED_TO_NEW_ACTOR');
  }],
  ['PHONE_NO_ACTOR_NO_AUTH',async()=>{
    const e=environment();e.scope(null,2);await e.api.phone(e.event);requireCase(e.calls.length===0,'AUTH_WITHOUT_ACTOR');
  }],
  ['PHONE_WRONG_READBACK_ACTOR_NOT_ADOPTED',async()=>{
    const e=environment();e.seedPhone();e.controls.user=async()=>({data:{user:{id:'other'}},error:null});await e.api.phone(e.event);
    requireCase(e.state().userId==='A' && e.notices.length===0,'OTHER_READBACK_ACTOR_ADOPTED');
  }],
  ['PHONE_CURRENT_THROW_RELEASES_AND_MANUAL_RETRY',async()=>{
    const e=environment();e.controls.update=async()=>{throw new Error('synthetic network refusal');};await e.api.phone(e.event);
    requireCase(!e.node('providerPhoneLinkSubmit').disabled && !e.node('providerPhoneLinkError').hidden,'PHONE_THROW_STUCK');
    e.controls.update=async()=>({error:null});await e.api.phone(e.event);requireCase(e.calls.length===2 && e.state().codeRequested,'MANUAL_PHONE_RETRY_CHANGED');
  }],
  ['PHONE_CAPABILITY_DISABLED_DISCLOSURE_PRESERVED',async()=>{
    const e=environment();e.node('showPhoneLoginButton').disabled=true;e.node('providerPhoneLinkSubmit').disabled=true;
    e.node('providerPhoneLinkSubmit').textContent='SMS пока не подключены';e.node('providerPhoneLinkHint').textContent='synthetic disabled reason';e.scope('B',2);
    requireCase(e.node('providerPhoneLinkSubmit').disabled && e.node('providerPhoneLinkSubmit').textContent==='SMS пока не подключены' && e.node('providerPhoneLinkHint').textContent==='synthetic disabled reason','DISABLED_CAPABILITY_OVERRIDDEN');
  }],
  ['SOCIAL_SAME_SCOPE_OTHER_PENDING_PRESERVED',async()=>{
    const e=environment(),a=deferred(),b=deferred();let n=0;e.controls.link=()=>++n===1?a.promise:b.promise;
    const first=e.api.social(e.social),second=e.api.social(e.socialAlt);a.resolve({error:{message:'synthetic refusal'}});await first;
    const preserved=e.socialAlt.disabled && Boolean(e.flow()) && e.flow().provider==='vk';b.resolve({data:{},error:null});await second;
    requireCase(preserved,'RENDER_OR_CLEAR_RELEASED_OTHER_PENDING_PROVIDER');
  }],
  ['SOCIAL_CURRENT_SUCCESS_REQUEST_UNCHANGED',async()=>{
    const e=environment();await e.api.social(e.social);requireCase(e.calls.length===1 && e.calls[0].kind==='link' && e.social.disabled && e.flow()?.mode==='provider-link','NORMAL_SOCIAL_START_CHANGED');
  }],
  ['SOCIAL_CURRENT_THROW_RECOVERS_WITHOUT_RESEND',async()=>{
    const e=environment();e.controls.link=async()=>{throw new Error('synthetic rejected SDK promise');};await e.api.social(e.social);
    requireCase(e.calls.length===1 && !e.social.disabled && !e.node('providerSocialLinkError').hidden,'SOCIAL_THROW_RECOVERY_CHANGED');
  }],
  ['SOCIAL_DISABLED_PROVIDER_NO_AUTH',async()=>{
    const e=environment();e.social.dataset.socialAuthProvider='yandex';await e.api.social(e.social);
    requireCase(e.calls.length===0 && e.social.disabled && !e.node('providerSocialLinkError').hidden,'DISABLED_SOCIAL_PROVIDER_CALLED_AUTH');
  }],
  ['SOCIAL_LOGOUT_RETIRED_ERROR_SILENT',async()=>{
    const e=environment(),d=deferred();e.controls.link=()=>d.promise;const pending=e.api.social(e.social);e.scope(null,2);
    d.resolve({error:{message:'synthetic refusal'}});await pending;requireCase(e.node('providerSocialLinkError').hidden && e.calls.length===1,'RETIRED_SOCIAL_ERROR_REPORTED_AFTER_LOGOUT');
  }],
  ['PHONE_CURRENT_REQUEST_AND_VERIFY',async()=>{
    const e=environment();await e.api.phone(e.event);requireCase(e.state().codeRequested,'REQUEST_PHASE_MISSING');
    await e.api.phone(e.event);
    const kinds=e.calls.map(c=>c.kind).join(',');requireCase(kinds==='update,verify,user' && !e.state().codeRequested && e.notices.length===1,'NORMAL_PHONE_SEQUENCE_CHANGED');
    requireCase(e.calls[0].payload.phone==='+79000000001' && e.calls[1].payload.type==='phone_change' && e.calls[1].payload.token==='123456','NORMAL_PHONE_PAYLOAD_CHANGED');
  }],
  ['SOCIAL_CURRENT_REFUSAL_RECOVERS',async()=>{
    const e=environment();e.controls.link=async()=>({error:{message:'synthetic conflict'}});await e.api.social(e.social);
    requireCase(!e.social.disabled && !e.node('providerSocialLinkError').hidden && !e.flow(),'CURRENT_SOCIAL_ERROR_RECOVERY_CHANGED');
    requireCase(e.calls.length===1 && e.calls[0].payload.provider==='custom:telegram' && e.calls[0].payload.options.redirectTo==='https://fixture.invalid/provider.html?view=settings&social_auth=1','SOCIAL_REQUEST_CHANGED');
  }],
  ['PHONE_CURRENT_REFUSAL_RECOVERS',async()=>{
    const e=environment();e.controls.update=async()=>({error:{message:'synthetic refusal'}});await e.api.phone(e.event);
    requireCase(!e.node('providerPhoneLinkSubmit').disabled && !e.node('providerPhoneLinkError').hidden && !e.state().codeRequested,'CURRENT_PHONE_ERROR_RECOVERY_CHANGED');
  }]
];
(async()=>{
  const results=[];
  for(const [id,run] of cases){try{await run();results.push({id,pass:true});}catch(error){results.push({id,pass:false,failure:error.message});}}
  const failed=results.filter(result=>!result.pass);
  console.log(JSON.stringify({format:'provider-account-link-session-scope-noio',total:results.length,
    passed:results.length-failed.length,failed:failed.length,failures:failed,
    limits:'Actual selected local functions and helpers in VM; synthetic DOM/Auth/storage only. No SDK/server/Browser acceptance.'}));
  if(failed.length)process.exitCode=1;
})().catch(()=>{console.error('HARNESS_SETUP_FAILURE');process.exitCode=2;});
