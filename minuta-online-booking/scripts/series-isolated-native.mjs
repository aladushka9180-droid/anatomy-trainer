import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, statSync, lstatSync, realpathSync, readdirSync, mkdirSync, mkdtempSync, cpSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

export const IMAGE='supabase/postgres@sha256:49c938c7918f1543618b60568f5a995e52d98f19883075a14f89643e8b1571fe';
const sha=value=>createHash('sha256').update(value).digest('hex');
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const REQUIRED=['public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)',
 'public.provider_repeat_appointment_v164(uuid,uuid,text,date,time without time zone,text,text,integer)',
 'public.minuta_block_slot_valid_v123(uuid,uuid,uuid,date,time without time zone,integer)',
 'public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time without time zone,integer)'];

// Inspect only top-level statements: data writes inside original function bodies
// are schema definitions and must not be confused with restored table data.
export function schemaStatements(input){
 const text=input.replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?$/gm,'');
 const statements=[]; let out='',i=0;
 const fail=()=>{throw new Error('schema_lexical_boundary_invalid');};
 while(i<text.length){
  if(text.startsWith('--',i)){i=text.indexOf('\n',i);if(i<0)break;out+=' ';continue;}
  if(text.startsWith('/*',i)){let depth=1;i+=2;while(depth&&i<text.length){if(text.startsWith('/*',i)){depth++;i+=2;}else if(text.startsWith('*/',i)){depth--;i+=2;}else i++;}if(depth)fail();out+=' ';continue;}
  const dollar=text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
  if(dollar){const end=text.indexOf(dollar,i+dollar.length);if(end<0)fail();out+=' BODY ';i=end+dollar.length;continue;}
  if(text[i]==="'"||text[i]==='"'){
   const escapes=/[Ee]/.test(text[i-1]||'')&&!/[A-Za-z0-9_]/.test(text[i-2]||'');
   const quote=text[i++];let closed=false;
   while(i<text.length){if(text[i]==='\\'&&quote==="'"&&escapes){i+=2;continue;}if(text[i]===quote){if(text[i+1]===quote){i+=2;continue;}i++;closed=true;break;}i++;}
   if(!closed)fail();out+=quote==='"'?' IDENTIFIER ':' LITERAL ';continue;
  }
  if(text[i]===';'){if(out.trim())statements.push(out.trim());out='';i++;continue;}
  out+=text[i++];
 }
 if(out.trim())statements.push(out.trim());return statements;
}

export function verifySchema(bytes,expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/i,'schema SHA256 is required');
 assert.equal(sha(bytes),expected.toLowerCase(),'schema hash mismatch');
 assert.ok(bytes.length>0&&bytes.length<=64*1024*1024,'schema size is outside limit');
 const statements=schemaStatements(bytes.toString('utf8').replace(/^\uFEFF/,''));
 assert.ok(statements.length,'empty schema');
 for(const statement of statements){
  if(!/^(CREATE|ALTER|GRANT|REVOKE|COMMENT|SET)\b/i.test(statement)&&!/^SELECT\s+pg_catalog\.set_config\s*\(/i.test(statement))throw new Error('schema_contains_non_schema_statement');
  if(/^(?:CREATE|ALTER)\s+(?:DATABASE|SYSTEM|SERVER|FOREIGN|USER\s+MAPPING)\b/i.test(statement)||/^(?:CREATE|ALTER)\s+(?:ROLE|USER)\b[\s\S]*\bPASSWORD\b/i.test(statement))throw new Error('schema_contains_external_or_password_statement');
  if(/^SET\s+standard_conforming_strings\b/i.test(statement)&&!/^SET\s+standard_conforming_strings\s*=\s*on$/i.test(statement))throw new Error('schema_string_mode_refused');
 }
 return {sha256:sha(bytes),bytes:bytes.length,statementCount:statements.length};
}

export function containerArgs(name,label){
 assert.match(name,/^eldion-series-[a-f0-9-]{36}$/);assert.match(label,/^[a-f0-9-]{36}$/);
 return ['run','--detach','--name',name,'--label',`eldion.series.owner=${label}`,
  '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
  '--user','postgres','--pids-limit','128','--memory','1536m','--cpus','2',
  '--tmpfs','/series:rw,exec,size=768m,mode=1777','--entrypoint','/bin/sh',IMAGE,'-c','sleep infinity'];
}

