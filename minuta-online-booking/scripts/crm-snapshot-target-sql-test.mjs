import test from 'node:test';
import assert from 'node:assert/strict';
import {splitRestoreSql,transformTargetSql,targetSqlDiagnostic} from './crm-snapshot-target-sql.mjs';

const prefix=`-- PostgreSQL database dump
\\restrict TestGuard123
SET statement_timeout = 0;
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
DROP SCHEMA IF EXISTS public;
CREATE SCHEMA public;
DROP FUNCTION IF EXISTS public.on_auth_user_created();
CREATE FUNCTION public.on_auth_user_created() RETURNS trigger LANGUAGE plpgsql AS $fn$
begin
  -- SQL-looking text in a legitimate function body is not a restore command.
  perform 'DROP SCHEMA auth CASCADE; COPY x FROM PROGRAM';
  return new;
end
$fn$;
CREATE TABLE public.bookings (id uuid NOT NULL, created_by uuid, body text);
COPY public.bookings (id, created_by, body) FROM stdin;
00000000-0000-4000-8000-000000000001\t00000000-0000-4000-8000-000000000002\tCREATE FUNCTION public.fake(); FOREIGN KEY REFERENCES auth.users(id);
\\.
`;
const fk='ALTER TABLE ONLY public.bookings ADD CONSTRAINT booking_actor_fk FOREIGN KEY (created_by) REFERENCES auth.users(id);\n';
const suffix='\\unrestrict TestGuard123\n';
const fixture=(extra='')=>prefix+extra+fk+suffix;

test('preserves handler identity and namespace, adds inert UUIDs before constraints',()=>{
  const output=transformTargetSql(fixture());
  assert.doesNotMatch(output,/DROP FUNCTION IF EXISTS|DROP SCHEMA IF EXISTS|CREATE SCHEMA public/);
  assert.match(output,/CREATE OR REPLACE FUNCTION public.on_auth_user_created/);
  assert.ok(output.indexOf('insert into auth.users')<output.indexOf('ALTER TABLE ONLY public.bookings ADD'));
  assert.match(output,/select distinct created_by from public.bookings/);
  assert.match(output,/CREATE FUNCTION public.fake\(\); FOREIGN KEY REFERENCES auth.users\(id\);/);
  assert.match(output,/\\restrict TestGuard123/);assert.match(output,/\\unrestrict TestGuard123/);
  assert.equal((output.match(/insert into auth.users/g)||[]).length,1);
});

test('handles comments, escaped strings, dollar quotes and semicolons without crossing boundaries',()=>{
  const body="CREATE FUNCTION public.x() RETURNS text LANGUAGE sql AS $tag$ SELECT E'foo\\\'bar;'; $tag$;";
  assert.equal(splitRestoreSql(body).length,1);
  assert.match(transformTargetSql(fixture(body)),/CREATE OR REPLACE FUNCTION public.x/);
  assert.match(transformTargetSql(fixture('/* comment ; /* nested */ */ CREATE SEQUENCE public.test_seq;')),/CREATE SEQUENCE/);
});

test('rejects managed/executable DDL and psql escapes without revealing contents',()=>{
  for(const extra of [
    'DROP SCHEMA IF EXISTS auth;', 'DROP TABLE IF EXISTS public.x CASCADE;',
    'CREATE EXTENSION http;', 'CREATE EVENT TRIGGER x ON ddl_command_end EXECUTE FUNCTION public.x();',
    'CREATE PUBLICATION all_data FOR ALL TABLES;', 'CREATE SUBSCRIPTION x CONNECTION \'secret\' PUBLICATION x;',
    'CREATE SERVER x FOREIGN DATA WRAPPER postgres_fdw;', 'CREATE FOREIGN TABLE public.x (id int) SERVER x;',
    'CREATE TABLE auth.bad (id int);','DROP FUNCTION IF EXISTS auth.uid();',
    'ALTER TABLE public.bookings SET SCHEMA auth;', 'ALTER TABLE auth.users DISABLE TRIGGER ALL;',
    'ALTER TABLE public.bookings ENABLE ALWAYS TRIGGER x;', 'SET session_replication_role = origin;',
    'SELECT public.send_secret();',"COPY public.bookings FROM PROGRAM 'curl secret';",
    'DO $$begin perform 1; end$$;', '\\connect other_database\n','\\! echo unsafe\n',
    'CREATE FUNCTION public.bad() RETURNS void \\! echo unsafe\n LANGUAGE sql AS $$select 1$$;',
  ])assert.throws(()=>transformTargetSql(fixture(extra)));
});

