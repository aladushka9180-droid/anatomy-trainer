# Sales catalog — unnumbered server candidate

Local candidate only. No reserved migration/release number, production SQL, deployment,
UI integration, full CURRENT restore or physical-device acceptance. Install with
`sales-catalog-candidate.sql` only through the release owner's reviewed migration sequence.
Use the `migration` skill's expand/verify/rollback procedure. Existing numbered SQL,
provider/controller/benefit modules, flags and frontend resource versions are untouched.

## Acceptance scope and ownership

The agreed six product slices remain:
1. Catalog/variants/photos/icons/favorites/units.
2. Cart/physical bundles/atomicity.
3. Repeat purchase.
4. Isolated draft.
5. Excel/CSV preview/errors.
6. Soft UI at390/760/1440.

This server candidate supports1/2/3 and the metadata validation/commit part of5.
The isolated client draft4, Excel/CSV parsing/preview presentation5 and responsive
UI6 still require UI work; no server candidate represents those as implemented.
Product/live acceptance remains0/6. Root integrates UI; the existing coordinator reserves the
migration number, owns main/release and any independently authorized production SQL.

## API (exact candidate names)

All RPCs below are SECURITY DEFINER with an empty search_path. Only `authenticated`
has EXECUTE; helpers/tables are unavailable directly to PUBLIC, anon, authenticated
and service_role. Active organization owner/admin rights are checked with the
existing financial manager guard. No client token grants management access.

| RPC | Parameters | Result / scope |
| --- | --- | --- |
| get_minuta_sales_catalog_candidate | p_organization uuid | organization_id, capabilities, items, warehouses, actual balances, bundles; favorites belong to auth.uid() |
| save_minuta_sales_item_candidate | p_organization uuid, p_item jsonb, p_request_id uuid | owner/admin single-item editor; items:[{inventory_item_id,metadata_version}], replayed |
| preview_minuta_sales_import_candidate | p_organization uuid, p_rows jsonb | owner/admin read; normalized rows, errors:[{index,code,message}], preview_hash; no writes |
| commit_minuta_sales_import_candidate | p_organization uuid, p_rows jsonb, p_preview_hash text, p_confirmed boolean, p_request_id uuid | **owner only**, explicit confirmed=true; same result as item save, atomic batch |
| save_minuta_sales_bundle_candidate | p_organization uuid, p_bundle uuid/null, p_name text, p_items jsonb, p_version bigint, p_request_id uuid | id, version, replayed; create version0, update expected version |
| set_minuta_sales_favorite_candidate | p_organization uuid, p_item uuid, p_favorite boolean | inventory_item_id, favorite; explicit desired state, safely replayable |
| sell_minuta_inventory_cart_candidate | p_organization uuid, p_booking uuid/null, p_client_account uuid/null, p_seller uuid/null, p_lines jsonb, p_payment_method text, p_payment_account uuid, p_request_id uuid | grouped cart/status result + replayed |
| get_minuta_sales_cart_candidate | p_organization uuid, p_request_id uuid, p_client_account uuid/null | exact selected-client receipt; found, organization_id, client_account_id, id, seller_id, total_minor, refunded_minor, occurred_at, request_id, lines |
| get_minuta_sales_repeat_candidate | p_organization uuid, p_client_account uuid | selected client's latest inventory purchase including legacy; frozen lines + current_items/current_balances + requires_current_validation=true |
| get_minuta_sales_history_candidate | p_organization uuid, p_client_account uuid/null, p_limit integer=50, p_filter_client boolean=true, p_before timestamptz/null, p_before_id uuid/null | organization_id, grouped=true, authoritative grouped_count/gross_minor/refunded_minor/net_minor, purchases, next_cursor |

Org-wide history explicitly uses `p_client_account=null,p_filter_client=false`.
Filtered=true uses the selected client; null then means anonymous purchases.
Limit1..100; the timestamp and ID cursor must be supplied together. Totals/count
cover the entire authorized filter, independently of page size/cursor. Pass the
returned next_cursor as p_before/p_before_id. Repeat and status never expand their
selected-client scope. All receipt payloads carry organization_id for UI session checks.

