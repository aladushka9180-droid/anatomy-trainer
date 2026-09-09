import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('./production-db-target-guard.mjs', import.meta.url));
const ref = 'cawexmmrqjvothcbgjxr';
function run(url, projectRef = ref, args = []) {
  return spawnSync(process.execPath,[guard,...args],{env:{...process.env,SUPABASE_DB_URL:url,MINUTA_PRODUCTION_PROJECT_REF:projectRef},encoding:'utf8'});
}

for (const url of [
  `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres?sslmode=require`,
  `postgres://postgres.${ref}:secret@aws-0-eu.pooler.supabase.com:6543/postgres?sslmode=require`
]) assert.equal(run(url).status,0,url);

for (const url of [
  `postgresql://postgres:secret@db.attacker.supabase.co:5432/postgres?project=${ref}`,
  `postgresql://postgres:secret@db.${ref}.supabase.co.attacker.example:5432/postgres`,
  `postgresql://postgres.${ref}:secret@aws-0-eu.pooler.supabase.com:6543/other`,
  `postgresql://postgres.${ref}:secret@aws-0-eu.pooler.supabase.com:6543/postgres?target=${ref}`
]) assert.notEqual(run(url).status,0,url);

assert.notEqual(run(`postgresql://postgres:secret@db.${ref}.supabase.co/postgres`,'wrongproject').status,0);
const session = run(`postgres://postgres.${ref}:secret@aws-0-eu.pooler.supabase.com:6543/postgres?sslmode=require`,ref,['--session-url']);
assert.equal(session.status,0);
assert.equal(new URL(session.stdout).port,'5432');
console.log('production database target guard: OK');
