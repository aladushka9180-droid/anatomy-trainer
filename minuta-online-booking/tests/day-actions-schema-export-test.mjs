import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,existsSync,unlinkSync,rmdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSchema} from '../scripts/day-actions-schema-export.mjs';
const sample=()=>({version:1,functions:['get_available_slots','book_appointment'].map(name=>({name,identity:name+'(uuid)',definition:'CREATE OR REPLACE FUNCTION public.'+name+'(p_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL $$;'})),tables:['bookings','provider_days_off','provider_schedule','services'].map(name=>({name,columns:[{name:'id',type:'uuid',not_null:true}],constraints:[],triggers:[]}))});
assert.equal(validateSchema(sample()).tables.length,4);
for(const secret of ['https://example.invalid/private','postgres://user:pass@host/db','sb_secret_abcdefghijk','sk-proj-abcdefghijk','api_key = "private"']){
 const value=sample();value.functions[0].definition+=' -- '+secret;assert.throws(()=>validateSchema(value),'embedded secret or URL must not reach artifact');
}
let value=sample();value.rows=[{client:'private'}];assert.throws(()=>validateSchema(value),'customer-row payload rejected');
value=sample();value.functions[0].name='unrelated_function';assert.throws(()=>validateSchema(value),'unrelated function rejected');
value=sample();value.functions.shift();assert.throws(()=>validateSchema(value),'missing canonical routine rejected');
value=sample();value.tables[0].rows=[];assert.throws(()=>validateSchema(value),'extra table payload rejected');
const sql=readFileSync(new URL('../scripts/day-actions-schema-read.sql',import.meta.url),'utf8');
assert.match(sql,/begin read only;/);assert.match(sql,/rollback;/);
assert.doesNotMatch(sql,/\b(?:insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|call)\s/i);
assert.doesNotMatch(sql,/\b(?:from|join)\s+public\./i);
const workflow=readFileSync(new URL('../../.github/workflows/minuta-day-actions-schema-read.yml',import.meta.url),'utf8');
assert.match(workflow,/if: github.ref == 'refs\/heads\/main'/);assert.match(workflow,/test "\$EXPECTED_SHA" = "\$GITHUB_SHA"/);
assert.match(workflow,/environment: minuta-production/);assert.match(workflow,/default_transaction_read_only=on/);assert.match(workflow,/production-db-target-guard/);
assert.ok(workflow.indexOf('day-actions-schema-export.mjs')<workflow.indexOf('actions/upload-artifact@'));
assert.match(workflow,/retention-days: 1/);assert.doesNotMatch(workflow,/path: day-actions-schema-raw/);
console.log('Day-action schema read: metadata scope, credential rejection, exact main, read-only and export gates PASS');

const dir=mkdtempSync(join(tmpdir(),'eldion-schema-export-'));
const input=join(dir,'input.json'),output=join(dir,'output.json');
try {
  const marker='sensitive_dummy_marker_123456';const rejected=sample();
  rejected.functions[0].definition+=' -- https://example.invalid/'+marker;
  writeFileSync(input,JSON.stringify(rejected));
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/day-actions-schema-export.mjs',import.meta.url)),input,output],{encoding:'utf8'});
  assert.equal(child.status,1);
  assert.equal(existsSync(output),false,'rejected metadata must not create an export');
  assert.ok(!child.stderr.includes(marker) && !child.stdout.includes(marker),'rejected content must not appear in logs');
  assert.match(child.stderr,/export withheld/);
} finally { unlinkSync(input); if(existsSync(output))unlinkSync(output); rmdirSync(dir); }
console.log('CLI rejection withholds file and keeps rejected contents out of logs: PASS');
