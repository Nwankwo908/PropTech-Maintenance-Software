# Account privacy ownership — migration + verification

**Date:** 2026-10-22  
**Repo:** Nwankwo908/PropTech-Maintenance-Software  
**Migration:** `supabase/migrations/20261022120000_account_privacy_ownership.sql`  
**Verifier:** `npm run verify:account-privacy-isolated`

## Deployment status: **applied** (linked host)

| Step | Status |
|---|---|
| `supabase db push` · `20261022120000_account_privacy_ownership.sql` | **Applied** |
| Post-migration `verify:account-privacy-isolated` | **partial** (exit 0) — all ownership checks **passed** |
| Dedicated `PRIVACY_ISOLATED_SUPABASE_URL` mirror | unset (ran on linked project) |
| Synthetic tenant JWT / OAuth / phone OTP | **blocked / untested** |

LA1 was not signed into, reset, or messaged. No real SMS. Service role used only for fixtures + unchanged-row audits.

## Post-migration results (authenticated JWTs)

| Check | Expected | Actual | Result |
|---|---|---|---|
| Anon read properties/users | deny | empty | passed |
| Anon update resident balance | unchanged | unchanged | passed |
| LA2 read B properties/users | deny | empty | passed |
| LA2 read B portal members | deny | empty | **passed** (was failed) |
| LA2 insert membership on B | deny | not persisted | **passed** (was failed) |
| LA2 list B private storage | deny | empty | **passed** (was failed) |
| B list LA2 private storage | deny | empty | **passed** (was failed) |
| B update LA2 property | unchanged | unchanged | passed |
| Owner success (LA2/B own reads + B own storage) | allow | allow | passed |
| Invalid JWT | deny | empty | passed |
| Synthetic tenant session | fixture | none | blocked |

Evidence: `.readiness/integration/account-privacy-isolated.json`

## Migration summary

1. Drop legacy `users_*_all` (already gone); re-assert landlord-scoped users policies (+ own-email).
2. Scope `landlord_portal_members` to `can_access_landlord` (fixes cross-account membership R/W).
3. Storage path ownership for onboarding + inspection uploads; remove bucket-wide authenticated maintenance reads.
4. Triggers: block `landlord_id` reassignment; enforce ticket property/resident landlord links.

Do **not** declare the whole pilot ready from these checks alone.
