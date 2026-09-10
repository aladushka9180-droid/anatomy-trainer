# PrimeTime webhook dispatcher

Private Edge worker for v142 webhook outbox delivery. It is disabled by default and does no network I/O until `PRIMETIME_WEBHOOK_DISPATCH_ENABLED=true` and every required secret is configured.

Required environment variables:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEYS.default`)
- `PRIMETIME_WEBHOOK_DISPATCH_ENABLED=true`
- `PRIMETIME_WEBHOOK_DISPATCH_TOKEN`: at least 32 bytes, used by the scheduler as `Authorization: Bearer ...`
- `PRIMETIME_WEBHOOK_DESTINATIONS`: JSON object keyed by subscription UUID. Each value contains the exact `organizationId`, `connectionId`, `targetUrl`, `secretRef`, and an HMAC `secret` of at least 32 bytes.
- optional `PRIMETIME_WEBHOOK_BATCH_SIZE`, from 1 to 20 (default 10)

Each exact JSON request body is signed as HMAC-SHA256 over `<unix timestamp>.<body>`. Receivers should reject timestamps outside a short tolerance, verify `X-PrimeTime-Signature` in constant time, and deduplicate `X-PrimeTime-Event-Id`. Payloads deliberately omit names, phone numbers, notes, management tokens and payment details.

The worker rejects redirects, literal IP addresses, non-HTTPS targets, alternate ports and local/internal host suffixes. It also requires the leased subscription, organization, connection, secret reference and complete normalized target URL to match one operator-provisioned destination exactly; a tenant cannot select another tenant's signing secret or receiver. Missing or mismatched destinations fail that delivery closed. Network failures, HTTP 408/425/429 and 5xx responses retry with the database-managed bounded backoff; other non-2xx responses fail permanently.
