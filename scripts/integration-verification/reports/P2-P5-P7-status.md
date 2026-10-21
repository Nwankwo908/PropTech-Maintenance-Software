# P2 / P3 / P4 / P5 / P7 — status (not completed live)

Date: 2026-10-21. Designated accounts: Limited Alpha 1/2, Demo only.

| Area | Automated / existing | Live integration | Blocker |
| --- | --- | --- | --- |
| **P2** Full maintenance journey | Unit/Deno coverage for intake pieces | **blocked** | No integration passwords; Twilio secrets absent locally; need test resident + Active vendor on LA portfolio |
| **P3** SMS / reminders / TZ / pest | Requester TZ matrix **passed**; pest dispatch Deno tests exist | **blocked** | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` absent; do not use production DID against real customers |
| **P4** Onboarding / scanning | Fail-closed complete + disposable PG inventory suite **passed** earlier | **blocked** for live Gemini extract | Need fixture leases + `GEMINI_API_KEY` on edge; do not finish setup on inventory failure (already enforced in code) |
| **P5** Home Check / public links | Mocked browser + SQL suite exist | **blocked** | Need `READINESS_HOME_CHECK_DATABASE_URL` + real uploads (no fixture intercept) |
| **P7** Performance | — | **not_run** | Propose pilot targets after P2–P3 stable |

None of these are reported as completed live workflows.