test('rejects unsupported external/composite foreign keys',()=>{
  for(const reference of ['storage.objects(id)','auth.identities(id)','auth.users(id, other)']) {
    assert.throws(()=>transformTargetSql(fixture(`ALTER TABLE ONLY public.bookings ADD CONSTRAINT other_fk FOREIGN KEY (created_by) REFERENCES ${reference};`)));
  }
  assert.throws(()=>transformTargetSql(fixture('ALTER TABLE ONLY public.bookings ADD CONSTRAINT other_fk FOREIGN KEY (created_by) REFERENCES\n storage.objects(id);')));
});

test('accepts public FK but derives IDs only from auth FK',()=>{
  const output=transformTargetSql(fixture('ALTER TABLE ONLY public.bookings ADD CONSTRAINT own_fk FOREIGN KEY (id) REFERENCES public.bookings(id) ON DELETE CASCADE;'));
  assert.equal((output.match(/insert into auth.users/g)||[]).length,1);
});

test('function command replacement ignores CREATE FUNCTION inside preceding comments',()=>{
  const output=transformTargetSql(fixture('-- CREATE FUNCTION is mentioned here only\nCREATE FUNCTION public.extra() RETURNS int LANGUAGE sql AS $$select 1$$;'));
  assert.match(output,/-- CREATE FUNCTION is mentioned here only\nCREATE OR REPLACE FUNCTION public.extra/);
});

test('rejects dump string-semantics changes and COPY after FK phase',()=>{
  assert.throws(()=>transformTargetSql(fixture('SET standard_conforming_strings = off;')));
  assert.throws(()=>transformTargetSql(fixture("SET client_encoding = 'SQL_ASCII';")));
  assert.throws(()=>transformTargetSql(prefix+fk+'COPY public.bookings (id) FROM stdin;\n\\.\n'+suffix));
});

test('rejects truncated SQL/COPY and mismatched restore guards',()=>{
  assert.throws(()=>transformTargetSql(fixture().replace('\\unrestrict TestGuard123','\\unrestrict Other')));
  assert.throws(()=>transformTargetSql(fixture().replace('\\unrestrict TestGuard123','')));
  assert.throws(()=>splitRestoreSql('CREATE FUNCTION public.x() RETURNS void AS $$ broken;'));
  assert.throws(()=>splitRestoreSql('COPY public.bookings (id) FROM stdin;\nvalue\n'));
});

test('accepts canonical PostgreSQL 17 clean ALTER forms without widening ADD',()=>{
  // Source: REL_17_STABLE src/bin/pg_dump/pg_backup_archiver.c, IF EXISTS
  // injection into ALTER TABLE cleanup and the special DEFAULT-object path.
  const clean='ALTER TABLE IF EXISTS ONLY public.bookings DROP CONSTRAINT IF EXISTS old_fk;\n'
    +'ALTER TABLE IF EXISTS public.bookings ALTER COLUMN id DROP DEFAULT;\n';
  const output=transformTargetSql(fixture(clean));
  assert.ok(output.includes(clean.trim()));
  for(const bad of [
    'ALTER TABLE IF EXISTS ONLY public.bookings ADD CONSTRAINT x CHECK(true);',
    'ALTER TABLE IF EXISTS ONLY public.bookings DROP COLUMN body;',
    'ALTER TABLE IF EXISTS ONLY auth.users DROP CONSTRAINT IF EXISTS x;',
    'ALTER TABLE IF EXISTS ONLY public.bookings DROP CONSTRAINT IF EXISTS x CASCADE;',
  ])assert.throws(()=>transformTargetSql(fixture(bad)));
});

test('does not let dump defaults remove the caller timeout bounds',()=>{
  const output=transformTargetSql(fixture('SET lock_timeout = 0;\nSET transaction_timeout = 0;\nSET idle_in_transaction_session_timeout = 0;'));
  assert.doesNotMatch(output,/SET (?:statement_timeout|lock_timeout|transaction_timeout|idle_in_transaction_session_timeout)/);
  assert.match(output,/SET standard_conforming_strings = on;/);
  assert.throws(()=>transformTargetSql(fixture('SET session_replication_role = replica;')));
});

test('preserves canonical table replica identity without accepting replica triggers',()=>{
  for(const form of ['FULL','DEFAULT','NOTHING','USING INDEX booking_pk']){
    assert.match(transformTargetSql(fixture(`ALTER TABLE ONLY public.bookings REPLICA IDENTITY ${form};`)),/REPLICA IDENTITY/);
  }
  assert.throws(()=>transformTargetSql(fixture('ALTER TABLE public.bookings ENABLE REPLICA TRIGGER unsafe;')));
  assert.throws(()=>transformTargetSql(fixture('ALTER TABLE public.bookings REPLICA IDENTITY USING INDEX other.private;')));
});

