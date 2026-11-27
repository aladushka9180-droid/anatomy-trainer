import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Native PostgreSQL + actual controller/forms + real browser localStorage/Web
// Locks. Entirely synthetic loopback data; NOT a full Supabase restore or live
// acceptance. Explicit opt-in and deny-all browser network are mandatory.
assert.equal(process.env.MINUTA_TEST_MIGRATION_CONFIRM, 'MIGRATE_ONLY_ISOLATED_TEST_DATABASE');
const target = new URL(process.env.MINUTA_TEST_DATABASE_URL || '');
assert.equal(target.hostname, '127.0.0.1');
assert.match(target.pathname, /warehouse-audit-local$/);
assert.equal(process.env.MINUTA_TEST_PROJECT_REF, 'warehouse-audit-local');
assert.notEqual(process.env.MINUTA_PRODUCTION_PROJECT_REF, process.env.MINUTA_TEST_PROJECT_REF);
assert.ok(!target.href.includes(process.env.MINUTA_PRODUCTION_PROJECT_REF));
const pg = await import(pathToFileURL(process.env.MINUTA_PG_MODULE).href);
const Client = pg.Client || pg.default.Client;
const { chromium } = await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href);
const admin = new Client({ connectionString:target.href }), actor = new Client({ connectionString:target.href });
await admin.connect(); await actor.connect();
const migration = fs.readFileSync(new URL('../supabase/migrations/20261014230902_inventory_legacy_quantity_precision.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../supabase/rollbacks/20261014230902_inventory_legacy_quantity_precision.sql', import.meta.url), 'utf8');
const originalHash = '5f67773de5edfa7677809eb9b6dbfa60', fixedHash = '1d9febd4d7e3e83ff01caa0095acac7a';
const source = fs.readFileSync(new URL('../inventory-management.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const icons = fs.readFileSync(new URL('../ui-icons.svg', import.meta.url), 'utf8');
const checks = [], clients = [admin, actor]; let browser;
let profile;
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
const signature = 'public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)';
const metadata = async () => (await admin.query(`select oid,proowner,proacl::text,prosecdef,proconfig,md5(prosrc) body_hash
  from pg_proc where oid=to_regprocedure($1)`, [signature])).rows[0];
const ids = Object.fromEntries(['actor','org','source','destination','item','location','destinationLocation'].map(k => [k, randomUUID()]));
async function seed() {
  await admin.query('insert into auth.users(id,email) values($1,$2)', [ids.actor, ids.actor + '@example.invalid']);
  await admin.query("insert into public.organizations(id,name,status,created_by) values($1,'Изолированная проверка восстановления','active',$2)", [ids.org,ids.actor]);
  await admin.query("insert into public.organization_memberships values($1,$2,'owner',true,true)", [ids.org,ids.actor]);
  await admin.query("insert into public.locations(id,organization_id,name,active,is_primary) values($1,$2,'Центр',true,true),($3,$2,'Север',true,false)", [ids.location,ids.org,ids.destinationLocation]);
  await admin.query("insert into public.inventory_items(id,organization_id,name,unit) values($1,$2,'Материал','ml')", [ids.item,ids.org]);
  await admin.query("insert into public.inventory_warehouses(id,organization_id,location_id,name) values($1,$2,$3,'Центр'),($4,$2,$5,'Север')", [ids.source,ids.org,ids.location,ids.destination,ids.destinationLocation]);
  await admin.query('insert into public.organization_inventory_settings(organization_id,enabled,auto_deduct_completed_visits) values($1,true,false)', [ids.org]);
  await actor.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.actor]); await actor.query('set role authenticated');
}
const move = (kind, quantity, count, request = randomUUID(), warehouse = ids.source) => actor.query(
  'select public.apply_minuta_stock_movement($1,$2,$3,$4,$5,$6,$7,$8) result',
  [ids.org,warehouse,ids.item,kind,quantity,count,'Изолированная проверка',request]);
