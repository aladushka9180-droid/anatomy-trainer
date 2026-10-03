const PREFIX='minuta.catalog.draft.v2:';
const MAX_AGE=24*60*60*1000;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone=value=>JSON.parse(JSON.stringify(value));
export const CONTEXT_FIELDS=Object.freeze(['clientId','bookingId','sellerId','paymentMethod','paymentAccountId','warehouseId']);
export function draftKey(orgId,actorId){return orgId&&actorId?PREFIX+encodeURIComponent(actorId)+':'+encodeURIComponent(orgId):null;}
function validPending(pending,scope){
 if(pending==null)return true;
 if(!['sale','item','import','bundle'].includes(pending.kind)||!uuidPattern.test(pending.requestId)||!Number.isFinite(pending.createdAt)||!pending.payload||typeof pending.payload!=='object')return false;
 if(pending.kind==='sale')return pending.payload.p_organization===scope.orgId&&pending.payload.p_request_id===pending.requestId&&Array.isArray(pending.payload.p_lines)&&pending.payload.p_lines.length>0&&pending.payload.p_lines.length<=50;
 return pending.payload.requestId===pending.requestId;
}
function valid(value,scope){
 return value?.version===2&&value.orgId===scope.orgId&&value.actorId===scope.actorId&&Number.isFinite(value.savedAt)
 &&value.context&&CONTEXT_FIELDS.every(key=>value.context[key]===null||typeof value.context[key]==='string')
 &&Array.isArray(value.lines)&&value.lines.length<=50&&value.lines.every(line=>typeof line?.lineId==='string'&&line.lineId.length<=80&&typeof line.quantity==='string'&&line.quantity.length<=30
 &&(typeof line.itemId==='string'||typeof line.bundleId==='string'&&Array.isArray(line.components)&&line.components.length<=30))
 &&validPending(value.pending,scope);
}
export function createDraftStore(storage,scope,now=()=>Date.now()){
 const key=draftKey(scope.orgId,scope.actorId);let corrupt=false;
 function write(value){if(!key||corrupt)return false;try{storage?.setItem(key,JSON.stringify(value));return Boolean(storage);}catch{return false;}}
 function remove(){try{if(key)storage?.removeItem(key);return true;}catch{return false;}}
 return {
 load(){
  if(!key)return null;
  try{const raw=storage?.getItem(key);if(!raw)return null;
   if(raw.length>2000000){corrupt=true;return {corrupt:true};}
   const value=JSON.parse(raw);if(!valid(value,scope)){corrupt=true;return {corrupt:true};}
   // Pending never expires: only an authoritative outcome can release it.
   if(!value.pending&&(now()-value.savedAt<0||now()-value.savedAt>MAX_AGE)){remove();return null;}
   // Unset client at startup is different from an explicit client selection.
   if(!value.pending&&Object.hasOwn(scope,'clientId')&&scope.clientId!==undefined&&(scope.clientId||null)!==value.context.clientId)return null;
   return clone(value);
  }catch{corrupt=true;return {corrupt:true};}
 },
 save(draft){
  const value={version:2,orgId:scope.orgId,actorId:scope.actorId,savedAt:now(),context:Object.fromEntries(CONTEXT_FIELDS.map(key=>[key,draft.context?.[key]||null])),lines:clone(draft.lines||[]),pending:clone(draft.pending||null)};
  return valid(value,scope)&&JSON.stringify(value).length<=2000000&&write(value);
 },
 clear({confirmed=false}={}){
  const raw=this.load();if((raw?.pending||raw?.corrupt)&&!confirmed)return false;
  corrupt=false;return remove();
 },
 };
}
export function receiptMatches(pending,receipt,orgId){
 if(pending?.kind!=='sale'||!receipt||receipt.found===false)return false;
 return receipt.organization_id===orgId&&receipt.organization_id===pending.payload.p_organization
 &&receipt.request_id===pending.requestId&&receipt.client_account_id===(pending.payload.p_client_account||null)&&uuidPattern.test(String(receipt.id||''));
}
export function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(deepFreeze);}return value;}
/** Explicit logout: discard editable draft, retain exact unresolved request for this actor. */
export function cleanupActorDrafts(storage,actorId){
 if(!storage||!actorId)return;const prefix=PREFIX+encodeURIComponent(actorId)+':';
 try{const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix))keys.push(key);}
 for(const key of keys){let value;try{value=JSON.parse(storage.getItem(key));}catch{continue;}
 if(value?.pending){value.lines=[];value.context=Object.fromEntries(CONTEXT_FIELDS.map(field=>[field,null]));storage.setItem(key,JSON.stringify(value));}
 else storage.removeItem(key);}
 }catch{/* Do not remove recovery data if storage is unavailable. */}
}