## Metadata and units

Item input: inventory_item_id (null/create), name, sku, unit (existing base unit),
sale_unit, stock_per_sale_unit, nullable sale_price_minor, purpose, metadata_version
(0 when no metadata), optional category/group_key/variant_label/icon/photo_url/
description/active. Version is required for existing metadata. Unknown price stays
null; zero price is invalid. Existing inactive state is preserved if active is omitted.
Base unit cannot change through this editor/import. Existing low-stock threshold is
preserved. Category is user text; variant SKU uniqueness reuses the existing org SKU
index. Every physical variant has its own inventory_item_id; group_key only groups UI.

Unit enums: piece/ml/g/kg/l/pack. Identical units require factor1; fixed l↔ml and
kg↔g require 1000/0.001. A pack/piece with a different base unit needs an explicit
positive factor, precision<=3; unrelated mass/volume conversion is refused. No
silent rounding of stock. Catalog_ready=false when metadata is absent or its base
unit no longer matches inventory. Old items are returned without invented prices.

Photo URLs allow empty or HTTPS without whitespace or embedded username/password;
the server does not fetch them. UI must escape all text, apply URL validation and
render unsupported icons safely. Description<=2000; category/group_key<=80.

Balances contain only persisted warehouse/item/quantity/updated_at rows in base
units. No generated balance or opening receipt. Missing balance is unknown in UI;
the sale gate treats absent available stock as zero and refuses a positive sale.
Import is metadata/prices only: stock_quantity, quantity and opening_stock input
are refused. CSV/XLSX parsing and preview presentation belong to the client.
Import and ordinary save create real positions only after the user's save action.
Existing service-usage rules remain the inventory subsystem's responsibility;
purpose gates catalog sales and does not rewrite old service consumption mappings.

## Cart/bundle intent

Item line: `{line_id,inventory_item_id,warehouse_id,quantity,metadata_version,
unit_price_minor,discount_minor}`. line_id is a unique caller ID, <=80 characters.
Quantity is in **sale units**; pack/piece sales require whole quantities. Server
requires exact current price and metadata version. Persist the full intent and one
request UUID before sending; retain explicit seller/payment/client choices.

Bundle save items: `[{inventory_item_id,quantity},...]`, 2..30 distinct physical
components. Bundle line: `{line_id,bundle_id,bundle_version,warehouse_id,quantity,
components:[{inventory_item_id,metadata_version,unit_price_minor},...]}`. Components
must match saved order/IDs. Server expands quantities; independent current price
and version checks apply to each component. Bundle-level discounts are unsupported;
item-line discounts are validated in integer minor units. These are physical goods,
not benefits, certificates, packages or subscriptions.

One transaction validates and saves all lines, compatible single-line legacy sales,
stock movements, immutable snapshots, financial transactions/postings and audit.
Aggregate stock demand includes duplicate item/warehouse lines. Stock writes use
the existing v130 RPC and actual cost-layer trigger. Locks follow the existing
financial membership→organization gate, payment account, v130 shared13000/org13001,
sorted item rows and sorted warehouse/item8201 locks. No v151 loop or separate
client RPC per line.

Example: 1 pack ×89900 minor units yields subtotal89900 and stock_quantity500ml.
commercial_sale_lines keeps quantity1/unit_price_minor89900. Snapshot keeps base_unit
ml/factor500. No rounded 179/180 kop-per-ml representation is written.

If the response is lost, outcome is **unknown** until status/retry confirms it.
Read status with the same organization/request/client, or retry exactly the same
full intent/request. Never create a replacement request UUID. Same request and
different intent returns 23505 catalog_request_conflict. Import/bundle retries
also compare the complete intent before mutable-version checks.

Successful cart receipts include booking_id, seller_id, payment_method,
payment_account_id, request_fingerprint and the original intent_lines, as well as
ordered immutable lines. Forward adds the nullable intent_lines column for earlier
candidate tables without rewriting their rows; every new cart stores its exact
p_lines in the same transaction. A receipt missing that snapshot stays unknown.
The UI adapter verifies organization/client/request/booking/seller/payment,
the entire original line/component payload (including bundle count, independent
of JSON object key order), line identifiers, item/warehouse/version/price/quantity and exact grouped total
before clearing recovery. An unmatched or incomplete receipt stays unknown.

