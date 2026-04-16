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
| `ADMIN_REASSIGN_SECRET` | For `admin-reassign-vendor` only | Long random string; client sends `Authorization: Bearer <same value>` (prefer server-side caller or lock down admin UI in production). |

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

- **Header:** `Authorization: Bearer <ADMIN_REASSIGN_SECRET>` (must match the Edge secret).
- **Body (JSON):** `ticketId` (uuid) and either `vendorId` (uuid) or `vendorName` (must match one active `vendors.name`, case-insensitive).

```bash
curl -sS "$URL/admin-reassign-vendor" \
  -H "Authorization: Bearer $ADMIN_REASSIGN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"<ticket_uuid>","vendorName":"ABC Maintenance Co."}'
```

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
```

## Frontend (Vite)

Optional env vars (see [`src/vite-env.d.ts`](../src/vite-env.d.ts)):

- `VITE_VENDOR_PORTAL_LIST_URL` — full URL to `vendor-list-tickets`
- `VITE_VENDOR_PORTAL_UPDATE_URL` — optional; defaults to same host with `vendor-update-job-status` instead of `vendor-list-tickets`
- `VITE_ADMIN_REASSIGN_URL` — full URL to `admin-reassign-vendor`; with `VITE_ADMIN_REASSIGN_SECRET` (same value as `ADMIN_REASSIGN_SECRET`), the admin dashboard persists vendor overrides when each row’s `backendTicketId` or `id` is a real ticket UUID (**sensitive**)

Deep link from notify: `/vendor?t=<ticketId>&k=<token>` opens the detail rail after the list loads and allows updates using the URL token when the action applies to that ticket.

If list/update env vars are unset, the portal uses demo kanban data only.
