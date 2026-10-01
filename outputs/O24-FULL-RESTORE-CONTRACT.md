# O24: full-public-restore savepoint probe

Source candidate: `21b94834e745e694c506fb5f71fe72f18ee50bc5` (`2e8aa70c` SQL, native `36738275128` PASS on its isolated fixture). This probe is an additional candidate, not a production SQL gate. It does not change the candidate or its operational rollback.

## Wrapper interface

Copy the pinned files into the same repository-relative layout inside an already restored, disposable PostgreSQL 17 container:

- `minuta-online-booking/inventory-item-catalog-candidate.sql`
- `minuta-online-booking/inventory-item-catalog-rollback.sql`
- `minuta-online-booking/tests/inventory-item-catalog-full-restore-probe.mjs`

The private wrapper, not this module, must verify the exact source commit and whole restored `public` schema/data/owners/ACL/RLS/indexes **before** invoking the probe. It must attest a network-none container, new database `o24-inventory-full-restore` listening only on `127.0.0.1` at a chosen port 20000–65535, a privileged PostgreSQL 17 session, an offline `auth.users` placeholder accepting synthetic `id`-only inserts, and no external workers. Do not use production or a remote database. The module also checks the database, port, both loopback addresses, version, writable status and superuser role. It makes no connection itself.

After that attestation, open **one outer transaction** on the same `pg` Client and call:

```js
await client.query('BEGIN');
try {
  const { probe } = await import('./minuta-online-booking/tests/inventory-item-catalog-full-restore-probe.mjs');
  const result = await probe(client, {
    attested: true,
    expectedDatabase: 'o24-inventory-full-restore',
    expectedPort: 25432 // use the wrapper's actual ephemeral port
  });
  if (result.status !== 'success' || result.savepointRestored !== true) throw new Error('O24 probe incomplete');
} finally {
  await client.query('ROLLBACK');
}
```

The wrapper then compares the **entire public snapshot again** and destroys the disposable database/container on every outcome. A process error, failed outer rollback, snapshot mismatch or failed cleanup cannot yield a certificate. Do not copy restored rows or logs to public artifacts; retain only sanitized boolean/stage proof. The private wrapper owns backup handling and proof that original public rows/metadata survived.

## What the probe proves when it actually passes

Before apply it rejects pre-existing catalog RPCs (including overloads), category/icon columns and identically named constraints. SQL bytes are pinned by SHA-256 (`apply a7b81ee8…eb6db`, `rollback 923ec150…c7c27`) and exact transaction framing. A fresh synthetic organization, foreign organization, four actors and items are created inside a savepoint. It checks nullable category/icon, creation/update/trim/clear, legacy RPC compatibility, owner/admin allow, specialist/foreign owner/anon deny, RLS foreign-item invisibility, unchanged synthetic foreign item, apply twice, operational rollback retaining values but removing RPCs, and reapply. The savepoint rollback must restore original function OID/body/owner/ACL/config, remove added columns/RPCs/constraints and remove every synthetic organization/item. No direct production contact, payment, messaging, or browser path is exercised.

The operational SQL rollback deliberately leaves category/icon columns and values for safe reapply; only the **outer savepoint rollback** must return the exact starting schema. A passing probe does not prove the UI or authorize production SQL.

## Local verification and open gate

`node --check tests/inventory-item-catalog-full-restore-probe.mjs` and `node --test tests/inventory-item-catalog-full-restore-probe-contract-test.mjs` pass (3/3). They cover pinned SQL parsing and rejection of remote/socket-NULL/wrong database/port/version/unprivileged identity before writes. PostgreSQL, Docker, full restore, private backup, CI and live UI were not run here. Next step: root reviews this interface, integrates it into its own offline wrapper after full snapshot comparison, and runs one isolated restore with before/after public proof.
