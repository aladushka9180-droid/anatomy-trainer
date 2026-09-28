// Test harness only: normalize a pg_dump schema for an already bootstrapped clone.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {splitRestoreSql} from '../scripts/crm-snapshot-target-sql.mjs';
import {filterPostData} from '../scripts/crm-snapshot-postdata.mjs';

export function prepareCloneSchema(source) {
  const filtered=filterPostData(source);
  let publicSchemas=0;
  const output=splitRestoreSql(filtered.output).map(part=>{
    assert.notEqual(part.kind,'data','schema_only_required');
    if(part.kind!=='sql')return part.text;
    assert(!/^(COPY|INSERT|UPDATE|DELETE|TRUNCATE|DROP SCHEMA)\b/i.test(part.mask),'schema_only_required');
    // Exact top-level pg_dump statement only. Do not change function bodies,
    // literals, other schemas, ACL statements or existing public ownership.
    if(/^CREATE SCHEMA (?:public|"public");$/.test(part.mask)) {
      publicSchemas++;
      return part.text.slice(0,part.commandOffset)+'CREATE SCHEMA IF NOT EXISTS public;';
    }
    return part.text;
  }).join('');
  assert.ok(publicSchemas<=1,'unexpected_public_schema_declarations');
  return {output,publicSchemas,removedWebhooks:filtered.removed};
}

const codes=new Map([
  ['42P06','duplicate_schema'],['42710','duplicate_object'],['42704','undefined_object'],
  ['42883','undefined_function'],['42P01','undefined_table'],['42501','insufficient_privilege'],
  ['42601','syntax_error'],['42804','datatype_mismatch'],['0A000','unsupported_feature'],
  ['23503','foreign_key_violation'],['23514','check_violation'],['55P03','lock_unavailable'],
  ['57014','statement_cancelled'],['22023','invalid_parameter']
]);
const stages=new Set(['bootstrap','fixture-bootstrap','schema-import']);
export function safeImportDiagnostic(stage,log) {
  assert.ok(stages.has(stage),'unknown_import_stage');
  // psql is called with VERBOSITY=sqlstate. Never return raw message, query,
  // context, schema text, connection string, log path or an arbitrary object name.
  const match=log.match(/^psql:\/tmp\/(bootstrap|fixture-bootstrap|schema)\.sql:([0-9]{1,7}): (?:ERROR|FATAL):\s+([0-9A-Z]{5})\s*$/m);
  const code=match?.[3];
  return {
    diagnostic:'booking_delete_clone_import',stage,
    sqlstate:codes.has(code)?code:'unclassified',
    reason:codes.get(code)||'private_error_withheld',
    ...(match?{source:match[1],line:Number(match[2])}:{})
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [mode,first,second]=process.argv.slice(2);
    assert.equal(process.argv.length,5);
    if(mode==='prepare') {
      const result=prepareCloneSchema(readFileSync(first,'utf8'));
      writeFileSync(second,result.output,{mode:0o600});
      console.log(JSON.stringify({prepared:true,publicSchemas:result.publicSchemas,removedWebhooks:result.removedWebhooks}));
    } else {
      assert.equal(mode,'diagnose');
      console.error(JSON.stringify(safeImportDiagnostic(first,readFileSync(second,'utf8'))));
    }
  } catch {
    console.error('Isolated schema harness refused input; private content withheld.');
    process.exitCode=1;
  }
}
