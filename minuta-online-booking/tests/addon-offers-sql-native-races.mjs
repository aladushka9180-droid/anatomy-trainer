import assert from 'node:assert/strict';
export async function runNativeResourceRaces({db,check,owner,addon,primary,loc,saved,date,originalRequest}) {
 const cfg=await db.connectPeer(),creator=await db.connectPeer();
 const org='20000000-0000-0000-0000-000000000001';
 const ids=['70000000-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000007'];
 const bookSQL="select public.book_minuta_service_offers($1,'synthetic-offers',$2,$3,$4::date,'16:00','Тестовый клиент','79990001122',2438,75,'',$5::jsonb)";
 const bookArgs=id=>[id,loc,primary,date,JSON.stringify([{id:saved.id,revision:saved.revision}])];
 const configs=[org,addon,JSON.stringify([{group_id:'50000000-0000-0000-0000-000000000002',quantity:2}])];
 const waitLock=async pid=>{
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){const r=await db.query("select wait_event_type from pg_stat_activity where pid=$1",[pid]);if(r.rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,25));}
  throw new Error('Did not observe actual PostgreSQL lock contention');
 };
 const pid=async connection=>Number((await connection.query('select pg_backend_pid() pid')).rows[0].pid);
 const settle=promise=>promise.then(value=>({value}),error=>({error}));
 let pending=null;
 try {
  await cfg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await creator.query('set role anon');
  await db.query("update public.bookings set status='cancelled' where request_id=$1",[originalRequest]);
  await check('native config-before-create blocks then rejects inadequate capacity',async()=>{
   await cfg.query('begin;set local statement_timeout=\'10s\';set local lock_timeout=\'8s\';');
   await cfg.query("select pg_advisory_xact_lock(hashtextextended($1,6901))",[org+':'+addon]);
   await cfg.query('update public.service_resource_requirements set quantity=2 where service_id=$1',[addon]);
   const creatorPid=await pid(creator);
   pending=settle(creator.query(bookSQL,bookArgs(ids[0])));
   await waitLock(creatorPid);
   await cfg.query('commit');
   const result=await pending;pending=null;
   assert.match(result.error?.message || '',/slot_unavailable|resource_unavailable/);
   assert.equal((await db.query('select count(*)::integer n from minuta_offer_private.booking_requests where request_id=$1',[ids[0]])).rows[0].n,0);
  });
  await cfg.query('rollback');if(pending){await pending;pending=null;}
  await db.query('update public.service_resource_requirements set quantity=1 where service_id=$1',[addon]);
  await check('native create-before-config commits visit and rolls back inadequate change',async()=>{
   await creator.query('begin;set local statement_timeout=\'10s\';set local lock_timeout=\'8s\';');
   const ack=(await creator.query(bookSQL,bookArgs(ids[1]))).rows[0].book_minuta_service_offers;assert.equal(ack.result_code,'ok');
   const cfgPid=await pid(cfg);
   await cfg.query('begin;set local statement_timeout=\'10s\';set local lock_timeout=\'8s\';');
   pending=settle(cfg.query('select public.replace_minuta_service_resource_requirements($1,$2,$3::jsonb)',configs));
   await waitLock(cfgPid);
   await creator.query('commit');
   const updated=await pending;pending=null;
   let failure=updated.error;
   if(!failure){try{await cfg.query('commit');}catch(error){failure=error;}}
   else await cfg.query('rollback');
   assert.match(failure?.message || '',/resource_unavailable|concurrent_booking_update|deadlock|lock timeout/);
   assert.equal((await db.query('select quantity from public.service_resource_requirements where service_id=$1',[addon])).rows[0].quantity,1);
   assert.equal((await db.query('select count(*)::integer n from public.booking_resource_allocations a join public.bookings b on b.id=a.booking_id where b.request_id=$1 and a.booking_status=\'active\'',[ids[1]])).rows[0].n,2);
  });
 } finally {
  // Release the creator's transaction first, then settle a configuration query.
  await creator.query('rollback').catch(()=>{});await cfg.query('rollback').catch(()=>{});
  if(pending)await pending;
  await cfg.close();await creator.close();
  await db.query('delete from public.booking_resource_allocations where booking_id in(select id from public.bookings where request_id=any($1::uuid[]))',[ids]);
  await db.query('delete from public.booking_session_items where booking_id in(select id from public.bookings where request_id=any($1::uuid[]))',[ids]);
  await db.query('delete from public.booking_session_revisions where booking_id in(select id from public.bookings where request_id=any($1::uuid[]))',[ids]);
  await db.query('delete from public.bookings where request_id=any($1::uuid[])',[ids]);
  await db.query('update public.service_resource_requirements set quantity=1 where service_id=$1',[addon]);
  await db.query("update public.bookings set status='confirmed' where request_id=$1",[originalRequest]);
 }
 await check('native locked booking makes deferred requirement change fail closed',async()=>{
  const held=await db.connectPeer();
  try{
   await held.query('begin');await held.query('select id from public.bookings where request_id=$1 for update',[originalRequest]);
   await assert.rejects(()=>db.query('update public.service_resource_requirements set quantity=quantity where service_id=$1',[addon]),e=>e.code==='40001' && /concurrent_booking_update/.test(e.message));
   assert.equal((await db.query("select count(*)::integer n from public.booking_resource_allocations where booking_status='active'")).rows[0].n,2);
  } finally{await held.query('rollback');await held.close();}
 });
}
