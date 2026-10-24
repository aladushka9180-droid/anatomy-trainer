import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

// This fixed public fixture is not a dispatcher or a production maintenance tool.
const image='supabase/postgres@sha256:d5424e9f4d0c21d63991c3f3dd77881f23f722c3a212452a61bc91924b79e8c8';
const credentials=['SUPABASE_DB_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ACCESS_TOKEN',
  'MINUTA_TEST_DB_URL','MINUTA_RESTORE_TEST_DB_URL','BACKUP_ENCRYPTION_PASSWORD','PGPASSWORD','PGHOST','PGSERVICE','PGPASSFILE'];
for(const name of credentials)assert.ok(!process.env[name],'SOURCE_OR_TARGET_CREDENTIAL_ENV_FORBIDDEN');
assert.equal(process.argv.length,3);assert.ok(['--plan','--run'].includes(process.argv[2]));
const settings={max_worker_processes:'0',max_logical_replication_workers:'0',max_parallel_workers:'0',
  max_parallel_workers_per_gather:'0',max_parallel_maintenance_workers:'0',autovacuum:'off','cron.launch_active_jobs':'off'};
const cases=['C1_ALL_TOUCH_AND_ROLLBACK','C2_CONCURRENT_NOOP_DRIFT_ABORTS_WHOLE_S1',
  'C3_SCOPED_TABLE_FENCE_DRAIN_READ_RESUME','C4_COMMITTED_CRON_CUSTODY_AND_SEPARATE_PROCESS_RESUME',
  'C5_CHANGED_PAUSED_VERSION_REFUSES_RESUME','C6_MISSING_COMMITTED_CUSTODY_REFUSES_RESUME'];
const contract={format:'eldion-public-maintenance-native-r26',image,engine:'17.6',cronVersion:'1.6.4',cases,
  settings,network:'none',memoryBytes:3221225472,cpus:2,pids:256,hostPorts:0,hostBinds:0,
  productionConnections:0,realArchivesRead:0,authUsersRead:0,storageBodiesRead:0,sourceCredentialsUsed:0,
  oldRuntimeOrOnceReused:false,automaticRetries:0,wholeServiceQualified:false,fullCopyAccepted:false,
  scope:'Fixed synthetic cron API/RR mechanics and one enumerated table/role fence only. No scheduler, global writer, hosted build, whole Auth/Storage/HTTP or full-copy qualification.',
  recoveryLimit:'Separate process/backend, same database custody; no container/host-loss or ambiguous-COMMIT qualification.',
  tableLimit:'Single table DML ACL only; no sequence/DDL/privileged writer coverage or concurrent ACL-administrator race qualification.'};
if(process.argv[2]==='--plan'){console.log(JSON.stringify({...contract,execution:false},null,2));process.exit(0);}
assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.GITHUB_REPOSITORY,'aladushka9180-droid/anatomy-trainer');
assert.match(process.env.GITHUB_RUN_ID??'',/^\d{1,20}$/);assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
assert.ok(path.isAbsolute(process.env.RUNNER_TEMP??''));
const run=process.env.GITHUB_RUN_ID,container=`eldion-maintenance-${run}`,label='eldion.maintenance.synthetic';
const resultPath=path.join(process.env.RUNNER_TEMP,'eldion-maintenance-native.json');
assert.equal(fs.existsSync(resultPath),false);
const receipt={...contract,runId:run,runAttempt:'1',workflowCommit:process.env.GITHUB_SHA,startedAt:new Date().toISOString(),
  status:'RUNNING',stage:'PULL_IMAGE',results:[],containerCreated:false,containerDestroyed:false};
