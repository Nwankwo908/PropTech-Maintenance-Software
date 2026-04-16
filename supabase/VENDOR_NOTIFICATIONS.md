# Vendor email/SMS on new maintenance tickets

When a resident submits a maintenance request through the `submit-maintenance-request` Edge Function, the function assigns an active vendor (`vendors` table) and sends **email** and/or **SMS** with **priority** (resident “urgency” level), **unit/location**, and **description**. Delivery uses **Resend** and **Twilio**; API keys must never be exposed to the browser.

## Resident lifecycle (email + SMS)

The same **Resend** and **Twilio** secrets notify the **submitter** (resident) on: ticket received (after optional media uploads); vendor assigned (including after admin reassign via `reassignVendorByIdAndNotify`); repair **in progress**; repair **completed** (`vendor-update-job-status`). **`resident_notification_channel`** on `maintenance_requests` is **`email`**, **`sms`**, or **`both`** (default `both`; set from multipart `residentNotificationChannel`). Per channel: **email** sends Resend only; **sms** sends Twilio only when **`resident_phone`** is valid; **both** sends email and SMS when possible. Missing phone on **both** / **sms** logs a skipped SMS row. Attempts are logged in **`resident_notification_log`**.

## Database

1. Apply migrations (includes `vendors`, `vendor_notification_log`, and columns on `maintenance_requests`).
2. Insert at least one **active** vendor. See [`seed_demo_vendor.sql`](seed_demo_vendor.sql) for an example.

Vendor selection order (see `supabase/functions/_shared/vendor_assignment.ts`):

1. **Specialists** whose normalized `vendors.category` matches the ticket’s `issue_category` (appliance / plumbing / electrical; substring normalization).
2. If none, **generalists** (`category` is null or empty).
3. If still none, **any active vendor** (last resort), ranked by low active job count and fairness.

If no vendor exists, the ticket is still created; assignment and notify are skipped (check logs).

## Edge Function secrets

Configure in the Supabase Dashboard: **Project Settings → Edge Functions → Secrets** (or CLI `supabase secrets set`).

| Secret | Required when | Purpose |
|--------|----------------|---------|
| `RESEND_API_KEY` | Sending email | Resend API |
| `RESEND_FROM_EMAIL` | Sending email | Verified sender domain in Resend |
| `TWILIO_ACCOUNT_SID` | Sending SMS | Twilio account |
| `TWILIO_AUTH_TOKEN` | Sending SMS | Twilio auth |
| `TWILIO_FROM_NUMBER` | Sending SMS | E.164 sender, e.g. `+15551234567` |
| `VENDOR_PORTAL_BASE_URL` | Optional | Legacy fallback: origin parsed for links if `APP_URL` is unset |
| `APP_URL` | Recommended | Public site origin for vendor links, e.g. `https://app.example.com` (no trailing slash). Used for **Vendor portal**, **View job** (`/vendor`, `/vendor/ticket/:id?k=…`), and redirects from **`vendor-respond`**. |
| `VENDOR_EMAIL_ACTION_SECRET` | Recommended | Long random string (32+ chars). HMAC secret for **Accept job** / **Decline job** links handled by **`vendor-respond`**. Without it, emails still send **View job** but not signed action buttons. |
| `VENDOR_RESPOND_FN_URL` | Optional | Override URL for email action links; default is `${SUPABASE_URL}/functions/v1/vendor-respond`. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to Edge Functions.

Deploy **`vendor-respond`** after setting secrets: `supabase functions deploy vendor-respond`

Assignment sets **`vendor_action_token`** and resets **`vendor_work_status`** to `pending_accept`. Portal APIs and env vars are documented in [`VENDOR_PORTAL.md`](VENDOR_PORTAL.md).

### Vendor links and `localhost`

Emails use **`APP_URL`** for **Vendor portal** and **View job** (`/vendor`, `/vendor/ticket/:id?k=…`). If those links “do not open” or load the wrong device:

- **Port must match the command you run (common “can’t be reached” cause):**
  - **`npm run dev`** serves on **5173** by default. Use `APP_URL=http://localhost:5173` (or the **Network** URL with **:5173**).
  - **`npm run preview`** (after `npm run build`) serves on **4173** by default. Use `APP_URL=http://localhost:4173` (or **Network** with **:4173**).
  - If **`APP_URL` uses 4173** but only **`npm run dev`** is running (5173), **nothing listens on 4173** → browser shows “can’t be reached” / connection refused. Either start preview on 4173 or change **`APP_URL`** to **5173** and redeploy secrets / trigger a new email.
- **`localhost` / `127.0.0.1` only refer to the machine where the browser is running.** A link to `http://localhost:4173/vendor` opened on a **phone** tries to load a server on the phone, not your Mac. Many **webmail apps also block or strip `localhost` links** for security, so the URL may not be clickable.
- **Same machine:** Keep the matching dev or preview server running, then open the same origin Vite prints. If the link still fails in Gmail/Outlook, **copy the URL** from the email and paste it into the browser address bar.
- **Another device on your Wi‑Fi:** Set Edge secret **`APP_URL`** to your computer’s **LAN origin** (the **Network** line in the terminal, correct **port**), not `http://localhost:…`.
- **Avoid** `vite preview --host localhost` if you need the **Network** URL from another device — that binds loopback only; use `npm run preview` (uses `vite.config.ts` **`host: true`**) or pass `--host`.
- **Stable testing from anywhere:** Use a tunnel (ngrok, Cloudflare Tunnel, etc.) and set **`APP_URL`** to the public `https://…` origin.
- **Production:** Use your real deployed origin, e.g. `https://app.example.com` (no trailing slash).

## Vendor `notification_channel`

- `email` — Resend only
- `sms` — Twilio only  
- `both` — both (if `email`/`phone` missing on the row, that channel logs an error; ticket creation still succeeds)

## Audit

Table `vendor_notification_log` stores one row per channel attempt with `provider_message_id` or `error`.

`maintenance_requests.vendor_notified_at` is set when the notify step finishes (including partial failures). `vendor_notify_error` holds a short summary if any channel failed.

## Local testing

```bash
supabase start
supabase db reset   # or migrate + run seed_demo_vendor.sql
supabase secrets set RESEND_API_KEY=re_... RESEND_FROM_EMAIL=notify@yourdomain.com
# ... Twilio secrets if testing SMS
supabase functions serve submit-maintenance-request --no-verify-jwt
```

POST multipart to the local function URL with the same fields as production.

### Resident lifecycle (verification)

- Include optional `residentPhone` and `residentNotificationChannel` (`email` \| `sms` \| `both`) in multipart when testing SMS.
- After submit: check **`resident_notification_log`** for `ticket_submitted` rows (email and/or sms per channel).
- After vendor assignment: log rows for `vendor_assigned` (also fired from **`reassignVendorByIdAndNotify`** when using **`admin-reassign-vendor`**).
- Use **`vendor-update-job-status`** with a valid bearer or ticket token: transitions to **`in_progress`** / **`completed`** should add `repair_in_progress` / `repair_completed` log rows.
