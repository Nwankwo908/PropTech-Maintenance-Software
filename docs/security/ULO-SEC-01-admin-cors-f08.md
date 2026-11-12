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
| Full frontend behavior after incorporating PR #11 | 1,708 passed; no failures |
| Full backend behavior after incorporating PR #11 | 2,002 passed; no failures |
| Full backend types after incorporating PR #11 | Passed: 100 entrypoints and shared tests |
| Full lint after incorporating PR #11 | Passed; frontend retains 65 pre-existing warnings |
| Connected workflows | Isolated onboarding PostgreSQL suite and timezone matrix passed. Home Check SQL requires an isolated pre-migrated database; browser/live suites not run |

The original candidate reproduced two backend type errors, nine backend lint findings and the HomeCheckDesktopPerf/intakeSilence_recurring failures on main. PR #11 fixes those issues and is incorporated directly into this PR without merging #11 to main. The attachment-rendering conflict keeps #11’s cleanup and #12’s session-based reassignment; requireAdminEdgeSecret is not restored. All seven local readiness checks now pass, with no checks weakened. An initial preview dependency symlink caused one test-suite load failure; reinstalling the exact locked dependencies locally resolved that environment issue. GitHub CI remains a separate verification, and no local check proves real-browser button availability.

## Deployment hold and next verification

The temporary `vercel.json` branch-deployment entry has been removed at the user’s request. Vercel project settings remain unchanged; an automatic preview of this branch is permitted. Production is linked to main, and main must not be changed until the user approves the coordinated rollout. There are no deployment steps in the added CI job. Do not merge this PR or deploy to production without approval.

## Frontend preservation before merging

Production was rechecked read-only: its READY deployment serves frontend commit `32f283eb0d74e5cf9036f103c761ca1fdbacc03a` in session-only F08 mode. That exact commit is an ancestor of this PR. The three API files `deleteWorkOrder.ts`, `emergencyWorkOrderDecision.ts`, and `maintenanceInvoice.ts` remain byte-for-byte identical to that live release. Their five calls still obtain the signed-in Supabase session and retain the sign-in-again behavior. The shared session helper keeps that default behavior while allowing an independent compatibility flag for the newer reassignment/stage callers. The 76 frontend authorization regressions verify the request headers and refusal behavior.

Merging this PR into main therefore includes a frontend newer than the live F08 release; it does not revert main to the pre-F08 callers. This is a source/build guarantee, not a prediction that an automatic deployment cannot fail. Verify the actual served commit after any separately approved production release. The newer reassignment/stage guards still require the coordinated compatibility order below; this source-preservation check does not authorize their production deployment.

After approval:

1. Recheck current deployed versions/source against the review baselines. Use clean per-function deployment candidates that preserve each function's current deployed business dependencies and overlay only the approved entrypoint, shared authorization guard and shared CORS source. GitHub main and deployed dependency graphs differ; do not replace whole graphs from a dirty repository or blindly promote unrelated shared runtime changes.
2. Review the frontend/backend compatibility order before executing the approved rollout: existing reassignment/stage callers still send the anon bearer, so installing their new session guards before a compatible frontend is live would block those actions. The safe staged sequence is shared-CORS preparation for the five functions with existing authorization preserved; compatible frontend with current user session plus temporary legacy header; reviewed five-function release; contactless controls; session-only frontend. Record full source commit identifiers and compare downloaded deployed source afterward. Do not deploy inspection activation or analytics or apply database migrations under this approval. The PR itself does not perform any phase.
3. Use a genuinely private browser session, a fresh disposable QA landlord and QA-only jobs. Do not use LA1/LA2 or retired Auth users. Keep account contacts null, vendors contactless, payments and dispatch disabled, outbound workers inactive and no message delivery destinations configured.
4. Test real dashboard actions: move stage, reassign vendor, archive, cancel, approve a synthetic invoice. Capture actual OPTIONS and POST, status, UI result and committed QA record for each. Invoice approval must not execute a payment. Confirm no outbound notification/dispatch records or transfers. If an action cannot be isolated without delivery or payment, leave it untested rather than run it unsafely.
5. Run fresh authorized and unauthorized controls, verify no cross-account mutation, then retire QA jobs and revoke/ban the temporary users. Never publish session or capability values in evidence.
6. Report each action as passed, failed or untested, keeping browser results separate from mocked tests and direct API controls.

Browser access was unavailable during the earlier assessment. Availability of a private browser session still needs to be verified after approval; it is not a passed check.
