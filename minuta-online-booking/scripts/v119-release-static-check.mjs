#!/usr/bin/env node

import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=(...parts)=>readFileSync(resolve(root,...parts),'utf8');
const workflow=read('.github','workflows','minuta-v119-safe-release.yml');
const migration=read('minuta-online-booking','supabase-migration-v119.sql');
const rollback=read('minuta-online-booking','supabase-migration-v119-rollback.sql');
const integration=read('minuta-online-booking','tests','client-profile-v119-integration.sql');
const errors=[];
const requireText=(text,token,message)=>{if(!text.includes(token)) errors.push(message);};
const forbid=(text,pattern,message)=>{if(pattern.test(text)) errors.push(message);};
const job=name=>new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9-]*:|(?![\\s\\S]))`,'m').exec(workflow)?.[0]||'';

requireText(workflow,'workflow_dispatch:','workflow must be manual');
forbid(workflow,/\n\s+(?:push|schedule|pull_request):/,'workflow must not have automatic triggers');
for(const token of ['test-v119:','validate-production-v119:','apply-production-v119:','observe-production-v119:','APPLY_V119_TO_PRODUCTION','minuta-supabase-backup.yml','default_transaction_read_only=on']) requireText(workflow,token,`workflow is missing ${token}`);
for(const token of ['supabase-migration-v119.sql','client-profile-v119-integration.sql','supabase-migration-v119-rollback.sql','check_client_profile_v119_reapply']) requireText(job('test-v119'),token,`test cycle is missing ${token}`);
for(const token of ['BACKUP_RUN_ID','TEST_RUN_ID','VALIDATION_RUN_ID','download-artifact@','sha256sum','environment: minuta-production']) requireText(job('apply-production-v119'),token,`production apply is missing ${token}`);
for(const block of [job('validate-production-v119'),job('observe-production-v119')]) requireText(block,'default_transaction_read_only=on','validation and observation must be read-only');
for(const token of ['organization_client_profiles','get_minuta_client_profile_v119','save_minuta_client_birthday_v119','set_minuta_client_online_booking_block_v119','zy_bookings_client_online_block_v119','client_online_booking_blocked','enable row level security']) requireText(migration,token,`migration is missing ${token}`);
forbid(rollback,/drop\s+table/i,'rollback must retain client profile data');
for(const token of ['v119_rollback_blocked_active_client_blocks','get_minuta_client_profile_v119','zy_bookings_client_online_block_v119']) requireText(rollback,token,`rollback is missing ${token}`);
for(const token of ['specialist_block_allowed','outsider_read_allowed','check_client_profile_v119_rollback','check_client_profile_v119_reapply']) requireText(integration,token,`integration is missing ${token}`);

if(errors.length){console.error('v119 release contract failed:');errors.forEach(error=>console.error(`- ${error}`));process.exit(1);}
console.log('v119 release contract: OK');
