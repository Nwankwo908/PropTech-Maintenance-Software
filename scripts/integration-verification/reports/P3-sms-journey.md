# P3 — SMS journey (designated LA2 test phones)

**Status:** partial  
**Finished:** 2026-10-21  
**Environment:** `mzpqwuizhiaczxcnmxbt.supabase.co`  
**Landlord:** Limited Alpha 2 `de300000-0000-4000-8000-000000000004`

## What is verified

| Claim | Status | Evidence |
| --- | --- | --- |
| Vendor outbound reached handset (carrier) | **passed** | Twilio + DB `delivered` — `SMd169759b0aa77640d31d00b909d36501` → `+19737358072` |
| Tenant outbound reached handset (carrier) | **passed** | Twilio + DB `delivered` — `SM77bbadba422adf3b909c4ca84086557b` → `+15715028158` |
| Prior run outbounds delivered | **passed** | `SM18bff5…` + `SM8b3a31…` both `delivered` via Twilio API `check_delivery` |
| Vendor YES from physical phone → Ulo inbound | **unverified** | No Twilio `SM…` inbound YES in 120s edge wait + 180s client poll (ticket stayed `pending_accept`) |

Carrier `delivered` is Twilio’s terminal success for “accepted by the destination carrier / handset.” It is not a person reading the SMS, but it is stronger than `queued`/`sent`.

## What is not verified

1. **Handset reply path** — someone must text **YES** from `+19737358072` to `+18775803356` while a pending vendor assignment is open. Injected `processInboundSms("YES")` does **not** count (earlier run used `integration-…` MessageSid).
2. After a real handset YES: ticket → `accepted` with that inbound row’s Twilio SID recorded.

## Open ticket awaiting handset YES

| Field | Value |
| --- | --- |
| Ticket | `ed07c738-24cd-443a-954a-70d1227f2e9d` |
| Vendor convo | `2467e2b5-ee9c-4eea-ade0-4085da8b5846` |
| Status | `pending_accept` |
| Action | From `+19737358072`, reply **YES** to `+18775803356` |

Then re-check:

```bash
# or re-run full strict journey after YES is possible
INTEGRATION_SMS_INJECT_YES=0 npm run verify:sms-journey
```

## Machine artifacts

- `.readiness/integration/P3-sms-journey.json` — latest strict run  
- `.readiness/integration/P3-sms-delivery-check.json` — prior SID delivery check  

## Scope / phones

| Role | Phone |
| --- | --- |
| Tenant | `+15715028158` |
| Vendor handset | `+19737358072` |
| Ulo line | `+18775803356` |

Edge function `integration-sms-journey` refuses any other numbers. Full `ok` requires **delivered** outbounds **and** handset YES (`SM…` sid, not inject).
