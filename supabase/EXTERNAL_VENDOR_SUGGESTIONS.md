# External vendor suggestions (backend)

When no in-network roster vendor is available (or SLA escalation needs outside help), admins can discover and onboard external vendors without changing the existing vendor assignment workflow.

## Architecture

```
discover-external-vendors (Edge)
  └─ external_vendor/discover.ts
       ├─ providers/thumbtack.ts  ← Thumbtack Partner Platform businesses search
       └─ providers/mock.ts   ← used when Thumbtack credentials are absent
       └─ ranking.ts          ← dedupe + rankScore

reassign-external-vendor (Edge)
  └─ external_vendor/reassign_external.ts
       ├─ resolveVendorIdForExternalReassign (onboard to roster)
       └─ reassignVendorByIdAndNotify (existing pipeline)
       └─ logGraphEvent maintenance.external_vendor_reassigned
```

In-network roster suggestions remain on **`recommend-vendor-alternatives`** (OpenAI / category fallback). External discovery is a separate path and does not replace SLA auto-reassign or vendor portal flows.

## Migration

`20260615200000_external_vendor_discovery.sql` adds to `public.vendors`:

| Column | Purpose |
|--------|---------|
| `onboarded_from_external` | `true` when created from an external suggestion |
| `external_discovery` | JSON snapshot: `sources`, `rating`, `review_count`, `price_label`, `rank_score` |

## Edge secrets

| Secret | Purpose |
|--------|---------|
| `ADMIN_REASSIGN_SECRET` | Auth for both functions (`x-admin-reassign-secret`) |
| `THUMBTACK_CLIENT_ID` | Thumbtack Partner Platform OAuth client ID |
| `THUMBTACK_CLIENT_SECRET` | Thumbtack Partner Platform OAuth client secret |
| `THUMBTACK_API_BASE_URL` | Optional API host (default `https://api.thumbtack.com/api`) |
| `THUMBTACK_TOKEN_URL` | Optional token URL (default `https://auth.thumbtack.com/oauth2/token`) |
| `THUMBTACK_OAUTH_SCOPE` | Optional. Default includes search **and** messaging (`requests.write`, negotiations). Search-only tokens return 401 when opening a conversation. |
| `THUMBTACK_UTM_SOURCE` | Optional `utm_source` on search (must be `cma-…`; default `cma-ulo`) |
| `EXTERNAL_VENDOR_SEARCH_LOCATION` | Fallback geocode anchor when property address cannot be resolved |
| `EXTERNAL_VENDOR_PROVIDER` | `auto` (default), `mock`, or `thumbtack` |
| `EXTERNAL_VENDOR_USE_MOCK` | `true` forces mock provider in discover API |

When no live Thumbtack credentials are configured, **`mock`** provider returns deterministic suggestions (safe for demo accounts). Alpha production never receives mock vendors.

### Thumbtack Partner Platform

Demand-side **client credentials** OAuth against `urn:partner-api`, then:

1. `POST /v4/businesses/search-filtered` with ticket wording, trade, ZIP, and `projectMetadata.radiusMiles` (50)
2. Fill remaining slots with `POST /v4/businesses/search` (`searchQuery` + ZIP), up to 10 unique businesses
3. Optional matched `categoryID` only — never an unmatched first category

ZIP is taken from the resolved property search location. Pros with Thumbtack license verification are treated as provider-verified for Find External Vendor compliance; others still go through the state board + Certificial path.

## APIs

### POST `discover-external-vendors`

Auth: same as `admin-reassign-vendor`.

```json
{ "ticketId": "<uuid>", "limit": 8, "useMock": false }
```

Response:

```json
{
  "ticketId": "...",
  "suggestions": [
    {
      "name": "Rapid Plumb Co.",
      "rating": 4.9,
      "reviewCount": 218,
      "priceLabel": "$$ · Moderate",
      "sources": ["mock"],
      "rankScore": 12.4,
      "etaMinutes": 18
    }
  ],
  "providersUsed": ["mock"],
  "mode": "mock",
  "configured": false,
  "searchLocation": "901 Maple Heights Blvd, Hillsboro, OR 97123",
  "locationLabel": "Maple Heights · Unit 207",
  "issueCategory": "plumbing"
}
```

**Location resolution:** loads the ticket from `maintenance_request_enriched` (building + unit), then resolves a geocodable `searchLocation` from landlord onboarding property addresses, demo portfolio building addresses, or `EXTERNAL_VENDOR_SEARCH_LOCATION`. Issue category is normalized (`water_damage` → `plumbing`, etc.) before provider search.

Ticket load uses `maintenance_requests.landlord_id`; roster vendor names for that landlord are excluded from suggestions.

### POST `reassign-external-vendor`

Onboards the external vendor onto the landlord roster (if needed) and reassigns via **`reassignVendorByIdAndNotify`**.

```json
{
  "ticketId": "<uuid>",
  "vendorName": "Rapid Plumb Co.",
  "sources": ["mock"],
  "rating": 4.9,
  "reviewCount": 218,
  "rankScore": 12.4,
  "vendorCategory": "plumbing"
}
```

Response:

```json
{
  "ok": true,
  "ticketId": "...",
  "assigned_vendor_id": "...",
  "createdVendor": true
}
```

Graph event: `maintenance.external_vendor_reassigned`.

### POST / GET `message-thumbtack-vendor`

Opens or reuses the Thumbtack **negotiation** for a search hit, then:

`POST /api/v4/negotiations/{negotiationID}/messages` with `{ "text": "..." }`.

Uses the stored OAuth access token on the Edge Function (never in the browser). First send may `POST /v4/requests` with `searchID` + `businessIDs` to mint the lead.

Auth: same as discover (`ADMIN_REASSIGN_SECRET`).

### POST `thumbtack-webhook`

Demand-side `MessageCreatedV4` ingest. Set `THUMBTACK_WEBHOOK_SECRET` (Bearer or `x-thumbtack-webhook-secret`) or Basic `THUMBTACK_WEBHOOK_USER` / `THUMBTACK_WEBHOOK_PASSWORD`. Attaches the reply to `thumbtack_vendor_threads`, logs `vendor.thumbtack_replied`, and notifies the landlord.

## Tests

```bash
deno test supabase/functions/_shared/external_vendor/
```

Covers ranking, mock provider, Thumbtack payload mapping, discover fallback, and external vendor resolve/onboard logic.

## Deploy

```bash
supabase db push   # migration
supabase functions deploy discover-external-vendors
supabase functions deploy message-thumbtack-vendor
supabase functions deploy thumbtack-webhook
supabase functions deploy reassign-external-vendor
```

Also `supabase db push` for `thumbtack_vendor_threads`.

Existing **`admin-reassign-vendor`** remains unchanged for in-network reassigns; vendor create path now scopes by ticket `landlord_id`.
