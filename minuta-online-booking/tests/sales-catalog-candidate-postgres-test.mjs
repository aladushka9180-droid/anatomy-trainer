// Explicitly authorized, new synthetic PostgreSQL17 cluster only. No env URL.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {baseline,seed,read,ids,request,rpc,scalar,saveMetadata,importRows,lines,cartArgs} from './sales-catalog-candidate-harness.mjs';
const pgModule=process.env.MINUTA_PG_MODULE;
const pg=await import(pgModule ? pathToFileURL(pgModule).href : 'pg');
const Client=pg.Client||pg.default?.Client;
const config={host:'127.0.0.1',port:54851,database:'eldion_sales_catalog_fixture',user:'postgres',application_name:'sales-catalog-synthetic-candidate'};
const db=new Client(config);
const proof={engine:'PostgreSQL17',synthetic:true,productionWritten:false,checks:[]};
const check=(name)=>{proof.checks.push(name);console.log(`PASS ${name}`);};
const expectError=async(fn,message,code) => assert.rejects(fn,e=>e.message===message && (!code||e.code===code));
const counts=async()=>scalar(db,`select jsonb_build_object('sales',(select count(*) from commercial_sales),
 'carts',(select count(*) from sales_carts_candidate),'lines',(select count(*) from sales_cart_lines_candidate),
 'movements',(select count(*) from inventory_movements),'transactions',(select count(*) from financial_transactions),
 'postings',(select count(*) from financial_postings),'stock',(select jsonb_agg(to_jsonb(b) order by inventory_item_id) from inventory_stock_balances b))`);
