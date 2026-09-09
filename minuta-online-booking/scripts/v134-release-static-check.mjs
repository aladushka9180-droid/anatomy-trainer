#!/usr/bin/env node

import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=(...parts)=>readFileSync(resolve(root,...parts),'utf8');
const workflow=read('.github','workflows','minuta-v134-safe-release.yml');
const migration=read('minuta-online-booking','supabase-migration-v134.sql');
const rollback=read('minuta-online-booking','supabase-migration-v134-rollback.sql');
const integration=read('minuta-online-booking','tests','client-profile-v134-integration.sql');
const testStack=read('minuta-online-booking','tests','client-profile-v134-test-stack.sql');
const provider=read('minuta-online-booking','provider.js');
const errors=[];
const need=(text,token,message)=>{if(!text.includes(token))errors.push(message);};
const forbid=(text,pattern,message)=>{if(pattern.test(text))errors.push(message);};
const job=name=>new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9-]*:|(?![\\s\\S]))`,'m').exec(workflow)?.[0]||'';

need(workflow,'workflow_dispatch:','workflow must be manual');
forbid(workflow,/\n\s+(?:push|schedule|pull_request):/,'workflow must not run automatically');
for(const token of ['test-v134:','validate-production-v134:','apply-production-v134:','observe-production-v134:','APPLY_V134_TO_PRODUCTION','minuta-supabase-backup.yml','default_transaction_read_only=on'])need(workflow,token,`workflow is missing ${token}`);
for(const token of ['supabase-migration-v134.sql','client-profile-v134-integration.sql','supabase-migration-v134-rollback.sql','check_client_profile_v134_reapply'])need(job('test-v134'),token,`test cycle is missing ${token}`);
for(const token of ['BACKUP_RUN_ID','TEST_RUN_ID','VALIDATION_RUN_ID','download-artifact@','sha256sum','environment: minuta-production'])need(job('apply-production-v134'),token,`production apply is missing ${token}`);
for(const block of [job('validate-production-v134'),job('observe-production-v134')])need(block,'default_transaction_read_only=on','production inspection must be read-only');
for(const token of ['save_minuta_client_identity_v134','is_organization_member','client_phone_conflict','organization_imported_clients','organization_imported_booking_history','client_field_values','client_record_entries','client_result_series','client_notes','client_labels','client_avatars'])need(migration,token,`migration is missing ${token}`);
forbid(rollback,/drop\s+table|delete\s+from|truncate/i,'rollback must retain client data');
for(const token of ['client_name_update_failed','client_phone_update_failed','client_phone_conflict_not_rejected','outsider_identity_write_allowed','check_client_profile_v134_rollback','check_client_profile_v134_reapply'])need(integration,token,`integration is missing ${token}`);
for(const table of ['organization_imported_clients','organization_imported_booking_history','organization_client_profiles','client_result_series'])need(testStack,table,`test stack is missing ${table}`);
for(const token of ['openClientIdentityDialog','saveClientIdentity','applyClientIdentityLocally','save_minuta_client_identity_v134'])need(provider,token,`frontend is missing ${token}`);

if(errors.length){console.error('v134 release contract failed:');errors.forEach(error=>console.error(`- ${error}`));process.exit(1);}
console.log('v134 release contract: OK');
