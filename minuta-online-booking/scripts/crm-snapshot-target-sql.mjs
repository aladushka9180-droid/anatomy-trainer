import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {authPlaceholders} from './crm-snapshot-toc.mjs';

// This accepts pg_restore 17 SQL, not an arbitrary SQL deployment script.
// Parse boundaries before inspecting DDL: function bodies and COPY data must
// never become top-level commands merely because they contain SQL-like text.
export function splitRestoreSql(input) {
  const parts=[]; let pos=0;
  while(pos<input.length) {
    const start=pos;
    while(pos<input.length) {
      if(/\s/.test(input[pos])) {pos++;continue;}
      if(input.startsWith('--',pos)) {const end=input.indexOf('\n',pos);pos=end<0?input.length:end+1;continue;}
      if(input.startsWith('/*',pos)) {
        let depth=1;pos+=2;
        while(pos<input.length&&depth) {
          if(input.startsWith('/*',pos)){depth++;pos+=2;}
          else if(input.startsWith('*/',pos)){depth--;pos+=2;}
          else pos++;
        }
        assert(depth===0,'Unterminated restore comment');continue;
      }
      break;
    }
    if(pos===input.length) break;
    if(input[pos]==='\\') {
      const end=input.indexOf('\n',pos);
      const line=input.slice(pos,end<0?input.length:end).trim();
      assert(/^\\(?:unrestrict|restrict) [A-Za-z0-9]+$/.test(line),'Unsupported restore meta-command');
      parts.push({kind:'meta',text:line+'\n'});pos=end<0?input.length:end+1;continue;
    }
    const commandOffset=pos-start;
    let mask=''; let ended=false;
    while(pos<input.length) {
      const ch=input[pos];
      if(input.startsWith('--',pos)) {
        const end=input.indexOf('\n',pos);pos=end<0?input.length:end+1;mask+=' ';continue;
      }
      if(input.startsWith('/*',pos)) {
        let depth=1;pos+=2;
        while(pos<input.length&&depth) {
          if(input.startsWith('/*',pos)){depth++;pos+=2;}
          else if(input.startsWith('*/',pos)){depth--;pos+=2;}
          else pos++;
        }
        assert(depth===0,'Unterminated restore comment');mask+=' ';continue;
      }
      if(ch==="'") {
        const escapeString=pos>0&&/[eE]/.test(input[pos-1])&&(pos<2||!/[a-zA-Z0-9_$]/.test(input[pos-2]));
        pos++;let closed=false;
        while(pos<input.length) {
          if(escapeString&&input[pos]==='\\'){pos+=2;continue;}
          if(input[pos]==="'") {if(input[pos+1]==="'"){pos+=2;continue;}pos++;closed=true;break;}
          pos++;
        }
        assert(closed,'Unterminated restore string');mask+="'opaque'";continue;
      }
      if(ch==='"') {
        const qstart=pos++;let closed=false;
        while(pos<input.length) {
          if(input[pos]==='"'){if(input[pos+1]==='"'){pos+=2;continue;}pos++;closed=true;break;}
          pos++;
        }
        assert(closed,'Unterminated restore identifier');mask+=input.slice(qstart,pos);continue;
      }
      if(ch==='$') {
        const tag=input.slice(pos).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
        if(tag){const end=input.indexOf(tag,pos+tag.length);assert(end>=0,'Unterminated restore function body');pos=end+tag.length;mask+="'opaque'";continue;}
      }
      assert(ch!=='\\','Embedded restore meta-command is prohibited');
      pos++;mask+=ch;
      if(ch===';'){ended=true;break;}
    }
    assert(ended,'Unterminated restore statement');
    const statement={kind:'sql',text:input.slice(start,pos),mask:mask.trim(),commandOffset};
    parts.push(statement);
    if(/^COPY\b/i.test(statement.mask)) {
      assert(/^COPY public\.(?:[a-z_][a-z0-9_]*|"(?:[^"]|"")+")\s*\([\s\S]*\) FROM stdin;$/i.test(statement.mask),'Unsupported restore COPY');
      assert(/^\r?\n/.test(input.slice(pos)),'Invalid COPY boundary');
      const bodyStart=pos;pos+=input[pos]==='\r'?2:1;
      let closed=false;
      while(pos<=input.length) {
        const end=input.indexOf('\n',pos);
        const line=input.slice(pos,end<0?input.length:end).replace(/\r$/,'');
        pos=end<0?input.length:end+1;
        if(line==='\\.'){closed=true;break;}
        if(end<0)break;
      }
      assert(closed,'Unterminated restore COPY data');
      parts.push({kind:'data',text:input.slice(bodyStart,pos)});
    }
  }
  return parts;
}

