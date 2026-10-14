# Home Check

Property Intelligence → **Scan property equipment** starts a baseline for the water heater and heating system. Roof, electrical and plumbing information can still be added through inspection documents; it is not part of the four-photo Home Check.

The landlord chooses an exact property and, for tenant equipment, an exact unit. **Ask my tenant**, **Send to my contractor**, and **I'll do it** issue the same `/c/:checkId` page. The server fixes the recipient role and scope; changing a URL query parameter cannot change them.

## Capture and evidence

1. Water heater model/serial label.
2. Whole water heater, including the base for leaks or rust.
3. Furnace or boiler model/serial label.
4. Whole furnace or boiler.
5. Leaks, odd noises or smells: yes/no, with optional details.
6. Last service for each system and last heating filter change, if known.

Four **distinct slots** complete the proactive ticket and shared `home_check` workflow. Label readability and landlord confirmation are separate outcomes. Private inspection storage holds the photos. Each system is read only after its whole-equipment photo and label close-up arrive, using Gemini 3.8 Flash with gpt-4o-mini as the backup for difficult labels. See [equipment vision configuration](EQUIPMENT_VISION.md). Label text supplies make/model/serial and estimated age; whole-system photos supply visible condition. A wrong-system or unreadable label leaves fields unknown. Each asset field carries source, participant role, confidence and photo references. Serial-derived ages always remain estimates. Service dates from unscoped SMS notes are retained as notes rather than assigned to both systems.

Both asset records remain unverified until the landlord confirms in Property Intelligence or replies to a result SMS. The authenticated dashboard shows signed photo previews; public capture links show only their location, role and progress. Results and capture copy do not use “AI”. A reported warning or a significant photo warning opens one linked reactive ticket, without assigning or authorizing repair work. Approved-job conversion uses approved estimates or recognized spend on that follow-up ticket.

## SMS

- Landlords and authorized property managers/team members can initiate from their registered account/team phone number. Existing phone authorization uses the landlord account phone, onboarding account/backup/team contacts, and canonical `properties.manager_phone` records. Unregistered, revoked, tenant and vendor senders cannot initiate inspections.
- `INSPECT Property / Unit`: send the self-capture link to the person who initiated the inspection, including an authorized manager/team member. `INSPECTION`, `HOME CHECK`, and `START AN INSPECTION FOR Property / Unit` also work. `INSPECT` on its own returns scoped property/unit and recipient instructions without creating a check.
- `INSPECT TENANT Property / Unit`: explicitly ask the tenant. `INSPECT CONTRACTOR Property / Unit | <ISO job-window-end>` selects the closest located active contractor. An ambiguous unit label asks for the property; no check or invitation is created until the target is exact. `INSPECT SELF Property / Unit` explicitly selects self-capture.
- `CHECK 12A`: landlord-authorized tenant request. Duplicate unit labels require `CHECK Property / Unit` or `CHECK Street address / Unit`.
- `CHECK SELF Property / Unit`: landlord capture link.
- `CHECK CONTRACTOR Property / Unit | <ISO job-window-end>`: select the closest active contractor with known exact coordinates. The window must end within seven days. The dashboard also supports manually choosing a contractor or texting the landlord a link to forward.
- A recipient sends **one image per message** with the exact reference and slot, e.g. `HC-AABBCCDDEEFF 2`. Images without both remain in the SMS conversation and prompt clarification; they are not assigned to a property by recency. Shared-number routing also checks the assigned phone and receiving Ulo line before selecting the landlord account.
- Observations: `HC-AABBCCDDEEFF ANSWERS YES | last service notes | last filter change | warning details`. Use `NO` when none are reported; leave unknown dates blank.
- Confirmation: `OK HC-AABBCCDDEEFF`. Bare `OK` works only with one completed, previously sent landlord result.

Tenant requests require one clearly identified active occupancy and a usable phone number. Opted-out tenants are not texted. The landlord's request authorizes the invitation; the interface suggests a heads-up first. The existing ops cron attempts one reminder after 48 hours, only while photos are incomplete, then stops. An atomic claim prevents overlapping cron runs or a provider timeout from sending another reminder.

