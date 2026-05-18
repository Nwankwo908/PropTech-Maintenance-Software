# Vendor portal API and ticket status

Vendors can list assigned tickets and update **`maintenance_requests.vendor_work_status`** via Edge Functions. Values are the source of truth for the kanban board in [`VendorPortalDashboard`](../src/components/VendorPortalDashboard.tsx). See also [`VENDOR_NOTIFICATIONS.md`](VENDOR_NOTIFICATIONS.md) for assignment and email/SMS.

## Database

Applied in migration `20260331140000_vendor_work_status.sql`:

| Object | Purpose |
|--------|---------|
| `maintenance_requests.vendor_work_status` | `pending_accept` → `accepted` → `in_progress` → `completed` |
| `maintenance_requests.vendor_action_token` | Per-ticket UUID for deep links and token-only POSTs |
| `vendors.auth_user_id` | Links a vendor row to a Supabase Auth user (used for vendor portal JWT auth) |
| `vendor_status_events` | Audit: `ticket_id`, `from_status`, `to_status`, `source` (`portal` \| `email_link` \| `edge`) |

Admin override of assignment uses the same notify pipeline with a new `vendor_action_token` and sets `vendor_work_status` back to `pending_accept` (see **`admin-reassign-vendor`** below).

`vendors.portal_api_key` is deprecated (kept for backward compatibility / rotation history) and is no longer used by the vendor portal.

## Edge Function secrets

| Secret | Required | Purpose |
|--------|----------|---------|
| `SUPABASE_URL` | Auto | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Service role for DB access |
| `VENDOR_PORTAL_BASE_URL` | Recommended on assign notify | e.g. `https://yourapp.com/vendor` — appended to email/SMS as `?t=<ticketId>&k=<token>` |
| `ADMIN_REASSIGN_SECRET` | For `admin-reassign-vendor` and `recommend-vendor-alternatives` | Long random string; admin UI sends `x-admin-reassign-secret: <same value>` plus anon `Authorization`/`apikey` when `VITE_SUPABASE_ANON_KEY` is set (treat as sensitive). |
| `OPENAI_API_KEY` | Optional on `recommend-vendor-alternatives` | When set, ranks category-matched vendors with GPT-4o-mini; otherwise the function returns the first N matches alphabetically (`mode: "fallback"`). |

## Functions

Registered in [`config.toml`](config.toml) with **`verify_jwt = false`**; handlers validate the `Authorization` JWT via `auth.getUser(accessToken)` (avoids edge proxy JWT timing issues).

### `vendor-list-tickets` (GET)

- **Header:** `Authorization: Bearer <Supabase session access_token>`
- **Response:** `{ "vendor": { "id", "name" }, "tickets": [ ... ] }`

### `vendor-update-job-status` (POST)

JSON body:

```json
{
  "ticketId": "<uuid>",
  "action": "accept | in_progress | completed",
  "token": "<optional vendor_action_token>"
}
```

**Auth (one of):**

1. `Authorization: Bearer <Supabase session access_token>` and the ticket’s `assigned_vendor_id` matches that vendor, or  
2. `token` in the body equals `maintenance_requests.vendor_action_token` for that ticket (no Bearer required).

**Transitions (409 if invalid):**

| `action` | From | To |
|----------|------|-----|
| `accept` | `pending_accept` | `accepted` |
| `in_progress` | `pending_accept` or `accepted` | `in_progress` |
| `completed` | `in_progress` | `completed` |

### `admin-reassign-vendor` (POST)

Reassigns `maintenance_requests.assigned_vendor_id`, rotates `vendor_action_token`, sets `vendor_work_status` to `pending_accept`, clears prior notify timestamps, sends email/SMS to the **new** vendor (same templates as create-time assign), and inserts `vendor_status_events` (`source`: `edge`).

