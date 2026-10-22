# Pilot gate status (coding-task evidence)

**Decision: NOT PILOT-READY** — landlord handset **approvals** still unverified.

| Field | Value |
| --- | --- |
| Generated | 2026-10-22 |
| Head commit (SMS/cap fix) | `5f3e506` (+ follow-up pilot exclusion commit) |
| Blocker audit | `.readiness/integration/pilot-remaining-blockers.json` |
| Note | LA1 unused. Rent/payments hard-disabled for this pilot. |

## Core-safety inventory (`shared/pilotGate.ts`)

| Workflow | Status | Notes |
|---|---|---|
| Emergency → human alert | **verified** | Prior LA2 live flooding SMS |
| SMS identity → action | **verified** | Fresh handset YES …3069 → LA2 |
| Vendor assignment | **verified** | Handset YES + schedule …0274; ticket accepted |
| Approvals | **unknown** | Still open — inject-only late approval; no Twilio APPROVE inbound |
| Rent & payments | **excluded** + **hardDisable** | Checkout/invoice pay refuse even without `PILOT_STRICT` |

## Pilot-scoped exclusions (gaps)

| Workflow | Status |
|---|---|
| Lease imports | **excluded** (fixture extract only; live multi-lease gap) |
| Ask ULO priorities | **excluded** (routing only; action binding gap) |
| Home Checks | **excluded** + **hardDisable** (SQL/browser prerequisites) |

## Still required before pilot-ready

1. Prove landlord estimate **APPROVE/DECLINE** from a real handset (Twilio SM… inbound).
2. Keep rent/payments disabled for Limited Alpha pilot (already hard-gated).
3. Do not treat UNKNOWN/EXCLUDED as passed.
