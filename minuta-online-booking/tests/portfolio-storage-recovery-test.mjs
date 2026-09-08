import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Actual portfolio functions; in-memory Storage/RPC boundaries only, no network.
const source=readFileSync(new URL('../provider.js',import.meta.url),'utf8');
const between=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)+a.length));
const functions=between('async function savePortfolioPhoto(', 'async function persistPortfolioOrder(');
function fixture(mode='unknown'){
 const values={portfolioItemId:'',portfolioProcedure:'Процедура',portfolioArea:'',portfolioSessions:'',portfolioDescription:''};
 const fields=Object.fromEntries(Object.entries(values).map(([k,value])=>['#'+k,{value}]));
 fields['#portfolioConsent']={checked:false};fields['#portfolioPublished']={checked:false};
 const events=[],form={dataset:{},isConnected:true},button={disabled:false,textContent:''};
 const db={storage:{from:()=>({upload:async path=>{events.push(['upload',path]);return {error:null};},remove:async paths=>{events.push(['remove',paths]);return {error:null};}})},
  rpc:async()=>{events.push(['rpc']);return {data:null,error:{code:mode==='rejected'?'22023':'',message:'response lost'}};},from:()=>{throw Error('verification boundary is stubbed');}};
 const s={console,Date,currentUser:{id:'actor-a'},sessionGeneration:1,portfolioEditorRevision:1,portfolioRemoteAvailable:true,portfolioItems:[],portfolioPhotoDrafts:{before:{name:'local.webp'}},PORTFOLIO_BUCKET:'portfolio-images',db,
  sessionIsCurrent:(userId,generation)=>s.currentUser?.id===userId&&s.sessionGeneration===generation,
  $:selector=>fields[selector],requireWrites:()=>true,clearFormError(){},showFormError:(id,m)=>events.push(['error',m]),notify:m=>events.push(['notice',m]),
  createPortfolioPhotoId:()=> 'photo-id',preparePortfolioImage:async()=>({blob:{},width:320,height:240}),portfolioAfterSessionWord:()=>'',
  closePortfolioEditor:()=>events.push(['close']),loadPortfolio:async()=>events.push(['load']),confirm:()=>true};
 vm.createContext(s);vm.runInContext(functions,s);s.verifyPortfolioSave=async()=>mode==='lost-confirmed';
 return {s,events,form,button,event:{preventDefault(){},currentTarget:form,submitter:button}};
}
test('lost metadata success proven by exact read preserves linked staged Storage file',async()=>{
 const f=fixture('lost-confirmed');await f.s.savePortfolioItem(f.event);
 assert.equal(f.events.filter(x=>x[0]==='upload').length,1);assert.equal(f.events.some(x=>x[0]==='remove'),false);assert.ok(f.events.some(x=>x[0]==='close'));
});
test('unconfirmed metadata keeps uploaded file and blocks repeat in same form',async()=>{
 const f=fixture();await f.s.savePortfolioItem(f.event);await f.s.savePortfolioItem(f.event);
 assert.equal(f.form.dataset.saveUncertain,'true');assert.equal(f.events.filter(x=>x[0]==='rpc').length,1);assert.equal(f.events.some(x=>x[0]==='remove'),false);
});
test('exact transaction refusal cleans only the new unlinked staged object',async()=>{
 const f=fixture('rejected');await f.s.savePortfolioItem(f.event);
 const uploaded=f.events.find(x=>x[0]==='upload')[1],removed=f.events.find(x=>x[0]==='remove')[1];assert.deepEqual([...removed],[uploaded]);
});
test('actor change during image preparation must not upload old form into replacement account',async()=>{
 const f=fixture();let resolve;f.s.preparePortfolioImage=()=>new Promise(r=>resolve=r);
 const pending=f.s.savePortfolioItem(f.event);f.s.currentUser={id:'actor-b'};resolve({blob:{},width:320,height:240});await pending;
 assert.equal(f.events.filter(x=>x[0]==='upload').length,0,'Old actor A form uploaded under current actor B prefix');
});