- **Auth:** `x-admin-reassign-secret: <ADMIN_REASSIGN_SECRET>` (required from browsers; matches Edge secret). Also send `apikey` + `Authorization: Bearer <anon JWT>` like other Supabase Functions (the app does this when `VITE_SUPABASE_ANON_KEY` is set). Legacy: `Authorization: Bearer <ADMIN_REASSIGN_SECRET>` only (e.g. curl against local `supabase functions serve`).
- **CORS:** Handlers respond to `OPTIONS` with `Access-Control-Allow-Headers: *` (no credentials) so browser preflight matches; if you still see “Failed to fetch”, check a failed **OPTIONS** row in Network or a **host typo** in `VITE_ADMIN_REASSIGN_URL` vs `VITE_SUPABASE_URL`.
- **Body (JSON):** `ticketId` (uuid) and either **`vendorId`** (uuid, preferred) or **`vendorName`** (must match one active `vendors.name`, case-insensitive). If both are sent, **`vendorId`** wins.

```bash
curl -sS "$URL/admin-reassign-vendor" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "x-admin-reassign-secret: $ADMIN_REASSIGN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"<ticket_uuid>","vendorId":"<vendor_uuid>"}'
```

### `recommend-vendor-alternatives` (POST)

Used by **Vendor delayed → Alternative recommendations** in the admin Request Management accordion (`VendorDelayedAlternativesSection`). Returns active vendors in the ticket’s issue category (excluding the current assignee), ranked by OpenAI when `OPENAI_API_KEY` is set on the function.

**Requirements**

- Ticket `id` = uuid, `vendor_work_status` = `pending_accept` (otherwise **400**).
- Deploy: `supabase functions deploy recommend-vendor-alternatives`
- Same **`ADMIN_REASSIGN_SECRET`** as `admin-reassign-vendor` (Vite: `VITE_ADMIN_REASSIGN_SECRET`). Optional `VITE_VENDOR_RECOMMEND_URL`; if unset, the app uses `${VITE_SUPABASE_URL}/functions/v1/recommend-vendor-alternatives`.

- **Auth:** Same as `admin-reassign-vendor` (`x-admin-reassign-secret` + anon `Authorization`/`apikey` from the browser).
- **Body (JSON):** `ticketId` (uuid), optional `limit` (1–10, default **3**).
- **Response:** `{ "ticketId", "alternatives": [{ "id", "name" }, ...], "mode": "openai" | "fallback" }`

```bash
curl -sS "$URL/recommend-vendor-alternatives" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "x-admin-reassign-secret: $ADMIN_REASSIGN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"<ticket_uuid>","limit":3}'
```

Selecting a candidate still calls **`admin-reassign-vendor`** (see `VITE_ADMIN_REASSIGN_URL`).

## curl examples

Replace placeholders with your project ref and secrets.

```bash
export URL="https://<project-ref>.supabase.co/functions/v1"

curl -sS "$URL/vendor-list-tickets" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

curl -sS "$URL/vendor-update-job-status" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"<ticket_uuid>","action":"accept"}'

curl -sS "$URL/vendor-update-job-status" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"<ticket_uuid>","action":"in_progress","token":"<vendor_action_token>"}'

curl -sS "$URL/recommend-vendor-alternatives" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "x-admin-reassign-secret: $ADMIN_REASSIGN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"<ticket_uuid>","limit":3}'
```

## Frontend (Vite)

Optional env vars (see [`src/vite-env.d.ts`](../src/vite-env.d.ts)):

- `VITE_VENDOR_PORTAL_LIST_URL` — full URL to `vendor-list-tickets`
- `VITE_VENDOR_PORTAL_UPDATE_URL` — optional; defaults to same host with `vendor-update-job-status` instead of `vendor-list-tickets`
- `VITE_ADMIN_REASSIGN_URL` — full URL to `admin-reassign-vendor`; with `VITE_ADMIN_REASSIGN_SECRET` (same value as `ADMIN_REASSIGN_SECRET`), the admin dashboard persists vendor overrides when each row’s `backendTicketId` or `id` is a real ticket UUID (**sensitive**)
- `VITE_VENDOR_RECOMMEND_URL` — optional full URL to `recommend-vendor-alternatives`; if omitted, defaults from `VITE_SUPABASE_URL` as above (**same secret** as admin reassign)

Deep link from notify: `/vendor?t=<ticketId>&k=<token>` opens the detail rail after the list loads and allows updates using the URL token when the action applies to that ticket.

If list/update env vars are unset, the portal uses demo kanban data only.
