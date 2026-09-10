# Yandex Booking API

Server-to-server adapter for the Yandex Maps beauty booking API. The function is
disabled by default and never accepts a provider `manage_token`, a Supabase user
JWT, or an environment selector from the request.

## Configuration

Required runtime variables:

- `YANDEX_BOOKING_ENABLED=true`
- `YANDEX_BOOKING_ENVIRONMENT=testing|production`
- `YANDEX_BOOKING_PARTNER_NAME=<partnerName issued by Yandex>`
- `YANDEX_BOOKING_JWT_KEYS={"default":"...","previous":"..."}`
- `SUPABASE_URL=https://<project>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEYS={"default":"..."}`

Optional JWT constraints:

- `YANDEX_BOOKING_EXPECTED_ISSUER`
- `YANDEX_BOOKING_EXPECTED_AUDIENCE`

Testing and production must be separate deployments/configurations with their
own Yandex secret keyrings. The fixed `YANDEX_BOOKING_ENVIRONMENT` is included
in every v140 RPC call; the caller cannot override it.

If the enable flag or any required configuration is absent/invalid, every valid
API route returns `503 {"code":"NOT_CONFIGURED"}`.

## Authentication and protocol

Requests require `Accept: application/json` and `Authorization: Bearer <JWT>`.
The JWT header uses `HS256` and `typ=JWT`; optional `kid` selects a named key.
Without `kid`, `default` and then `previous` support safe rotation. The payload
must contain the exact configured `sub` and the endpoint-specific claims:

- company endpoints: `companyId`
- `POST /bookings`: `companyId` and `userPhone`
- booking endpoints: `bookingId`
- prebooking endpoints: `companyId` or `prebookingId`

`iat` is rejected because the Yandex beauty specification requires no `iat`.
`exp` and `nbf` are optional but validated when present. `iss` and `aud` are not
part of the base contract; configuring an expected value makes the matching
claim required for that deployment. Other payload
claims are ignored as required by the partner specification.

JSON request bodies are limited to 32 KiB, URLs to 8 KiB, resource filters to
20 unique service IDs, and available-date ranges to 14 days. The current Minuta
booking model accepts exactly one service for availability, conditions, and
booking mutations. First name, last name, and the combined display name are
limited to 80 characters; booking comments are limited to 1,000 characters.
Datetimes must be ISO 8601 with an explicit timezone.

## Routes

The function accepts the official `/v1` routes:

- `GET /v1/companies/feed`
- `GET /v1/companies/{companyId}/services`
- `GET /v1/companies/{companyId}/resources`
- `GET /v1/companies/{companyId}/available_dates`
- `GET /v1/companies/{companyId}/available_time_slots`
- `GET /v1/companies/{companyId}/special_conditions`
- `POST /v1/bookings`
- `GET|PUT|DELETE /v1/bookings/{bookingId}`

Reviews and prebookings are intentionally unsupported until their storage and
privacy contract exists. These optional/conditional routes return 404. Resource
responses therefore must not advertise a positive `reviewsCount`.

The public Yandex documents conflict on cancellation (`DELETE` in OpenAPI,
`PUT status=cancelled` in the launch checklist), so both are supported. The
official `DELETE` response has no declared body schema and is returned as the
JSON object `{}`; the compatible `PUT` form returns the updated booking. The
wire response uses the OpenAPI 1.0 status spelling `not visited`; internal
`not_visited` and `no_show` are mapped to it.

The beauty API does not currently define `Idempotency-Key`. If one is supplied,
it participates in a hashed request identity; otherwise the function derives a
stable key from environment, operation, entity, and canonical payload. Only the
hash is sent to SQL.

After authentication, exact JWT-to-route/body binding, and request validation,
valid requests are rate-limited by a service-role-only RPC. Read operations are
limited separately from mutations for each environment, credential, and tenant
scope. A rejected request returns `429 {"code":"RATE_LIMITED"}` with a bounded
`Retry-After` header and never reaches a booking RPC.

## Database boundary

The adapter reads and mutates booking data only through service-role-only v140
RPCs. It never queries tables directly and never exposes the service key. RPC
responses are converted from the internal envelope to the official Yandex JSON
shape. Semantic errors are mapped to 404, 409, or 422 without exposing database
details.

The implementation can be contract-tested with locally signed JWTs while
disabled in production. Real JWT compatibility, Yandex status webhook details,
organization matching, and the official E2E test remain unverified until Yandex
issues `partnerName` and separate testing/production secrets.

Official sources:

- https://yandex.ru/maps/booking/partners/api/
- https://yandex.ru/support/business-priority/ru/manage/booking-api-partners
