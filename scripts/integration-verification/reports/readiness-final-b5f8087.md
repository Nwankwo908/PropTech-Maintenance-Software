# Readiness evidence — final commit `7a72fbd`

**Decision: NOT PILOT-READY** (core SMS handset YES + type/lint gates still open; rent/Home Checks excluded).

| Field | Value |
| --- | --- |
| Final commit | `7a72fbddcedb036fec7269a77e4f454ecfa69fe4` |
| Evidence suite commit | `b5f80878e1549a2c7c77f7a69849daa8d3457c4f` (journeys + gates); `83d8d88` / `7a72fbd` inventory/test follow-ups |
| Environment | `mzpqwuizhiaczxcnmxbt.supabase.co` |
| Test landlord | Limited Alpha 2 `de300000-0000-4000-8000-000000000004` only |
| Limited Alpha 1 | **Not used** — no sign-in, password reset, record edits, or messages |

## Commits in this readiness pass

| Commit | Summary |
| --- | --- |
| `f46dfe4` | Pilot gates + integration tooling |
| `c0e6feb` | LA2-only emergency/onboarding verifiers + edge `emergency_attention` |
| `b5f8087` | Verifier hardening, blank lease address retain, Ask Ulo period-summary test |

## Gate results (re-run on `b5f8087`)

| Gate | Status | Notes |
| --- | --- | --- |
| Packaging | **passed** | `npm run build` |
| Behavior frontend | **passed** | 1326 / 0 fail |
| Behavior backend | **passed** | 1679 / 0 fail (`--no-check`) |
| Connected workflows | **passed*** | onboarding PG + TZ matrix passed; Home Check SQL **blocked**; browser/live Deno **not_run** |
| Lint | **failed** | ~200 ESLint + ~488 Deno lint errors (pre-existing bulk) |
| Frontend types | **failed** | `tsc` gate red |
| Backend types | **failed** | `deno check` gate red |

\*Connected-workflows script exit 0 with required subchecks passed; optional Home Check remains blocked/excluded.

## Connected journeys (LA2)

| Journey | Success | Failure / recovery | Evidence |
| --- | --- | --- | --- |
| Emergency → property → human alert | **passed** | Idempotent re-notify **passed**; missing-contact invent **passed** (no placeholder) | Live SMS `SMfa3af4…` / `SM94ef6b…` to `…8158`, body “Emergency flooding reported”, `provider_status=delivered`; ticket `issue_type=flooding` on property `02b5ce41…`. Artifact: `.readiness/integration/emergency-alert.json` |
| SMS identity → reply → action | **partial** | Handset YES **not_run** | Outbounds **delivered** (`SM76160c…` vendor, `SM637686…` tenant). `handsetVerified=false` — **no Twilio SM… inbound YES**; inject disabled. Ticket stayed `pending_accept`. Artifact: P3 SMS journey run log |
| Vendor assign → accept → schedule → complete | **passed** (DB path) | Duplicate id **passed**; pest/generalist policy **passed**; pest unassign fixture **partial** (no LA2 generalist row); handset late approval **not_run**; failed-delivery SID probe **not_run** | `verify:maintenance-workflow` + `verify:failure-recovery`. Carrier SMS on this path **not claimed** (non-routable phones). Cross-tenant LA1 login **not_run** by policy |
| Onboarding vs saved records | **passed** | — | LA2 properties/units/residents + `completed_at` |
| Lease imports live | **not_run** | — | No Gemini fixture extract this run |
| Ask Ulo priorities | **partial** | — | Routing suites **passed**; live retrieval **not_run** |
| Rent checkout | **excluded** | — | `pilotGate` + `PILOT_STRICT` / edge gate |
| Home Checks | **excluded** | — | `pilotGate` + start blocked under strict; SQL URL missing |

## What was simulated vs real

| Side effect | Real / simulated |
| --- | --- |
| Emergency attention SMS to LA2 phone `…8158` | **Real** Twilio delivery |
| Vendor/tenant journey outbounds to designated handsets | **Real** Twilio delivery |
| Vendor YES from physical handset | **Not observed** — must not be counted as passed |
| Maintenance assign→complete statuses | **Real DB** on LA2; SMS notify skipped (non-routable) |
| Injected `processInboundSms("YES")` | **Not used** in strict SMS journey |

## Remaining blockers for pilot-ready

1. Handset YES (and late/duplicate reply) on designated vendor phone → durable `accepted` + Twilio inbound SID.
2. Frontend/backend type gates and lint volume.
3. Rent ledger + Home Checks connected proof before un-excluding.
4. Ask Ulo live retrieval + lease import live extract.
5. Optional: failed-delivery recovery with intentional undelivered SIDs.

## Commands used

```bash
npm run verify:configure-test-access   # --la2-only
INTEGRATION_EMERGENCY_SEND_LIVE=1 npm run verify:emergency-alert
INTEGRATION_SMS_INJECT_YES=0 npm run verify:sms-journey
npm run verify:maintenance-workflow
npm run verify:failure-recovery
npm run verify:onboarding-askulo
npm run check:packaging
npm run check:behavior-frontend
npm run check:behavior-backend
npm run check:connected-workflows
npm run check:lint
npm run check:frontend-types
npm run check:backend-types
```
