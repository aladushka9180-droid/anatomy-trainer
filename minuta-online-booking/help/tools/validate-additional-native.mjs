import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>JSON.parse(readFileSync(resolve(root,name)));
const plan=read('tools/additional-visual-plan.json'), evidence=read('tools/additional-native-manifest.json'), approved=read('tools/native-article-visuals.json');
const context={window:{}};vm.runInNewContext(readFileSync(resolve(root,'help-data.js'),'utf8'),context);vm.runInNewContext(readFileSync(resolve(root,'help-visuals.js'),'utf8'),context);
const articles=context.window.MINUTA_HELP_ARTICLES;
const targetSlugs=[...new Set(plan.screens.flatMap(s=>Object.keys(s.articles))),...Object.keys(plan.diagrams)];
assert.equal(new Set(targetSlugs).size,31);assert.equal(targetSlugs.length,31,'Screenshots and rules have distinct owners');
assert.deepEqual(evidence.failures,[]);assert.deepEqual(evidence.unsupportedReads,[]);assert.equal(evidence.productionRequests,0);assert.equal(evidence.deniedMutations,0);assert.equal(evidence.transportFailures,0);assert.equal(evidence.domModified,false);assert.equal(evidence.rendererModified,false);assert.equal(evidence.liveVerified,false);
assert.equal(evidence.captures.length,63);assert.equal(evidence.theme,'pink-porcelain');
for(const screen of plan.screens){
 for(const width of [390,760,1440]){
  const c=evidence.captures.find(c=>c.id===screen.id&&c.viewportWidth===width);assert.ok(c,`${screen.id}: ${width}`);assert.deepEqual(c.articleSteps,screen.articles);
  // The original theme preview deliberately clips its decorative petals.
  if(c.horizontalOverflow){assert.equal(c.id,'client-page-theme');assert.equal(c.overflowX,'hidden');}
  assert.equal(createHash('sha256').update(readFileSync(resolve(root,c.src))).digest('hex'),c.sha256);
  if(screen.id.startsWith('inventory-')&&screen.id!=='inventory-history')assert.equal(c.fields.find(f=>f.id==='inventoryMovementKind')?.value,{'inventory-receipt-form':'receipt','inventory-writeoff-form':'write_off','inventory-transfer-form':'transfer','inventory-count-form':'inventory'}[screen.id]);
  if(screen.id==='client-private-result')for(const label of ['До сеанса','Что сделали','После сеанса','Рекомендации'])assert.ok(c.visibleText.includes(label),label);
  if(screen.id==='client-record-files')assert.ok(c.visibleText.includes('Выбрать файл'));
  if(screen.id==='client-phone-lookup')assert.ok(c.fields.find(f=>f.id==='newBookingName')?.value.includes('Клиент примера А'));
 }
 for(const [slug,step]of Object.entries(screen.articles)){
  const a=articles.find(a=>a.slug===slug),visual=a.visuals.find(v=>v.step===step);assert.ok(visual,`${slug}: visual at the instructed action`);assert.equal(visual.kind,'screenshot');
  const source=approved[slug].find(v=>v.provenanceCapture===screen.id);assert.ok(source);assert.equal(source.variants.length,3);assert.deepEqual(source.variants.map(v=>v.minWidth),[901,431,0]);
 }
}
for(const [slug,diagram]of Object.entries(plan.diagrams)){
 const a=articles.find(a=>a.slug===slug),visual=a.visuals.find(v=>v.kind==='diagram');assert.equal(visual.step,diagram.step);assert.match(visual.caption,/не снимок интерфейса/);
 const svg=readFileSync(resolve(root,visual.src),'utf8');assert.ok(svg.includes('#fff7fa')&&svg.includes('#ead5df'));
 if(diagram.parallel)assert.ok(!svg.includes('d="M280 '),'Comparisons must not imply successive actions');
}
assert.equal(articles.filter(a=>a.visuals.length).length,97,'All articles are illustrated');
console.log(JSON.stringify({addedArticles:31,nativeArticles:20,nativeFrames:63,diagrams:11,illustratedArticles:97,productionRequests:0,mutations:0}));
