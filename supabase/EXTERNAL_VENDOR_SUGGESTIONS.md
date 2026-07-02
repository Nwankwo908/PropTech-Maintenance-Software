# External vendor suggestions (backend)

When no in-network roster vendor is available (or SLA escalation needs outside help), admins can discover and onboard external vendors without changing the existing vendor assignment workflow.

## Architecture

```
discover-external-vendors (Edge)
  └─ external_vendor/discover.ts
       ├─ providers/google.ts
       ├─ providers/yelp.ts
       └─ providers/mock.ts   ← used when live API keys are absent
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
| `GOOGLE_PLACES_API_KEY` | Google Places Text Search (optional) |
| `YELP_API_KEY` | Yelp Fusion search (optional) |
| `EXTERNAL_VENDOR_SEARCH_LOCATION` | Fallback location when ticket `unit` is not geocodable |
| `EXTERNAL_VENDOR_PROVIDER` | `auto` (default), `mock`, or comma list e.g. `google,yelp` |
| `EXTERNAL_VENDOR_USE_MOCK` | `true` forces mock provider in discover API |

When no live keys are configured, **`mock`** provider returns deterministic suggestions (safe for dev/demo).

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
  "configured": false
}
```

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

## Tests

```bash
deno test supabase/functions/_shared/external_vendor/
```

Covers ranking, mock provider, discover fallback, and external vendor resolve/onboard logic.

## Deploy

```bash
supabase db push   # migration
supabase functions deploy discover-external-vendors
supabase functions deploy reassign-external-vendor
```

Existing **`admin-reassign-vendor`** remains unchanged for in-network reassigns; vendor create path now scopes by ticket `landlord_id`.
