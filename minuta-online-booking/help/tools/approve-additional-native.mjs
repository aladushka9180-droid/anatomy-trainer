import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
assert.equal(process.env.NATIVE_ADDITIONAL_REVIEWED,'1','Review all originals before approving');
const plan=JSON.parse(readFileSync(resolve(root,'tools/additional-visual-plan.json')));
const manifest=JSON.parse(readFileSync(resolve(root,'../../outputs/knowledge-all-visuals-20261008/additional-capture-manifest.json')));
assert.deepEqual(manifest.failures,[]);assert.equal(manifest.deniedMutations,0);assert.equal(manifest.productionRequests,0);assert.equal(manifest.transportFailures,0);assert.deepEqual(manifest.unsupportedReads,[]);
assert.equal(manifest.captures.length,plan.screens.length*3);
const approved=JSON.parse(readFileSync(resolve(root,'tools/native-article-visuals.json')));
for(const screen of plan.screens){
 const captures=[1440,760,390].map(width=>{const entry=manifest.captures.find(c=>c.id===screen.id&&c.viewportWidth===width);assert.ok(entry,`${screen.id}: ${width}`);assert.equal(createHash('sha256').update(readFileSync(resolve(root,entry.src))).digest('hex'),entry.sha256);return entry;});
 const variants=captures.map((c,i)=>({src:c.src,width:c.width,height:c.height,minWidth:[901,431,0][i],sha256:c.sha256,...(c.detail?{detail:c.detail}:{})}));
 for(const [slug,step]of Object.entries(screen.articles)){
  const c=captures[0];const entry={src:c.src,kind:'screenshot',alt:screen.caption,caption:c.caption,width:c.width,height:c.height,step,environment:manifest.environment,coverageExact:true,domModified:false,rendererModified:false,liveVerified:false,sha256:c.sha256,variants,provenanceCapture:screen.id,...(c.detail?{detail:c.detail}:{})};
  approved[slug]=[...(approved[slug]||[]).filter(v=>v.provenanceCapture!==screen.id),entry];
 }
}
writeFileSync(resolve(root,'tools/native-article-visuals.json'),JSON.stringify(approved,null,2)+'\n');
writeFileSync(resolve(root,'tools/additional-native-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({articles:new Set(plan.screens.flatMap(s=>Object.keys(s.articles))).size,screens:plan.screens.length,originals:manifest.captures.length}));
