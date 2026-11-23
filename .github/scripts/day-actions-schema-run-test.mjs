import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const sample=()=>({version:1,functions:['get_available_slots','book_appointment'].map(name=>({name,identity:name+'(uuid)',definition:'CREATE OR REPLACE FUNCTION public.'+name+'(p_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL $$;'})),tables:['bookings','provider_days_off','provider_schedule','services'].map(name=>({name,columns:[{name:'id',type:'uuid',not_null:true}],constraints:[],triggers:[]}))});
const dir=mkdtempSync(join(tmpdir(),'eldion-schema-review-')),input=join(dir,'input.json'),output=join(dir,'output.json'),fingerprints=join(dir,'source-fingerprints.json');
const run=value=>{writeFileSync(input,JSON.stringify(value));return spawnSync(process.execPath,[fileURLToPath(new URL('./day-actions-schema-run.mjs',import.meta.url)),input,output],{encoding:'utf8'});};
const clean=()=>{for(const f of [output,fingerprints])if(existsSync(f))unlinkSync(f);};
try {
  const good=sample(),pass=run(good);assert.equal(pass.status,0);assert.deepEqual(JSON.parse(readFileSync(output,'utf8')),good);clean();
  for(const literal of ['https://example.invalid/dummy_sensitive_marker','postgres://dummy:dummy@host/database','sk-proj-dummy_sensitive_marker_123','api_key = "dummy_sensitive_marker"']){
    const value=sample();value.functions[0].definition+=' -- '+literal;
    const result=run(value);assert.equal(result.status,0,result.stderr);
    const copy=readFileSync(output,'utf8');assert.ok(!copy.includes(literal));assert.ok(!copy.includes('dummy_sensitive_marker'));assert.ok(!result.stderr.includes(literal) && !result.stdout.includes(literal));
    const manifest=JSON.parse(readFileSync(fingerprints,'utf8'));assert.equal(manifest.functions[0].redacted,true);assert.equal(manifest.functions[0].definitionMd5,createHash('md5').update(value.functions[0].definition).digest('hex'));assert.equal(manifest.functions[1].redacted,false);assert.match(manifest.purpose,/never be applied/);clean();
  }
  const triggerInput=sample(),opaque='DUMMY_OPAQUE_PRIVATE_VALUE_NOT_A_KNOWN_KEY_PREFIX';
  triggerInput.tables[0].triggers=['CREATE TRIGGER notify AFTER INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(\'https://example.invalid/webhook\',\'POST\',\'{"x-booking-secret":"'+opaque+'"}\')'];
  const triggerResult=run(triggerInput);assert.equal(triggerResult.status,0,triggerResult.stderr);
  assert.ok(!readFileSync(output,'utf8').includes(opaque));assert.ok(!readFileSync(fingerprints,'utf8').includes(opaque));assert.deepEqual(JSON.parse(readFileSync(output,'utf8')).tables[0].triggers,['EXECUTE FUNCTION supabase_functions.http_request([arguments omitted])']);clean();
  const privateFunction=sample();privateFunction.functions[0].definition+=' -- x-booking-secret '+opaque;
  const denied=run(privateFunction);assert.equal(denied.status,1);assert.equal(existsSync(output),false);assert.ok(!denied.stderr.includes(opaque));
  const malformed=run({rows:['dummy_sensitive_marker']});assert.equal(malformed.status,1);assert.equal(existsSync(output),false);assert.equal(existsSync(fingerprints),false);assert.ok(!malformed.stderr.includes('dummy_sensitive_marker'));
} finally {unlinkSync(input);clean();rmdirSync(dir);}
const workflow=readFileSync(new URL('../workflows/minuta-day-actions-schema-read.yml',import.meta.url),'utf8');
const runner=workflow.indexOf('node .github/scripts/day-actions-schema-run.mjs');assert.ok(runner>=0 && runner<workflow.indexOf('actions/upload-artifact@'));
assert.match(workflow,/sha256sum day-actions-schema\/schema.json day-actions-schema\/source-fingerprints.json/);
console.log('Scheduling review export: structural allowlist, masked literals, exact source fingerprints, no private logs and complete checksums PASS');
