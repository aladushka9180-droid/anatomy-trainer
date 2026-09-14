import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../provider.js',import.meta.url),'utf8');
const start=source.indexOf("  if (remove && confirm('Удалить услугу?");
assert.ok(start>0);
const body=source.slice(start,source.indexOf('  if (removeDayOff)',start));
const run=new (Object.getPrototypeOf(async function(){}).constructor)('remove','confirm','db','notify','saveServiceScheduleName','refreshAfterWrite','servicePublicDetails','SERVICE_IMAGE_BUCKET',body);
for (const kind of ['waitlist','other','success','denied']) {
  const calls=[],messages=[];
  const db={rpc:async()=>kind==='success'?{data:'deleted'}:{error:{code:'23503',message:kind==='other'?'other_relation':'organization_waitlist_requests_service_id_fkey'}},
    storage:{from:bucket=>{assert.equal(bucket,'service-images');return {remove:async paths=>{assert.deepEqual(paths,['owner/services/service-a/photo.webp']);calls.push('photo-removed');}};}},
    from:table=>{assert.equal(table,'services');return {update:values=>{assert.deepEqual(values,{active:false});calls.push('archive');return {
      eq:(column,id)=>{assert.equal(column,'id');assert.equal(id,'service-a');return {select:()=>({maybeSingle:async()=>kind==='denied'?{data:null}:{data:{id}}})};}
    };}};}};
  const details=new Map([['service-a',{photo_storage_path:'owner/services/service-a/photo.webp'}]]);
  await run({dataset:{deleteService:'service-a'}},()=>true,db,message=>messages.push(message),async(id,enabled)=>{calls.push(`short-name:${id}:${enabled}`);},async()=>calls.push('refresh'),details,'service-images');
  assert.equal(calls.includes('archive'),['waitlist','denied'].includes(kind));
  assert.equal(calls.includes('short-name:service-a:false'),kind==='success');
  assert.equal(calls.includes('photo-removed'),kind==='success');
  assert.equal(messages[0].includes('Не удалось'),['other','denied'].includes(kind));
  assert.equal(calls.at(-1),'refresh');
}
console.log('PASS: services with scoped waitlist history archive safely; unrelated errors and denied writes remain errors');