const refundSignature='public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)';
await db.connect();
try {
  const guarded=(await db.query(`select current_database() db,host(inet_server_addr()) addr,inet_server_port() port,
    current_setting('server_version_num')::integer version,(select count(*) from pg_tables where schemaname not in('pg_catalog','information_schema')) tables`)).rows[0];
  assert.equal(db.connection.stream.remoteAddress,'127.0.0.1');
  assert.equal(db.connection.stream.remotePort,54851);
  if (process.argv.includes('--ci-owned-postgres-service')) {
    assert.equal(process.env.GITHUB_ACTIONS,'true');
    assert.equal(process.env.MINUTA_SALES_CATALOG_CI_CONFIRM,'OWN_EMPTY_POSTGRES17_SERVICE');
    const serviceIp=process.env.MINUTA_CATALOG_CI_SERVICE_IP;
    assert.match(serviceIp,/^172\.(?:1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}$/);
    assert.deepEqual([guarded.db,guarded.addr,guarded.port],['eldion_sales_catalog_fixture',serviceIp,5432]);
  } else assert.deepEqual([guarded.db,guarded.addr,guarded.port],['eldion_sales_catalog_fixture','127.0.0.1',54851]);
  assert.ok(guarded.version>=170000 && guarded.version<180000);
  if (process.argv.includes('--reset-owned-synthetic-fixture')) {
    assert.equal(await scalar(db,`select marker from public.sales_catalog_synthetic_fixture_marker`),'sales-catalog-candidate-empty-synthetic');
    // Dedicated new fixture DB + own marker verified above. Never reset a supplied URL.
    await db.query('drop schema public cascade;drop schema auth cascade;drop schema extensions cascade;create schema public;');
    guarded.tables=0;
  }
  assert.equal(Number(guarded.tables),0,'refuse any nonempty database before bootstrap');
  await baseline(db);
  const beforeRefund=await scalar(db,`select jsonb_build_object('definition',pg_get_functiondef('${refundSignature}'::regprocedure),
    'acl',proacl::text,'marker',obj_description(oid,'pg_proc')) from pg_proc where oid='${refundSignature}'::regprocedure`);
  const beforeSale=await scalar(db,`select prosrc from pg_proc where proname='sell_minuta_commercial_product_v151'`);
  await db.query(read('../sales-catalog-candidate.sql'));
  await db.query(read('../sales-catalog-candidate.sql'));
  check('forward reapply no drift');
  await db.query('grant execute on function public.require_minuta_sales_candidate(uuid,boolean) to authenticated');
  await expectError(()=>db.query(read('../sales-catalog-candidate.sql')),'sales_catalog_candidate_function_drift','55000');
  await db.query('rollback');
  await db.query('revoke execute on function public.require_minuta_sales_candidate(uuid,boolean) from authenticated');
  await db.query(read('../sales-catalog-schema-rollback.sql'));
  assert.deepEqual(await scalar(db,`select jsonb_build_object('definition',pg_get_functiondef('${refundSignature}'::regprocedure),
    'acl',proacl::text,'marker',obj_description(oid,'pg_proc')) from pg_proc where oid='${refundSignature}'::regprocedure`),beforeRefund);
  assert.equal(await scalar(db,`select prosrc from pg_proc where proname='sell_minuta_commercial_product_v151'`),beforeSale);
  check('empty schema rollback restores exact legacy refund and ACL');
  await db.query(read('../sales-catalog-candidate.sql'));
  await seed(db);
  const candidateAcl=(await db.query(`select p.proname,has_function_privilege('anon',p.oid,'execute') anon,
    has_function_privilege('service_role',p.oid,'execute') service,has_function_privilege('authenticated',p.oid,'execute') auth,
    p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and obj_description(p.oid,'pg_proc') like 'sales-catalog-candidate:md5=%'`)).rows;
  assert.equal(candidateAcl.length,15);
  for(const p of candidateAcl) {assert.equal(p.anon,false);assert.equal(p.service,false);assert.equal(p.prosecdef,true);assert.deepEqual(p.proconfig,['search_path=""']);}
  assert.equal(candidateAcl.filter(p=>p.auth).length,10);
  assert.equal(Number(await scalar(db,`select count(*) from pg_class where relname in('sales_catalog_items_candidate','sales_cart_lines_candidate')
    and relrowsecurity and relforcerowsecurity and not has_table_privilege('authenticated',oid,'select')`)),2);
  check('RPC ACL, private helpers, forced RLS and direct-table isolation');
  const rawCounts=await counts();
  const preview=await rpc(db,ids.owner,'preview_minuta_sales_import_candidate',[ids.org,JSON.stringify(importRows())]);
  assert.deepEqual(await counts(),rawCounts);
  assert.deepEqual(preview.errors,[]);
  await expectError(()=>rpc(db,ids.owner,'commit_minuta_sales_import_candidate',[ids.org,JSON.stringify(importRows()),preview.preview_hash,false,request(10)]),'catalog_import_confirmation_required','22023');
  await expectError(()=>rpc(db,ids.admin,'commit_minuta_sales_import_candidate',[ids.org,JSON.stringify(importRows()),preview.preview_hash,true,request(10)]),'catalog_import_owner_required','42501');
  await expectError(()=>rpc(db,ids.owner,'commit_minuta_sales_import_candidate',[ids.org,JSON.stringify(importRows()),'changed',true,request(10)]),'catalog_preview_changed','40001');
  const saved=await saveMetadata(db);
  const replay=await rpc(db,ids.owner,'commit_minuta_sales_import_candidate',[ids.org,JSON.stringify(importRows()),saved.preview.preview_hash,true,request(10)]);
  assert.equal(replay.replayed,true);assert.deepEqual(replay.items,saved.result.items);
  await expectError(()=>rpc(db,ids.owner,'commit_minuta_sales_import_candidate',[ids.org,JSON.stringify(importRows().slice(0,1)),saved.preview.preview_hash,true,request(10)]),'catalog_request_conflict','23505');
  assert.deepEqual(await counts(),rawCounts,'catalog import does not mutate balances/finance');
  check('preview no writes, explicit owner commit, full intent replay/conflict');
  const bad=importRows(1);bad[1].sale_price_minor=0;
  const invalid=await rpc(db,ids.owner,'preview_minuta_sales_import_candidate',[ids.org,JSON.stringify(bad)]);
  assert.equal(invalid.errors[0].index,2);
  await expectError(()=>rpc(db,ids.owner,'commit_minuta_sales_import_candidate',[ids.org,JSON.stringify(bad),invalid.preview_hash,true,request(11)]),'catalog_import_invalid','22023');
  assert.equal(Number(await scalar(db,`select max(metadata_version) from sales_catalog_items_candidate`)),1);
  const receiptImport=importRows(1);receiptImport[0].stock_quantity=5;
  const forbidden=await rpc(db,ids.owner,'preview_minuta_sales_import_candidate',[ids.org,JSON.stringify(receiptImport)]);
  assert.equal(forbidden.errors[0].message,'catalog_import_metadata_only');
  const massConversion=importRows(1);massConversion[0].sale_unit='kg';
  assert.equal((await rpc(db,ids.owner,'preview_minuta_sales_import_candidate',[ids.org,JSON.stringify(massConversion)])).errors[0].message,'catalog_unit_conversion_invalid');
  const tinyFactor=importRows(1);tinyFactor[0].stock_per_sale_unit=0.0001;
  assert.equal((await rpc(db,ids.owner,'preview_minuta_sales_import_candidate',[ids.org,JSON.stringify(tinyFactor)])).errors[0].message,'invalid_catalog_item');
  const baseEdit=importRows(1);baseEdit[0].unit='g';
  assert.equal((await rpc(db,ids.owner,'preview_minuta_sales_import_candidate',[ids.org,JSON.stringify(baseEdit)])).errors[0].message,'catalog_base_unit_locked');
  check('invalid row rolls back entire import, stock import refused');
  const singleItem={name:'Admin catalog item',sku:'SYNTHETIC-ADMIN',unit:'piece',sale_unit:'piece',stock_per_sale_unit:1,
    purpose:'consumable',sale_price_minor:null,photo_url:'https://example.invalid/photo.png'};
  const adminSave=await rpc(db,ids.admin,'save_minuta_sales_item_candidate',[ids.org,JSON.stringify(singleItem),request(12)]);
  const adminReplay=await rpc(db,ids.admin,'save_minuta_sales_item_candidate',[ids.org,JSON.stringify(singleItem),request(12)]);
  assert.equal(adminReplay.replayed,true);assert.deepEqual(adminReplay.items,adminSave.items);
  const adminItem=(await rpc(db,ids.admin,'get_minuta_sales_catalog_candidate',[ids.org])).items.find(x=>x.id===adminSave.items[0].inventory_item_id);
  assert.equal(adminItem.sale_price_minor,null,'unknown price stays unknown');
  assert.equal(Number(await scalar(db,`select count(*) from inventory_stock_balances where inventory_item_id=$1`,[adminItem.id])),0,'save creates no invented balance');
  const credentials={...singleItem,photo_url:'https://username:password@example.invalid/p.png'};
  assert.equal((await rpc(db,ids.owner,'preview_minuta_sales_import_candidate',[ids.org,JSON.stringify([credentials])])).errors[0].message,'invalid_catalog_item');
  check('admin single-item save/replay allowed, unknown price/stock retained, photo userinfo rejected');
  for(const actor of [ids.specialist,ids.outsider]) await expectError(()=>rpc(db,actor,'get_minuta_sales_catalog_candidate',[ids.org]),'financial_manager_role_required','42501');
  await expectError(()=>rpc(db,'','get_minuta_sales_catalog_candidate',[ids.org]),'financial_manager_role_required','42501');
  await db.query('update organizations set status=$1 where id=$2',['suspended',ids.org]);
  await expectError(()=>rpc(db,ids.owner,'get_minuta_sales_catalog_candidate',[ids.org]),'financial_manager_role_required','42501');
  await db.query('update organizations set status=$1 where id=$2',['active',ids.org]);
  await db.query('update organization_memberships set active=false where user_id=$1',[ids.owner]);
  await expectError(()=>rpc(db,ids.owner,'get_minuta_sales_catalog_candidate',[ids.org]),'financial_manager_role_required','42501');
  await db.query('update organization_memberships set active=true where user_id=$1',[ids.owner]);
  await expectError(()=>rpc(db,ids.owner,'get_minuta_sales_catalog_candidate',[ids.otherOrg]),'financial_manager_role_required','42501');
  await expectError(()=>rpc(db,ids.owner,'get_minuta_sales_repeat_candidate',[ids.org,ids.otherClient]),'commercial_client_mismatch','42501');
  for(const [at,value,message] of [[3,ids.outsider,'commercial_seller_not_active_member'],[2,ids.otherClient,'commercial_client_mismatch'],[6,ids.otherCash,'cash_or_bank_account_required']]) {
    const args=cartArgs(lines(),30+at);args[at]=value;await expectError(()=>rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',args),message);
  }
  const foreign=lines();foreign[0].warehouse_id=ids.otherWarehouse;
  await expectError(()=>rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(foreign,39)),'catalog_warehouse_scope_mismatch','42501');
  check('role, organization, selected client, seller, account, warehouse boundaries');
  const beforeFailure=await counts();
  const badPrice=lines();badPrice[1].unit_price_minor=1199;
  let caught;
  try {await rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(badPrice,40));} catch(e){caught=e;}
  assert.equal(caught.message,'catalog_price_changed');assert.equal(JSON.parse(caught.detail).line_id,'variant');
  assert.deepEqual(await counts(),beforeFailure);
  // Fail inside the second real stock/cost write, after the first line and ledger
  // have been inserted. Proves transaction rollback beyond pre-validation.
  await db.query('update inventory_cost_layers set remaining_quantity=0 where inventory_item_id=$1',[ids.item2]);
  let midWrite;
  try {await rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(lines(),46));} catch(e){midWrite=e;}
  assert.equal(midWrite.message,'inventory_cost_ledger_out_of_sync');assert.equal(JSON.parse(midWrite.detail).line_id,'variant');
  assert.deepEqual(await counts(),beforeFailure);
  await db.query('update inventory_cost_layers set remaining_quantity=original_quantity where inventory_item_id=$1',[ids.item2]);
  const tooMany=lines(11);
  await expectError(()=>rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(tooMany,41)),'insufficient_inventory_stock','55000');
  assert.deepEqual(await counts(),beforeFailure);
  const duplicate=lines(6);duplicate.push({...duplicate[0],line_id:'cream-again'});
  await expectError(()=>rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(duplicate,42)),'insufficient_inventory_stock','55000');
  assert.deepEqual(await counts(),beforeFailure);
  const corrupt=lines();corrupt[0].metadata_version=2;
  await expectError(()=>rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(corrupt,43)),'catalog_metadata_changed','40001');
  const badId=lines();badId[1].inventory_item_id='not-a-uuid';
  try {await rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(badId,44));assert.fail('bad UUID succeeded');}
  catch(e) {assert.equal(e.code,'22P02');assert.equal(JSON.parse(e.detail).line_id,'variant');}
  const badQuantity=lines();badQuantity[0].quantity='NaN';
  await expectError(()=>rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(badQuantity,45)),'invalid_inventory_quantity','22023');
  assert.deepEqual(await counts(),beforeFailure);
  check('bad price/version and aggregate insufficient stock all-or-nothing with row errors');
  const cart=await rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs());
  assert.equal(cart.total_minor,92300);assert.equal(cart.lines.length,2);
  assert.equal(cart.organization_id,ids.org);
  assert.equal(cart.booking_id,null);
  assert.equal(cart.seller_id,ids.specialist);
  assert.equal(cart.payment_method,'cash');
  assert.equal(cart.payment_account_id,ids.cash);
  assert.match(cart.request_fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(cart.lines[0].stock_quantity,500);assert.equal(cart.lines[0].sale_quantity,1);
  assert.equal(Number(await scalar(db,`select quantity from inventory_stock_balances where inventory_item_id=$1`,[ids.item])),4500);
  assert.equal(Number(await scalar(db,`select sum(total_minor) from commercial_sales where id in(select sale_id from sales_cart_lines_candidate where cart_id=$1)`,[cart.id])),cart.total_minor);
  assert.equal(Number(await scalar(db,`select sum(case side when 'debit' then amount_minor else -amount_minor end) from financial_postings`)),0);
  assert.equal(Number(await scalar(db,`select count(*) from inventory_cost_allocations where movement_id in(select inventory_movement_id from commercial_sale_lines)`)),2);
  const afterCart=await counts();
  const cartReplay=await rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs());
  assert.equal(cartReplay.replayed,true);assert.equal(cartReplay.id,cart.id);assert.deepEqual(await counts(),afterCart);
  const receipt=await rpc(db,ids.owner,'get_minuta_sales_cart_candidate',[ids.org,request(20),ids.client]);
  assert.deepEqual(receipt.lines,cart.lines);
  assert.equal(receipt.request_fingerprint,cart.request_fingerprint);
  assert.equal(receipt.payment_account_id,ids.cash);
  const changed=lines();changed[0].quantity=2;
  await expectError(()=>rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(changed)),'catalog_request_conflict','23505');
  assert.equal((await rpc(db,ids.owner,'get_minuta_sales_cart_candidate',[ids.org,request(20),ids.otherClient])).found,false);
  const history=await rpc(db,ids.owner,'get_minuta_sales_history_candidate',[ids.org,ids.client,50]);
  assert.equal(history.purchases.length,1);assert.equal(history.purchases[0].total_minor,92300);
  await expectError(()=>db.query('update sales_cart_lines_candidate set stock_per_sale_unit=1'),'sales_catalog_snapshot_immutable','55000');
  check('89900/500 exact money and stock, balanced ledger/cost, response-loss retry');
  const repeat=await rpc(db,ids.owner,'get_minuta_sales_repeat_candidate',[ids.org,ids.client]);
  assert.equal(repeat.id,cart.id);assert.equal(repeat.lines.length,2);assert.equal(repeat.requires_current_validation,true);
  const edited=importRows(1);edited[0].stock_per_sale_unit=250;edited[0].sale_price_minor=99000;
  await saveMetadata(db,edited,50);
  const freshRepeat=await rpc(db,ids.owner,'get_minuta_sales_repeat_candidate',[ids.org,ids.client]);
  assert.equal(freshRepeat.lines[0].stock_per_sale_unit,500);
  assert.equal(freshRepeat.current_items.find(x=>x.id===ids.item).sale_price_minor,99000);
  const beforeRefundStock=Number(await scalar(db,`select quantity from inventory_stock_balances where inventory_item_id=$1`,[ids.item]));
  await rpc(db,ids.owner,'refund_minuta_commercial_sale_v147',[ids.org,cart.lines[0].sale_id,0.5,44950,'Synthetic partial refund',request(51)]);
  assert.equal(Number(await scalar(db,`select quantity from inventory_stock_balances where inventory_item_id=$1`,[ids.item])),beforeRefundStock+250);
  await expectError(()=>rpc(db,ids.owner,'refund_minuta_commercial_sale_v147',[ids.org,cart.lines[0].sale_id,0.0001,9,'Synthetic precision',request(52)]),'catalog_stock_precision_invalid','22023');
  const refund=await rpc(db,ids.owner,'refund_minuta_commercial_sale_v147',[ids.org,cart.lines[0].sale_id,0.5,44950,'Synthetic remaining refund',request(53)]);
  assert.equal(refund.amount_minor,44950);
  assert.equal(Number(await scalar(db,`select quantity from inventory_stock_balances where inventory_item_id=$1`,[ids.item])),beforeRefundStock+500);
  assert.equal((await rpc(db,ids.owner,'get_minuta_sales_cart_candidate',[ids.org,request(20),ids.client])).refunded_minor,89900);
  check('frozen factor after edit, partial/full refund exact money and stock, grouped refunds');
  const fav=await rpc(db,ids.owner,'set_minuta_sales_favorite_candidate',[ids.org,ids.item,true]);
  assert.equal(fav.favorite,true);
  assert.equal((await rpc(db,ids.owner,'get_minuta_sales_catalog_candidate',[ids.org])).items.find(x=>x.id===ids.item).favorite,true);
  assert.equal((await rpc(db,ids.admin,'get_minuta_sales_catalog_candidate',[ids.org])).items.find(x=>x.id===ids.item).favorite,false);
  const bundleItems=[{inventory_item_id:ids.item,quantity:1},{inventory_item_id:ids.item2,quantity:1}];
  const bundle=await rpc(db,ids.owner,'save_minuta_sales_bundle_candidate',[ids.org,null,'Physical kit',JSON.stringify(bundleItems),0,request(60)]);
  const bundleLine=[{line_id:'kit',bundle_id:bundle.id,bundle_version:bundle.version,quantity:1,warehouse_id:ids.warehouse,
    components:[{inventory_item_id:ids.item,metadata_version:2,unit_price_minor:99000},{inventory_item_id:ids.item2,metadata_version:2,unit_price_minor:1200}]}];
  const bundleCart=await rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(bundleLine,61));
  assert.equal(bundleCart.total_minor,100200);assert.equal(bundleCart.lines.length,2);
  bundleLine[0].bundle_version=99;
  await expectError(()=>rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(bundleLine,62)),'catalog_bundle_changed','40001');
  check('physical bundles expand atomically with version check, personal favorites');
  const legacy=await rpc(db,ids.owner,'sell_minuta_commercial_product_v151',[ids.org,null,ids.client,ids.owner,'inventory_item',null,ids.item2,ids.warehouse,1,700,0,'cash',ids.cash,request(70)]);
  const legacyRepeat=await rpc(db,ids.owner,'get_minuta_sales_repeat_candidate',[ids.org,ids.client]);
  assert.equal(legacyRepeat.legacy,true);assert.equal(legacyRepeat.lines[0].sale_id,legacy.id);
  const legacyBefore=Number(await scalar(db,`select quantity from inventory_stock_balances where inventory_item_id=$1`,[ids.item2]));
  await rpc(db,ids.owner,'refund_minuta_commercial_sale_v147',[ids.org,legacy.id,1,700,'Synthetic legacy refund',request(71)]);
  assert.equal(Number(await scalar(db,`select quantity from inventory_stock_balances where inventory_item_id=$1`,[ids.item2])),legacyBefore+1);
  const mixedHistory=await rpc(db,ids.owner,'get_minuta_sales_history_candidate',[ids.org,ids.client,100]);
  assert.equal(mixedHistory.purchases.length,3,'two multi-line carts plus one legacy sale count as three purchases');
  assert.equal(mixedHistory.purchases.reduce((n,x)=>n+Number(x.total_minor),0),193200);
  assert.equal(mixedHistory.purchases.reduce((n,x)=>n+Number(x.refunded_minor),0),90600);
  const anonymous=await rpc(db,ids.owner,'sell_minuta_commercial_product_v151',[ids.org,null,null,ids.owner,'inventory_item',null,ids.item2,ids.warehouse,1,700,0,'cash',ids.cash,request(72)]);
  const orgHistory=await rpc(db,ids.owner,'get_minuta_sales_history_candidate',[ids.org,null,2,false,null,null]);
  assert.equal(orgHistory.organization_id,ids.org);assert.equal(orgHistory.grouped_count,4);
  assert.equal(orgHistory.gross_minor,193900);assert.equal(orgHistory.refunded_minor,90600);assert.equal(orgHistory.net_minor,103300);
  assert.equal(orgHistory.purchases.length,2);assert.ok(orgHistory.next_cursor);
  const nextPage=await rpc(db,ids.owner,'get_minuta_sales_history_candidate',[ids.org,null,2,false,orgHistory.next_cursor.before,orgHistory.next_cursor.before_id]);
  const allIds=[...orgHistory.purchases,...nextPage.purchases].map(x=>x.id);
  assert.equal(new Set(allIds).size,4);assert.ok(allIds.includes(anonymous.id));assert.equal(nextPage.next_cursor,null);
  assert.equal((await rpc(db,ids.owner,'get_minuta_sales_history_candidate',[ids.org,ids.client,50,true,null,null])).grouped_count,3);
  assert.equal((await rpc(db,ids.owner,'get_minuta_sales_history_candidate',[ids.org,null,50,true,null,null])).grouped_count,1);
  check('org-wide authoritative grouped count/totals, selected/anonymous filters and stable cursor');
  check('legacy sale/repeat/refund factor1 preserved');
  await concurrency(db,Client,config);
  check('native two-session duplicate serialization and independent stock race');
  const beforeRollback=await counts();
  await expectError(()=>db.query(read('../sales-catalog-schema-rollback.sql')),'sales_catalog_rollback_has_dependent_data','55000');
  await db.query('rollback');
  assert.deepEqual(await counts(),beforeRollback);
  await db.query(read('../sales-catalog-operational-rollback.sql'));
  await expectError(()=>rpc(db,ids.owner,'sell_minuta_inventory_cart_candidate',cartArgs(lines(),80)),'sales_catalog_writes_disabled','55000');
  assert.equal((await rpc(db,ids.owner,'get_minuta_sales_catalog_candidate',[ids.org])).capabilities.writes_enabled,false);
  await db.query(read('../sales-catalog-candidate.sql'));
  assert.equal((await rpc(db,ids.owner,'get_minuta_sales_catalog_candidate',[ids.org])).capabilities.writes_enabled,false,'reapply cannot re-enable writes');
  await rpc(db,ids.owner,'refund_minuta_commercial_sale_v147',[ids.org,bundleCart.lines[0].sale_id,1,99000,'Synthetic after rollback refund',request(81)]);
  assert.equal(Number(await scalar(db,`select stock_per_sale_unit from sales_cart_lines_candidate where sale_id=$1`,[bundleCart.lines[0].sale_id])),250);
  check('dependent schema rollback refused, operational disable preserves reads/frozen refunds');
  console.log(JSON.stringify({...proof,count:proof.checks.length,limitations:['minimal surrounding schema, no full auth/benefits or deployed UI proof']},null,2));
} finally {await db.end();}

