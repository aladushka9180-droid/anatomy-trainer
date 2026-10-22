import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const image='supabase/postgres@sha256:d5424e9f4d0c21d63991c3f3dd77881f23f722c3a212452a61bc91924b79e8c8';
const expectedExtensions={btree_gist:'1.7',pg_cron:'1.6.4',pg_net:'0.20.4',pg_stat_statements:'1.11',pgcrypto:'1.3',plpgsql:'1.0',supabase_vault:'0.3.1','uuid-ossp':'1.1'};
const forbiddenCredentials=['SUPABASE_DB_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ACCESS_TOKEN','MINUTA_TEST_DB_URL','MINUTA_RESTORE_TEST_DB_URL','BACKUP_ENCRYPTION_PASSWORD','PGPASSWORD'];
for(const name of forbiddenCredentials)if(process.env[name])throw new Error('SOURCE_OR_TARGET_CREDENTIAL_ENV_FORBIDDEN');
assert.ok(process.argv.length<=4&&(process.argv[3]===undefined||process.argv[3]==='--prestart-isolation'));
const prestart=process.argv[3]==='--prestart-isolation';
const prestartSettings={max_worker_processes:'0',max_logical_replication_workers:'0',max_parallel_workers:'0',max_parallel_workers_per_gather:'0',max_parallel_maintenance_workers:'0',autovacuum:'off','cron.launch_active_jobs':'off'};
const contract={format:'eldion-fullcopy-public-runtime-profile-r21',image,engine:'17.6',platform:'linux/amd64',
  profile:prestart?'RESTORE_BASELINE_PRESTART_ISOLATION_R23':'SYNTHETIC_RUNTIME_FAMILY_R21',
  prestartSettings:prestart?prestartSettings:null,
  memoryBytes:3221225472,pidsLimit:256,cpus:2,network:'none',hostPortBindings:0,hostBindMounts:0,
  expectedExtensions,scope:'Public image and two synthetic databases inside one disposable container; cluster roles are shared. No full-copy, Auth, Storage or globals-restore qualification.',
  productionConnections:0,realArchivesRead:0,authUsersRead:0,storageBodiesRead:0,sourceCredentialsUsed:0};
