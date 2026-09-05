import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

// pg_restore consumes the original TOC lines. Unknown descriptors/namespaces are
// excluded, never inferred from substrings. Only app objects enter offline PG.
const allowed = [
  'TABLE DATA','SEQUENCE SET','FK CONSTRAINT','CHECK CONSTRAINT','ROW SECURITY',
  'TABLE ATTACH','INDEX ATTACH','MATERIALIZED VIEW DATA','MATERIALIZED VIEW',
  'SEQUENCE OWNED BY','FUNCTION','PROCEDURE','TABLE','SEQUENCE','TYPE','DOMAIN',
  'DEFAULT','CONSTRAINT','INDEX','TRIGGER','POLICY','RULE','VIEW',
];
export function filterToc(input) {
  const output=[];
  for(const line of input.split(/\r?\n/)) {
    if(!line || line.startsWith(';')) continue;
    const prefix=line.match(/^\d+; \d+ \d+ (.+)$/);
    assert(prefix,'Unrecognized archive TOC format');
    const descriptor=allowed.find(kind=>prefix[1].startsWith(kind+' public '));
    if(!descriptor) continue;
    output.push(line);
  }
  assert(output.some(line=>/ TABLE public bookings /.test(line)),'Missing public bookings schema');
  assert(output.some(line=>/ TABLE DATA public bookings /.test(line)),'Missing public bookings data');
  return output.join('\n')+'\n';
}

// Foreign keys are installed after COPY; derive only the required inert auth IDs
// from the archive-generated post-data SQL. Anything besides auth.users(id) fails.
export function authPlaceholders(sql) {
  const inserts=[];
  const withoutComments=sql.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/^\s*--.*$/mg,'');
  for(const statement of withoutComments.split(';')) {
    if(!/\bFOREIGN\s+KEY\b/i.test(statement)) continue;
    if(/\bREFERENCES\s+public\.[a-z_][a-z0-9_]*\s*\(/i.test(statement)) continue;
    const match=statement.match(/ALTER\s+TABLE\s+ONLY\s+public\.([a-z_][a-z0-9_]*)\s+ADD\s+CONSTRAINT\s+[a-z_][a-z0-9_]*\s+FOREIGN\s+KEY\s*\(([a-z_][a-z0-9_]*)\)\s+REFERENCES\s+auth\.users\s*\(id\)/i);
    assert(match,'Unsupported external foreign key in snapshot');
    const [,table,column]=match;
    inserts.push(`insert into auth.users(id) select distinct ${column} from public.${table} where ${column} is not null on conflict do nothing;`);
  }
  assert(inserts.length>0,'No auth FK references found');
  return inserts.join('\n')+'\n';
}

if(process.argv[2]==='toc')writeFileSync(process.argv[4],filterToc(readFileSync(process.argv[3],'utf8')));
else if(process.argv[2]==='auth')writeFileSync(process.argv[4],authPlaceholders(readFileSync(process.argv[3],'utf8')));