async function concurrency(observer,Client,config) {
  const a=new Client({...config,application_name:'sales-cart-concurrency-a'}),b=new Client({...config,application_name:'sales-cart-concurrency-b'});
  await a.connect();await b.connect();
  const one=[{line_id:'race',inventory_item_id:ids.item2,warehouse_id:ids.warehouse,quantity:1,metadata_version:2,unit_price_minor:1200}];
  const start=async(client,args,actor=ids.owner)=>{
    await client.query('begin');await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
    return client.query('select sell_minuta_inventory_cart_candidate($1,$2,$3,$4,$5,$6,$7,$8) payload',args);
  };
  const invoke=(client,n,quantity=1)=>start(client,cartArgs([{...one[0],quantity}],n));
  try {
    const first=await invoke(a,100);
    let settled=false;const pending=invoke(b,100).then(r=>{settled=true;return r;});
    let blocked=false;
    for(let i=0;i<40;i++) {
      const wait=await scalar(observer,`select exists(select 1 from pg_stat_activity where application_name='sales-cart-concurrency-b'
        and cardinality(pg_blocking_pids(pid))>0)`);
      if(wait){blocked=true;break;}
      await new Promise(r=>setTimeout(r,25));
    }
    assert.equal(blocked,true,'prove actual server blocking, not client timing');assert.equal(settled,false);
    await a.query('commit');const second=await pending;await b.query('commit');
    assert.equal(second.rows[0].payload.id,first.rows[0].payload.id);assert.equal(second.rows[0].payload.replayed,true);
    const two=[{...one[0],line_id:'two-item'},
      {...one[0],line_id:'two-cream',inventory_item_id:ids.item,unit_price_minor:99000}];
    await start(a,cartArgs(two,103));
    const reversed=start(b,cartArgs([...two].reverse(),104),ids.admin);
    await a.query('commit');await reversed;await b.query('commit');
    const available=Number(await scalar(observer,`select quantity from inventory_stock_balances where inventory_item_id=$1`,[ids.item2]));
    await invoke(a,101,available);
    const losing=invoke(b,102,available).then(r=>({r}),e=>({e}));
    await a.query('commit');const loser=await losing;await b.query('rollback');
    assert.equal(loser.e?.message,'insufficient_inventory_stock');
    assert.equal(Number(await scalar(observer,`select quantity from inventory_stock_balances where inventory_item_id=$1`,[ids.item2])),0);
    assert.equal(Number(await scalar(observer,`select count(*) from sales_carts_candidate where request_id=$1`,[request(102)])),0);
  } finally {await a.query('rollback');await b.query('rollback');await a.end();await b.end();}
}
