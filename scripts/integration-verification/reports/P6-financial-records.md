# P6 — Financial records (partial)

**Environment:** automated Deno only (no Stripe live webhook this pass).  
**Date:** 2026-10-21

## Supported in this release (from code / capabilities)

| Feature | Status |
| --- | --- |
| Landlord rent Checkout + Connect | Implemented (Stripe; Limited Alpha surface disables payments for LA accounts) |
| Vendor invoice Checkout | Implemented (`invoice-payment-checkout`) |
| SMS “have you paid this invoice?” YES/NO | Implemented (`invoice_paid_confirmation`) |
| Ledger events on invoice approve | Implemented (`maintenanceSpend.approveMaintenanceInvoice`) |

## What was tested

| Check | Layer | Result |
| --- | --- | --- |
| Invoice paid confirmation router + unit mocks | Automated Deno | **passed** after mock repair (21/21) |
| Stripe test-mode Checkout / Connect / webhook idempotency | Live | **blocked** — needs intentional Stripe test run with `sk_test` + test landlord that has payments enabled (not Limited Alpha surface) |
| Double-count / repeated webhook | Live | **not_run** |

## Bug fixed (test fixture, not product)

Router mock for `.update().eq().eq().eq().select("id")` returned `data: null`, so `approveMaintenanceInvoice` treated the win as failed and never wrote `spend_status=recognized`. Aligned mock with `invoicePaidConfirmation_test.ts`. **Not** a product defect.

## Missing for done-when

- Live Stripe test-mode success/failure/retry on a payments-enabled test account  
- Ledger totals vs invoice rows after repeated webhook delivery  
