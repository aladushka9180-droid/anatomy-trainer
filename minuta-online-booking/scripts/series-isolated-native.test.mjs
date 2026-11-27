import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {schemaStatements,verifySchema,containerArgs,ownedCleanup,IMAGE} from './series-isolated-native.mjs';
const valid=Buffer.from("SET standard_conforming_strings = on;CREATE TABLE public.test(id uuid);CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $f$begin insert into public.test values(gen_random_uuid());end$f$;");
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const owner='00000000-0000-4000-8000-000000000001',id='a'.repeat(64);
const missing=object=>Object.assign(new Error('not found'),{exitCode:1,missingObject:object});

test('accepts schema definitions including real write-capable function bodies',()=>assert.equal(verifySchema(valid,digest(valid)).statementCount,3));
test('hash mismatch fails before restoring SQL',()=>assert.throws(()=>verifySchema(valid,'0'.repeat(64)),/hash mismatch/));
test('missing binding and empty schema are rejected',()=>{assert.throws(()=>verifySchema(valid,''));assert.throws(()=>verifySchema(Buffer.alloc(0),digest(Buffer.alloc(0))));});
for(const sql of ['INSERT INTO public.bookings values(1);','COPY public.bookings FROM stdin;','DO $$begin null;end$$;','DROP SCHEMA public CASCADE;','SELECT malicious();','\\! curl host','CREATE DATABASE another;','ALTER SYSTEM SET listen_addresses=\'*\';',"CREATE ROLE account PASSWORD 'secret';",'CREATE SERVER outside FOREIGN DATA WRAPPER dblink;','SET standard_conforming_strings=off;']){
 test('refuses '+sql.split(/[\s;]/).slice(0,3).join(' '),()=>{const bytes=Buffer.from(sql);assert.throws(()=>verifySchema(bytes,digest(bytes)));});
}
test('comments, quoted values, dollar bodies and nested comments do not split statements',()=>assert.equal(schemaStatements("/* x /* ; */ y */ CREATE FUNCTION f() RETURNS text AS $tag$SELECT '; INSERT';$tag$ LANGUAGE SQL;-- ;\n COMMENT ON FUNCTION f() IS 'doubled '' ; quote';").length,2));
test('unterminated body/comment/literal fails closed',()=>{for(const sql of ['CREATE FUNCTION f() AS $$ x;','/* closed?','COMMENT ON SCHEMA public IS \'x'])assert.throws(()=>schemaStatements(sql));});
test('pg_dump restrict pair allowed; arbitrary psql commands remain refused',()=>{const bytes=Buffer.from('\\restrict token123\nCREATE TABLE x(id int);\n\\unrestrict token123\n');assert.equal(verifySchema(bytes,digest(bytes)).statementCount,1);});
test('ordinary strings cannot hide a following data statement with a backslash',()=>{const bytes=Buffer.from("COMMENT ON SCHEMA public IS 'x\\';INSERT INTO public.x values(1);--';");assert.throws(()=>verifySchema(bytes,digest(bytes)));});
test('image is immutable and launch has no ports or host mounts',()=>{const args=containerArgs('eldion-series-'+owner,owner);assert.ok(args.includes(IMAGE));assert.match(IMAGE,/@sha256:[a-f0-9]{64}$/);assert.equal(args[args.indexOf('--network')+1],'none');assert.ok(args.includes('--read-only'));for(const flag of ['--publish','-p','--volume','-v','--mount','--privileged'])assert.ok(!args.includes(flag));});
test('container names cannot inject command arguments',()=>assert.throws(()=>containerArgs('another --privileged',owner)));
test('cleanup refuses an unknown ID before contacting Docker',async()=>{let calls=0;await assert.rejects(ownedCleanup(async()=>calls++,'foreign',owner));assert.equal(calls,0);});
test('cleanup refuses a container owned by another stand',async()=>{const calls=[];await assert.rejects(ownedCleanup(async args=>{calls.push(args);return JSON.stringify([{Id:id,Config:{Labels:{'eldion.series.owner':'different'}}}]);},id,owner));assert.equal(calls.length,1);});
test('owned cleanup removes the exact ID and verifies absence',async()=>{const calls=[];let inspections=0;const result=await ownedCleanup(async args=>{calls.push(args);if(args[0]==='inspect'){if(inspections++)throw missing(id);return JSON.stringify([{Id:id,Config:{Labels:{'eldion.series.owner':owner}}}]);}return id;},id,owner);assert.equal(result.removed,true);assert.deepEqual(calls[1],['rm','--force',id]);});
test('recovery is idempotent when the exact object is absent',async()=>assert.deepEqual(await ownedCleanup(async()=>{throw missing(id);},id,owner),{alreadyAbsent:true}));
test('daemon failure is not reported as successful cleanup',async()=>await assert.rejects(ownedCleanup(async()=>{throw Object.assign(new Error('daemon unavailable'),{exitCode:1});},id,owner)));
test('cleanup fails if the container remains after removal',async()=>await assert.rejects(ownedCleanup(async()=>JSON.stringify([{Id:id,Config:{Labels:{'eldion.series.owner':owner}}}]),id,owner),/still_present/));