export async function ownedCleanup(docker,id,owner){
 assert.match(id,/^[a-f0-9]{64}$/);assert.match(owner,/^[a-f0-9-]{36}$/);
 let info;try{info=JSON.parse(await docker(['inspect',id]));}catch(error){if(error.exitCode===1&&error.missingObject===id)return {alreadyAbsent:true};throw error;}
 assert.equal(info[0].Id,id);assert.equal(info[0].Config.Labels['eldion.series.owner'],owner,'refuse foreign container');
 await docker(['rm','--force',id]);
 try{await docker(['inspect',id]);throw new Error('owned_container_still_present');}catch(error){if(error.exitCode!==1||error.missingObject!==id)throw error;}
 return {removed:true};
}

function run(command,args,{input,env=process.env,binary=false,maxBytes=4*1024*1024,checksumDiagnostic=false}={}){
 return new Promise((done,fail)=>{
  const child=spawn(command,args,{env,stdio:['pipe','pipe','pipe']});const chunks=[];let bytes=0,stderr='',overflow=false;
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes>maxBytes){overflow=true;child.kill();}else chunks.push(b);});
  child.stderr.on('data',b=>{stderr+=b;if(stderr.length>4*1024*1024)child.kill();});
  child.once('error',fail);child.once('close',code=>{if(code===0&&!overflow){const output=Buffer.concat(chunks);done(binary?output:output.toString('utf8').trim());}else{const e=new Error(overflow?'isolated_output_limit':'isolated_command_failed');e.exitCode=code;e.sqlstate=stderr.match(/ERROR:\s+([0-9A-Z]{5})/)?.[1];e.missingObject=stderr.match(/No such (?:object|container):\s+([a-z0-9-]+)/i)?.[1];if(checksumDiagnostic)e.checksumDiagnostic=(stderr+'\n'+Buffer.concat(chunks).toString('utf8').split('\n').filter(line=>!/ OK$/.test(line)).join('\n')).slice(0,2000);fail(e);}});
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}

