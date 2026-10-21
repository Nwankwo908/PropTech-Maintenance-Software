# Integration verification backlog

Priority order from coverage gaps. Use Limited Alpha 1/2 and Demo test accounts only.
Provider test modes only. No real-customer SMS, charges, or live customer-record edits.

Statuses: `pending` | `in_progress` | `passed` | `failed` | `blocked` | `partial`

Keep **build / type / lint / automated unit tests** separate from **live integration** results.
A page load, invalid-link message, or mocked Vitest/Deno pass is not a completed live workflow.

| Pri | Area | Status | Notes |
| --- | --- | --- | --- |
| 1 | Account access & data privacy | **passed** | LA1/LA2 auth configured; live isolation verified (see reports/P1). |
| 2 | Complete maintenance workflow | **passed*** | LA2 integration fixtures; ticket+photo+assign+status+cross-tenant. *Carrier SMS **not_run** (non-routable phones). |
| 3 | SMS, reminders, scheduling | **partial** | Outbounds **delivered** (Twilio+DB) to LA2 handsets. Handset YES→Ulo still **unverified** (no SM… inbound in 5m). Reminders/scheduling FSM still pending. |
| 4 | Onboarding & scanning | pending | Fail-closed complete already in unit/SQL; live Gemini extract needs keys + fixtures. PDF render now passes required `canvas`. |
| 5 | Home Checks & public links | **excluded (pilot)** | `shared/pilotGate` + `PILOT_STRICT` blocks `home-check` start + UI start; live still needs `READINESS_HOME_CHECK_DATABASE_URL`. |
| 6 | Financial records | **excluded (pilot)** | Invoice mocks repaired. Rent Checkout fail-closed under `PILOT_STRICT`. Live Stripe ledger **not** verified. |
| 7 | Realistic performance | pending | After workflows stable; propose pilot targets first. |

## Test accounts (designated)

| Account | Landlord id | Login email |
| --- | --- | --- |
| Limited Alpha 1 | `de300000-0000-4000-8000-000000000003` | `limitedalpha1@ulohome.io` |
| Limited Alpha 2 | `de300000-0000-4000-8000-000000000004` | `limitedalpha2@ulohome.io` |
| Demo | `de300000-0000-4000-8000-000000000001` | `demo@ulohome.io` |

Env for live checks (never commit values):

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (present)
- `INTEGRATION_LA1_PASSWORD` / `INTEGRATION_LA2_PASSWORD` (or `ALPHA_ACCOUNT_PASSWORD` only for Alpha setup — prefer dedicated integration passwords)
- `SUPABASE_SERVICE_ROLE_KEY` (optional; admin user create / cleanup — **absent** in local `.env` as of backlog start)
- Twilio / Stripe test secrets as needed per area

## Report location

Per-area reports: `scripts/integration-verification/reports/P{n}-*.md`
Machine summaries: `.readiness/integration/` (gitignored)
