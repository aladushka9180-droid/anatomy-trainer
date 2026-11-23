import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function validateSchema(value) {
  assert.equal(value?.version,1);
  assert.deepEqual(Object.keys(value).sort(),['functions','tables','version']);
  assert.ok(Array.isArray(value.functions) && value.functions.length>0 && value.functions.length<20);
  const allowedFunctions=new Set(['get_available_slots','get_available_slots_v101','book_appointment','book_minuta_appointment_v2','get_public_minuta_available_slots_v101','minuta_block_slot_valid_v141','get_provider_block_slots_v141','create_provider_block_v141']);
  for(const item of value.functions){
    assert.deepEqual(Object.keys(item).sort(),['definition','identity','name']);
    assert.ok(allowedFunctions.has(item.name));
    assert.match(item.identity,new RegExp('^(?:public\\.)?'+item.name+'\\('));
    assert.ok(typeof item.definition==='string' && item.definition.length<200000);
    assert.match(item.definition,new RegExp('^CREATE OR REPLACE FUNCTION public\\.'+item.name+'\\('));
  }
  for(const name of ['get_available_slots','book_appointment']) assert.ok(value.functions.some(f=>f.name===name),'Required canonical routine missing: '+name);
  assert.ok(Array.isArray(value.tables) && value.tables.length===4);
  assert.deepEqual(value.tables.map(t=>t.name).sort(),['bookings','provider_days_off','provider_schedule','services']);
  for(const table of value.tables){
    assert.deepEqual(Object.keys(table).sort(),['columns','constraints','name','triggers']);
    assert.ok(Array.isArray(table.columns) && table.columns.length>0);
    for(const c of table.columns){assert.deepEqual(Object.keys(c).sort(),['name','not_null','type']);assert.equal(typeof c.not_null,'boolean');}
  }
  // Fail closed before any artifact upload if a routine embeds credentials or a URL.
  assert.doesNotMatch(value.functions.map(item=>item.definition).join("\n")+JSON.stringify(value),/https?:\/\/[^\s'"\\]|postgres(?:ql)?:\/\/|(?:sb_secret_|sk-proj-|eyJ)[A-Za-z0-9_-]{8,}|(?:password|service_role_key|api_key)\s*[:=]\s*['"][^'"]+/i);
  return value;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const schema=validateSchema(JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')));
    writeFileSync(process.argv[3],JSON.stringify(schema,null,2),{mode:0o600});
    console.log('Validated scheduling catalog only; no customer rows or connection strings exported.');
  } catch {
    console.error('Scheduling schema metadata failed validation; export withheld.');
    process.exitCode=1;
  }
}
