import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(source, '..');
const fixture = mkdtempSync(join(repository, '.test-tmp-migration-guard-'));
const booking = join(fixture, 'minuta-online-booking');
const script = join(booking, 'scripts', 'migration-safety-guard.mjs');
try {
  mkdirSync(dirname(script), {recursive:true});
  mkdirSync(join(fixture,'.github','workflows'), {recursive:true});
  copyFileSync(fileURLToPath(new URL('./migration-safety-guard.mjs',import.meta.url)),script);
  for (const name of readdirSync(source).filter(name=>/^supabase-migration-v\d+\.sql$/i.test(name))) copyFileSync(join(source,name),join(booking,name));
  cpSync(join(source,'supabase','migrations'),join(booking,'supabase','migrations'),{recursive:true});
  const workflow=join(fixture,'.github','workflows','minuta-safe-release.yml');
  copyFileSync(join(repository,'.github','workflows','minuta-safe-release.yml'),workflow);
  const run=()=>spawnSync(process.execPath,[script],{encoding:'utf8'});
  let result=run(); assert.equal(result.status,0,result.stderr);
  const candidate=join(booking,'supabase-migration-v184.sql');
  const original=readFileSync(candidate,'utf8');
  writeFileSync(candidate,original.replace(/\r?\n/g,'\r\n'));
  result=run(); assert.equal(result.status,0,result.stderr);
  writeFileSync(candidate,original+'\n-- unreviewed edit\n');
  result=run(); assert.notEqual(result.status,0); assert.match(result.stderr,/v184.sql.*не совпадает/u);
  writeFileSync(candidate,original);
  writeFileSync(join(booking,'supabase-migration-v185.sql'),'create or replace function public.provider_delete_booking(p_booking uuid) returns text language sql as $$ select null::text $$;');
  result=run(); assert.notEqual(result.status,0); assert.match(result.stderr,/v185.*переопределяет/u);
  console.log('migration guard PASS: reviewed source, CRLF parity, changed source rejected, future replacement rejected');
} finally {
  assert.ok(resolve(fixture).startsWith(repository+sep));
  assert.ok(fixture.split(sep).at(-1).startsWith('.test-tmp-migration-guard-'));
  rmSync(fixture,{recursive:true,force:true});
}
