# Export contract candidate (S04/S10)

This is an integration candidate, not a production migration. Assign a migration number only after reconciling fresh `main`. The SQL is additive; rollback drops only its three new functions. No existing table or report RPC is modified.

## Existing phone readers and compatibility

- `get_minuta_staff_report_bookings_v97` is called only by `provider.js` `loadReportScopedBookings`. Its result feeds analytics and `bookingSourceItems()` when navigating from analytics to bookings. That booking path retains legitimate staff contact actions. The v94 fallback serves the same path on older schemas.
- The booking detail and booking journal have separate legitimate contact reads. They are outside this export change.
- The old v97/v94 result still contains full phones for an authorized staff member. This candidate prevents CSV/XLSX/PDF export handlers from using that result. It does **not** make full phones inaccessible to staff through every existing report or booking API.
- To close the wider report RPC path without breaking booking contacts, first move the bookings view to a purpose-specific contact endpoint with equivalent staff authorization, then migrate analytics to masked report RPCs, run mixed-version compatibility and detail-action tests, and only then revoke or replace raw v97/v94. That contraction needs a separate impact decision and migration/rollback rehearsal.

## New export boundary

- `get_minuta_report_export_bookings` and `get_minuta_report_export_imported_history` authenticate the caller, require active organization membership, restrict specialists to their own performer ID, and allow full phone mode only for an owner. Both return masked or blank phones otherwise and echo the scope for client verification.
- The browser export composer always fetches these RPCs for own-data files, checks each response and row against the captured organization, dates, performer and phone mode, and checks the current account/organization/role through `get_minuta_workspace` before file delivery. A missing RPC or mismatch fails closed. The owner full-phone option also requires a separate checkbox in the review dialog.
- A stable opaque `client_export_key` joins matching phone-only visits across live and imported records for new/returning segments. It uses a pre-existing record UUID; it is not a claim that ordinary hashes or these UUIDs make otherwise accessible contacts secret.
- Imported history has no `location_id`. All-location exports include it and preserve historic totals. For one selected branch the composer requests only branch-scoped live bookings, excludes unassigned imported visits, and shows an explicit exclusion notice in the export and review dialogs and while preparing the file. The server import RPC rejects a non-null location. Synthetic UI checks cover the branch selection and explanation; the target live UI remains a release gate.

## Release gates

The native PostgreSQL 17 fixture runner checks apply, roles, masking, organization/performer/location scopes, pagination, imported joins, rollback and reapply on an empty synthetic database. It is wired to a branch-specific CI workflow. Local JavaScript tests use only blocked-network synthetic fixtures. Production SQL, backup/restore, integrated UI and target live checks remain separate coordinator gates.
