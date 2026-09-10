# PrimeTime integration API

Provider-neutral, server-to-server calendar API for PrimeTime Pro. It is
disabled by default and cannot be enabled by a request parameter.

## Runtime configuration

- `PRIMETIME_INTEGRATION_ENABLED=true`
- `PRIMETIME_INTEGRATION_ENVIRONMENT=testing|production`
- `SUPABASE_URL=https://<project>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEYS={"default":"..."}`

Production and testing use separate deployments and keys. API secrets are never
stored in plaintext: a caller sends
`Authorization: Bearer ptk_<key UUID>.<base64url secret>`, the Edge function
hashes only the secret, and v142 authenticates the hash against a key with the
required `calendar:read` or `calendar:write` scope.

If the enable flag or required configuration is missing, every route returns
`503 {"code":"NOT_CONFIGURED"}` before any database I/O.

## Routes

- `GET /v1/calendar/events?from=<ISO>&to=<ISO>` returns a bounded, PII-free page
  of bookings and external busy blocks. Optional cursor fields are
  `afterUpdatedAt` and `afterId`.
- `PUT /v1/calendar/events/{externalEventId}` creates or updates one external
  busy interval. The JSON body contains `performerId`, `locationId`, `startsAt`,
  `endsAt`, `revision`, and optional `expectedRevision`.
- `DELETE /v1/calendar/events/{externalEventId}` removes a synchronized busy
  interval and requires `If-Match` with the current source revision.

Every mutation requires an 8–200 byte printable `Idempotency-Key`. v142 stores a
hash of the request identity and payload; exact retries return the original
result, while a reused key with another payload is rejected. Updates use
optimistic revision matching, so an old calendar replay cannot overwrite a newer
interval. A deleted source event can be restored only by matching its last
revision and advancing to a new revision. External busy intervals are represented by protected zero-payment,
zero-notification schedule blocks and therefore participate in the existing
availability collision checks.

No connection or key is created or enabled by the migration. Real provider
credentials and production calendar E2E remain an explicit post-launch gate.
