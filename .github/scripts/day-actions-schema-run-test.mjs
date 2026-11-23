import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const sample=()=>({version:1,functions:['get_available_slots','book_appointment'].map(name=>({name,identity:name+'(uuid)',definition:'CREATE OR REPLACE FUNCTION public.'+name+'(p_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL $$;'})),tables:['bookings','provider_days_off','provider_schedule','services'].map(name=>({name,columns:[{name:'id',type:'uuid',not_null:true}],constraints:[],triggers:[]}))});
const dir=mkdtempSync(join(tmpdir(),'eldion-schema-diagnostic-')),input=join(dir,'input.json'),output=join(dir,'output.json');
const run=value=>{writeFileSync(input,JSON.stringify(value));return spawnSync(process.execPath,[fileURLToPath(new URL('./day-actions-schema-run.mjs',import.meta.url)),input,output],{encoding:'utf8'});};
try {
  const good=sample(),pass=run(good);assert.equal(pass.status,0);assert.deepEqual(JSON.parse(readFileSync(output,'utf8')),good);unlinkSync(output);
  const marker='dummy_sensitive_marker_123456',bad=sample();bad.functions[0].definition+=' -- https://example.invalid/'+marker;
  const rejected=run(bad);assert.equal(rejected.status,1);assert.equal(existsSync(output),false);
  assert.match(rejected.stderr,/SCHEMA_RULE_L\d+/);assert.ok(!rejected.stderr.includes(marker) && !rejected.stdout.includes(marker));assert.ok(!rejected.stderr.includes('CREATE OR REPLACE'));
  const malformed=run({rows:[marker]});assert.equal(malformed.status,1);assert.equal(existsSync(output),false);assert.ok(!malformed.stderr.includes(marker));
} finally {unlinkSync(input);if(existsSync(output))unlinkSync(output);rmdirSync(dir);}
console.log('GitHub schema diagnostic: exact export, safe rejection code and no rejected contents in logs PASS');

const workflow=readFileSync(new URL('../workflows/minuta-day-actions-schema-read.yml',import.meta.url),'utf8');
const runner=workflow.indexOf('node .github/scripts/day-actions-schema-run.mjs');
assert.ok(runner>=0 && runner<workflow.indexOf('actions/upload-artifact@'),'validated runner must precede artifact upload');
