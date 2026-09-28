// Pure metadata checks and local source checks. No network/database connections.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkRun,checkBackupFresh,checkRestore,checkHealth,checkPhase,repository} from '../scripts/booking-delete-v184-release-preflight.mjs';
import {manifest,verifySources,buildTransaction} from '../scripts/booking-delete-v184-release-sql.mjs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8').replace(/\r\n/g,'\n');
let checked=0;
const rejects=fn=>{assert.throws(fn);checked++;};
const sha='a'.repeat(40),id='1234',path='.github/workflows/minuta-supabase-backup.yml';
const run={id,status:'completed',conclusion:'success',head_sha:sha,path,head_branch:'main',event:'workflow_dispatch',repository:{full_name:repository},head_repository:{full_name:repository}};
checkRun(run,{id,sha,path});
for(const [key,value] of Object.entries({id:'9',status:'in_progress',conclusion:'failure',head_sha:'b'.repeat(40),path:'other.yml',head_branch:'candidate',event:'pull_request',repository:{full_name:'foreign/repo'},head_repository:{full_name:'foreign/repo'}}))
  rejects(()=>checkRun({...run,[key]:value},{id,sha,path}));
const now=Date.parse('2026-09-29T12:00:00Z');
checkBackupFresh({created_at:new Date(now-7200000).toISOString()},now);
for(const created_at of ['invalid',new Date(now+1).toISOString(),new Date(now-7200001).toISOString()])
  rejects(()=>checkBackupFresh({created_at},now));
for(const phase of ['validate-production','observe-production'])checkPhase(phase,'');
checkPhase('apply-production','APPLY_V184_AFTER_BACKUP_RESTORE');
rejects(()=>checkPhase('apply-production',''));
rejects(()=>checkPhase('apply-production','APPLY_V181_AFTER_BACKUP_RESTORE'));
rejects(()=>checkPhase('arbitrary','APPLY_V184_AFTER_BACKUP_RESTORE'));
const cert={status:'success',sourceBackupRunId:'1234',sourceBackupSha:sha,workflowRunId:'5678',candidateVersion:'v184',candidateSha:sha,networkMode:'none',productionWritten:false,testDatabaseWritten:false,ephemeralContainerDestroyed:true,
  candidateMigrationApplied:true,candidateRollbackVerified:true,candidateReapplied:true,candidateHistoryPreserved:true,candidateSecurityPreserved:true,sourceEncryptedArchiveVerified:true,
  candidateSqlSha256:manifest.candidateSha256,rollbackSqlSha256:manifest.rollbackSha256,sourceEncryptedSha256:'b'.repeat(64),deletionInvoked:false,rpcAclReconstructed:true};
const context={sha,backupId:'1234',restoreId:'5678'};
checkRestore(cert,context);
for(const key of Object.keys(cert)) {
  const modified={...cert};delete modified[key];rejects(()=>checkRestore(modified,context));
}
for(const [key,value] of Object.entries({candidateSha:'f'.repeat(40),sourceBackupRunId:'999',networkMode:'bridge',productionWritten:true,deletionInvoked:true,candidateSqlSha256:'e'.repeat(64),sourceEncryptedSha256:'invalid'}))
  rejects(()=>checkRestore({...cert,[key]:value},context));
const state={readOnly:true,authenticatedCanExecute:true,anonDenied:true,serviceDenied:true,securityDefiner:true,ownerCanBypassRls:true,tableRls:true,knownOriginal:true,knownCandidate:false,marker:'',archiveColumns:false,archiveChecks:false,archiveColumnCount:0,archiveCheckCount:0};
checkHealth(state,'validate-production');
checkHealth({...state,archiveColumns:true,archiveChecks:true,archiveColumnCount:2,archiveCheckCount:2},'apply-production');
const installed={...state,knownOriginal:false,knownCandidate:true,marker:manifest.marker,archiveColumns:true,archiveChecks:true,archiveColumnCount:2,archiveCheckCount:2};
checkHealth(installed,'observe-production');
for(const key of ['readOnly','authenticatedCanExecute','anonDenied','serviceDenied','securityDefiner','ownerCanBypassRls','tableRls','knownOriginal'])
  rejects(()=>checkHealth({...state,[key]:false},'apply-production'));
rejects(()=>checkHealth({...state,archiveColumnCount:1,archiveCheckCount:1},'validate-production'));
rejects(()=>checkHealth({...state,archiveColumnCount:2},'validate-production'));
rejects(()=>checkHealth({...installed,archiveColumns:false},'observe-production'));
rejects(()=>checkHealth(state,'observe-production'));
rejects(()=>checkHealth(installed,'apply-production'));
assert.equal(verifySources(),true);
for(const phase of ['apply','rollback']) {
  const sql=buildTransaction(phase);
  assert.equal((sql.match(/^begin;$/gm)||[]).length,1);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
  assert.ok(sql.indexOf('v184_preservation_snapshot()')<sql.indexOf('create or replace function public.provider_delete_booking'));
  assert.ok(sql.indexOf('v184_preservation_check_failed')<sql.indexOf('\ncommit;'));
  assert.doesNotMatch(sql,/select\s+public\.provider_delete_booking\s*\(/i);
}
const release=read('../../.github/workflows/eldion-booking-delete-release.yml');
assert.match(release,/default: validate-production/);
assert.match(release,/group: minuta-production-database/);
assert.match(release,/environment: minuta-production/);
assert.match(release,/default_transaction_read_only=on/);
assert.equal((release.match(/default_transaction_read_only=off/g)||[]).length,1);
assert.match(release,/if: inputs.phase == 'apply-production'/);
assert.match(release,/production-db-schema-guard\.sh "\$session_url"/);
assert.ok(release.indexOf('last-check')<release.indexOf('default_transaction_read_only=off'));
assert.doesNotMatch(release,/provider_delete_booking\(/);
const restore=read('../../.github/workflows/minuta-supabase-restore-drill.yml').split('\n  ephemeral-restore-drill:')[1];
assert.doesNotMatch(restore,/secrets\.(?:SUPABASE_DB_URL|MINUTA_RESTORE_TEST_DB_URL|MINUTA_TEST_DATABASE_URL)/);
assert.match(restore,/test "\$age" -le 7200/);
assert.match(restore,/test "\$CANDIDATE_SHA" = "\$MAIN_SHA"/);
assert.match(restore,/sourceEncryptedArchiveVerified:true/);
const script=read('../scripts/booking-delete-v184-restore.sh');
assert.match(script,/for phase in apply rollback apply/);
assert.match(script,/NetworkMode/);
assert.doesNotMatch(script,/select\s+(?:public\.)?provider_delete_booking\s*\(/i);
assert.match(script,/rpcAclReconstructed:true/);
console.log(`v184 source/phase/evidence/health guards: PASS (${checked} rejection scenarios); no remote access`);