The nearest-contractor calculation uses WGS84 `properties.latitude/longitude` and `vendors.latitude/longitude`, and reports straight-line distance. It excludes inactive, suspended and banned vendors. City names are not treated as exact locations. If no reliable locations are available, automatic routing asks the landlord to select a contractor in Property Intelligence. This identifies the closest **located** contractor, not verified travel time or availability.

## Deploy

These changes are implemented locally; live Supabase, provider extraction and SMS delivery were not exercised in this cloud environment. Apply both `20261013120000_home_checks.sql` and `20261013130000_home_check_label_review.sql` **before** deploying the functions. The second migration prevents premature confirmation and records landlord label corrections.

From the linked project checkout:

```sh
supabase db push
supabase functions deploy home-check
supabase functions deploy inspection-asset-assess
supabase functions deploy sms-inbound
supabase functions deploy run-ops-sms-crons
npm run build
```

Publish the frontend through the existing Vercel deployment workflow. Its SPA rewrite already serves `/c/:checkId`. `home-check` has gateway JWT verification disabled to allow upload capabilities; landlord actions explicitly validate the signed-in session and account access, while public actions require the hashed, scoped, unexpired token. Public RPC execution is revoked; only the service role can call the write functions.

Use existing environment bindings and secure provider settings:

- Frontend: `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_ANON_KEY`.
- Edge runtime: the existing Supabase service-role binding and anon key, existing Twilio configuration, and `GEMINI_API_KEY` and `OPENAI_API_KEY` for the equipment-photo backup. Provider keys belong in Edge secrets, never frontend variables.
- `APP_URL`: HTTPS on `ulohome.io` or a Ulo subdomain. Capture links use a token fragment, not a public shortener. Tokens are hashed in the database and never saved in the reusable setup script.
- An active landlord SMS line, or the existing supported shared Alpha line; correct occupancy and recipient phone data; exact coordinates for automatic nearest-contractor selection.
- The existing authenticated hourly `run-ops-sms-crons` schedule. No second cron or extra tenant reminder workflow is introduced.

Links expire after seven days; contractor links expire at the job-window end. Confirmation closes uploads. Captures audit every accepted upload. Ticket/check creation, distinct-slot completion, follow-up creation and confirmation are transactional; asset persistence compares photo IDs under a row lock so slow requests cannot overwrite newer evidence or confirmed records.

## Verify

```sh
npx vitest run --config scripts/vitest.home-check.config.ts
npx vitest run --config scripts/vitest.equipment-vision.config.ts
npm run build
```

The focused suite covers scope ambiguity, source/confidence, estimated ages, completion, exact MMS routing, confirmation, the single-reminder claim, distance ranking and participant metrics. `supabase/tests/home_check.sql` checks the actual PostgreSQL functions in a rollback transaction. Run it only in an isolated test database with the migration applied and no outbound workers. It passed locally using PostgreSQL 17 and a minimal prerequisite schema fixture; a full production migration rehearsal remains unrun.

The browser smoke uses mocked API responses and a clearly labeled local fixture key, sends no SMS, and does not invoke a vision provider. Install Playwright outside the checkout to leave dependency declarations unchanged:

```sh
npm --cache /workspace/.npm-cache install --prefix /workspace/.home-check-tools --no-package-lock playwright@1.58.2
VITE_SUPABASE_URL=http://127.0.0.1:55432 VITE_SUPABASE_ANON_KEY=sb_publishable_home_check_browser_fixture npm run dev -- --port 5180
# In another shell:
HOME_CHECK_BROWSER_DRIVER=/workspace/.home-check-tools/node_modules/playwright/index.mjs node scripts/test-home-check-browser.mjs
```

The browser check covers all three initiation choices, closest-contractor selection, property/unit reset, all three capture roles, four uploads, label retakes, ambiguous characters, landlord corrections, warning observations and expired links. Its temporary harness is removed afterward. The outcome table in Property Intelligence reports sent → opened → completed → readable labels → confirmed, average completion time, issues surfaced per completed check, and approved jobs per issue, separately for tenant, contractor and landlord.

The repository-wide unit suite still has the six failures seen before these changes. Broad TypeScript/Edge checks also encounter existing dependency/type errors outside Home Check. These checks are not reported as passing.
