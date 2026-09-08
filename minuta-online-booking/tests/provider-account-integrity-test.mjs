import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
function actual(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/^(?:async )?function /m);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
function context(names, values) { const box = vm.createContext(values); vm.runInContext(names.map(actual).join('\n'), box); return box; }
function node(value = '') { return {value,checked:false,hidden:false,dataset:{},focus(){},classList:{toggle(){}},setAttribute(){}}; }

for (const outcomes of [[true,true],[true,false],[false,false],[true,'reject']]) test(`bulk marks count only confirmed ${outcomes}`,async()=>{
  const notices=[];
  const box=context(['markAllDueNotificationsSent'],{requireWrites:()=>true,notificationMarks:()=>({}),buildNotificationTasks:()=>outcomes.map((_,i)=>({key:String(i),dueAt:new Date(0)})),setNotificationMark:async key=>{if(outcomes[key]==='reject')throw Error('network');return outcomes[key];},renderNotifications(){},notify:m=>notices.push(m)});
  const button={disabled:false,textContent:'Отметить все',isConnected:true};
  await box.markAllDueNotificationsSent(button);
  const count=outcomes.filter(x=>x===true).length;
  assert.match(notices[0],new RegExp(count===outcomes.length?`отправленными: ${count}`:`${count} из ${outcomes.length}`));
  assert.equal(button.disabled,false);
});
test('failed remote notification mark does not hide pending task locally',async()=>{
  let localWrites=0;
  const query={upsert:async()=>({error:{code:'42501'}})};
  const box=context(['setNotificationMark'],{notificationSettingsRemoteAvailable:true,currentUser:{id:'owner'},db:{from:()=>query},serverNotificationMarks:{},readNotificationStorage:()=>({}),writeNotificationStorage:()=>localWrites++});
  assert.equal(await box.setNotificationMark('booking|confirmation','sent'),false);assert.equal(localWrites,0);
});
for (const cached of [false,true]) test(`review read error is not empty, cache=${cached}`,async()=>{
  const nodes={'#providerReviewsList':node(),'#providerReviewsCount':node()};
  const box=context(['loadProviderReviews','renderProviderReviews'],{currentUser:{id:'owner'},sessionGeneration:1,sessionIsCurrent:()=>true,db:{rpc:async()=>({error:{message:'network'}})},providerReviews:cached?[{rating:5,client_name:'Fixture',review_id:'r',created_at:'2026-09-01'}]:[],providerReviewsState:'idle',$:id=>nodes[id],portfolioCountLabel:()=> 'отзывов',escapeHtml:x=>x,applyWriteAvailability(){}});
  assert.equal((await box.loadProviderReviews()).ok,false);
  assert.match(nodes['#providerReviewsList'].innerHTML,/Не удалось загрузить отзывы/);
  assert.doesNotMatch(nodes['#providerReviewsList'].innerHTML,/Получите первый отзыв/);
  assert.match(nodes['#providerReviewsList'].innerHTML,/data-retry-provider-reviews/);
  if(cached)assert.match(nodes['#providerReviewsList'].innerHTML,/последняя загруженная версия/);
});

