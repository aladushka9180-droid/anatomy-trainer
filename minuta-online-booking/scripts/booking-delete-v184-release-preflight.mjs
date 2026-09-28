// Metadata/artifact checks only. Does not connect to a database or dispatch runs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {manifest,verifySources} from './booking-delete-v184-release-sql.mjs';
export const repository='aladushka9180-droid/anatomy-trainer';
const releasePath='.github/workflows/eldion-booking-delete-release.yml';
export function checkRun(run,{id,sha,path,branch='main',event='workflow_dispatch'}) {
  assert.equal(String(run.id),String(id)); assert.equal(run.status,'completed'); assert.equal(run.conclusion,'success');
  assert.equal(run.head_sha,sha); assert.equal(run.path,path); assert.equal(run.head_branch,branch); assert.equal(run.event,event);
  assert.equal(run.repository?.full_name,repository); assert.equal(run.head_repository?.full_name,repository);
}
export function checkBackupFresh(run,now=Date.now()) {
  const age=now-Date.parse(run.created_at); assert.ok(Number.isFinite(age)&&age>=0&&age<=7200000,'backup must be at most two hours old');
}
export function checkRestore(certificate,{sha,backupId,restoreId}) {
  assert.equal(certificate.status,'success'); assert.equal(certificate.sourceBackupRunId,backupId);
  assert.equal(certificate.sourceBackupSha,sha); assert.equal(certificate.workflowRunId,restoreId);
  assert.equal(certificate.candidateVersion,'v184'); assert.equal(certificate.candidateSha,sha);
  assert.equal(certificate.networkMode,'none'); assert.equal(certificate.productionWritten,false);
  assert.equal(certificate.testDatabaseWritten,false); assert.equal(certificate.ephemeralContainerDestroyed,true);
  for(const key of ['candidateMigrationApplied','candidateRollbackVerified','candidateReapplied',
    'candidateHistoryPreserved','candidateSecurityPreserved','sourceEncryptedArchiveVerified'])assert.equal(certificate[key],true,key);
  assert.equal(certificate.candidateSqlSha256,manifest.candidateSha256);
  assert.equal(certificate.rollbackSqlSha256,manifest.rollbackSha256);
  assert.match(certificate.sourceEncryptedSha256,/^[a-f0-9]{64}$/);
  assert.equal(certificate.deletionInvoked,false);
  assert.equal(certificate.rpcAclReconstructed,true);
}
export function checkHealth(state,phase) {
  for(const key of ['readOnly','authenticatedCanExecute','anonDenied','serviceDenied','securityDefiner','ownerCanBypassRls','tableRls'])
    assert.equal(state[key],true,key);
  assert.equal(state.archiveColumnCount,state.archiveCheckCount,'no partially installed archive schema');
  assert.ok([0,2].includes(state.archiveColumnCount));
  if(state.archiveColumnCount===2) {assert.equal(state.archiveColumns,true);assert.equal(state.archiveChecks,true);}
  if(phase==='observe-production') {
    assert.equal(state.knownCandidate,true); assert.equal(state.marker,manifest.marker);
    assert.equal(state.archiveColumns,true); assert.equal(state.archiveChecks,true);
  } else {
    assert.equal(state.knownOriginal,true); assert.equal(state.marker,'');
    assert.equal(state.archiveColumns,state.archiveChecks,'no partially installed archive schema');
  }
}
const gh=(...args)=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const api=path=>JSON.parse(gh('api',`repos/${repository}/${path}`));
const numeric=value=>{assert.match(value||'',/^[0-9]+$/);return value;};
function certificate(runId,name,file) {
  const directory=join(process.env.RUNNER_TEMP,`v184-proof-${runId}-${name}`);
  mkdirSync(directory,{mode:0o700});
  gh('run','download',runId,'--repo',repository,'--name',name,'--dir',directory);
  assert.deepEqual(readdirSync(directory),[file]); assert.equal(lstatSync(join(directory,file)).isSymbolicLink(),false);
  return JSON.parse(readFileSync(join(directory,file),'utf8'));
}
export function checkPhase(phase,confirmation) {
  assert.ok(['validate-production','apply-production','observe-production'].includes(phase));
  if(phase==='apply-production')assert.equal(confirmation,'APPLY_V184_AFTER_BACKUP_RESTORE');
}
async function preflight() {
  verifySources();
  const env=process.env,sha=env.RELEASE_SHA,phase=env.RELEASE_PHASE;
  assert.equal(env.GITHUB_REPOSITORY,repository); assert.equal(env.GITHUB_REF,'refs/heads/main');
  assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch'); assert.match(sha||'',/^[a-f0-9]{40}$/);
  assert.equal(env.GITHUB_SHA,sha); assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sha);
  assert.equal(api('git/ref/heads/main').object.sha,sha); checkPhase(phase,env.RELEASE_CONFIRMATION);
  const testId=numeric(env.TEST_RUN_ID); assert.equal(testId,manifest.testRunId);
  checkRun(api(`actions/runs/${testId}`),{id:testId,sha:manifest.sourceSha,path:manifest.testWorkflow,branch:manifest.testBranch,event:'push'});
  const jobs=api(`actions/runs/${testId}/jobs`).jobs;
  assert.ok(jobs.some(job=>job.conclusion==='success'&&job.steps.some(step=>step.name==='Full-schema rollback rehearsal and concurrent requests'&&step.conclusion==='success')));
  const tree=api(`git/trees/${manifest.sourceSha}?recursive=1`); assert.equal(tree.truncated,false);
  for(const [path,blob] of [['booking-delete-dialog-candidate.sql',manifest.candidateGitBlob],['booking-delete-dialog-rollback.sql',manifest.rollbackGitBlob]])
    assert.equal(tree.tree.find(item=>item.path===`minuta-online-booking/recovery/${path}`)?.sha,blob);
  if(phase==='apply-production') {
    const validationId=numeric(env.VALIDATION_RUN_ID),backupId=numeric(env.BACKUP_RUN_ID),restoreId=numeric(env.RESTORE_RUN_ID);
    const validation=api(`actions/runs/${validationId}`),backup=api(`actions/runs/${backupId}`),restore=api(`actions/runs/${restoreId}`);
    checkRun(validation,{id:validationId,sha,path:releasePath});
    const validated=certificate(validationId,`eldion-v184-validate-${validationId}`,'v184-result.json');
    assert.equal(validated.status,'success'); assert.equal(validated.phase,'validate-production'); assert.equal(validated.commitSha,sha);
    assert.equal(validated.readOnly,true); assert.equal(validated.productionWritten,false); assert.equal(validated.testRunId,testId);
    checkRun(backup,{id:backupId,sha,path:'.github/workflows/minuta-supabase-backup.yml'}); checkBackupFresh(backup);
    const artifacts=api(`actions/runs/${backupId}/artifacts`).artifacts.filter(item=>!item.expired);
    assert.equal(artifacts.length,1); assert.ok(artifacts[0].size_in_bytes>0);
    assert.match(artifacts[0].name,/^minuta-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
    checkRun(restore,{id:restoreId,sha,path:'.github/workflows/minuta-supabase-restore-drill.yml'});
    assert.ok(Date.parse(validation.updated_at)<=Date.parse(backup.created_at));
    assert.ok(Date.parse(backup.updated_at)<=Date.parse(restore.created_at));
    checkRestore(certificate(restoreId,`minuta-ephemeral-restore-${restoreId}`,'minuta-ephemeral-restore.json'),{sha,backupId,restoreId});
    // Check freshness again after artifact retrieval and immediately before SQL.
    checkBackupFresh(backup);
  }
  if(phase==='observe-production') {
    const applyId=numeric(env.APPLY_RUN_ID);
    checkRun(api(`actions/runs/${applyId}`),{id:applyId,sha,path:releasePath});
    const applied=certificate(applyId,`eldion-v184-apply-${applyId}`,'v184-result.json');
    assert.equal(applied.phase,'apply-production'); assert.equal(applied.status,'success'); assert.equal(applied.commitSha,sha);
    assert.equal(applied.productionWritten,true); assert.equal(applied.businessRowsChanged,false);
    assert.equal(applied.securityPreserved,true); assert.equal(applied.historyPreserved,true); assert.equal(applied.deletionInvoked,false);
    assert.equal(applied.candidateSqlSha256,manifest.candidateSha256); assert.equal(applied.rollbackSqlSha256,manifest.rollbackSha256);
  }
  assert.equal(api('git/ref/heads/main').object.sha,sha);
  console.log('v184 exact source, main, phase and required evidence: PASS');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv[2]==='health') {
      const state=JSON.parse(readFileSync(process.argv[3],'utf8'));checkHealth(state,process.env.RELEASE_PHASE);
      console.log('v184 read-only metadata health: PASS');
    } else if(process.argv[2]==='record') {
      const applying=process.env.RELEASE_PHASE==='apply-production';
      const result=applying?JSON.parse(readFileSync(process.argv[3],'utf8')):{status:'success',readOnly:true,productionWritten:false,deletionInvoked:false};
      if(applying) {
        assert.equal(result.status,'success');assert.equal(result.operation,'apply');
        assert.equal(result.businessRowsChanged,false);assert.equal(result.securityPreserved,true);assert.equal(result.historyPreserved,true);
        assert.equal(result.deletionInvoked,false);assert.equal(result.candidateVersion,'v184');
        assert.equal(result.candidateSqlSha256,manifest.candidateSha256);assert.equal(result.rollbackSqlSha256,manifest.rollbackSha256);
      }
      Object.assign(result,{phase:process.env.RELEASE_PHASE,commitSha:process.env.RELEASE_SHA,
        sourceSha:manifest.sourceSha,testRunId:manifest.testRunId,productionWritten:applying,
        backupRunId:process.env.BACKUP_RUN_ID||null,restoreRunId:process.env.RESTORE_RUN_ID||null});
      writeFileSync(process.argv[4],JSON.stringify(result),{mode:0o600});
    } else if(process.argv[2]==='last-check') {
      const env=process.env;
      assert.equal(env.RELEASE_PHASE,'apply-production');checkPhase(env.RELEASE_PHASE,env.RELEASE_CONFIRMATION);
      assert.equal(api('git/ref/heads/main').object.sha,env.RELEASE_SHA);
      const backupId=numeric(env.BACKUP_RUN_ID),backup=api(`actions/runs/${backupId}`);
      checkRun(backup,{id:backupId,sha:env.RELEASE_SHA,path:'.github/workflows/minuta-supabase-backup.yml'});
      checkBackupFresh(backup);
    } else {assert.equal(process.argv[2],undefined);await preflight();}
  } catch {console.error('v184 release proof/phase/health guard failed; no private detail emitted');process.exitCode=1;}
}
