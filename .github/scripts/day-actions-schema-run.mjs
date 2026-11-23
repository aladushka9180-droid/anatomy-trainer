// GitHub-only entry point: keep rejected database metadata out of public logs.
import {readFileSync,writeFileSync} from 'node:fs';
import {validateSchema} from '../../minuta-online-booking/scripts/day-actions-schema-export.mjs';
try {
  const value=validateSchema(JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')));
  writeFileSync(process.argv[3],JSON.stringify(value,null,2),{mode:0o600});
  console.log('Scheduling catalog validated; no application routines were invoked.');
} catch (error) {
  // Emit only a source line number, never assertion arguments or a stack trace.
  const match=String(error?.stack||'').match(/\bat validateSchema \([^\n]*day-actions-schema-export\.mjs:(\d+):\d+\)/);
  const line=match ? Number(match[1]) : 0;
  const code=Number.isSafeInteger(line) && line>0 && line<1000 ? `SCHEMA_RULE_L${line}` : 'SCHEMA_INPUT_OR_IO';
  console.error(`Scheduling schema export withheld (${code}).`);
  process.exitCode=1;
}
