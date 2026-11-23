// GitHub-only review export. Never log or upload private literals from function bodies.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {validateSchema} from '../../minuta-online-booking/scripts/day-actions-schema-export.mjs';
function mask(text) {
  return text.replace(/https?:\/\/[^\s'"\\]+/gi,'[redacted-url]')
    .replace(/postgres(?:ql)?:\/\/[^\s'"\\]*/gi,'[redacted-connection]')
    .replace(/(?:sb_secret_|sk-proj-|eyJ)[A-Za-z0-9_.-]{8,}/gi,'[redacted-token]')
    .replace(/((?:password|service_role_key|api_key)\s*(?::=|=|:)\s*['"])[^'"]+(['"])/gi,'$1$2');
}
function reviewCopy(value) {
  if(typeof value==='string')return mask(value);
  if(Array.isArray(value))return value.map(reviewCopy);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,reviewCopy(item)]));
  return value;
}
try {
  const raw=readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'');
  const original=JSON.parse(raw);
  const copy=reviewCopy(original);
  for(const table of copy.tables||[]) {
    if(table.triggers==null)continue;
    if(!Array.isArray(table.triggers))throw new Error('invalid_trigger_catalog');
    table.triggers=table.triggers.map(definition=>{
      if(typeof definition!=='string')throw new Error('invalid_trigger_catalog');
      const match=definition.match(/\bEXECUTE FUNCTION ([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\(/i);
      if(!match)throw new Error('unsupported_trigger_catalog');
      return 'EXECUTE FUNCTION '+match[1]+'([arguments omitted])';
    });
  }
  const safe=validateSchema(copy);
  if(safe.functions.some(f=>/\b(?:http_request|authorization|access_token|service_role_key|password)\b|x-[a-z0-9-]*(?:secret|key|token)/i.test(f.definition)))throw new Error('private_function_configuration');
  const source={version:1,purpose:'review-only; redacted definitions must never be applied as replacement DDL',sourceSchemaSha256:createHash('sha256').update(raw).digest('hex'),functions:original.functions.map((f,index)=>({name:f.name,identity:f.identity,definitionMd5:createHash('md5').update(f.definition).digest('hex'),redacted:f.definition!==safe.functions[index].definition}))};
  writeFileSync(process.argv[3],JSON.stringify(safe,null,2),{mode:0o600});
  writeFileSync(join(dirname(process.argv[3]),'source-fingerprints.json'),JSON.stringify(source,null,2),{mode:0o600});
  console.log('Scheduling review metadata validated; private literals masked; original function fingerprints recorded.');
} catch (error) {
  const match=String(error?.stack||'').match(/\bat validateSchema \([^\n]*day-actions-schema-export\.mjs:(\d+):\d+\)/);
  const line=match ? Number(match[1]) : 0;
  const code=Number.isSafeInteger(line) && line>0 && line<1000 ? `SCHEMA_RULE_L${line}` : 'SCHEMA_INPUT_OR_IO';
  console.error(`Scheduling schema export withheld (${code}).`);
  process.exitCode=1;
}