const identifier='(?:[a-z_][a-z0-9_]*|"(?:[^"]|"")+")';
const object=`public\\.${identifier}`;
const regex=pattern=>new RegExp(pattern,'i');
const matches=(sql,pattern)=>regex(pattern).test(sql);
const knownSet=/^SET (statement_timeout|lock_timeout|idle_in_transaction_session_timeout|transaction_timeout|client_encoding|standard_conforming_strings|check_function_bodies|xmloption|client_min_messages|row_security|default_tablespace|default_table_access_method) = (?:'opaque'|[a-z_0-9]+);$/i;

function validateStatement(part) {
  const s=part.mask;
  assert(!/^(?:DROP\b|ALTER\b[\s\S]*\bDROP\b)[\s\S]*\bCASCADE\b/i.test(s),'Destructive CASCADE is prohibited in target restore');
  if(/^SET\b/i.test(s)) {
    assert(knownSet.test(s),'Unsupported restore SET');
    // The lexical reader follows standard strings; never let the input change
    // quote semantics after validation and before the target executes it.
    if(/^SET standard_conforming_strings\b/i.test(s))assert(/^SET standard_conforming_strings = on;$/i.test(s),'Unsupported string semantics');
    if(/^SET client_encoding\b/i.test(s))assert(/^SET client_encoding = 'UTF8';$/i.test(part.text.slice(part.commandOffset).trim()),'Unsupported dump encoding');
    return 'keep';
  }
  if(/^SELECT\b/i.test(s)) {
    const compact=part.text.replace(/^\s*(?:--[^\n]*\n\s*)*/,'').trim();
    assert(/^SELECT pg_catalog\.set_config\('search_path', '', false\);$/i.test(compact)
      || /^SELECT pg_catalog\.setval\('public\.[a-z_][a-z0-9_]*', -?\d+, (?:true|false)\);$/i.test(compact),
    'Unsupported restore SELECT');return 'keep';
  }
  if(/^COPY\b/i.test(s))return 'keep';
  // Existing public namespace belongs to the target; never replace it.
  if(/^DROP SCHEMA IF EXISTS public;$/i.test(s)||/^CREATE SCHEMA public;$/i.test(s))return 'skip';
  if(matches(s,`^DROP FUNCTION IF EXISTS ${object}\\([\\s\\S]*\\);$`))return 'skip';
  if(matches(s,`^CREATE (?:OR REPLACE )?FUNCTION ${object}\\(`))return 'function';
  if(matches(s,`^CREATE (?:UNLOGGED )?TABLE ${object}\\s*\\(`)) {
    assert(!/\bREFERENCES\b/i.test(s),'Inline foreign keys are unsupported; use post-data constraints');return 'keep';
  }
  if(matches(s,`^CREATE SEQUENCE ${object}(?:\\s|;)`))return 'keep';
  if(matches(s,`^CREATE (?:UNIQUE )?INDEX ${identifier} ON (?:ONLY )?${object}\\s`))return 'keep';
  if(matches(s,`^CREATE (?:OR REPLACE )?(?:MATERIALIZED )?VIEW ${object}(?:\\s|\\()`))return 'keep';
  if(matches(s,`^CREATE (?:TYPE|DOMAIN) ${object}\\s`))return 'keep';
  if(matches(s,`^DROP (?:TABLE|SEQUENCE|INDEX|VIEW|MATERIALIZED VIEW|TYPE|DOMAIN) IF EXISTS ${object};$`))return 'keep';
  if(matches(s,`^DROP (?:TRIGGER|POLICY|RULE) IF EXISTS ${identifier} ON ${object};$`))return 'keep';
  if(matches(s,`^CREATE (?:TRIGGER|POLICY|RULE) ${identifier}\\s`)) {
    assert(matches(s,`\\bON ${object}(?:\\s|;)`),'External trigger/policy/rule target');
    // INSTEAD OF rules could write managed schemas once the target goes live.
    assert(!/^CREATE RULE\b/i.test(s),'Restore rules require separate review');return 'keep';
  }
  if(matches(s,`^ALTER TABLE (?:ONLY )?${object}\\s`)) {
    const action=s.replace(regex(`^ALTER TABLE (?:ONLY )?${object}\\s+`),'');
    assert(matches(action,`^DROP CONSTRAINT IF EXISTS ${identifier};$`)
      || matches(action,`^ADD CONSTRAINT ${identifier} (?:CHECK|UNIQUE|PRIMARY KEY|FOREIGN KEY|EXCLUDE)\\b`)
      || matches(action,`^ALTER COLUMN ${identifier} SET DEFAULT `)
      || matches(action,`^ALTER COLUMN ${identifier} ADD GENERATED (?:ALWAYS|BY DEFAULT) AS IDENTITY\\s*\\(`)
      || /^(?:ENABLE|FORCE|NO FORCE) ROW LEVEL SECURITY;$/i.test(action)
      || matches(action,`^ATTACH PARTITION ${object}\\s`),
    'Unsupported restore ALTER TABLE');return 'keep';
  }
  if(matches(s,`^ALTER SEQUENCE ${object} OWNED BY ${object}\\.${identifier};$`))return 'keep';
  if(matches(s,`^ALTER INDEX ${object} ATTACH PARTITION ${object};$`))return 'keep';
  if(matches(s,`^REFRESH MATERIALIZED VIEW ${object};$`))return 'keep';
  throw new Error('Unsupported target restore statement');
}