export async function executeStand({canary=false,schemaPath,schemaSha256,receiptPath}={}){
 assert.equal(process.platform,'linux','native stand executes only on Linux');
 let schema,source;
 if(!canary){
  assert.ok(schemaPath,'qualified full empty schema file required');
  assert.equal(lstatSync(schemaPath).isSymbolicLink(),false,'schema link refused');
  assert.ok(statSync(schemaPath).isFile());schema=readFileSync(realpathSync(schemaPath));source=verifySchema(schema,schemaSha256);
 }
 const owner=randomUUID(),name=`eldion-series-${owner}`,temp=mkdtempSync(join(tmpdir(),'eldion-series-'));
 const cli=join(temp,'docker');mkdirSync(cli);let id,primaryError,cleanupError,stage='image-pull';
 const docker=(args,opts)=>run('docker',['--config',cli,'--host','unix:///var/run/docker.sock',...args],opts);
 const receipt={format:'eldion-series-native-v1',mode:canary?'engine-canary':'supplied-full-schema',image:IMAGE,
  sourceSchema:source||null,fullSeriesGatePassed:false,engineCanaryPassed:false,ownedCleanupProven:false,
  sourceDataRead:false,productionWritten:false,actualProductionRestoreProven:false};
 try{
  await docker(['pull',IMAGE]);
  stage='owned-container-create';
  id=await docker(containerArgs(name,owner));assert.match(id,/^[a-f0-9]{64}$/);
  const config=JSON.parse(await docker(['inspect',id]))[0];
  assert.equal(config.HostConfig.NetworkMode,'none');assert.equal(config.HostConfig.ReadonlyRootfs,true);
  assert.equal(config.HostConfig.CapDrop.includes('ALL'),true);assert.equal(config.HostConfig.PortBindings==null||Object.keys(config.HostConfig.PortBindings).length===0,true);
  assert.equal(config.Mounts.every(x=>x.Type==='tmpfs'&&x.Destination==='/series'),true,'host/volume mounts refused');assert.equal(config.Config.User,'postgres');
  const exec=(args,opts)=>docker(['exec','--interactive',id,...args],opts);
  const pg='/usr/bin/';
  stage='generated-cluster-init';
  await exec([pg+'initdb','-D','/series/data','--username=postgres','--auth=trust','--no-instructions','--no-locale','--encoding=UTF8']);
  stage='generated-cluster-start';
  await exec([pg+'pg_ctl','-D','/series/data','-l','/series/server.log','-w','-t','25','start','-o','-c listen_addresses=127.0.0.1 -c unix_socket_directories=/series -c shared_preload_libraries= -c cron.launch_active_jobs=off -c pg_net.database_name=series_native_sink -c log_statement=none -c port=5432']);
  const psql=(sql,database='eldion-series-fixture')=>exec([pg+'psql','-X','--host=127.0.0.1','--username=postgres','--dbname='+database,'--set=ON_ERROR_STOP=1','--set=VERBOSITY=sqlstate','--tuples-only','--no-align'],{input:sql});
  stage='database-init';
  receipt.serverVersion=await psql('show server_version_num','postgres');assert.equal(receipt.serverVersion,'170006');
  await psql('create database "eldion-series-fixture"','postgres');
  stage=canary?'engine-sql-canary':'qualified-schema-restore';
  if(canary){
   await psql('create schema auth;create table auth.users(id uuid primary key);create table public.bookings(id uuid primary key);');
   await psql('begin;insert into public.bookings values(\'00000000-0000-4000-8000-000000000001\');rollback;');
   assert.equal(await psql('select count(*) from public.bookings'),'0');
   await assert.rejects(psql('select * from public.intentionally_missing_relation'),e=>e.sqlstate==='42P01');
   receipt.engineCanaryPassed=true;
  }else{
   await psql('drop schema public cascade;');
   await psql(schema);
   // Empty all source tables, with the real booking/repeat/resource graph present.
   const prerequisites=await psql(`select (${REQUIRED.map(x=>`to_regprocedure('${x}') is not null`).join(' and ')}) and to_regclass('auth.users') is not null and to_regclass('public.bookings') is not null and to_regprocedure('auth.uid()') is not null;`);
   assert.equal(prerequisites,'t','full schema dependencies missing');
   await psql(`do $$declare t record;n bigint;begin for t in select schemaname,tablename from pg_tables where schemaname in ('public','auth') loop execute format('select count(*) from %I.%I',t.schemaname,t.tablename) into n;if n<>0 then raise exception using errcode='55000',message='schema_not_empty';end if;end loop;end $$;`);
   assert.equal(await psql("select exists(select 1 from pg_trigger where tgrelid='public.bookings'::regclass and not tgisinternal and tgenabled<>'D');"),'t','booking triggers must be enabled');
   await psql("create schema if not exists minuta_migration_guard;create table if not exists minuta_migration_guard.target(project_ref text primary key,allow_migrations boolean not null);truncate minuta_migration_guard.target;insert into minuta_migration_guard.target values('eldion-series-fixture',true);");
  }
   // Both modes execute the same Node/pg transport inside the isolated image.
   stage='node-runtime-prepare';
   const runtime=join(temp,'runtime');mkdirSync(join(runtime,'lib'),{recursive:true});
   cpSync(process.execPath,join(runtime,'node'));
   const dependencies=await run('ldd',[process.execPath]);
   const libraries=[...new Set(dependencies.match(/\/[A-Za-z0-9_./+-]+/g)||[])];
   for(const lib of libraries)cpSync(realpathSync(lib),join(runtime,'lib',lib.split('/').pop()));
   const loader=libraries.find(x=>/ld-linux/.test(x));assert.ok(loader,'Node linker not found');
   const payload=join(temp,'payload');mkdirSync(join(payload,'tests'),{recursive:true});mkdirSync(join(payload,'recovery'));
   for(const f of ['repeat-series-full-schema-test.mjs','repeat-visit-v164-integration.sql'])cpSync(join(ROOT,'tests',f),join(payload,'tests',f));
   for(const f of ['provider-series-plan-candidate.sql','provider-series-plan-rollback.sql'])cpSync(join(ROOT,'recovery',f),join(payload,'recovery',f));
   writeFileSync(join(payload,'tests','series-engine-driver.mjs'),`import assert from 'node:assert/strict';import pg from 'pg';const db=new pg.Client({connectionString:process.env.MINUTA_TEST_DATABASE_URL});try{await db.connect();assert.equal((await db.query('show server_version_num')).rows[0].server_version_num,'170006');await assert.rejects(db.query('select * from public.intentionally_missing_relation'),e=>e.code==='42P01');}finally{await db.end();}console.log('Series Node/pg native transport: PASS');`);
   cpSync(join(ROOT,'scripts','series-native-runtime','node_modules'),join(payload,'node_modules'),{recursive:true});
   // Docker archive-copy rejects writable tmpfs under a read-only rootfs.
   // Stream the owned archive to tar as postgres; retain every isolation guard.
   stage='node-runtime-transfer';
   const archive=await run('tar',['--create','--file=-','--directory',temp,'runtime','payload'],{binary:true,maxBytes:256*1024*1024});
   await exec(['/bin/tar','--extract','--file=-','--directory=/series','--no-same-owner','--no-same-permissions'],{input:archive});
   const hashes=[];function walk(base,target){for(const entry of readdirSync(base,{withFileTypes:true})){const path=join(base,entry.name),remote=target+'/'+entry.name;assert.equal(entry.isSymbolicLink(),false,'payload symlink refused');if(entry.isDirectory())walk(path,remote);else hashes.push(`${sha(readFileSync(path))}  ${remote}`);}}
   walk(runtime,'/series/runtime');walk(payload,'/series/payload');
   stage='runtime-and-input-hashes';
   await exec(['/usr/bin/sha256sum','-c','-'],{input:hashes.join('\n')+'\n',checksumDiagnostic:true});receipt.runtimeAndInputHashesVerified=true;
   stage=canary?'native-node-pg-canary':'native-full-series';
   const result=await exec(['/usr/bin/env','-i','MINUTA_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/eldion-series-fixture',
    'MINUTA_SERIES_EPHEMERAL_CONFIRM=SCHEMA_ONLY_EMPTY_DATABASE','MINUTA_TEST_PROJECT_REF=eldion-series-fixture',
    'MINUTA_PRODUCTION_PROJECT_REF=production-never-a-test-target','MINUTA_TEST_MIGRATION_CONFIRM=MIGRATE_ONLY_ISOLATED_TEST_DATABASE',
    '/series/runtime/lib/'+loader.split('/').pop(),'--library-path','/series/runtime/lib','/series/runtime/node','/series/payload/tests/'+(canary?'series-engine-driver.mjs':'repeat-series-full-schema-test.mjs')]);
   assert.ok(result.startsWith(canary?'Series Node/pg native transport: PASS':'Series full-schema PostgreSQL: PASS'));
   receipt.nativeNodePgTransportPassed=true;
   if(!canary)receipt.fullSeriesGatePassed=true;
 }catch(error){primaryError=error;receipt.failureStage=stage;receipt.failure={code:error.message,exitCode:error.exitCode??null,sqlstate:error.sqlstate||null};if(error.checksumDiagnostic)receipt.failure.checksumDiagnostic=error.checksumDiagnostic;}
 finally{
  try{if(!id){try{const info=JSON.parse(await docker(['inspect',name]))[0];assert.equal(info.Config.Labels['eldion.series.owner'],owner);id=info.Id;}catch(error){if(error.exitCode!==1||error.missingObject!==name)throw error;}}if(id){await ownedCleanup(docker,id,owner);assert.deepEqual(await ownedCleanup(docker,id,owner),{alreadyAbsent:true});}receipt.ownedCleanupProven=true;}catch(error){cleanupError=error;receipt.cleanupFailure=error.message;}
  try{rmSync(temp,{recursive:true,force:true});receipt.localTemporaryCleanupProven=!statExists(temp);}catch(error){cleanupError||=error;receipt.localTemporaryCleanupProven=false;}
  if(primaryError||cleanupError)receipt.fullSeriesGatePassed=false;
  if(receiptPath)writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');
 }
 if(primaryError)throw primaryError;if(cleanupError)throw cleanupError;return receipt;
}
function statExists(path){try{statSync(path);return true;}catch{return false;}}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
 try{const receipt=await executeStand({canary:args.includes('--canary'),schemaPath:option('--schema'),schemaSha256:option('--schema-sha256'),receiptPath:option('--receipt')});console.log(JSON.stringify(receipt));}
 catch(error){console.error(JSON.stringify({error:error.message,sqlstate:error.sqlstate||null,fullSeriesGatePassed:false}));process.exitCode=1;}
}
