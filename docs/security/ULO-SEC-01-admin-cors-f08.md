# ULO-SEC-01: five-function admin CORS and F08 review

Status: PR candidate only. Deployment and real-browser verification require the user's PR approval. ULO-SEC-01 remains incomplete.

## Source and scope

- Base: GitHub main `c03e280ab0472babd039e2f97514c38e0921d6fb`.
- Preserve production frontend commit `32f283eb0d74e5cf9036f103c761ca1fdbacc03a` in branch history, including its reviewed build/type repairs.
- Preserve the reviewed session/account guards for `admin-delete-work-order`, `admin-approve-maintenance-invoice`, and `terminate-work-order`.
- Include the reviewed session/account authorization and frontend caller changes for `admin-reassign-vendor` and `admin-move-workflow-stage` (including visit-time edits).
- Define the explicit allowed header list once, in `supabase/functions/_shared/admin_edge_cors.ts`. All five functions use that shared object without per-function overrides.
- The compatibility frontend changes the Authorization value, not the HTTP header names. Each changed caller requires a current user session. The new compatibility flag does not re-enable the legacy header for the earlier F08 callers.
- Inspection activation and analytics corrections are explicitly outside this PR at the user's direction. Other legacy-secret consumers and wider ULO-SEC-01 findings remain open.

The shared header list is `authorization, apikey, content-type, x-client-info, x-ulo-access-token, x-admin-reassign-secret`. Authorization must be explicitly listed; wildcard allowed headers do not cover it. Allowing a header does not authorize an action.

## CI and local checks

Existing readiness jobs and lockfile checks remain enabled. A separate admin-authorization CI job runs typed handler/guard regressions without network permission or real credentials. The frontend authorization regressions run in the existing full Vitest suite. All identities, credentials and tokens in these tests are synthetic and cannot authenticate to a real service.

Fresh local results on the candidate:

| Check | Result |
| --- | --- |
| F08 guard and original three handlers, including shared CORS | 81 passed |
| Reassign/stage/visit handler authorization and CORS | 33 passed |
| Frontend authorization regressions | 76 passed |
| Frontend TypeScript: application, tooling, tests | Passed after fixing one test-fixture import during test integration |
| Production packaging | Passed |
| Edge lockfile compatibility | Passed |
| Full frontend behavior | 1,707 passed; 1 failed: HomeCheckDesktopPerf expected-copy assertion |
| Full backend behavior | 2,001 passed; 1 failed: intakeSilence_recurring NOT SURE assertion |
| Full backend types | Failed: equipmentPair argument count; manufactureCorrection PromiseLike.catch |
| Full lint | Frontend: zero errors, 65 warnings. Backend: nine errors |
| Connected workflows | Isolated onboarding PostgreSQL suite and timezone matrix passed. Home Check SQL requires an isolated pre-migrated database; browser/live suites not run |

The two backend type errors, nine backend lint findings, HomeCheckDesktopPerf failure and intakeSilence_recurring failure were independently reproduced on unchanged GitHub main. These checks are not suppressed or converted to success. GitHub CI is authoritative for its own runtime and must be reviewed before approval. No local check proves real-browser button availability.

## Deployment hold and next verification

Vercel automatic deployment is disabled for this PR branch only using `git.deploymentEnabled`. Other branch settings are unchanged. There are no deployment steps in the added CI job. Do not merge or deploy until the user approves the PR.

After approval:

1. Recheck current deployed versions/source against the review baselines. Use clean per-function deployment candidates that preserve each function's current deployed business dependencies and overlay only the approved entrypoint, shared authorization guard and shared CORS source. GitHub main and deployed dependency graphs differ; do not replace whole graphs from a dirty repository or blindly promote unrelated shared runtime changes.
2. Review the frontend/backend compatibility order before executing the approved rollout: existing reassignment/stage callers still send the anon bearer, so installing their new session guards before a compatible frontend is live would block those actions. The safe staged sequence is shared-CORS preparation for the five functions with existing authorization preserved; compatible frontend with current user session plus temporary legacy header; reviewed five-function release; contactless controls; session-only frontend. Record full source commit identifiers and compare downloaded deployed source afterward. Do not deploy inspection activation or analytics or apply database migrations under this approval. The PR itself does not perform any phase.
3. Use a genuinely private browser session, a fresh disposable QA landlord and QA-only jobs. Do not use LA1/LA2 or retired Auth users. Keep account contacts null, vendors contactless, payments and dispatch disabled, outbound workers inactive and no message delivery destinations configured.
4. Test real dashboard actions: move stage, reassign vendor, archive, cancel, approve a synthetic invoice. Capture actual OPTIONS and POST, status, UI result and committed QA record for each. Invoice approval must not execute a payment. Confirm no outbound notification/dispatch records or transfers. If an action cannot be isolated without delivery or payment, leave it untested rather than run it unsafely.
5. Run fresh authorized and unauthorized controls, verify no cross-account mutation, then retire QA jobs and revoke/ban the temporary users. Never publish session or capability values in evidence.
6. Report each action as passed, failed or untested, keeping browser results separate from mocked tests and direct API controls.

Browser access was unavailable during the earlier assessment. Availability of a private browser session still needs to be verified after approval; it is not a passed check.
