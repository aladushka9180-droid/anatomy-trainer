import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const allowed = [
  'FK CONSTRAINT', 'CHECK CONSTRAINT', 'ROW SECURITY', 'TABLE ATTACH',
  'INDEX ATTACH', 'MATERIALIZED VIEW', 'SEQUENCE OWNED BY', 'FUNCTION',
  'PROCEDURE', 'TABLE', 'SEQUENCE', 'TYPE', 'DOMAIN', 'DEFAULT',
  'CONSTRAINT', 'INDEX', 'TRIGGER', 'POLICY', 'RULE', 'VIEW',
];

export function filterSchemaToc(input) {
  const output = [];
  for (const line of input.split(/\r?\n/)) {
    if (!line || line.startsWith(';')) continue;
    const prefix = line.match(/^\d+; \d+ \d+ (.+)$/);
    assert(prefix, 'Unrecognized schema archive TOC format');
    assert(!/^(?:TABLE DATA|SEQUENCE SET|MATERIALIZED VIEW DATA|BLOB|LARGE OBJECT)\b/.test(prefix[1]),
      'Schema archive contains data');
    if (allowed.some(kind => prefix[1].startsWith(`${kind} public `))) output.push(line);
  }
  for (const table of ['bookings', 'organization_waitlist_requests',
    'conversation_messages_v162', 'message_participants_v162', 'organization_memberships']) {
    assert(output.some(line => line.includes(` TABLE public ${table} `)), `Missing ${table} schema`);
  }
  assert(output.filter(line => / TABLE public /.test(line)).length > 50,
    'Test schema is too small for a full-schema rehearsal');
  return `${output.join('\n')}\n`;
}

if (process.argv[1] && process.argv[1].endsWith('abuse-guards-v173-schema-toc.mjs')) {
  assert.equal(process.argv.length, 4);
  writeFileSync(process.argv[3], filterSchemaToc(readFileSync(process.argv[2], 'utf8')), { mode: 0o600 });
}