const ledger = async () => (await admin.query(`select (select quantity from public.inventory_stock_balances where warehouse_id=$1 and inventory_item_id=$2)::text balance,
  (select count(*) from public.inventory_movements where organization_id=$3)::int movements`, [ids.source,ids.item,ids.org])).rows[0];
try {
  // Permit repeated runs in this explicitly admitted synthetic stand only.
  if ((await metadata()).body_hash === fixedHash) await admin.query(rollback);
  await seed(); const baseline = await metadata();
  assert.equal(baseline.body_hash, originalHash, 'qualified installed legacy body required');
  await check('precision migration preserves OID/owner/ACL/search_path/security', async () => {
    await admin.query(migration); const current = await metadata();
    assert.equal(current.body_hash, fixedHash); delete current.body_hash;
    const previous = { ...baseline }; delete previous.body_hash; assert.deepEqual(current, previous);
  });
  for (const [kind, quantity, count] of [
    ['receipt','0.1234',null],['write_off','0.1234',null],['receipt','999999999999',null],
    ['receipt','NaN',null],['receipt','Infinity',null],['receipt',null,null],['receipt','0',null],
    ['inventory',null,'2.1234'],['inventory',null,'-1'],['inventory',null,'NaN'],['inventory',null,'Infinity']
  ]) await check(`reject ${kind} ${quantity ?? count} without balance/movement change`, async () => {
    const before = await ledger();
    await assert.rejects(move(kind,quantity,count), error => error.code === '22023' && error.message === (kind === 'inventory' ? 'invalid_inventory_count' : 'invalid_inventory_quantity'));
    assert.deepEqual(await ledger(), before);
  });
  await check('valid three decimals and replay retain one document; count zero remains valid', async () => {
    const request = randomUUID(), first = (await move('receipt','0.123',null,request)).rows[0].result;
    assert.equal(first.quantity_after,0.123);
    assert.deepEqual((await move('receipt','0.1230',null,request)).rows[0].result, first);
    assert.equal((await move('inventory',null,'0')).rows[0].result.quantity_after, 0);
  });
  await check('rollback restores exact original body and reapply restores precision rejection', async () => {
    await admin.query(rollback); assert.deepEqual(await metadata(), baseline);
    await actor.query('begin');
    try { assert.equal((await move('receipt','0.1234',null)).rows[0].result.quantity_after,0.123); }
    finally { await actor.query('rollback'); }
    await admin.query(migration); assert.equal((await metadata()).body_hash, fixedHash);
    await assert.rejects(move('receipt','0.1234',null), error => error.code === '22023');
    await admin.query(migration); assert.equal((await metadata()).body_hash, fixedHash);
  });
  await check('Windows CRLF migration and rollback retain exact qualified function bodies', async () => {
    const crlf = sql => sql.replace(/\r?\n/g,'\r\n');
    await admin.query(crlf(rollback)); assert.deepEqual(await metadata(),baseline);
    await admin.query(crlf(migration)); assert.equal((await metadata()).body_hash,fixedHash);
  });
  await check('anonymous/foreign actor cannot execute stock changes', async () => {
    assert.equal((await admin.query("select has_function_privilege('anon',$1,'EXECUTE') allowed", [signature])).rows[0].allowed,false);
    await actor.query("select set_config('request.jwt.claim.sub',$1,false)", [randomUUID()]);
    await assert.rejects(move('receipt','1',null), error => error.code === '42501');
    await actor.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.actor]);
  });

  await move('receipt',10,null); await move('receipt',2,null,randomUUID(),ids.destination);
  profile = fs.mkdtempSync(path.join(tmpdir(),'minuta-inventory-recovery-'));
  let context = await chromium.launchPersistentContext(profile,{ headless:true }); browser = context;
  const traffic = [], pageErrors = [], calls = [];
  let loseNext = true, deferNext = false, release;
  const prepareContext = async () => {
  await context.exposeBinding('__inventoryRpc', async (_sender, name, p) => {
    if (name === 'get_minuta_inventory_workspace_v130') return { data:(await actor.query('select public.get_minuta_inventory_workspace_v130($1) result',[p.p_organization])).rows[0].result, error:null };
    calls.push({ name, parameters:structuredClone(p) });
    try {
      let result;
      if (name === 'apply_minuta_stock_movement') result = (await actor.query('select public.apply_minuta_stock_movement($1,$2,$3,$4,$5,$6,$7,$8) result', [p.p_organization,p.p_warehouse,p.p_item,p.p_kind,p.p_quantity,p.p_counted_quantity,p.p_reason,p.p_request_id])).rows[0].result;
      else if (name === 'apply_minuta_stock_movement_v130') result = (await actor.query('select public.apply_minuta_stock_movement_v130($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[p.p_organization,p.p_warehouse,p.p_item,p.p_kind,p.p_quantity,p.p_counted_quantity,p.p_reason,p.p_request_id,p.p_purchase_total_cost_kopecks])).rows[0].result;
      else if (name === 'transfer_minuta_inventory_stock_v130') result = (await actor.query('select public.transfer_minuta_inventory_stock_v130($1,$2,$3,$4,$5,$6,$7) result',[p.p_organization,p.p_source_warehouse,p.p_destination_warehouse,p.p_item,p.p_quantity,p.p_reason,p.p_request_id])).rows[0].result;
      else throw new Error('unexpected stock RPC '+name);
      if (deferNext) { deferNext = false; await new Promise(resolve => { release = resolve; }); }
      if (loseNext) { loseNext = false; return { data:null,error:{ code:'',message:'Lost response after native commit' } }; }
      return { data:result,error:null };
    } catch (error) { return { data:null,error:{ code:error.code,message:error.message } }; }
  });
  await context.route('**/*', route => {
    if (route.request().url() === 'https://warehouse-recovery.test/ui-icons.svg') return route.fulfill({ contentType:'image/svg+xml',body:icons });
    if (route.request().url() !== 'https://warehouse-recovery.test/') { traffic.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType:'text/html',body:'<!doctype html><html><body></body></html>' });
  });
  };
  await prepareContext();
  const open = async page => {
    page ||= await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('https://warehouse-recovery.test/');
    await page.evaluate(html => {
      const panel = new DOMParser().parseFromString(html,'text/html').querySelector('#inventoryPanel');
      document.body.append(document.importNode(panel,true));
      panel.hidden = false;
      const nativeAdd = document.addEventListener.bind(document);
      document.addEventListener = (name,callback,...rest) => nativeAdd(name,name === 'submit' ? event => {
        window.lastStockSubmit = Promise.resolve(callback(event));
      } : callback,...rest);
    },html);
    await page.addScriptTag({ content:source });
    await page.evaluate(async ids => {
      window.notices = [];
      const controller = MinutaInventory.createController({ db:{ rpc:(name,p) => window.__inventoryRpc(name,p) },
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g,c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),
        notify:message => notices.push(message),requireWrites:() => true,getCurrentUser:() => ({ id:ids.actor }),getSessionGeneration:() => 1,
        sessionIsCurrent:(actor,generation) => actor === ids.actor && generation === 1,applyWriteAvailability(){},requestConfirmation:async () => true });
      window.controller = controller; controller.bind(); await controller.setOrganization({ id:ids.org,current_role:'owner' });
    },ids); return page;
  };
  const fill = async (page,kind,amount='2') => page.evaluate(({ids,kind,amount}) => {
    document.querySelector('#inventoryMovementWarehouse').value = ids.source;
    document.querySelector('#inventoryMovementItem').value = ids.item;
    document.querySelector('#inventoryMovementKind').value = kind;
    document.querySelector('#inventoryMovementQuantity').value = amount;
    document.querySelector('#inventoryTransferDestination').value = ids.destination;
    document.querySelector('#inventoryMovementReason').value = 'Изолированная проверка';
    document.querySelector('#inventoryMovementKind').dispatchEvent(new Event('change',{ bubbles:true }));
  },{ ids,kind,amount });
  const submit = async page => {
    await page.evaluate(() => {
      const form = document.querySelector('#inventoryMovementForm');
      if (!form.checkValidity()) throw new Error('invalid fixture form');
      form.requestSubmit(form.querySelector('button[type="submit"]'));
      return window.lastStockSubmit;
    });
  };
  let page = await open();
  await check('real browser reload replays native committed write-off with one movement', async () => {
    await fill(page,'write_off'); await submit(page); const first = calls.at(-1);
    const afterCommit = await ledger(); assert.equal(afterCommit.balance,'8.000');
    // Enabling FIFO between loss and reload must not switch the saved RPC.
    await actor.query('select public.enable_minuta_inventory_transfers_v130($1)', [ids.org]);
    await open(page); await submit(page);
    assert.equal(calls.at(-1).name,'apply_minuta_stock_movement');
    assert.equal(calls.at(-1).parameters.p_request_id,first.parameters.p_request_id); assert.deepEqual(await ledger(),afterCommit);
    assert.equal(await page.evaluate(() => localStorage.length),0);
  });
  // Transfer baseline snapshots the current stock; material cost may be unknown
  // but document ID and exactly two movement sides remain real native results.
  await check('complete browser process restart replays native transfer with UUID ACK and two sides', async () => {
    await open(page); loseNext = true; await fill(page,'transfer','3'); await submit(page); const first = calls.at(-1);
    await context.close();
    context = await chromium.launchPersistentContext(profile,{ headless:true }); browser = context;
    await prepareContext(); page = await open(); await submit(page);
    assert.equal(calls.at(-1).parameters.p_request_id,first.parameters.p_request_id);
    const row = (await admin.query(`select document.id,
      (select count(*)::int from public.inventory_movements where transfer_document_id=document.id and movement_type='transfer_out') outgoing,
      (select count(*)::int from public.inventory_movements where transfer_document_id=document.id and movement_type='transfer_in') incoming
      from public.inventory_transfer_documents document where organization_id=$1 and request_id=$2`,[ids.org,first.parameters.p_request_id])).rows;
    assert.equal(row.length,1); assert.match(row[0].id,/^[0-9a-f-]{36}$/);
    assert.equal(row[0].outgoing,1); assert.equal(row[0].incoming,1);
    assert.equal(await page.evaluate(() => localStorage.length),0);
    assert.match(await page.evaluate(() => notices.join(' ')),/Перемещение сохранено/);
  });
  await check('real Web Lock blocks concurrent tab while request is unresolved', async () => {
    await open(page); deferNext = true; await fill(page,'write_off','1');
    await page.evaluate(() => document.querySelector('#inventoryMovementForm').requestSubmit());
    for (let i=0; !release && i<100; i++) await new Promise(resolve => setTimeout(resolve,20));
    assert.ok(release); const before = calls.length, tab = await open();
    await fill(tab,'write_off','1'); await submit(tab);
    assert.equal(calls.length,before); assert.match(await tab.locator('#inventoryMovementError').textContent(),/другой вкладке/);
    release(); await page.evaluate(() => window.lastStockSubmit); await tab.close();
  });
  assert.deepEqual(traffic,[]); assert.deepEqual(pageErrors,[]); await context.close();
  console.log(`Inventory recovery native candidate: ${checks.length}/${checks.length} PASS; loopback synthetic only.`);
} finally {
  await browser?.close();
  if (profile) {
    const resolved = fs.realpathSync(profile), expectedRoot = fs.realpathSync(tmpdir());
    assert.equal(path.dirname(resolved),expectedRoot);
    assert.ok(path.basename(resolved).startsWith('minuta-inventory-recovery-'));
    assert.ok(!fs.lstatSync(profile).isSymbolicLink());
    fs.rmSync(resolved,{ recursive:true });
  }
  try { if ((await metadata()).body_hash === fixedHash) await admin.query(rollback); }
  finally { for (const client of clients) await client.end(); }
}
