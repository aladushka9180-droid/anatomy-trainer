import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const env=process.env,repo=env.GITHUB_REPOSITORY,sha=env.EXPECTED_SHA,phase=env.PHASE;
const gh=args=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});const api=p=>JSON.parse(gh(['api','repos/'+repo+'/'+p]));
const root=new URL('../../minuta-online-booking/',import.meta.url);const hash=p=>createHash('sha256').update(fs.readFileSync(new URL(p,root))).digest('hex');
function required(name){const id=env[name];assert.match(id||'',/^\d+$/);return id;}
function run(id,workflow){const r=api('actions/runs/'+id);assert.equal(r.conclusion,'success');assert.equal(r.head_sha,sha);assert.equal(r.head_branch,'main');assert.equal(r.head_repository.full_name,repo);assert.equal(r.path,'.github/workflows/'+workflow);return r;}
function certificate(id,artifact,file){const d=fs.mkdtempSync(path.join(os.tmpdir(),'day-evidence-'));try{gh(['run','download',id,'-R',repo,'-n',artifact,'-D',d]);return JSON.parse(fs.readFileSync(path.join(d,file),'utf8'));}finally{fs.rmSync(d,{recursive:true,force:true});}}
try{
 assert.match(sha||'',/^[a-f0-9]{40}$/);assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_SHA,sha);assert.equal(api('git/ref/heads/main').object.sha,sha);assert.ok(['check','apply','observe'].includes(phase));
 run(required('TEST_RUN'),'minuta-inventory-metadata.yml');
 if(phase==='apply'){
  assert.equal(env.CONFIRMATION,'APPLY_V193_AFTER_BACKUP_RESTORE');
  const validation=run(required('VALIDATION_RUN'),'minuta-inventory-metadata-v193-release.yml');assert.equal(validation.display_title,'v193 check '+sha);
  const backup=run(required('BACKUP_RUN'),'minuta-supabase-backup.yml');assert.equal(backup.event,'workflow_dispatch');assert.ok(Date.now()-Date.parse(backup.created_at)>=0&&Date.now()-Date.parse(backup.created_at)<=7200000);
  const backupArtifacts=api('actions/runs/'+env.BACKUP_RUN+'/artifacts').artifacts;assert.ok(backupArtifacts.some(a=>!a.expired&&a.size_in_bytes>0&&a.name.startsWith('minuta-')));
  const restoreId=required('RESTORE_RUN');run(restoreId,'minuta-supabase-restore-drill.yml');const c=certificate(restoreId,'minuta-ephemeral-restore-'+restoreId,'minuta-ephemeral-restore.json');
  assert.equal(c.status,'success');assert.equal(c.sourceBackupRunId,env.BACKUP_RUN);assert.equal(c.sourceBackupSha,sha);assert.equal(c.workflowRunId,restoreId);assert.equal(c.candidateVersion,'v193');assert.equal(c.candidateSha,sha);assert.equal(c.networkMode,'none');
  for(const flag of ['candidateMigrationApplied','candidateRollbackVerified','candidateFreshApplyVerified','candidateHistoryPreserved','ephemeralContainerDestroyed','sourceEncryptedArchiveVerified'])assert.equal(c[flag],true,flag);
  assert.equal(c.productionWritten,false);assert.equal(c.testDatabaseWritten,false);assert.equal(c.candidateSqlSha256,hash('supabase-migration-v193.sql'));assert.equal(c.rollbackSqlSha256,hash('supabase-migration-v193-rollback.sql'));
  assert.ok(Date.parse(validation.created_at)<=Date.parse(backup.created_at));
 }
 console.log('PASS: exact main, qualified test and required release evidence');
}catch{console.error('Inventory metadata release evidence rejected; no production SQL was executed by this guard.');process.exitCode=1;}
