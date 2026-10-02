import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PGlite } = process.env.MINUTA_PGLITE_PACKAGE
  ? require(path.join(process.env.MINUTA_PGLITE_PACKAGE, 'dist/index.cjs'))
  : require('@electric-sql/pglite');
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n','\n');
const original = read('../provider.js');
const applyCandidate = source => {
  const patch = read('../recovery/service-delete-history.patch').split('diff --git ')[1];
  const lines = patch.slice(patch.indexOf('@@', patch.indexOf('@@') + 2) + 2).split('\n');
  const before = lines.filter(line => line.startsWith(' ') || line.startsWith('-')).map(line => line.slice(1)).join('\n');
  const after = lines.filter(line => line.startsWith(' ') || line.startsWith('+')).map(line => line.slice(1)).join('\n');
  assert.equal(source.split(before).length, 2, 'Candidate must match the current handler exactly once');
  return source.replace(before, after);
};
export const candidateSource = process.argv.includes('--integrated') ? original : applyCandidate(original);
const handler = source => {
  const start = source.indexOf("  if (remove && confirm('Удалить услугу?");
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf('  if (removeDayOff)', start));
  return new (Object.getPrototypeOf(async function() {}).constructor)(
    'remove','confirm','db','notify','saveServiceScheduleName','refreshAfterWrite','servicePublicDetails','SERVICE_IMAGE_BUCKET','currentUser',body);
};
export const candidateBody = candidateSource.slice(candidateSource.indexOf("  if (remove && confirm('Удалить услугу?"),candidateSource.indexOf('  if (removeDayOff)',candidateSource.indexOf("  if (remove && confirm('Удалить услугу?")));
const before = handler(original);
const after = handler(candidateSource);
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const service = '33333333-3333-4333-8333-333333333333';
const db = new PGlite();
const proofs = [];
try {
  await db.exec(read('./services-42501-fixture.sql'));
  await db.query('insert into public.services(id,performer_id,name,duration_minutes,price_rub) values($1,$2,$3,150,3333)',[service,owner,'Synthetic service']);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const relations = [
    ['supabase-migration-v111.sql','organization_waitlist_requests'],
    ['supabase-migration-v73.sql','benefit_product_services'],
    ['supabase-migration-v73.sql','benefit_instrument_service_balances'],
    ['supabase-migration-v73.sql','benefit_redemptions'],
    ['supabase-migration-v69.sql','service_resource_requirements'],
    ['supabase-migration-v61.sql','booking_reviews']
  ];
  const execute = async (run, rpcError, userId = owner, fakeResult) => {
    const calls=[],messages=[];
    const api = {
      rpc:async(name,args)=>{assert.equal(name,'provider_delete_service');assert.equal(args.p_service,service);return rpcError ? {error:rpcError} : {data:'deleted'};},
      from:table=>{
        assert.equal(table,'services');
        return {update:values=>{
          assert.deepEqual(values,{active:false});calls.push('archive');
          const filters = [];
          const chain = {eq:(column,value)=>{filters.push([column,value]);return chain;},select:()=>chain,maybeSingle:async()=>{
            if(fakeResult)return fakeResult;
            try {
              assert.deepEqual(filters,[['id',service],['performer_id',userId]]);
              const result=await db.query('update public.services set active=false where id=$1 and performer_id=$2 returning id,active',[service,userId]);
              return {data:result.rows[0] || null};
            }catch(error){return {error};}
          }};return chain;
        }};
      },
      storage:{from:()=>({remove:async()=>{calls.push('photo-removed');}})}
    };
    await run({dataset:{deleteService:service}},()=>true,api,text=>messages.push(text),async()=>calls.push('short-name-removed'),async()=>calls.push('refresh'),new Map([[service,{photo_storage_path:'synthetic/photo.webp'}]]),'service-images',{id:userId});
    return {calls,messages};
  };
  for(const [migration,relation] of relations){
    await db.exec('reset role');
    const ddl = read('../'+migration).split('create table if not exists public.'+relation+' (')[1]?.split('\n');
    const reference = ddl?.find(line=>line.trim().startsWith('service_id uuid '))?.trim().replace(/,$/,'');
    assert.ok(reference?.includes('references public.services(id)'),relation+' must use the actual repository FK');
    await db.exec(`create table public.${relation}(id integer primary key, ${reference}); insert into public.${relation}(id,service_id) values(1,'${service}'); update public.services set active=true; set role authenticated;`);
    let dependency;
    try {await db.query('delete from public.services where id=$1',[service]);} catch(error) {dependency=error;}
    assert.equal(dependency?.code,'23503');
    assert.match(dependency.message,/update or delete on table "services" violates foreign key constraint/i);
    if(relation !== 'organization_waitlist_requests' && !process.argv.includes('--integrated')) {
      const baseline = await execute(before,dependency);
      assert.match(baseline.messages[0],/Не удалось удалить/);
      assert.ok(!baseline.calls.includes('archive'));
      assert.equal((await db.query('select active from public.services where id=$1',[service])).rows[0].active,true);
    }
    const fixed = await execute(after,dependency);
    assert.match(fixed.messages[0],/Услуга скрыта/);
    assert.ok(!fixed.calls.includes('photo-removed') && !fixed.calls.includes('short-name-removed'));
    assert.equal((await db.query('select active from public.services where id=$1',[service])).rows[0].active,false);
    await db.exec('reset role');
    assert.equal((await db.query(`select count(*)::int as count from public.${relation}`)).rows[0].count,1);
    await db.exec(`drop table public.${relation};`);
    proofs.push(relation+': dependency failure -> hide; service/photo/reference retained');
  }
  await db.exec('set role authenticated');
  for(const error of [{code:'23503',message:'other_relation'},{code:'42501',message:'service_access_denied'},{code:'PGRST202',message:'missing_rpc'},{code:'23505',message:'duplicate'},{message:'network_failure'}]){
    const result=await execute(after,error);
    assert.deepEqual(result.calls,['refresh']);
    assert.match(result.messages[0],/Не удалось удалить/);
  }
  proofs.push('Unrelated FK, permission, RPC, uniqueness and transport errors never trigger a write');
  const conflict={code:'23503',message:'update or delete on table "services" violates foreign key constraint "synthetic" on table "booking_reviews"'};
  const foreign=await execute(after,conflict,other);
  assert.match(foreign.messages[0],/Не удалось удалить/);
  for(const data of [null,{id:service,active:true},{id:other,active:false}]){
    const result=await execute(after,conflict,owner,{data});
    assert.match(result.messages[0],/Не удалось удалить/);
  }
  const rejected=await execute(after,conflict,owner,{error:{code:'42501'}});
  assert.match(rejected.messages[0],/Не удалось удалить/);
  proofs.push('Foreign owner, rejected write, missing/mismatched/active returned row never report success');
  const deleted=await execute(after,null);
  assert.deepEqual(deleted.calls,['short-name-removed','photo-removed','refresh']);
  assert.equal(deleted.messages[0],'Услуга удалена');
  proofs.push('Successful deletion retains existing cleanup');
  console.log('PASS: '+proofs.length+' focused checks\n'+proofs.join('\n'));
}finally {await db.close();}
