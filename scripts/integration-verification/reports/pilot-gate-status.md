# Pilot gate status (coding-task evidence)

**Decision: NOT PILOT-READY** — landlord handset **approvals** still unverified; lease / Ask Ulo / Home Checks remain open verification work (not scoped out).

| Field | Value |
| --- | --- |
| Generated | 2026-10-22 |
| Note | LA1 unused. Only rent/payments is authorized hard-excluded for this pilot. |

## Core-safety inventory (`shared/pilotGate.ts`)

| Workflow | Status | Notes |
|---|---|---|
| Emergency → human alert | **verified** | Prior LA2 live flooding SMS |
| SMS identity → action | **verified** | Fresh handset YES …3069 → LA2 |
| Vendor assignment | **verified** | Handset YES + schedule …0274; ticket accepted |
| Approvals | **unknown** | Still open — inject-only late approval; no Twilio APPROVE inbound |
| Rent & payments | **excluded** + **hardDisable** | Authorized pilot exclusion; checkout/invoice pay refuse |

## Open verification (not excluded from product)

| Workflow | Status |
|---|---|
| Lease imports | **unknown** — complete and verify |
| Ask ULO priorities | **unknown** — complete and verify |
| Home Checks | **unknown** — complete and verify (not hard-disabled) |

## Still required before pilot-ready

1. Prove landlord estimate **APPROVE/DECLINE** from a real handset (Twilio SM… inbound).
2. Close verification for lease imports, Ask Ulo priorities, and Home Checks (do not scope them out).
3. Keep rent/payments disabled for Limited Alpha pilot (authorized).
4. Do not treat UNKNOWN as passed.
