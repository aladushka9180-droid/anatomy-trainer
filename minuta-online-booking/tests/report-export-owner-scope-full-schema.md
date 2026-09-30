# S04/S10 full-schema rehearsal contract

This test complements `report-export-owner-scope-postgres-test.mjs`, which already proves the export RPC on a small empty PostgreSQL fixture. It has **not** been run on a full restored schema in this branch. It must never be pointed at production, a shared test project, or an ordinary developer database.

## Attach after the private restore

Use a disposable PostgreSQL 17 container with `--network none`, after the private owner has restored the full schema and verified its snapshot. Do not copy a dump, logs, data, or credentials into this repository. The container must accept a loopback connection to database `postgres` as local superuser. The private workflow owns the container and its destruction.

Create this marker **inside that container only**, after restore verification:

```sql
create schema minuta_export_fixture_guard;
create table minuta_export_fixture_guard.target (
  purpose text primary key,
  disposable boolean not null
);
insert into minuta_export_fixture_guard.target values ('s04-s10-full-schema',true);
```

Copy only these four public repository files into the container, retaining the `minuta-online-booking/` and `tests/` relative layout:

- `report-export-owner-scope-candidate.sql`
- `report-export-owner-scope-rollback.sql`
- `tests/report-export-owner-scope-full-schema.sql`
- `tests/report-export-owner-scope-full-schema-checks.sql`

Then run from **inside** the offline container, with output directed to the private workflow log:

```sh
PGHOST=127.0.0.1 PGPORT=5432 psql -U postgres -d postgres -X -q \
  -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  -f /tmp/export-probe/minuta-online-booking/tests/report-export-owner-scope-full-schema.sql
```

The runner requires the exact marker, `postgres` database and loopback connection before reading any business table. It rejects an existing export candidate, requires the existing legacy report functions and tables, and never calls an external service. A failure ends the psql session with an open transaction, which PostgreSQL rolls back. On success the runner explicitly rolls back; the sole success line is `report export full-schema apply/roles/scope/legacy/rollback/reapply: ok`.

## Scope of the proof

The runner stages random synthetic owner/admin/staff, two locations, three visits, one imported visit, one approved payroll adjustment and one history event within a single transaction. It tests owner full phone, admin/staff masks, denied full and foreign scope, staff's legitimate legacy v97 contact read, location and imported-history boundary, stable client linkage, session items, export grants and RLS flags. It compares v97/team/event payloads, function bodies and grants and synthetic business rows before and after candidate apply; the synthetic team payload includes a nonzero payroll amount and the event payload includes one history row. It performs candidate rollback and reapply, then rolls back the entire fixture. The JavaScript workbook test separately checks that the existing unrestricted export still includes history and the reconciled payroll path.

This proof is only one release gate. The private owner must still review the real restored schema, backup/restore evidence, migration number, integration and live UI before requesting authorization for any production SQL.
