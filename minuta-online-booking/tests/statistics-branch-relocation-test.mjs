// Preservation proof: actual classic-script core -> optional extension load order.
// Baseline hashes freeze the 19 admitted S10 function bodies before relocation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const baseline=JSON.parse(readFileSync(new URL('./statistics-branch-relocation-baseline.json',import.meta.url),'utf8'));
const core=read('provider.js');
const context={console,document:{querySelector:()=>null},reportPeriod:'month',reportDataSource:'own',reportCanViewTeam:false,sessionGeneration:1,currentUser:{id:'actor'},allBookings:[{id:'cold-offline'}],importedBookingHistory:[{id:'legacy'}],reportOrganizationId:()=> 'org',reportOrganization:()=>({id:'org',current_role:'owner'}),reportScopedBookingsState:{status:'idle',rows:[]},reportTeamAnalyticsState:{status:'idle',rows:[]},reportPerformerFilter:'all',queueMicrotask:()=>{},MinutaStatisticsAuditUI:{create:()=>({mount(){},refresh(){}})}};
context.window=context;vm.createContext(context);
// Use unchanged core declarations; full optional script is evaluated below.
for(const name of Object.keys(baseline)){const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(core);if(!match)continue;const end=core.indexOf('\n}',match.index)+2;assert.ok(end>match.index);vm.runInContext(core.slice(match.index,end),context)}
assert.equal(context.reportSessionKey('org','date'),'1:actor:org:date');
assert.equal(context.reportUsesScopedBookings(),false);
assert.equal(context.MinutaStatisticsBranchRuntime,undefined);
vm.runInContext(read('statistics-branch-scope.js'),context);
vm.runInContext(read('statistics-branch-provider.js'),context);
assert.throws(()=>context.MinutaStatisticsBranchProvider.activate(),/backend_not_accepted/);
assert.throws(()=>context.MinutaStatisticsBranchProvider.activate({backendAccepted:true}),/extension_not_loaded/);
assert.equal(context.MinutaStatisticsBranchRuntime,undefined);
const oldKey=context.reportSessionKey;
vm.runInContext(read('statistics-audit-provider.js'),context);
assert.equal(context.MinutaStatisticsAuditProvider.branchSourceReady,true);
assert.notEqual(context.reportSessionKey,oldKey);
for(const [name,expected]of Object.entries(baseline)){assert.equal(crypto.createHash('sha256').update(context[name].toString().trim()).digest('hex'),expected,'changed body '+name)}
assert.equal(context.reportSessionKey('org','date'),'1:actor:org:date');
assert.equal(context.reportHistoryBookings(),context.allBookings);
assert.equal(context.reportBranchImportedHistory(),context.importedBookingHistory);
assert.equal(context.MinutaStatisticsBranchRuntime,undefined);
const actor={userId:'actor',organizationId:'org',role:'owner',sessionGeneration:1,source:'own'};
const scope=context.MinutaStatisticsBranchScope.create({backendAccepted:true,getIdentity:()=>actor,rpc(){throw Error('RPC is forbidden in relocation proof')}});
context.MinutaStatisticsBranchRuntime=scope;
scope.setLocation('a');const a=context.reportSessionKey('org','date');
assert.equal(context.reportUsesScopedBookings(),true);
assert.equal(context.reportHistoryBookings().length,0);assert.equal(context.reportBranchImportedHistory().length,0);
scope.setLocation('b');assert.notEqual(context.reportSessionKey('org','date'),a);
scope.setLocation('a');assert.notEqual(context.reportSessionKey('org','date'),a);
const prior=context.reportSessionKey('org','date');actor.sessionGeneration++;assert.notEqual(context.reportSessionKey('org','date'),prior);
const roleKey=context.reportSessionKey('org','date');actor.role='specialist';assert.notEqual(context.reportSessionKey('org','date'),roleKey);
console.log(JSON.stringify({suite:'s10-classic-load-relocation',preservedFunctionBodies:Object.keys(baseline).length,coldOfflineAll:true,gate:true,abaSessionRole:true,realRpc:false}));
