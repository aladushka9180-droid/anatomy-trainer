// Proposed common-file patch: exercised in fixtures until its owner applies it.
// Each anchor must be unique; a changed controller is reviewed, never guessed.
export function connectCatalog(source) {
  if (source.includes('async function syncCatalog(')) return source;
  const replace=(from,to)=>{if(source.split(from).length!==2)throw Error('Catalog integration anchor changed: '+from.slice(0,70));source=source.replace(from,to);};
  replace("  'use strict';", "  'use strict';\n  const saleSource=document.currentScript.src;");
  replace('    const activeWrites = new Set();',`    const activeWrites = new Set();
let catalog,legacyGoods=false;
async function syncCatalog(action){legacyGoods=false;try{if(!catalog){const url=new URL('commerce-catalog-adapter.js',saleSource);url.search=new URL(saleSource).search;catalog=import(url.href).then(m=>m.createCatalogAdapter({...options,getContext:()=>({organization,state}),reload:load,onLegacyMode:value=>legacyGoods=value})).catch(e=>{catalog=null;throw e;});}await(await catalog).sync(action);}catch(e){notify(errorMessage(e));}}
function resetCatalog(){legacyGoods=false;catalog?.then(m=>m.destroy());}`);
  replace('        state = result.data;\n        render();','        state = result.data;\n        render();\n        await syncCatalog();');
  replace('      if (!updateSaleValidity()) return;','      if ($(\'#commerceItemKind\').value===\'inventory_item\'&&!legacyGoods) return;\n      if (!updateSaleValidity()) return;');
  replace('        render();\n        if (claimTarget)', '        render();\n        await syncCatalog();\n        if (claimTarget)');
  replace('        if (window.MinutaCommerceSoftUI) window.MinutaCommerceSoftUI.focusItem();', "        void syncCatalog({clientId:clientId||null,bookingId:bookingId||null,sellerId:$('#commerceSeller').value});\n        if (window.MinutaCommerceSoftUI) window.MinutaCommerceSoftUI.focusItem();");
  replace('        organization = next || null;', '        resetCatalog();\n        organization = next || null;');
  replace('      reset() {\n        clearSaleClaimResult();','      reset() {\n        resetCatalog();\n        clearSaleClaimResult();');
  // Only the integration's render/load/submit/lifecycle blocks lose indentation. This offsets the
  // lazy hook inside the existing startup budget; no unrelated file is packed.
  for(const [start,end] of [['    function render() {','    async function load() {'],['    async function load() {','    async function write('],['    async function submitSale(event) {','    function selectRefundSale('],['      startSale({','\n  function createFinanceController(']]){
    const from=source.indexOf(start),to=source.indexOf(end,from);if(from<0||to<0)throw Error('Catalog flow boundary changed');
    source=source.slice(0,from)+source.slice(from,to).replace(/^[ \t]+/gm,'')+source.slice(to);
  }
  return source;
}

if(process.argv.includes('--emit-patch')){
  const {readFileSync,writeFileSync,mkdirSync}=await import('node:fs');
  const {fileURLToPath}=await import('node:url');const {resolve}=await import('node:path');const {spawnSync}=await import('node:child_process');
  const root=fileURLToPath(new URL('..',import.meta.url)),out=resolve(root,'../../..','outputs','sales-catalog-controller-review');mkdirSync(out,{recursive:true});
  const source=readFileSync(resolve(root,'commerce-management.js'),'utf8').replaceAll('\r\n','\n'),next=connectCatalog(source);
  if(source===next)throw Error('Hook already applied; do not overwrite review patch');
  const before=resolve(out,'before.js'),after=resolve(out,'after.js');writeFileSync(before,source);writeFileSync(after,next);
  const result=spawnSync('git',['diff','--no-index','--src-prefix=a/','--dst-prefix=b/',before,after],{encoding:'utf8'});
  if(result.status!==1)throw Error('Cannot generate integration diff');
  const target='minuta-online-booking/commerce-management.js';
  const patch=result.stdout.replace(/^diff --git .*$/m,`diff --git a/${target} b/${target}`).replace(/^--- .*$/m,`--- a/${target}`).replace(/^\+\+\+ .*$/m,`+++ b/${target}`);
  writeFileSync(resolve(root,'docs','commerce-catalog-controller.patch'),patch);
  console.log('Prepared owner patch; core byte delta: '+(Buffer.byteLength(next)-Buffer.byteLength(source)));
}
