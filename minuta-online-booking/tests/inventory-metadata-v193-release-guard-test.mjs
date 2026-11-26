import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url), sha='a'.repeat(40), repo='owner/repo';
const source=fs.readFileSync(new URL('../../.github/scripts/inventory-metadata-v193-release-guard.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'');
const certificate={status:'success',sourceBackupRunId:'3',sourceBackupSha:sha,workflowRunId:'4',candidateVersion:'v193',candidateSha:sha,networkMode:'none',productionWritten:false,testDatabaseWritten:false};
for(const key of ['candidateMigrationApplied','candidateRollbackVerified','candidateFreshApplyVerified','candidateHistoryPreserved','ephemeralContainerDestroyed','sourceEncryptedArchiveVerified'])certificate[key]=true;
for(const [key,file] of [['candidateSqlSha256','supabase-migration-v193.sql'],['rollbackSqlSha256','supabase-migration-v193-rollback.sql']])certificate[key]=createHash('sha256').update(fs.readFileSync(new URL(file,root))).digest('hex');
function verify(change=()=>{}) {
 const c=structuredClone(certificate),env={GITHUB_REPOSITORY:repo,EXPECTED_SHA:sha,PHASE:'apply',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,TEST_RUN:'1',VALIDATION_RUN:'2',BACKUP_RUN:'3',RESTORE_RUN:'4',CONFIRMATION:'APPLY_V193_AFTER_BACKUP_RESTORE'};
 const runs={};
 for(const [id,workflow] of [['1','minuta-inventory-metadata.yml'],['2','minuta-inventory-metadata-v193-release.yml'],['3','minuta-supabase-backup.yml'],['4','minuta-supabase-restore-drill.yml']])runs[id]={conclusion:'success',head_sha:sha,head_branch:'main',head_repository:{full_name:repo},path:'.github/workflows/'+workflow,event:'workflow_dispatch',created_at:new Date(Date.now()-60000).toISOString(),display_title:'v193 check '+sha};
 const state={c,env,runs,remoteSha:sha};change(state);
 const processMock={env,exitCode:0};
 const execFileSync=(_,args)=>{
  if(args[0]==='run') {fs.writeFileSync(path.join(args.at(-1),'minuta-ephemeral-restore.json'),JSON.stringify(c));return '';}
  const p=args[1];
  if(p.endsWith('/git/ref/heads/main'))return JSON.stringify({object:{sha:state.remoteSha}});
  if(p.endsWith('/artifacts'))return JSON.stringify({artifacts:[{expired:false,size_in_bytes:50,name:'minuta-encrypted'}]});
  return JSON.stringify(runs[p.split('/').at(-1)]);
 };
 vm.runInNewContext(source.replace('import.meta.url','guardUrl'),{assert,fs,os,path,createHash,execFileSync,process:processMock,URL,Date,guardUrl:new URL('../../.github/scripts/inventory-metadata-v193-release-guard.mjs',import.meta.url),console:{log(){},error(){}}});
 return processMock.exitCode===0;
}
assert.equal(verify(),true);
for(const change of [s=>s.remoteSha='b'.repeat(40),s=>s.env.CONFIRMATION='',s=>s.runs['1'].conclusion='failure',s=>s.runs['3'].created_at=new Date(Date.now()-7200001).toISOString(),s=>s.c.candidateSqlSha256='wrong',s=>s.c.candidateRollbackVerified=false,s=>s.c.sourceBackupRunId='999',s=>s.c.productionWritten=true,s=>s.c.candidateSha='b'.repeat(40)])assert.equal(verify(change),false);
console.log('PASS: v193 release guard accepts exact evidence; rejects stale main, missing consent, failed test, old backup, wrong SQL, failed rollback and mismatched restore.');
