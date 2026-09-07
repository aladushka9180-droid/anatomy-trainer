import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => readFile(path.join(root, name), 'utf8');
const [providerHtml,indexHtml,provider,app,scanner,scannerCss,clientImport,benefits,inventory,sw,migration,rollback,clientMigration,readiness] = await Promise.all([
  read('provider.html'), read('index.html'), read('provider.js'), read('app.js'), read('code-scanner.js'), read('code-scanner.css'),
  read('client-import.js'), read('benefit-management.js'), read('inventory-management.js'), read('sw.js'),
  read('supabase-migration-v115.sql'), read('supabase-migration-v115-rollback.sql'), read('supabase-migration-v112.sql'),
  read('design/INDUSTRY_FITNESS_MEDICAL_READINESS.md')
]);

// Large Excel parser is loaded only for an explicit Excel import.
assert.doesNotMatch(providerHtml, /<script[^>]+xlsx-0\.20\.3/i);
assert.match(clientImport, /if \(\/\\\.xlsx\?\$\/i\.test\(file\.name\)\) await loadXlsx\(\)/);
assert.match(clientImport, /script\.integrity = XLSX_INTEGRITY/);
assert.match(clientImport, /navigator\.contacts\.select\(\['name','tel'\], \{ multiple:true \}\)/);
assert.match(providerHtml, /id="clientContactsImport"[^>]+hidden/);
assert.match(providerHtml, /ничего не импортируется автоматически/i);
assert.match(clientImport, /marketing_consent:null, personal_data_consent:null/);

// Camera access is user initiated, supports QR/barcodes and always releases tracks.
for (const format of ['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e']) assert.match(scanner, new RegExp(`['"]${format}['"]`));
assert.match(scanner, /getUserMedia\(\{ video:/);
assert.match(scanner, /stream\?\.getTracks\?\.\(\)\.forEach\(track => track\.stop\(\)\)/);
assert.match(scanner, /generation !== cameraGeneration \|\| dialog\(\)\?\.open !== true/);
assert.match(scanner, /acquired\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
assert.match(scanner, /visibilitychange/);
assert.match(scanner, /codeScannerManualForm/);
for (const target of ['benefitInstrumentSearch','inventoryItemSku','inventoryMovementItem']) {
  assert.match(providerHtml, new RegExp(`data-code-scan-target="${target}"`));
}
assert.match(indexHtml, /data-code-scan-target="bookingBenefitCode"/);
assert.match(sw, /\.\/code-scanner\.js\?v=575/);
assert.match(sw, /\.\/code-scanner\.css\?v=575/);
assert.ok(scannerCss.length > 500);
assert.match(scanner, /codes\.length \? codes\.includes\(needle\)/);
assert.doesNotMatch(scanner, /value\.includes\(`· \$\{needle\}`\)/);
assert.match(scanner, /cleaned\.length > maximum/);
assert.match(inventory, /data-sku="\$\{escapeHtml\(row\.sku \|\| ''\)\}"/);
assert.match(benefits, /benefitInstrumentSearch/);

// Each organization role gets its own navigation and block order, with legacy fallback.
assert.match(providerHtml, /id="providerPreferenceRole"/);
for (const role of ['owner','admin','specialist']) assert.match(providerHtml, new RegExp(`<option value="${role}">`));
assert.match(provider, /mobile_nav_by_role/);
assert.match(provider, /view_order_by_role/);
assert.match(provider, /current_role \|\| 'specialist'/);
assert.match(provider, /function applyRoleViewOrder\(\)/);
assert.match(provider, /source\.mobile_nav_by_role \?\? source\.mobileNavByRole/);

// Private client records remain opt-in, scoped and server-authorized.
assert.match(clientMigration, /client_records_enabled/i);
assert.match(clientMigration, /organization_id/i);
assert.match(clientMigration, /security definer/i);
assert.match(providerHtml, /client-records\.js\?v=575/);
assert.match(sw, /\.\/client-records\.js\?v=575/);

// Benefit use is one transaction: booking + locked server validation + reservation.
assert.match(migration, /v115_requires_v68_v73_v76_and_v87/i);
assert.match(migration, /public_benefit_booking_requests_v115/i);
assert.match(migration, /primary key\(organization_id,request_id\)/i);
assert.match(migration, /public_code=upper\(btrim\(p_public_code\)\)/i);
const bookingAdvisory = migration.indexOf("hashtextextended(v_booking_id::text,7302)");
const instrumentAdvisory = migration.indexOf("hashtextextended(v_instrument_id::text,7300)");
const instrumentRowLock = migration.indexOf("where id=v_instrument_id and organization_id=p_organization for update");
const bookingRowLock = migration.indexOf("where id=v_booking_id and organization_id=p_organization and request_id=p_request_id for update");
assert.ok(bookingAdvisory > 0 && bookingAdvisory < instrumentAdvisory && instrumentAdvisory < instrumentRowLock && instrumentRowLock < bookingRowLock, 'v115 must preserve the v76 lock order');
assert.match(migration, /benefit_client_mismatch/i);
assert.match(migration, /timezone\('Europe\/Samara',now\(\)\)::date/i);
assert.match(migration, /v_today>v_instrument\.expires_on/i);
assert.match(migration, /package_service_exhausted/i);
assert.match(migration, /visit_pass_not_applicable/i);
assert.match(migration, /status','already_bound'/i);
assert.match(migration, /booking_payment_already_started/i);
assert.match(migration, /coalesce\(v_booking\.deposit_amount_rub,0\)>0/i);
assert.match(migration, /v_booking\.payment_status<>'not_required'/i);
assert.doesNotMatch(migration, /update public\.bookings set deposit_amount_rub/i, 'benefit reservation must not mutate payment state until reversible reconciliation exists');
assert.match(migration, /book_minuta_appointment_with_benefit_v115/i);
assert.match(migration, /perform public\.reserve_minuta_public_benefit_v115/i);
assert.match(migration, /exception when others/i);
assert.match(migration, /raise exception using errcode='P0001',message='benefit_not_available'/i);
assert.match(migration, /revoke all on function public\.reserve_minuta_public_benefit_v115[\s\S]+from public,anon,authenticated,service_role/i);
assert.match(migration, /grant execute on function public\.book_minuta_appointment_with_benefit_v115[\s\S]+to anon,authenticated/i);
assert.doesNotMatch(migration, /grant execute on function public\.reserve_minuta_public_benefit_v115[\s\S]+to anon/i);
assert.match(rollback, /drop function if exists public\.book_minuta_appointment_with_benefit_v115/i);
assert.doesNotMatch(rollback, /drop\s+(table|column)|truncate|delete\s+from/i);
assert.doesNotMatch(rollback, /^revoke/im, 'rollback must also be safe before v115 exists');
assert.match(app, /book_minuta_appointment_with_benefit_v115/);
assert.match(app, /p_benefit_code:benefitCode/);
assert.match(app, /Сертификат или абонемент не подходит/);
assert.match(indexHtml, /id="bookingBenefitCode"[^>]+maxlength="40"/);
assert.match(sw, /CACHE_PREFIX}v575/);

// Industry expansion is explicitly gated; no accidental medical-product claim.
assert.match(readiness, /Статус: проектирование/);
assert.match(readiness, /нельзя считать медицинской картой/i);
assert.match(readiness, /не медицинской информационной системой/i);
assert.match(readiness, /два параллельных клиента борются за последнее место/i);

console.log('Platform hardening v115 static checks passed.');
