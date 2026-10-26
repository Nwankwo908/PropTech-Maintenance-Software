# Self-service Limited Alpha signup

Get Started now supports a new verified email without a hardcoded portal allowlist. The first newly provisioned profile is labelled Limited Alpha 3 (LA3), then LA4, LA5, and so on. Each has a separate random UUID and empty portfolio; no existing account is copied. Numeric labels are unique, persistent sequence allocations; failed transactions can leave normal sequence gaps.

A private account is provisioned before the wizard needs to save data. Its registry status starts as `onboarding`; committing `landlord_onboarding.onboarding_status = completed` activates the same profile in that transaction. Retry, refresh and additional tabs reuse the verified Auth identity's account. Existing members and seeded users retain their current account.

Email OTP signup records explicit signup intent. Google Get Started carries intent through the production OAuth hosts using a short-lived cookie. This cookie is a UI hint only: the database reads auth.uid(), locks that Auth user, and requires a confirmed email. No email, landlord UUID, label, or owner can be supplied to the provisioning RPC. Unknown ordinary login sessions do not create accounts automatically. The registry is owner-readable and has no client-write policy.

New UUIDs use a reserved namespace so shared frontend/edge capability and onboarding checks recognize them without adding customers to a static list. Actual data access still requires database membership/ownership; knowing an account ID or matching its format grants no access. The dashboard binds the member's account before rendering and refuses unresolved non-staff scopes. UI account labels load LA3/LA4 from the owner registry.

Profiles use the existing Limited Alpha operational product surface: onboarding/import, portfolio, resident/vendor workflows, maintenance approvals, scheduling, SMS and Ask Ulo. Existing role permissions, safety rules and feature readiness gates remain in force. Payments, bank linking and payouts remain disabled. Native-app/accounting surfaces retain the existing Limited Alpha restrictions; this does not build unavailable features or bypass safety/verification gates. Existing fixed-account-only administrative reset/ops tools are not expanded to arbitrary new tenants by this change.

SMS uses the existing shared Alpha sender configuration, with identities/conversations/rosters still scoped to the new landlord UUID. Signup itself sends no operational SMS. Opt-in onboarding completion retains its normal resident/vendor invitation behavior. No new provider number is purchased, and Limited Alpha 1 is not changed.

## Rollout

Apply `20261026120000_self_service_limited_alpha.sql` and `20261026121000_self_service_limited_alpha_privileges.sql`, then deploy the updated frontend and every edge consumer of shared/landlordCapabilities.ts. Hosted Supabase Auth must permit the intended email/OAuth signup flow and its configured callbacks. Production rollout completed October 26, 2026: both migrations, the frontend, all 81 edge capability consumers, and production OAuth callbacks. See `.readiness/la3-release/release.md` for the exact release commit and evidence. Older unrelated pending migrations should be reviewed separately before any schema push.

## Evidence

Run `bash scripts/test-self-service-signup.sh` for a disposable PostgreSQL test. It uses synthetic verified/unverified Auth identities, a temporary Unix socket, a minimal fixture schema, and stubbed access helpers. It checks distinct profiles, repeat signup, owner RLS, cross-tenant onboarding denial, activation on completion, existing-account reuse, client-write denial and anonymous/unverified rejection. It does not prove the entire deployed RLS/schema, hosted OTP/OAuth settings, browser journey, email/SMS delivery, or every operational feature. Frontend tests separately cover Auth intent, failure behavior, request coalescing and capability gates. Real-user signup must be verified after rollout with an isolated test account.
