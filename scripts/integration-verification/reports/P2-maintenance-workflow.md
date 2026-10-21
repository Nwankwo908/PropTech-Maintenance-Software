# P2 — Complete maintenance workflow

**Environment:** hosted Supabase `mzpqwuizhiaczxcnmxbt`  
**Landlord:** Limited Alpha 2 only (`123 Main` + integration fixtures)  
**Date:** 2026-10-21

## Result: **passed** (with explicit SMS boundary)

| Step | Status | Evidence |
| --- | --- | --- |
| Integration resident + Active overridden vendor (non-routable phones) | passed | `+15555550101` / `+15555550102` |
| Photo upload to `maintenance-uploads` | passed | path under LA2/ticket |
| Ticket FKs (property, unit, resident) | passed | |
| Vendor assigned pending_accept | passed | |
| Accept → schedule window → in_progress → completed | passed | |
| LA2 landlord sees completed + photos | passed | session query |
| Resident link + final status | passed | |
| LA1 cannot read LA2 ticket | passed | |
| Duplicate id insert rejected | passed | |
| Carrier SMS to vendor/resident | **not_run** | Intentionally skipped — no real-customer SMS |

Evidence: `.readiness/integration/P2-maintenance-workflow.json`

## Boundaries

This proves **records, recipients (assignment), and status progression** on designated test fixtures. It does **not** claim Twilio/Telnyx delivery to a handset. Run a separate provider-sandbox SMS probe when a dedicated test handset is approved.
