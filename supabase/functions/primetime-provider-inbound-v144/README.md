# PrimeTime provider inbound v144

Private testing-only Edge endpoint for normalized booking events. It is disabled
unless both `PRIMETIME_PROVIDER_INBOUND_V144_ENABLED=true` and
`PRIMETIME_PROVIDER_INBOUND_V144_ENVIRONMENT=testing` are present.

`PRIMETIME_PROVIDER_INBOUND_V144_CONNECTIONS` is an operator-managed JSON object
keyed by the v142 connection UUID. Each entry contains `organizationId`,
`provider` (`dikidi` or `yclients`), `externalLocationId`, and an independent
secret of at least 32 bytes. The secret exists only in Edge environment values.

Send `POST /v1/events/{provider}/{connectionId}` with JSON and these headers:

- `X-PrimeTime-Provider-Event-Id`: stable event identifier;
- `X-PrimeTime-Provider-Timestamp`: current Unix timestamp;
- `X-PrimeTime-Provider-Signature`: `v1=` plus HMAC-SHA256 of
  `<timestamp>.<exact raw body>`.

These are PrimeTime ingress headers, not an assertion that either vendor emits
this signature format. An operator-controlled gateway must add them for both
providers; direct unsigned vendor traffic is rejected.

The handler verifies tenant, provider, timestamp, signature and body bounds
before parsing. It emits only PII-free internal commands and stores their hash
and state through `record_minuta_provider_event_v144`. Exact retries replay;
the same event ID with another payload is rejected by SQL.

Per the [YCLIENTS webhook reference](https://support.yclients.com/993), record
create/update webhooks are intentionally normalized to
`refresh_booking`: the documented event can be partial and its `date` has no
timezone or duration. PrimeTime therefore does not guess a local slot from it.
Deletions become `cancel_booking`.

No public DIKIDI webhook-signature contract was assumed. DIKIDI is accepted only
through the explicit gateway schema `primetime.dikidi.booking.v1`, signed with
the PrimeTime connection secret. This function does not call either vendor and
does not create, charge or refund payments.
