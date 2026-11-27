import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {readPinned} from '../../minuta-online-booking/scripts/remaining-eight-restore-sql.mjs';
const env=process.env,sha=env.EXPECTED_SHA,repo=env.GITHUB_REPOSITORY;
const gh=args=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const api=p=>JSON.parse(gh(['api','repos/'+repo+'/'+p]));
function run(id,workflow){assert.match(id||'',/^\d+$/);const r=api('actions/runs/'+id);assert.equal(r.conclusion,'success');assert.equal(r.head_sha,sha);assert.equal(r.head_branch,'main');assert.equal(r.head_repository.full_name,repo);assert.equal(r.path,'.github/workflows/'+workflow);return r;}
try{
 assert.match(sha||'',/^[a-f0-9]{40}$/);assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_SHA,sha);assert.equal(api('git/ref/heads/main').object.sha,sha);
 assert.ok(['check','apply','observe'].includes(env.PHASE));
 readPinned(path.resolve('minuta-online-booking'));
 run(env.TEST_RUN,'minuta-online-booking-smoke.yml');
 if(env.PHASE==='apply'){
  assert.equal(env.CONFIRMATION,'APPLY_REMAINING_EIGHT_AFTER_USER_APPROVAL');
  const validation=run(env.VALIDATION_RUN,'minuta-remaining-eight-release.yml');assert.equal(validation.display_title,'remaining-eight check '+sha);
  const backup=run(env.BACKUP_RUN,'minuta-supabase-backup.yml');assert.equal(backup.event,'workflow_dispatch');assert.ok(Date.now()-Date.parse(backup.created_at)>=0&&Date.now()-Date.parse(backup.created_at)<=7200000);
  run(env.RESTORE_RUN,'minuta-supabase-restore-drill.yml');
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'eight-release-evidence-'));
  try{
   gh(['run','download',env.RESTORE_RUN,'-R',repo,'-n','minuta-ephemeral-restore-'+env.RESTORE_RUN,'-D',d]);
   const c=JSON.parse(fs.readFileSync(path.join(d,'minuta-ephemeral-restore.json'),'utf8'));
   assert.equal(c.status,'success');assert.equal(c.sourceBackupRunId,env.BACKUP_RUN);assert.equal(c.sourceBackupSha,sha);assert.equal(c.workflowRunId,env.RESTORE_RUN);assert.equal(c.candidateVersion,'remaining-eight');assert.equal(c.candidateSha,sha);assert.equal(c.networkMode,'none');
   for(const flag of ['candidateMigrationApplied','candidateProductionApplyEnvelopeVerified','candidateRollbackVerified','candidateReapplied','candidateOriginalPublicRowsAndDefinitionsPreserved','candidateMissingMembershipDenied','candidateMissingCapabilityDenied','candidatePositiveLoyaltyAndBranchAndOfferChecks','ephemeralContainerDestroyed','sourceEncryptedArchiveVerified'])assert.equal(c[flag],true,flag);
   assert.equal(c.productionWritten,false);assert.equal(c.candidateFunctionalLiveAccepted,false);
  }finally{fs.rmSync(d,{recursive:true,force:true});}
 }
 console.log('PASS: exact main and approved remaining-eight release evidence');
}catch{console.error('Remaining-eight release evidence rejected; production SQL was not executed by this guard.');process.exitCode=1;}
