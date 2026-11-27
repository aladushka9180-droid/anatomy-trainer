// SOURCE only: caller must supply backendAccepted after ROOT's backend acceptance.
// No UI/control, global runtime, or production capability is enabled by importing this file.
(function(root){'use strict';
 const contract='s10-branch-v1';
 const sources=Object.freeze({get_minuta_staff_report_bookings_v97:'bookings',get_minuta_staff_report_bookings:'bookings',get_minuta_staff_report_availability:'availability',get_minuta_team_analytics:'team',get_minuta_finance_screen_v163:'finance',get_minuta_retention_workspace:'retention',get_minuta_utm_funnel_v107:'utm',get_minuta_booking_events_v97:'history',get_minuta_booking_events:'history'});
 function create({rpc,getIdentity,backendAccepted=false,onChange=()=>{}}){
  backendAccepted=backendAccepted===true;
  let locationId=null,revision=0,identityKey='',records=new Map();
  const identity=()=>{const value=getIdentity();if(!value?.userId||!value.organizationId||!value.role)throw new Error('branch_identity_required');return value};
  const keyOf=value=>JSON.stringify(value);
  function context(){const actor=identity();const next=keyOf(actor);if(identityKey!==next){identityKey=next;revision++;records.clear();}return{...actor,locationId,revision}}
  function setLocation(value){if(!backendAccepted)throw new Error('branch_backend_not_accepted');const next=value||null;if(next!==locationId){locationId=next;revision++;records.clear();onChange(context())}}
  function snapshot({start,end,performerId=null}={}){const c=context();return{...c,start,end,performerId:['owner','admin'].includes(c.role)?performerId:c.userId}}
  function current(c){try{return keyOf({...snapshot(c)})===keyOf(c)}catch{return false}}
  function cacheKey(source,c){return keyOf({contract,source,...c})}
  function envelopeValid(value,source,c){const s=value?.scope;return value?.contract===contract&&value.source===source&&s?.actor_id===c.userId&&s.role===c.role&&s.organization_id===c.organizationId&&(s.location_id||null)===c.locationId&&s.start===c.start&&s.end===c.end&&(s.performer_id||null)===c.performerId&&typeof value.available==='boolean'&&(!value.available?value.data===null&&typeof value.reason==='string':value.data&&typeof value.data==='object')}
  async function read(source,range,{cursor=null,limit=1000}={}){
   if(!backendAccepted)throw new Error('branch_backend_not_accepted');
   const c=snapshot(range),key=cacheKey(source,c);
   if(cursor&&cursor.clientScope!==key)throw new Error('stale_branch_cursor');
   records.set(key,{status:'loading',scope:c,data:null});
   let response;try{response=await rpc('get_minuta_statistics_branch_candidate',{p_organization:c.organizationId,p_start:c.start,p_end:c.end,p_performer:c.performerId,p_location:c.locationId,p_source:source,p_limit:limit,p_cursor:cursor?.server||null})}catch(error){response={error}}
   if(!current(c))throw new Error('stale_branch_reply');
   if(response?.error){records.set(key,{status:'error',scope:c,data:null,error:response.error});throw response.error}
   if(!envelopeValid(response?.data,source,c)){records.set(key,{status:'error',scope:c,data:null});throw new Error('branch_echo_mismatch')}
   const value=response.data;
   if(c.locationId&&source==='bookings'&&(!Array.isArray(value.data?.bookings)||value.data.bookings.some(row=>row.organization_id!==c.organizationId||row.location_id!==c.locationId||c.performerId&&row.performer_id!==c.performerId))){records.set(key,{status:'error',scope:c,data:null});throw new Error('branch_row_mismatch');}
   const record={status:value.available?'ready':'unavailable',scope:c,data:value.data,reason:value.reason||'',cursor:value.next_cursor?{clientScope:key,server:value.next_cursor}:null};records.set(key,record);return record;
  }
  function cached(source,range){const c=snapshot(range);return records.get(cacheKey(source,c))||{status:'idle',scope:c,data:null}}
  function persisted(source,range){const record=cached(source,range);return record.status==='ready'?{contract,key:cacheKey(source,record.scope),record}:null}
  function restore(source,range,stored){const c=snapshot(range),key=cacheKey(source,c);if(stored?.contract!==contract||stored.key!==key||stored.record?.status!=='ready'||keyOf(stored.record.scope)!==keyOf(c))return false;records.set(key,stored.record);return true}
  function exportParams(range,phoneMode='masked'){if(!['masked','none','full'].includes(phoneMode))throw new Error('invalid_phone_mode');const c=snapshot(range);if(phoneMode==='full'&&c.role!=='owner')throw new Error('full_phone_export_owner_required');return{p_organization:c.organizationId,p_start:c.start,p_end:c.end,p_performer:c.performerId,p_location:c.locationId,p_phone_mode:phoneMode}}
  async function readLegacy(name,args){
   if(!backendAccepted)return rpc(name,args);
   const source=sources[name];if(!source)throw new Error('branch_source_not_bound');
   try {
   const actor=identity();
   if(args.p_organization!==undefined&&args.p_organization!==actor.organizationId)throw new Error('stale_request_organization');
   if(!['owner','admin'].includes(actor.role)&&args.p_performer&&args.p_performer!==actor.userId)throw new Error('staff_report_access_denied');
   const range={start:args.p_start,end:args.p_end,performerId:args.p_performer||null};
   // Existing offset pagination must not create an unbound page. The adapter advances
   // only the exact prior cursor under the same actor/role/location/range/source key.
   const previous=cached(source,range);let cursor=null;
   if(args.p_offset||args.p_before_key){cursor=previous.cursor;if(!cursor||source!=='finance'&&cursor.server.offset!==args.p_offset||source==='finance'&&(cursor.server.legacy?.event_key!==args.p_before_key||cursor.server.legacy?.occurred_at!==args.p_before_occurred_at))return{data:null,error:{code:'S10_STALE_CURSOR',message:'stale_branch_cursor'}}}
   const value=await read(source,range,{cursor,limit:args.p_limit||1000});return value.status==='unavailable'?{data:null,error:{code:'S10_METRIC_UNAVAILABLE',message:value.reason}}:{data:value.data,error:null}}
   catch(error){return{data:null,error:{code:'S10_SCOPE_REJECTED',message:error.message||'branch_scope_rejected'}}}
  }
  return Object.freeze({get enabled(){return backendAccepted},get locationId(){return locationId},get token(){return keyOf(context())},setLocation,snapshot,current,read,cached,persisted,restore,exportParams,readLegacy});
 }
 root.MinutaStatisticsBranchScope=Object.freeze({contract,create,sources});
})(typeof window==='undefined'?globalThis:window);
