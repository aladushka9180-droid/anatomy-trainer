import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {splitRestoreSql} from './crm-snapshot-target-sql.mjs';

// Webhook arguments can contain URLs, headers and API keys. Never load them
// into the isolated database or export them to the authorized test project.
export function filterPostData(input) {
  let removed=0;
  const output=splitRestoreSql(input).filter(part=>{
    if(part.kind!=='sql'||!/^CREATE TRIGGER\b/i.test(part.mask))return true;
    if(/\bEXECUTE FUNCTION supabase_functions\.http_request\(/i.test(part.mask)){
      removed++;return false;
    }
    assert(/\bEXECUTE FUNCTION public\.[a-z_][a-z0-9_]*\(\s*\);$/i.test(part.mask),
      'Unreviewed trigger function or arguments');
    return true;
  }).map(part=>part.text).join('');
  return {output,removed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    assert(process.argv.length===4);
    const {output,removed}=filterPostData(readFileSync(process.argv[2],'utf8'));
    writeFileSync(process.argv[3],output,{mode:0o600});
    console.log(`Outbound webhook definitions excluded: ${removed}`);
  }catch{console.error('Offline post-data filter refused input; private SQL withheld');process.exitCode=1;}
}
