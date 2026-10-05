import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(readFileSync(resolve(appRoot,'help/images/native-local/native-capture-manifest.json'),'utf8'));
const plan=JSON.parse(readFileSync(resolve(appRoot,'help/tools/native-article-shot-map.json'),'utf8').replace(/^\uFEFF/,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const field of ['domModified','rendererModified','liveVerified','cssModified'])assert.equal(manifest[field],false,field);
assert.equal(manifest.productionRequests,0);
assert.equal(manifest.deniedMutationCount,0,'The capture performed no app write attempts');
let pixelsVerified=0;
for(const capture of manifest.captures){
 assert.match(capture.src,/^images\/native-local\/[a-z0-9-]+\.webp$/);
 const path=resolve(appRoot,'help',capture.src),bytes=readFileSync(path),metadata=await sharp(bytes).metadata();
 assert.equal(sha(bytes),capture.sha256,capture.src+' SHA');
 assert.equal(metadata.width,capture.width,capture.src+' width');
 assert.equal(metadata.height,capture.height,capture.src+' height');
 assert.ok(capture.width>=200&&capture.height>=100,capture.src+' instructional crop size');
 assert.equal(capture.coverageExact,true,capture.src+' coverage');
 const png=resolve(appRoot,'../outputs/native-provider-capture/raw',capture.id+'-'+capture.viewportWidth+'.png');
 if(existsSync(png)){assert.deepEqual(await sharp(png).ensureAlpha().raw().toBuffer(),await sharp(bytes).ensureAlpha().raw().toBuffer(),capture.src+' lossless pixels');pixelsVerified++;}
}
const ids=[...new Set(manifest.captures.map(c=>c.id))];
for(const id of ids){const variants=manifest.captures.filter(c=>c.id===id);assert.deepEqual(variants.map(c=>c.viewportWidth).sort((a,b)=>a-b),[390,760,1440],id+' widths');for(const variant of variants)assert.deepEqual(variant.articleSteps,variants[0].articleSteps,id+' consistent instructional steps');}
const personal=manifest.captures.filter(c=>c.id==='personal-calendar');
assert.equal(personal.length,3,'The primary personal calendar has all three native variants');
for(const capture of personal){
 assert.equal(capture.calendarMode,'personal');
 assert.equal(capture.teamCalendarEnabled,false);
 assert.equal(capture.emptyDay,true);
 assert.notEqual(capture.selectedDate,manifest.fixtureDate);
 assert.deepEqual(capture.articleSteps,{'find-and-filter-bookings':[],'view-team-calendar':[]});
}
for(const capture of manifest.captures.filter(c=>c.id==='team-calendar'))assert.deepEqual(capture.articleSteps,{'view-team-calendar':[3]},'Additional team filters belong to the filter-selection step');
for(const capture of manifest.captures.filter(c=>c.id==='booking-list-filters')){
 assert.equal(capture.calendarMode,'personal');
 assert.equal(capture.teamCalendarEnabled,false,'The basic list and primary timeline use the same personal preference');
}
const expected=[...new Set(plan.screens.flatMap(s=>Object.keys(s.articleSteps)))].sort();
const covered=[...new Set(manifest.captures.flatMap(c=>Object.keys(c.articleSteps)))].sort();
assert.deepEqual(covered,expected,'All provider deferred articles have actual captured states');
for(const [file,hash]of Object.entries(manifest.sources))assert.equal(sha(readFileSync(resolve(appRoot,file))),hash,file+' original source hash');
const result={passed:true,articlesCovered:covered.length,statesCaptured:ids.length,captures:manifest.captures.length,sourceHashesVerified:Object.keys(manifest.sources).length,pixelsVerified,productionRequests:0,appWriteAttempts:0,liveVerified:false};
writeFileSync(resolve(appRoot,'../outputs/native-provider-capture/final-validation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