test('guards only known public object drops when their owning table is missing',()=>{
  for(const kind of ['TRIGGER','POLICY','RULE']) {
    const output=transformTargetSql(fixture(`DROP ${kind} IF EXISTS old_object ON public.absent_table;`));
    assert.match(output,/IF pg_catalog.to_regclass\(E'public.absent_table'\) IS NOT NULL THEN/);
    assert.ok(output.includes(`EXECUTE E'DROP ${kind} IF EXISTS old_object ON public.absent_table;'`));
  }
  for(const bad of [
    'DROP TRIGGER IF EXISTS x ON auth.users;',
    'DROP POLICY IF EXISTS x ON public.bookings CASCADE;',
    'DROP TRIGGER x ON public.bookings;',
  ])assert.throws(()=>transformTargetSql(fixture(bad)));
  const tricky='DROP POLICY IF EXISTS "O\'Brien\\name" ON public."table\'name$crm_restore_drop$";';
  const output=transformTargetSql(fixture(tricky));
  assert.match(output,/DO \$crm_restore_dropx\$/);
  assert.ok(output.includes("O''Brien\\\\name"));
});

test('leaves approved zero-argument public auth handlers completely untouched',()=>{
  const output=transformTargetSql(fixture(),{preserveFunctions:['public.on_auth_user_created']});
  assert.doesNotMatch(output,/CREATE (?:OR REPLACE )?FUNCTION public.on_auth_user_created/);
  assert.doesNotMatch(output,/perform 'DROP SCHEMA auth/);
  assert.doesNotMatch(output,/DROP FUNCTION IF EXISTS public.on_auth_user_created/);
  assert.match(output,/CREATE TABLE public.bookings/);
  const other=transformTargetSql(fixture('CREATE FUNCTION public.other() RETURNS int LANGUAGE sql AS $$select 1$$;'),
    {preserveFunctions:['public.on_auth_user_created']});
  assert.match(other,/CREATE OR REPLACE FUNCTION public.other/);
  assert.throws(()=>transformTargetSql(fixture('CREATE FUNCTION public.on_auth_user_created(id uuid) RETURNS trigger LANGUAGE plpgsql AS $$begin return new; end$$;'),
    {preserveFunctions:['public.on_auth_user_created']}),/exactly zero arguments/);
  for(const preserveFunctions of [null,{},['auth.uid'],['public."handler"'],['public.x(); DROP TABLE x;'],['public.x','public.x']]) {
    assert.throws(()=>transformTargetSql(fixture(),{preserveFunctions}),/Invalid protected function manifest/);
  }
});

test('diagnostics expose only static codes and statement numbers',()=>{
  try {
    transformTargetSql(fixture('ALTER TABLE public."PRIVATE_NAME" ENABLE ALWAYS TRIGGER "PRIVATE_TOKEN";'));
    assert.fail('must reject');
  } catch(error) {
    const diagnostic=targetSqlDiagnostic(error);
    assert.equal(diagnostic.code,'TARGET_ALTER_TABLE');
    assert.equal(typeof diagnostic.statementIndex,'number');
    assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_NAME|PRIVATE_TOKEN/);
    assert.equal(diagnostic.shape,'ALTER TABLE ENABLE ALWAYS TRIGGER');
  }
  assert.deepEqual(targetSqlDiagnostic(new Error('secret-path-secret-key')),{code:'TARGET_INPUT_REJECTED'});
});

test('conditional drop runs against missing and existing tables in isolated PGlite',
  {skip:!process.env.MINUTA_PGLITE_MODULE},async()=>{
    const {PGlite}=await import(process.env.MINUTA_PGLITE_MODULE);
    const db=new PGlite();
    try {
      await db.exec(`CREATE TABLE public.present_table(id int);
        CREATE FUNCTION public.test_trigger() RETURNS trigger LANGUAGE plpgsql AS $$begin return new; end$$;
        CREATE TRIGGER old_trigger BEFORE INSERT ON public.present_table FOR EACH ROW EXECUTE FUNCTION public.test_trigger();
        CREATE POLICY old_policy ON public.present_table USING(true);`);
      const output=transformTargetSql(fixture(`DROP TRIGGER IF EXISTS absent_trigger ON public.absent_table;
        DROP POLICY IF EXISTS absent_policy ON public.absent_table;
        DROP TRIGGER IF EXISTS old_trigger ON public.present_table;
        DROP POLICY IF EXISTS old_policy ON public.present_table;`));
      for(const part of splitRestoreSql(output).filter(p=>p.kind==='sql'&&/^DO\b/.test(p.mask)))await db.exec(part.text);
      assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgname='old_trigger'")).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int as n from pg_policy where polname='old_policy'")).rows[0].n,0);
    } finally {await db.close();}
  });
