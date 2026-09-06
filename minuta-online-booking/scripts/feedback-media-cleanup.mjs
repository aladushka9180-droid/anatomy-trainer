import {pathToFileURL} from 'node:url';
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const pathPattern=new RegExp(`^${UUID}/${UUID}/${UUID}\\.(webp|mp4|webm|mov)$`,'i');
const tokenPattern=new RegExp(`^${UUID}$`,'i');
const canonicalPathPattern=new RegExp(`^${UUID}/${UUID}/${UUID}\\.(webp|mp4|webm|mov)$`);
export async function cleanupFeedbackMedia({baseUrl,expectedProjectRef,serviceKey,apply=false,manifestPaths,fetchImpl=fetch}){
  const base=new URL(baseUrl);
  if(!/^[a-z0-9]{10,32}$/.test(expectedProjectRef||'')||base.origin!==`https://${expectedProjectRef}.supabase.co`
    ||base.username||base.password||base.search||base.hash||base.pathname!=='/'||!serviceKey)throw Error('invalid_cleanup_configuration');
  let manifest;
  if(manifestPaths!==undefined){
    if(!Array.isArray(manifestPaths)||manifestPaths.length<1||manifestPaths.length>50
      ||[...manifestPaths].some(path=>typeof path!=='string'||path!==path.trim()||!canonicalPathPattern.test(path))
      ||new Set(manifestPaths).size!==manifestPaths.length)throw Error('invalid_cleanup_manifest');
    manifest=new Set(manifestPaths); // Snapshot before await: caller edits cannot widen this run.
  }
  const headers={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'};
  const request=(path,options={})=>fetchImpl(new URL(path,base),{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(30000)});
  const rpc=async(name,args)=>{const r=await request(`/rest/v1/rpc/${name}`,{method:'POST',body:JSON.stringify(args)});if(!r.ok)throw Error('cleanup_rpc_failed');return r.json();};
  if(!apply){
    const filter=manifest?'&object_path=in.('+[...manifest].join(',')+')':'';
    const r=await request('/rest/v1/product_feedback_media_uploads?select=state&state=in.(reserved,cleanup)&limit=100'+filter);
    if(!r.ok)throw Error('cleanup_preview_failed');const rows=await r.json();if(!Array.isArray(rows))throw Error('invalid_cleanup_preview');
    return {mode:'preview',boundedCandidateCount:rows.length,deleted:0};
  }
  const claimed=manifest
    ?await rpc('claim_minuta_feedback_cleanup_paths_v116',{p_paths:[...manifest]})
    :await rpc('claim_minuta_feedback_cleanup_v116',{p_limit:50});
  if(!Array.isArray(claimed)||claimed.length>50||claimed.some(row=>!pathPattern.test(row?.path||'')||!tokenPattern.test(row?.token||''))
    ||new Set(claimed.map(row=>row.path)).size!==claimed.length
    ||(manifest&&claimed.some(row=>!manifest.has(row.path))))throw Error('invalid_cleanup_claim');
  let deleted=0,failed=0;
  for(const row of claimed){
    try{
      const removal=await request('/storage/v1/object/product-feedback-media',{method:'DELETE',body:JSON.stringify({prefixes:[row.path]})});
      if(!removal.ok&&removal.status!==404)throw Error('storage_remove_failed');
      await removal.body?.cancel();
      // A 200 DELETE alone is not enough to finalize the lease: verify absence.
      const probe=await request('/storage/v1/object/authenticated/product-feedback-media/'+row.path,{headers:{Range:'bytes=0-0'}});
      let absent=probe.status===404;
      if(!absent&&!probe.ok){const body=await probe.json().catch(()=>null);absent=String(body?.statusCode)==='404'&&['not_found','NotFound'].includes(body?.error);}
      else await probe.body?.cancel();
      if(!absent)throw Error('storage_absence_unconfirmed');
      if(await rpc('finish_minuta_feedback_cleanup_v116',{p_path:row.path,p_token:row.token})!==true)throw Error('cleanup_ack_invalid');
      deleted++;
    }catch{failed++;}
  }
  // No names, paths, tokens, messages or keys enter logs/results.
  return {mode:'apply',claimed:claimed.length,deleted,failed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const apply=process.env.MINUTA_MEDIA_CLEANUP_CONFIRM==='DELETE_ONLY_CLAIMED_FEEDBACK_ORPHANS';
    if(process.env.MINUTA_MEDIA_CLEANUP_CONFIRM&&!apply)throw Error('invalid_cleanup_confirmation');
    const result=await cleanupFeedbackMedia({baseUrl:process.env.MINUTA_MEDIA_SUPABASE_URL,expectedProjectRef:process.env.MINUTA_MEDIA_PROJECT_REF,serviceKey:process.env.MINUTA_MEDIA_SERVICE_KEY,apply});
    console.log(JSON.stringify(result));if(result.failed)process.exitCode=1;
  }catch{console.error('Feedback media cleanup stopped: configuration, access or verification failed.');process.exitCode=1;}
}
