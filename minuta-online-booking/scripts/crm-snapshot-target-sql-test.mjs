import test from 'node:test';
import assert from 'node:assert/strict';
import {splitRestoreSql,transformTargetSql} from './crm-snapshot-target-sql.mjs';

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