if(process.argv[2]==='--plan'){console.log(JSON.stringify({...contract,execution:false},null,2));process.exit(0);}
assert.equal(process.argv[2],'--run');
assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.GITHUB_REPOSITORY,'aladushka9180-droid/anatomy-trainer');
assert.match(process.env.GITHUB_RUN_ID??'',/^\d{1,20}$/);assert.match(process.env.GITHUB_RUN_ATTEMPT??'',/^\d{1,4}$/);
assert.ok(path.isAbsolute(process.env.RUNNER_TEMP??''));
const run=`${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const container=`eldion-fc-profile-${run}`,label='eldion.fullcopy.synthetic-profile';
const resultPath=path.join(process.env.RUNNER_TEMP,'eldion-fullcopy-runtime-profile.json');
assert.equal(fs.existsSync(resultPath),false);
const receipt={...contract,startedAt:new Date().toISOString(),runId:process.env.GITHUB_RUN_ID,
  runAttempt:process.env.GITHUB_RUN_ATTEMPT,workflowCommit:process.env.GITHUB_SHA,
  status:'RUNNING',stage:'PULL_IMAGE',containerCreated:false,containerDestroyed:false,
  fullCopyAccepted:false,liveReaderEndpointAccepted:false,privateDataLoaded:false};
let created=false,containerId=null,failed=false;
function docker(args,{input,timeout=120000}={}){
  return execFileSync('docker',args,{input,timeout,encoding:'utf8',maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']}).trim();
}
function psql(database,sql){
  return docker(['exec','-i',container,'psql','-X','-qAt','-h','/var/run/postgresql','-U','supabase_admin','-v','ON_ERROR_STOP=1','-d',database],{input:sql,timeout:60000});
}
function snapshot(database){
  return JSON.parse(psql(database,`SELECT json_build_object(
    'rows',(SELECT count(*) FROM eldion_probe.records),
    'rowDigest',(SELECT md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY id)) FROM eldion_probe.records t),
    'tableOwner',(SELECT relowner::regrole::text FROM pg_class WHERE oid='eldion_probe.records'::regclass),
    'tableAcl',(SELECT relacl::text FROM pg_class WHERE oid='eldion_probe.records'::regclass),
    'rlsEnabled',(SELECT relrowsecurity FROM pg_class WHERE oid='eldion_probe.records'::regclass),
    'rlsForced',(SELECT relforcerowsecurity FROM pg_class WHERE oid='eldion_probe.records'::regclass),
    'policy',(SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polrelid='eldion_probe.records'::regclass),
    'sequenceOwner',(SELECT relowner::regrole::text FROM pg_class WHERE oid='eldion_probe.record_number'::regclass),
    'sequenceLast',(SELECT last_value::text FROM eldion_probe.record_number),
    'sequenceCalled',(SELECT is_called FROM eldion_probe.record_number));`));
}
try{
  docker(['pull','--platform','linux/amd64',image],{timeout:240000});
  receipt.stage='CREATE_DISPOSABLE_CONTAINER';
  const password=`synthetic-only-${randomBytes(24).toString('hex')}`;
  containerId=docker(['run','--detach','--name',container,'--label',`${label}=${run}`,
    '--network','none','--memory','3g','--pids-limit','256','--cpus','2',
    '--env','POSTGRES_USER=supabase_admin','--env',`POSTGRES_PASSWORD=${password}`,
    image,'postgres','-D','/etc/postgresql','-c','listen_addresses=','-c','cron.launch_active_jobs=off',
    ...(prestart?Object.entries(prestartSettings).filter(([name])=>name!=='cron.launch_active_jobs').flatMap(([name,value])=>['-c',`${name}=${value}`]):[])]);
  assert.match(containerId,/^[a-f0-9]{64}$/);created=true;receipt.containerCreated=true;
  receipt.stage='VERIFY_ISOLATION';
  const inspect=JSON.parse(docker(['inspect',container]))[0];
  assert.equal(inspect.Id,containerId);assert.equal(inspect.Config.Labels[label],run);
  assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(inspect.HostConfig.Memory,contract.memoryBytes);
  assert.equal(inspect.HostConfig.PidsLimit,256);assert.equal(inspect.HostConfig.NanoCpus,2000000000);
  assert.equal((inspect.HostConfig.Binds??[]).length,0);assert.equal(Object.keys(inspect.HostConfig.PortBindings??{}).length,0);
  assert.equal(inspect.Mounts.some(m=>m.Type==='bind'),false);
  receipt.isolationVerified=true;
  receipt.stage='WAIT_FOR_EMPTY_SERVER';
  let ready=false;
  for(let i=0;i<60;i++){
    try{
      const startup=spawnSync('docker',['logs','--tail','80',container],{encoding:'utf8',timeout:5000,maxBuffer:65536,stdio:['pipe','pipe','pipe']});
      assert.equal(startup.status,0);
      receipt.initializationCompleted=`${startup.stdout??''}\n${startup.stderr??''}`.includes('PostgreSQL init process complete; ready for start up.');
      try{receipt.observedPid1Name=docker(['exec',container,'cat','/proc/1/comm'],{timeout:5000}).slice(0,64);}catch{receipt.observedPid1Name='unavailable';}
      assert.equal(receipt.initializationCompleted,true);
      docker(['exec',container,'pg_isready','-h','/var/run/postgresql','-U','supabase_admin','-d','postgres'],{timeout:5000});ready=true;break;
    }
    catch{await delay(700);}
  }
  assert.equal(ready,true);
  receipt.stage='CHECK_ENGINE_AND_EXTENSIONS';
  const expected=Object.entries(expectedExtensions).map(([n,v])=>`('${n}','${v}')`).join(',');
  const capabilities=JSON.parse(psql('postgres',`WITH expected(name,version) AS(VALUES ${expected})
    SELECT json_build_object('engine',current_setting('server_version'),
      'administrator',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
      'extensions',(SELECT json_agg(json_build_object('name',e.name,'required',e.version,
        'available',EXISTS(SELECT 1 FROM pg_available_extension_versions a WHERE a.name=e.name AND a.version=e.version)) ORDER BY e.name) FROM expected e));`));
  receipt.capabilities=capabilities;
  assert.match(capabilities.engine,/^17\.6(?:\s|$)/);assert.equal(capabilities.administrator,true);
  if(!capabilities.extensions.every(e=>e.available))throw new Error('REQUIRED_EXTENSION_VERSION_UNAVAILABLE');
  if(prestart){
    receipt.stage='VERIFY_PRESTART_BACKGROUND_ISOLATION';
    const settings=JSON.parse(psql('postgres',`SELECT json_object_agg(name,json_build_object('setting',setting,'source',source)) FROM pg_settings WHERE name IN (${Object.keys(prestartSettings).map(name=>`'${name}'`).join(',')});`));
    for(const [name,value] of Object.entries(prestartSettings)){
      assert.equal(settings[name]?.setting,value);assert.equal(settings[name]?.source,'command line');
    }
    psql('postgres',`SET statement_timeout='10s';
      CREATE EXTENSION IF NOT EXISTS pg_cron VERSION '1.6.4';
      CREATE EXTENSION IF NOT EXISTS pg_net VERSION '0.20.4';
      CREATE TABLE public.eldion_prestart_effects(marker text NOT NULL);
      INSERT INTO cron.job(jobid,schedule,command,nodename,nodeport,database,username,active,jobname)
        VALUES(9001,'* * * * *','INSERT INTO public.eldion_prestart_effects VALUES (''unexpected scheduler effect'')','localhost',5432,'postgres','supabase_admin',true,'eldion_prestart_fixture');
      INSERT INTO cron.job_run_details(jobid,runid,status,command,database,username,start_time)
        VALUES(9001,9001,'running','SELECT 1','postgres','supabase_admin','2000-01-01T00:00:00Z');
      INSERT INTO net.http_request_queue(id,method,url,headers,body,timeout_milliseconds)
        VALUES(9001,'POST','https://no-delivery.invalid/fixture','{}',decode('00','hex'),1000);
      INSERT INTO net._http_response(id,status_code,content_type,headers,content,timed_out,created)
        VALUES(9002,200,'text/plain','{}','synthetic expired response',false,'2000-01-01T00:00:00Z');`);
    const idleSnapshot=()=>JSON.parse(psql('postgres',`SET statement_timeout='10s'; SELECT json_build_object(
      'cronVersion',(SELECT extversion FROM pg_extension WHERE extname='pg_cron'),
      'netVersion',(SELECT extversion FROM pg_extension WHERE extname='pg_net'),
      'jobs',(SELECT count(*) FROM cron.job WHERE jobid=9001),
      'runs',(SELECT count(*) FROM cron.job_run_details WHERE runid=9001 AND status='running'),
      'requests',(SELECT count(*) FROM net.http_request_queue WHERE id=9001),
      'expiredResponses',(SELECT count(*) FROM net._http_response WHERE id=9002),
      'effects',(SELECT count(*) FROM public.eldion_prestart_effects),
      'extensionWorkers',(SELECT count(*) FROM pg_stat_activity WHERE backend_type ILIKE '%pg_net%' OR backend_type ILIKE '%cron%' OR application_name IN ('pg_cron scheduler','pg_net 0.20.4')),
      'digest',md5(json_build_array((SELECT row_to_json(t) FROM cron.job t WHERE jobid=9001),(SELECT row_to_json(t) FROM cron.job_run_details t WHERE runid=9001),(SELECT row_to_json(t) FROM net.http_request_queue t WHERE id=9001),(SELECT row_to_json(t) FROM net._http_response t WHERE id=9002))::text));`));
    const before=idleSnapshot();
    assert.equal(before.cronVersion,'1.6.4');assert.equal(before.netVersion,'0.20.4');
    for(const name of ['jobs','runs','requests','expiredResponses'])assert.equal(before[name],1);
    assert.equal(before.effects,0);assert.equal(before.extensionWorkers,0);
    await delay(5000);
    const after=idleSnapshot();assert.deepEqual(after,before);
    receipt.prestartIsolation={settingsVerifiedBeforeExtensionInstall:true,commandLineSettings:settings,observationMilliseconds:5000,
      fixtureRowsPreserved:4,activeCronJobPreserved:true,runningCronStatusPreserved:true,pendingHttpRequestPreserved:true,
      expiredHttpResponsePreserved:true,observedExtensionWorkers:0,observedScheduledEffects:0,fixtureDigest:after.digest,
      httpSchedulingApisCalled:false,applicationHttpApiBehaviorQualified:false,fullApplicationRuntimeQualified:false,
      scope:'Synthetic baseline restoration and read-only inspection profile only; no production writer barrier, full capture, globals/Auth/Storage restore or arbitrary application SQL qualification.'};
  }
  receipt.stage='CREATE_SYNTHETIC_SOURCE';
  psql('postgres',`CREATE ROLE eldion_probe_owner NOLOGIN NOBYPASSRLS;
    CREATE ROLE eldion_probe_actor NOLOGIN NOBYPASSRLS;
    CREATE SCHEMA eldion_probe AUTHORIZATION eldion_probe_owner;
    CREATE SEQUENCE eldion_probe.record_number START 7;
    CREATE TABLE eldion_probe.records(id bigint PRIMARY KEY DEFAULT nextval('eldion_probe.record_number'),actor text NOT NULL,amount numeric(10,2) NOT NULL);
    INSERT INTO eldion_probe.records(actor,amount) VALUES('eldion_probe_actor',12.00),('unrelated_synthetic_actor',3.00);
    ALTER TABLE eldion_probe.records OWNER TO eldion_probe_owner;
    ALTER SEQUENCE eldion_probe.record_number OWNER TO eldion_probe_owner;
    GRANT USAGE ON SCHEMA eldion_probe TO eldion_probe_actor;
    GRANT SELECT ON eldion_probe.records TO eldion_probe_actor;
    ALTER TABLE eldion_probe.records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE eldion_probe.records FORCE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON eldion_probe.records FOR SELECT TO eldion_probe_actor USING(actor=current_user::text);
    DO $$BEGIN PERFORM setval('eldion_probe.record_number',42,true); END$$;`);
  const source=snapshot('postgres');assert.equal(source.rows,2);assert.equal(source.sequenceLast,'42');
  assert.equal(source.tableOwner,'eldion_probe_owner');assert.equal(source.rlsEnabled,true);assert.equal(source.rlsForced,true);
  assert.equal(psql('postgres',"SET ROLE eldion_probe_actor; SELECT count(*) FROM eldion_probe.records; RESET ROLE;"),'1');
  assert.equal(psql('postgres',"SELECT (rolsuper OR rolbypassrls)::text FROM pg_roles WHERE rolname='eldion_probe_actor';"),'false');
  receipt.stage='CUSTOM_ARCHIVE_AND_ISOLATED_DATABASE_RESTORE';
  docker(['exec',container,'pg_dump','-h','/var/run/postgresql','-U','supabase_admin','-d','postgres','--format=custom','--schema=eldion_probe','--file=/tmp/eldion-profile.dump']);
  docker(['exec',container,'pg_restore','--list','/tmp/eldion-profile.dump']);
  psql('postgres','CREATE DATABASE eldion_profile_target;');
  docker(['exec',container,'pg_restore','-h','/var/run/postgresql','-U','supabase_admin','--dbname=eldion_profile_target','--exit-on-error','--single-transaction','/tmp/eldion-profile.dump']);
  const restored=snapshot('eldion_profile_target');assert.deepEqual(restored,source);
  assert.equal(psql('eldion_profile_target',"SET ROLE eldion_probe_actor; SELECT count(*) FROM eldion_probe.records; RESET ROLE;"),'1');
  receipt.syntheticArchive={preservedRows:2,ownersPreserved:true,aclPreserved:true,rlsAndPolicyPreserved:true,sequenceValueAndCalledPreserved:true,actorRlsReadsOnlyOwnRow:true,clusterRolesShared:true,globalsRestoreProven:false,authStorageRestoreProven:false};
  receipt.status='PASS_SYNTHETIC_RUNTIME_PROFILE';
}catch(error){
  failed=true;receipt.status='FAILED_RUNTIME_PROFILE';
  receipt.failureCategory=error.message==='REQUIRED_EXTENSION_VERSION_UNAVAILABLE'?error.message:'BOUNDED_PROBE_FAILED';
  if(receipt.stage==='VERIFY_PRESTART_BACKGROUND_ISOLATION')receipt.syntheticSqlDiagnostic=String(error.stderr??'').split('\n').filter(line=>/^(ERROR|FATAL|DETAIL|HINT|LINE)[: ]/.test(line)&&!/password|secret|token|credential|authorization/i.test(line)).slice(0,4).map(line=>line.slice(0,240));
  if(created&&receipt.stage==='WAIT_FOR_EMPTY_SERVER'){
    try{
      const state=JSON.parse(docker(['inspect','--format','{{json .State}}',container]));
      const logs=spawnSync('docker',['logs','--tail','80',container],{encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['pipe','pipe','pipe']});
      const messages=`${logs.stdout??''}\n${logs.stderr??''}`.split('\n')
        .filter(line=>/FATAL|ERROR|PANIC|failed|could not|initdb|unrecognized|permission denied|No such file/i.test(line))
        .filter(line=>!/password|secret|token|credential|authorization/i.test(line)).slice(-12).map(line=>line.slice(0,240));
      receipt.syntheticStartupDiagnostics={state:state.Status,exitCode:state.ExitCode,oomKilled:state.OOMKilled,messages};
    }catch{receipt.syntheticStartupDiagnostics={unavailable:true};}
  }
}finally{
  const failedStage=receipt.stage;
  if(created){
    try{
      receipt.stage='CLEANUP_OWN_SYNTHETIC_CONTAINER';
      const owned=JSON.parse(docker(['inspect',container]))[0];
      assert.equal(owned.Id,containerId);assert.equal(owned.Config.Labels[label],run);
      docker(['rm','--force','--volumes',container],{timeout:30000});
      assert.equal(docker(['ps','--all','--filter',`label=${label}=${run}`,'--format','{{.ID}}']), '');
      receipt.containerDestroyed=true;
    }catch{failed=true;receipt.status='FAILED_OWN_CONTAINER_CLEANUP';}
  }
  receipt.stage=failed?failedStage:'COMPLETE';receipt.finishedAt=new Date().toISOString();
  receipt.noLiveEndpointRetained=receipt.containerDestroyed;
  fs.writeFileSync(resultPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:receipt.status,stage:receipt.stage,engine:receipt.capabilities?.engine??null,extensionsAvailable:receipt.capabilities?.extensions.filter(x=>x.available).length??0,containerDestroyed:receipt.containerDestroyed,privateDataLoaded:false,fullCopyAccepted:false}));
}
if(failed)process.exitCode=1;