export function transformTargetSql(input) {
  const parts=splitRestoreSql(input);const actions=[];const fks=[];let restrict=null;let firstFkSeen=false;
  for(const part of parts) {
    if(part.kind==='meta') {
      const [,verb,token]=part.text.trim().match(/^\\(restrict|unrestrict) ([A-Za-z0-9]+)$/);
      if(verb==='restrict'){assert(restrict===null,'Nested restore restriction');restrict=token;}
      else {assert(restrict===token,'Unmatched restore restriction');restrict=null;}
      actions.push('keep');continue;
    }
    if(part.kind==='data'){actions.push('keep');continue;}
    actions.push(validateStatement(part));
    if(/^COPY\b/i.test(part.mask))assert(!firstFkSeen,'COPY after foreign-key installation is unsupported');
    if(/^ALTER TABLE\b/i.test(part.mask)&&/\bADD CONSTRAINT\b[\s\S]*\bFOREIGN KEY\b/i.test(part.mask)){fks.push(part.mask);firstFkSeen=true;}
  }
  assert(restrict===null,'Unclosed restore restriction');
  assert(parts.some(p=>p.kind==='sql'&&matches(p.mask,`^CREATE (?:UNLOGGED )?TABLE public\\.bookings\\s*\\(`)), 'Missing target bookings table');
  assert(parts.some(p=>p.kind==='sql'&&/^COPY public\.bookings\s*\(/i.test(p.mask)), 'Missing target bookings COPY');
  assert(fks.length>0,'Missing target foreign keys');
  // Use the existing, fail-closed FK parser only on lexically isolated FK DDL,
  // never on function bodies or COPY text that happens to contain those words.
  const placeholders=authPlaceholders(fks.join('\n'));
  let inserted=false;const output=[];
  for(let index=0;index<parts.length;index++) {
    const part=parts[index];const action=actions[index];
    if(action==='skip')continue;
    if(!inserted&&part.kind==='sql'&&fks.includes(part.mask)) {
      output.push('\n-- Inert auth UUID references only; no auth credentials are imported.\n'+placeholders);inserted=true;
    }
    output.push(action==='function'
      ? part.text.slice(0,part.commandOffset)+part.text.slice(part.commandOffset).replace(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,'CREATE OR REPLACE FUNCTION')
      : part.text);
  }
  return output.join('');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length===4,'Expected input and output paths');
    const output=transformTargetSql(readFileSync(process.argv[2],'utf8'));
    writeFileSync(process.argv[3],output,{mode:0o600});
    console.log('Target snapshot SQL fragment validated; no database accessed');
  } catch {
    // Do not expose input SQL, row values, identifiers, or parser stack traces.
    console.error('Target snapshot SQL preparation refused input; no database accessed');process.exitCode=1;
  }
}