receipt.sourceSha256=createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
let containerId=null,created=false,failed=false,clientNumber=0;
const clients=new Set();
function docker(args,{input,timeout=60000}={}){
  return execFileSync('docker',args,{input,timeout,encoding:'utf8',maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']}).trim();
}
function psql(sql,user='supabase_admin'){
  return docker(['exec','-i',container,'psql','-X','-qAt','-h','/var/run/postgresql','-U',user,
    '-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-d','postgres'],{input:sql});
}
function json(sql,user){return JSON.parse(psql(sql,user));}
const role='eldion_native_cron_actor';
function jobSql(){return `SELECT coalesce(json_agg(row_to_json(t) ORDER BY jobid),'[]'::json) FROM (
  SELECT jobid::text,jobname,database,username,nodename,nodeport,schedule,active,xmin::text,
    encode(sha256(convert_to(command,'UTF8')),'hex') AS command_sha256
  FROM cron.job WHERE username='${role}' ORDER BY jobid) t;`;}
function values(rows){return rows.map(({xmin,...rest})=>rest);}
function ownXmin(rows,xid){for(const row of rows)assert.equal(row.xmin,(BigInt(xid)&0xffffffffn).toString());}
function ids(rows){assert.equal(rows.length,2);for(const r of rows)assert.match(r.jobid,/^[1-9]\d{0,17}$/);return rows.map(r=>r.jobid);}
function literal(value){return "'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";}

class Client{
  constructor(user){
    this.user=user;this.app=`eldion-r26-${run}-${++clientNumber}`;this.number=0;this.buffer='';this.lines=[];this.errors='';this.pending=null;this.closed=false;
    this.process=spawn('docker',['exec','-i','--env',`PGAPPNAME=${this.app}`,container,'psql','-X','-qAt','-h','/var/run/postgresql',
      '-U',user,'-v','ON_ERROR_STOP=0','-v','VERBOSITY=sqlstate','-P','pager=off','-d','postgres'],{stdio:['pipe','pipe','pipe']});
    clients.add(this);
    this.exited=new Promise(resolve=>{this.process.on('exit',(code,signal)=>{this.closed=true;clients.delete(this);
      if(this.pending){clearTimeout(this.pending.timer);const error=new Error('OWN_CLIENT_EXIT_DURING_REQUEST');error.stderr=this.errors;this.pending.reject(error);this.pending=null;}resolve({code,signal});});});
    this.process.on('error',error=>{if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}});
    this.process.stdout.on('data',chunk=>{
      this.buffer+=chunk.toString();assert.ok(this.buffer.length<262144);
      let end;while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end).replace(/\r$/,'');this.buffer=this.buffer.slice(end+1);
        const p=this.pending;if(p&&line.startsWith(p.marker+' ')){
          clearTimeout(p.timer);this.pending=null;p.resolve({lines:this.lines.filter(Boolean),state:line.slice(p.marker.length+1),errors:this.errors});this.lines=[];
        }else this.lines.push(line);
      }
    });
    this.process.stderr.on('data',chunk=>{this.errors=(this.errors+chunk.toString()).slice(-16384);});
  }
  sql(sql){
    assert.equal(this.closed,false);assert.equal(this.pending,null);this.errors='';
    const marker=`__ELDION_BOUNDARY_${++this.number}__`;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending=null;reject(new Error('OWN_SQL_TIMEOUT'));},25000);
      this.pending={resolve,reject,timer,marker};this.process.stdin.write(sql+`\n\\echo ${marker} :SQLSTATE\n`);});
  }
  async ok(sql){const r=await this.sql('\\set ON_ERROR_STOP on\n'+sql+'\n\\set ON_ERROR_STOP off');assert.equal(r.state,'00000',r.errors);return r.lines;}
  async object(sql){const lines=await this.ok(sql);assert.equal(lines.length,1);return JSON.parse(lines[0]);}
  async start(){
    await this.ok("SET statement_timeout='20s'; SET lock_timeout='15s';");
    const c=await this.object(`SELECT json_build_object('pid',pg_backend_pid(),'user',current_user,'session',session_user,
      'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'postmaster',pg_postmaster_start_time()::text);`);
    assert.equal(c.user,this.user);assert.equal(c.session,this.user);assert.equal(c.databaseOid,receipt.physical.databaseOid);
    assert.equal(c.postmaster,receipt.physical.postmaster);this.pid=c.pid;return this;
  }
  async begin(){
    await this.ok('BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE;');
    const c=await this.object(`SELECT json_build_object('pid',pg_backend_pid(),'user',current_user,'session',session_user,
      'isolation',current_setting('transaction_isolation'),'readOnly',current_setting('transaction_read_only'),
      'xid',pg_current_xact_id()::text,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
      'canSelect',has_table_privilege(current_user,'cron.job','SELECT'),'canUse',has_schema_privilege(current_user,'cron','USAGE'),
      'canAlter',has_function_privilege(current_user,'cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE'),
      'canUpdate',has_any_column_privilege(current_user,'cron.job','UPDATE'));`);
    assert.equal(c.pid,this.pid);assert.equal(c.user,role);assert.equal(c.session,role);assert.equal(c.superuser,false);
    assert.equal(c.isolation,'repeatable read');assert.equal(c.readOnly,'off');assert.equal(c.canUpdate,false);
    assert.equal(c.canSelect,true);assert.equal(c.canUse,true);assert.equal(c.canAlter,true);return c;
  }
  async close(){if(!this.closed){this.process.stdin.end('\\q\n');await this.exited;}}
}
async function client(user=role){return await new Client(user).start();}
async function jobs(c){return await c.object(jobSql());}
async function touch(c,rows,actives){for(let i=0;i<ids(rows).length;i++)await c.ok(`SELECT cron.alter_job(${rows[i].jobid}::bigint, active := ${actives[i]?'true':'false'});`);}
async function terminate(c){
  const owned=json(`SELECT json_build_object('count',count(*),'owned',bool_and(usename='${c.user}' AND application_name='${c.app}'))
    FROM pg_stat_activity WHERE pid=${c.pid};`);assert.equal(owned.count,1);assert.equal(owned.owned,true);
  assert.equal(psql(`SELECT pg_terminate_backend(${c.pid});`),'t');await c.exited;
}
async function idle(c){assert.equal(psql(`SELECT state FROM pg_stat_activity WHERE pid=${c.pid};`),'idle');}
async function pauseAndCommit(c,key){
  const context=await c.begin(),original=await jobs(c);ids(original);
  await touch(c,original,[false,false]);const paused=await jobs(c);ownXmin(paused,context.xid);
  assert.deepEqual(values(paused),values(original).map(r=>({...r,active:false})));
  await c.ok(`INSERT INTO eldion_native_custody.states(key,original,paused,state) VALUES('${key}',${literal(original)},${literal(paused)},'paused'); COMMIT;`);
  assert.deepEqual(json(jobSql()),paused);
  assert.deepEqual(json(`SELECT json_build_object('original',original,'paused',paused,'state',state) FROM eldion_native_custody.states WHERE key='${key}';`),{original,paused,state:'paused'});
  return {original,paused,pid:c.pid};
}
async function recover(key){
  const c=await client();try{
    const context=await c.begin();
    const custody=await c.object(`SELECT coalesce((SELECT row_to_json(t) FROM eldion_native_custody.states t WHERE key='${key}'),'null'::json);`);
    if(!custody){await c.ok('ROLLBACK;');return {status:'REFUSED_MISSING_COMMITTED_CUSTODY',apiCalls:0,pid:c.pid};}
    assert.equal(custody.state,'paused');const observed=await jobs(c);
    if(JSON.stringify(observed)!==JSON.stringify(custody.paused)){
      // jsonb key order is irrelevant. Tuple values and versions are compared structurally.
      try{assert.deepEqual(observed,custody.paused);}catch{await c.ok('ROLLBACK;');return {status:'REFUSED_CHANGED_PAUSED_VERSION',apiCalls:0,pid:c.pid};}
    }
    ids(custody.original);await touch(c,custody.original,custody.original.map(r=>r.active));
    const restored=await jobs(c);ownXmin(restored,context.xid);assert.deepEqual(values(restored),values(custody.original));
    await c.ok(`UPDATE eldion_native_custody.states SET state='resumed' WHERE key='${key}' AND state='paused'; COMMIT;`);
    assert.deepEqual(values(json(jobSql())),values(custody.original));
    assert.equal(psql(`SELECT state FROM eldion_native_custody.states WHERE key='${key}';`,role),'resumed');
    return {status:'RESUMED_ORIGINAL_VALUES',apiCalls:2,pid:c.pid,originalTupleXminRestored:false};
  }finally{await c.close();}
}
async function runCase(name,fn){receipt.stage=name;const details=await fn();receipt.results.push({id:name,status:'PASS',...details});}