## Refund, old readers and rollback

Forward requires the exact v148 refund source and saves its definition/comment/ACL.
Its signature and ACL stay unchanged. Only inventory receipt quantity gains the
frozen snapshot multiplier (legacy factor1), plus precision validation for new
snapshot sales. The proportional v148 money formula and benefits branch remain
literal old code. Factors/prices edited later do not change previous refunds.

New Pro history must use the grouped history RPC/count/totals. It excludes child
sales when presenting a cart, sums the original money once, and derives refund
amounts from actual legacy sale headers. Old direct commercial_sales readers and
the separate PrimeTime client v155 still see separate child purchases for one cart;
their files are not changed here. Monetary totals stay correct, but those readers'
purchase counters do not acquire grouping automatically. Client identity/session
scope is unchanged; full v155 auth/benefit runtime is not attested by this fixture.

Operational rollback disables candidate writes, preserves snapshots/status/history
and correctly converted refunds; reapplying forward does not turn writes back on.
Schema rollback locks tables, rejects **any** metadata/favorite/bundle/request/cart
data, checks refund source/ACL, and only then restores exact legacy refund/removes
empty candidate objects without CASCADE. After dependent data, use operational
rollback; do not delete business records to make schema rollback succeed.

Capability fallback: PGRST202/42883 from the new read RPC means use existing v151
single-item UI, unknown catalog prices, existing benefits path. Never downgrade an
atomic basket to several v151 writes. Other errors are real failures. No confirmed
Worker allowlist dependency: provider Supabase calls remain direct/pass-through.

## Errors and proof

Supabase shape stays `{code,message,details,hint}`. Row errors carry JSON details
`{index,line_id}`; stock shortage carries `{line_ids,inventory_item_id,warehouse_id}`.
Stable errors include 42501 financial_manager_role_required/catalog_import_owner_required/
commercial_client_mismatch/commercial_seller_not_active_member/catalog_warehouse_scope_mismatch,
40001 catalog_metadata_changed/catalog_price_changed/catalog_bundle_changed/catalog_preview_changed,
22023 invalid_catalog_item/catalog_import_invalid/catalog_stock_precision_invalid,
23505 catalog_request_conflict/catalog_sku_conflict, and 55000 insufficient_inventory_stock/
finance_disabled/inventory_disabled/sales_catalog_writes_disabled.

Verified on actual PostgreSQL17.11 in the explicitly authorized new loopback-only
eldion_sales_catalog_fixture DB/port54851: 15 scoped runtime groups, including native
two-session blocking/duplicate replay, separate stock race, reverse two-item order
with owner/admin, v130 cost ledger, deferred balanced finance, frozen refunds,
old/new data preservation, manager single save vs owner-only batch import,
grouped history totals/filter/cursor, and both rollback paths. Static preservation
and guarded-runner checks pass. The fixture installs real v129/v82/v108/v130/v147/
v148 and exact v151 function definitions; surrounding auth/benefit/supplier schemas
are explicitly minimal placeholders. It is not a full CURRENT or benefits proof.
Existing v151 DB and v155 DB static checks pass. The old v147 combined UI/static
test fails its fixed commerce-management.js?v=811 HTML assertion on the unchanged
fresh main loader; this candidate does not edit that test or frontend resources.

Run `node tests/sales-catalog-candidate-static-test.mjs` from minuta-online-booking.
Native runner accepts no DB URL/env override, verifies fixed loopback/name/port/PG17
and empty schemas, and refuses other targets. It needs pinned pg8.16.3 module via
MINUTA_PG_MODULE. For reruns, explicit --reset-owned-synthetic-fixture additionally
requires the exact synthetic marker before clearing only this dedicated fixture.
Release owner must reserve names/version, validate the full authorized target
schema/backup/rollback, integrate UI, then deploy and verify live acceptance.
