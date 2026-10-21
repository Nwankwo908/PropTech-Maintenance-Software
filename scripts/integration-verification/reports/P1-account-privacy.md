# P1 — Account access & data privacy

**Environment:** hosted Supabase `mzpqwuizhiaczxcnmxbt`  
**Test landlords:** Limited Alpha 1 / 2  
**Date:** 2026-10-21

## Result: **passed** (live)

| Check | Status |
| --- | --- |
| Configure test access (create LA1/LA2 auth + passwords in `.env.local`) | passed |
| Anonymous properties/tickets | passed |
| Login LA1 / LA2 | passed |
| Properties scoped per landlord | passed |
| Cross-read LA2 property as LA1 | passed (denied) |
| Cross-update LA2 property as LA1 | passed (denied) |
| Tickets scoped per landlord | passed |

Evidence: `.readiness/integration/P1-account-privacy.json`

## Fixes applied earlier this session

Landlord-scoped RLS (`20261021140000` + harden) — required for backend rejection of cross-tenant API.

## Not covered here

Google OAuth UI, email OTP inbox delivery (password auth used).