try{
  docker(['pull','--platform','linux/amd64',image],{timeout:240000});
  receipt.stage='CREATE_FRESH_OWN_CONTAINER';
  containerId=docker(['run','--detach','--name',container,'--label',`${label}=${run}`,'--network','none','--memory','3g','--pids-limit','256','--cpus','2',
    '--env','POSTGRES_USER=supabase_admin','--env',`POSTGRES_PASSWORD=synthetic-only-${randomBytes(24).toString('hex')}`,
    image,'postgres','-D','/etc/postgresql','-c','listen_addresses=','-c','shared_preload_libraries=pg_cron',
    ...Object.entries(settings).flatMap(([name,value])=>['-c',`${name}=${value}`])]);
  assert.match(containerId,/^[a-f0-9]{64}$/);created=true;receipt.containerCreated=true;
  const inspect=JSON.parse(docker(['inspect',container]))[0];assert.equal(inspect.Id,containerId);assert.equal(inspect.Config.Labels[label],run);
  assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(inspect.HostConfig.Memory,contract.memoryBytes);
  assert.equal(inspect.HostConfig.PidsLimit,256);assert.equal(inspect.HostConfig.NanoCpus,2000000000);
  assert.equal((inspect.HostConfig.Binds??[]).length,0);assert.equal(Object.keys(inspect.HostConfig.PortBindings??{}).length,0);
  assert.equal(inspect.Mounts.some(m=>m.Type==='bind'),false);receipt.isolationVerified=true;
  receipt.stage='WAIT_FOR_EMPTY_SERVER';let ready=false;
  for(let i=0;i<60;i++){
    const logs=spawnSync('docker',['logs',container],{encoding:'utf8',timeout:10000,maxBuffer:262144});
    if(`${logs.stdout??''}\n${logs.stderr??''}`.includes('PostgreSQL init process complete; ready for start up.')&&
      spawnSync('docker',['exec',container,'pg_isready','-h','/var/run/postgresql','-U','supabase_admin','-d','postgres'],{timeout:5000,stdio:'ignore'}).status===0){ready=true;break;}
    await delay(1000);
  }
  assert.equal(ready,true);
  receipt.stage='VERIFY_ENGINE_AND_PRESTART_ISOLATION';
  assert.match(psql('SHOW server_version;'),/^17\.6(?:\s|$)/);
  assert.equal(psql('SHOW shared_preload_libraries;'),'pg_cron');assert.equal(psql('SHOW listen_addresses;'),'');
  for(const [key,value] of Object.entries(settings))assert.equal(psql(`SHOW ${key};`),value);
  psql("CREATE EXTENSION IF NOT EXISTS pg_cron VERSION '1.6.4';");
  assert.equal(psql("SELECT extversion FROM pg_extension WHERE extname='pg_cron';"),'1.6.4');
  assert.equal(psql('SELECT count(*) FROM cron.job;'),'0');
  const cronLibrary='/nix/store/wr6adinqzlfq6iw3lgr3qgf7nw3ikxij-pg_cron-1.6.4/lib/pg_cron-1.6.4.so';
  receipt.cronLibrarySha256=docker(['exec',container,'sha256sum',cronLibrary]).split(' ')[0];
  assert.equal(receipt.cronLibrarySha256,'55a7bdcf1b966d51d83d248797507348de19d16f1c968948c1854bc799751108');
  receipt.physical=json(`SELECT json_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'postmaster',pg_postmaster_start_time()::text);`);
  receipt.physical.containerId=containerId;receipt.physical.socket='/var/run/postgresql';
  receipt.stage='SEED_FIXED_SYNTHETIC_FIXTURE';
  psql(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    GRANT USAGE ON SCHEMA cron TO ${role}; GRANT SELECT ON cron.job TO ${role};
    GRANT EXECUTE ON FUNCTION cron.schedule(text,text,text),cron.alter_job(bigint,text,text,text,text,boolean) TO ${role};
    CREATE SCHEMA eldion_native_custody AUTHORIZATION ${role};
    CREATE ROLE eldion_native_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE eldion_native_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE SCHEMA eldion_native_dml;
    CREATE TABLE eldion_native_dml.records(marker text PRIMARY KEY);
    CREATE TABLE eldion_native_dml.custody(key text PRIMARY KEY,original_acl text NOT NULL,paused_acl text NOT NULL);
    GRANT USAGE ON SCHEMA eldion_native_dml TO eldion_native_writer,eldion_native_reader;
    GRANT SELECT,INSERT,UPDATE,DELETE ON eldion_native_dml.records TO eldion_native_writer;
    GRANT SELECT ON eldion_native_dml.records TO eldion_native_reader;`);
  // The image's default peer rules do not map OS root to fictional DB roles.
  // Only this new, networkless, bind-free container gets a three-role local rule.
  const hba=psql('SHOW hba_file;');assert.match(hba,/^\/etc\/postgresql\/pg_hba\.conf$/);
  const originalHba=docker(['exec',container,'cat',hba]);
  const localRule=`local postgres ${role},eldion_native_writer,eldion_native_reader trust`;
  docker(['exec','-i',container,'tee',hba],{input:localRule+'\n'+originalHba+'\n'});
  const beforeReload=psql('SELECT pg_conf_load_time()::text;');assert.equal(psql('SELECT pg_reload_conf();'),'t');
  let reloaded=false;for(let i=0;i<50;i++){
    if(psql(`SELECT pg_conf_load_time() > '${beforeReload}'::timestamptz;`)==='t'){reloaded=true;break;}
    await delay(100);
  }
  assert.equal(reloaded,true);assert.equal(psql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;'),'0');
  const rule=json('SELECT row_to_json(t) FROM (SELECT type,database,user_name,auth_method FROM pg_hba_file_rules ORDER BY rule_number LIMIT 1) t;');
  assert.deepEqual(rule,{type:'local',database:['postgres'],user_name:[role,'eldion_native_writer','eldion_native_reader'],auth_method:'trust'});
  receipt.syntheticLocalAuth={explicitRoles:3,unixSocketOnly:true,containerNetwork:'none',productionConfigurationChanged:false};
  psql(`CREATE TABLE eldion_native_custody.states(key text PRIMARY KEY,original jsonb NOT NULL,paused jsonb NOT NULL,state text NOT NULL);
    SELECT cron.schedule('eldion-native-first','* * * * *','SELECT 1');
    SELECT cron.schedule('eldion-native-second','* * * * *','SELECT 1');`,role);
  let original=json(jobSql());ids(original);psql(`SELECT cron.alter_job(${original[1].jobid}::bigint, active := false);`,role);
  original=json(jobSql());assert.deepEqual(original.map(r=>r.active),[true,false]);

  await runCase(cases[0],async()=>{
    const s1=await client(),s2=await client();try{
      const ctx=await s1.begin();assert.deepEqual(await jobs(s1),original);
      await touch(s1,original,[false,false]);const changed=await jobs(s1);ownXmin(changed,ctx.xid);
      assert.deepEqual(changed.map(r=>r.active),[false,false]);assert.ok(changed.every((r,i)=>r.xmin!==original[i].xmin));
      assert.deepEqual(values(changed),values(original).map(r=>({...r,active:false})));
      assert.deepEqual(await jobs(s2),original);await s1.ok('ROLLBACK;');await idle(s1);
      assert.deepEqual(await jobs(s2),original);
      return {nonSuperuserWithoutCallerUpdate:true,bothOwnTupleVersions:true,falseToFalseChangesXmin:true,
        observerSeesOriginalsBeforeRollback:true,rollbackRestoresExactOriginalVersions:true};
    }finally{await s1.close();await s2.close();}
  });
  await runCase(cases[1],async()=>{
    const s1=await client(),s2=await client();try{
      await s1.begin();assert.deepEqual(await jobs(s1),original);await s1.ok(`SELECT cron.alter_job(${original[0].jobid}::bigint, active := false);`);
      const ctx2=await s2.begin();assert.deepEqual(await jobs(s2),original);
      await s2.ok(`SELECT cron.alter_job(${original[1].jobid}::bigint, active := false);`);
      const s2rows=await jobs(s2);ownXmin([s2rows[1]],ctx2.xid);await s2.ok('COMMIT;');
      const conflict=await s1.sql(`SELECT cron.alter_job(${original[1].jobid}::bigint, active := false);`);assert.equal(conflict.state,'40001');
      await s1.ok('ROLLBACK;');await idle(s1);const observed=await jobs(s2);
      assert.deepEqual(observed[0],original[0]);assert.deepEqual(observed[1],s2rows[1]);assert.deepEqual(values(observed),values(original));
      return {actualSqlstate:conflict.state,firstEffectRolledBack:true,concurrentNoopVersionPreserved:true,retries:0};
    }finally{await s1.close();await s2.close();}
  });
  await runCase(cases[2],async()=>{
    const writer=await client('eldion_native_writer'),control=await client('supabase_admin');
    const acl=()=>psql("SELECT relacl::text FROM pg_class WHERE oid='eldion_native_dml.records'::regclass;");
    const reader=()=>psql('SELECT count(*) FROM eldion_native_dml.records;','eldion_native_reader');
    const originalAcl=acl();try{
      await writer.ok("BEGIN; INSERT INTO eldion_native_dml.records VALUES('begun-before-fence');");
      await control.ok(`BEGIN; REVOKE INSERT,UPDATE,DELETE ON eldion_native_dml.records FROM eldion_native_writer;
        INSERT INTO eldion_native_dml.custody SELECT 'table',${"'"+originalAcl.replaceAll("'","''")+"'"},relacl::text FROM pg_class WHERE oid='eldion_native_dml.records'::regclass; COMMIT;`);
      const deny=await client('eldion_native_writer');try{
        const denied=await deny.sql("INSERT INTO eldion_native_dml.records VALUES('must-be-denied');");assert.equal(denied.state,'42501');
      }finally{await deny.close();}
      assert.equal(reader(),'0');await control.ok('BEGIN;');const locking=control.ok('LOCK TABLE eldion_native_dml.records IN SHARE MODE;');
      let waited=false;for(let i=0;i<30;i++){
        if(psql(`SELECT count(*) FROM pg_locks WHERE pid=${control.pid} AND relation='eldion_native_dml.records'::regclass AND mode='ShareLock' AND NOT granted;`)==='1'){waited=true;break;}
        await delay(30);
      }
      assert.equal(waited,true);await writer.ok('COMMIT;');await locking;assert.equal(reader(),'1');
      await terminate(control);const saved=json("SELECT row_to_json(t) FROM eldion_native_dml.custody t WHERE key='table';");assert.equal(acl(),saved.paused_acl);
      // Independent process, explicitly scoped to this table; no ACL-admin race claim.
      const recovery=await client('supabase_admin');try{
        await recovery.ok('BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE;');assert.equal(acl(),saved.paused_acl);
        await recovery.ok('GRANT INSERT,UPDATE,DELETE ON eldion_native_dml.records TO eldion_native_writer; COMMIT;');
        assert.equal(acl(),originalAcl);assert.notEqual(recovery.pid,control.pid);
      }finally{await recovery.close();}
      await writer.ok("INSERT INTO eldion_native_dml.records VALUES('after-resume');");assert.equal(reader(),'2');
      return {newDmlSqlstate:'42501',drainWaitObserved:true,begunWriteCommitted:true,independentReadDuringFence:true,
        committedAclSurvivesControllerLoss:true,independentResumeRestoresExactAcl:true,writeAfterResumeWorks:true,
        concurrentAclAdministratorRaceQualified:false,scope:'One synthetic table and one unprivileged DML writer only.'};
    }finally{await writer.close();await control.close();}
  });
  await runCase(cases[3],async()=>{
    const control=await client();try{
      const paused=await pauseAndCommit(control,'known-commit');await terminate(control);const recovery=await recover('known-commit');
      assert.equal(recovery.status,'RESUMED_ORIGINAL_VALUES');assert.notEqual(recovery.pid,paused.pid);
      assert.deepEqual(values(json(jobSql())),values(paused.original));
      return {originalAndPausedCustodyAtomic:true,controllerBackendLostAfterKnownCommit:true,separateProcessRecovery:true,
        fullPausedVersionSetGuarded:true,originalValuesRestored:true,apiCalls:recovery.apiCalls,originalTupleXminRestored:false,
        hostLossQualified:false};
    }finally{await control.close();}
  });
  await runCase(cases[4],async()=>{
    const control=await client();let paused;try{paused=await pauseAndCommit(control,'drift');}finally{await control.close();}
    const drift=await client();try{await drift.begin();await drift.ok(`SELECT cron.alter_job(${paused.paused[1].jobid}::bigint, active := false); COMMIT;`);}finally{await drift.close();}
    const changed=json(jobSql());assert.notEqual(changed[1].xmin,paused.paused[1].xmin);const recovery=await recover('drift');
    assert.equal(recovery.status,'REFUSED_CHANGED_PAUSED_VERSION');assert.equal(recovery.apiCalls,0);assert.deepEqual(json(jobSql()),changed);
    return {refusal:recovery.status,apiCalls:0,concurrentNoopVersionUntouched:true};
  });
  await runCase(cases[5],async()=>{
    const control=await client();try{
      await control.begin();const before=await jobs(control);await touch(control,before,[false,false]);const paused=await jobs(control);
      await control.ok(`INSERT INTO eldion_native_custody.states VALUES('not-committed',${literal(before)},${literal(paused)},'paused');`);
      await terminate(control);const recovery=await recover('not-committed');assert.equal(recovery.status,'REFUSED_MISSING_COMMITTED_CUSTODY');
      assert.equal(recovery.apiCalls,0);assert.deepEqual(json(jobSql()),before);
      return {refusal:recovery.status,apiCalls:0,uncommittedEffectsRolledBack:true,ambiguousCommitResolutionQualified:false};
    }finally{await control.close();}
  });
  assert.equal(psql("SELECT count(*) FROM pg_stat_activity WHERE backend_type ILIKE '%cron%' OR backend_type ILIKE '%pg_net%';"),'0');
  assert.equal(psql('SELECT count(*) FROM cron.job_run_details;'),'0');
  receipt.scheduledCommandExecutions=0;receipt.passed=receipt.results.length;assert.equal(receipt.passed,cases.length);
  receipt.status='PASS_SCOPED_NATIVE_MAINTENANCE_MECHANICS';
}catch(error){
  failed=true;receipt.status='FAILED_SCOPED_NATIVE_MAINTENANCE';receipt.failureCategory=error.code==='ERR_ASSERTION'?'ASSERTION_FAILED':/^OWN_[A-Z_]+$/.test(error.message)?error.message:'BOUNDED_PROBE_FAILED';
  if(error.code==='ERR_ASSERTION')receipt.assertion={operator:error.operator,actual:JSON.stringify(error.actual)?.slice(0,900),expected:JSON.stringify(error.expected)?.slice(0,900)};
  receipt.sqlDiagnostics=String(error.stderr??error.message??'').split('\n').filter(l=>/ERROR|FATAL|PANIC|42\d{3}|permission|relation|function/i.test(l)&&!/password|secret|token|credential|authorization/i.test(l)).slice(0,4).map(l=>l.slice(0,300));
}finally{
  const stage=receipt.stage;
  for(const c of clients){try{await c.close();}catch{c.process.kill('SIGKILL');}}
  if(created){try{
    const owned=JSON.parse(docker(['inspect',container]))[0];assert.equal(owned.Id,containerId);assert.equal(owned.Config.Labels[label],run);
    docker(['rm','--force','--volumes',container],{timeout:30000});
    assert.equal(docker(['ps','--all','--filter',`label=${label}=${run}`,'--format','{{.ID}}']),'');receipt.containerDestroyed=true;
  }catch{failed=true;receipt.status='FAILED_OWN_CONTAINER_CLEANUP';}}
  receipt.stage=failed?stage:'COMPLETE';receipt.finishedAt=new Date().toISOString();receipt.noLiveEndpointRetained=receipt.containerDestroyed;
  fs.writeFileSync(resultPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:receipt.status,stage:receipt.stage,passed:receipt.results.length,total:cases.length,
    containerDestroyed:receipt.containerDestroyed,wholeServiceQualified:false,fullCopyAccepted:false}));
}
if(failed)process.exitCode=1;