function portfolioFixture(mode) {
  const notices=[],errors=[],removed=[],rpcCalls=[];
  const fields=Object.fromEntries(Object.entries({portfolioItemId:'item',portfolioProcedure:'Fixture procedure',portfolioArea:'',portfolioSessions:'2',portfolioDescription:'Description'}).map(([key,value])=>[`#${key}`,node(value)]));
  fields['#portfolioConsent']=node(); fields['#portfolioConsent'].checked=true;
  fields['#portfolioPublished']=node();
  const item={id:'item',updated_at:'2026-09-08T10:00:00Z',sort_order:10,photos:[{photo_type:'before',storage_path:'old-before'},{photo_type:'after',storage_path:'old-after'}]};
  const form={dataset:{}},button={disabled:false};
  const box=context(['savePortfolioItem'],{
    requireWrites:()=>true,portfolioRemoteAvailable:true,clearFormError(){},$:id=>fields[id],portfolioItems:[item],portfolioPhotoDrafts:{before:{},after:{}},currentUser:{id:'owner'},sessionGeneration:1,sessionIsCurrent:()=>true,portfolioEditorRevision:0,
    showFormError:(_id,m)=>errors.push(m),notify:m=>notices.push(m),
    savePortfolioPhoto:async(_item,type)=>{if(mode==='second-upload'&&type==='after')throw Error('upload');return{photo_type:type,storage_path:`new-${type}`};},
    removePortfolioStorage:async paths=>{removed.push([...paths]);return mode!=='cleanup-fail';},
    verifyPortfolioSave:async()=>mode==='lost-confirmed',
    db:{rpc:async(name,args)=>{rpcCalls.push({name,args});if(mode==='reject')return{error:{code:'42501'}};if(mode==='unknown'||mode==='lost-confirmed')return{error:{message:'fetch'}};return{data:{ok:true,item_id:'item',retired_paths:['old-before','old-after']}};}},
    closePortfolioEditor(){},loadPortfolio:async()=>{if(mode==='load-fail')throw Error('reload');}
  });
  return{box,notices,errors,removed,rpcCalls,form,button};
}
for(const mode of ['success','second-upload','reject','unknown','lost-confirmed','cleanup-fail','load-fail']) test(`portfolio paired write ${mode} preserves original storage until commit`,async()=>{
  const f=portfolioFixture(mode);
  await f.box.savePortfolioItem({preventDefault(){},currentTarget:f.form,submitter:f.button});
  assert.equal(f.button.disabled,false);
  if(['success','cleanup-fail','load-fail'].includes(mode)) {
    assert.deepEqual(f.removed,[['old-before','old-after']]);
    assert.ok(f.notices.some(m=>/сохранена/.test(m)));
  } else if(mode==='lost-confirmed') {
    assert.deepEqual(f.removed,[[]]);
    assert.ok(f.notices.some(m=>/сохранена/.test(m)));
  } else if(mode==='second-upload') {assert.equal(f.rpcCalls.length,0);assert.deepEqual(f.removed,[['new-before']]);}
  else if(mode==='reject') {assert.deepEqual(f.removed,[['new-before','new-after']]);assert.equal(f.form.dataset.saveUncertain,undefined);}
  else {assert.equal(f.removed.length,0);assert.equal(f.form.dataset.saveUncertain,'true');assert.match(f.errors[0],/не удалось подтвердить/i);}
  if(f.rpcCalls.length){assert.equal(f.rpcCalls[0].name,'save_provider_portfolio_item');assert.equal(f.rpcCalls[0].args.p_photos.length,2);assert.equal(f.rpcCalls[0].args.p_expected_updated_at,'2026-09-08T10:00:00Z');}
});
for(const mode of ['db-refused','zero-row','deleted','cleanup-failed']) test(`portfolio delete ${mode} removes DB references first`,async()=>{
  const actions=[],notices=[];
  const query={delete(){actions.push('db-delete');return this;},eq(){return this;},select(){return this;},then(resolve){resolve(mode==='deleted'||mode==='cleanup-failed'?{data:[{id:'item'}]}:{data:[],error:mode==='db-refused'?{code:'42501'}:null});},maybeSingle:async()=>({data:{id:'item'}})};
  const box=context(['deletePortfolioItem'],{requireWrites:()=>true,portfolioItems:[{id:'item',photos:[{storage_path:'original'}]}],currentUser:{id:'owner'},confirm:()=>true,db:{from:()=>query},removePortfolioStorage:async()=>{actions.push('storage-delete');return mode!=='cleanup-failed';},notify:m=>notices.push(m),loadPortfolio:async()=>actions.push('reload')});
  await box.deletePortfolioItem('item');
  if(['db-refused','zero-row'].includes(mode)){assert.deepEqual(actions,['db-delete']);assert.match(notices[0],/не подтверждено/);}
  else{assert.deepEqual(actions,['db-delete','storage-delete','reload']);if(mode==='cleanup-failed')assert.match(notices[0],/пока остались/);}
});

for(const mode of ['offline','invalid','other']) test(`login error classification ${mode}`,async()=>{
  const errors=[],fields={'#loginEmail':node('fixture@example.invalid'),'#loginPassword':node('password')};
  const error=mode==='offline'?{name:'AuthRetryableFetchError'}:mode==='invalid'?{code:'invalid_credentials'}:{status:500};
  const box=context(['login','authConnectionFailed'],{navigator:{onLine:true},clearFormError(){},$:id=>fields[id],db:{auth:{signInWithPassword:async()=>({error})}},showFormError:(_id,m)=>errors.push(m)});
  const button=node();await box.login({preventDefault(){},submitter:button});
  assert.equal(button.disabled,false);
  assert.match(errors[0],mode==='offline'?/Нет связи/:mode==='invalid'?/Неверный email/:/позже/);
});
for(const mode of ['missing','expired','verified','offline']) test(`recovery screen requires verified session ${mode}`,async()=>{
  const nodes=new Map(),errors=[];let finished=0;
  const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const box=context(['showRecoveryReset','showRecoveryRequest','authConnectionFailed'],{recoveryMode:true,recoverySessionVerified:false,navigator:{onLine:mode!=='offline'},URLSearchParams,location:{hash:mode==='expired'?'#error_code=otp_expired':'#type=recovery'},db:{auth:{getUser:async()=>mode==='verified'?{data:{user:{id:'owner'}}}:{error:mode==='offline'?{name:'AuthRetryableFetchError'}:null,data:{user:null}}}},$,setTimeout:fn=>fn(),showFormError:(_id,m)=>errors.push(m),finishProviderBoot:()=>finished++});
  await box.showRecoveryReset();
  assert.equal(box.recoverySessionVerified,mode==='verified');assert.equal(finished,1);
  if(mode!=='verified'){assert.equal($('#resetPasswordForm').hidden,true);assert.doesNotMatch($('#authDescription').textContent,/Ссылка подтверждена/);assert.match(errors[0],mode==='offline'?/интернету/:/устарела/);}
  else{assert.equal($('#resetPasswordForm').hidden,false);assert.match($('#authDescription').textContent,/Ссылка подтверждена/);}
});

test('onboarding completion restores actual today before opening bookings',()=>{
  assert.match(source,/onComplete: \(\) => \{\s*restoreDefaultScheduleView\(\);\s*setProviderView\('bookings'/);
});
