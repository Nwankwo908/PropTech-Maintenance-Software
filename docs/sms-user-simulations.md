# Simulated SMS users

Run `npm run test:sms-simulated` from the repository root. Deno typechecks and runs 12 deterministic scenarios against production decision functions. The backend readiness suite also discovers this `_test.ts` file automatically.

The command grants only filesystem reads, with no network, environment, subprocess, or write permissions. It uses cached imports; missing dependencies cause a clear failure rather than a live network fallback. No Supabase credentials, accounts, real phone numbers, API keys or model calls are used. All identities, job IDs, conversation IDs and provider SIDs are synthetic; no designated phone is contacted. Payments are not exercised. Limited Alpha 1 is untouched.

| Simulated user situation | Assertions |
|---|---|
| Resident reports leak, vendor accepts/proposes, resident confirms | Repair recognition, scheduling effects in order, persisted/scheduled state and job binding |
| Resident declines then accepts another slot | Reopens vendor availability; second slot is retained |
| Confirmation webhook replay | Same SID suppresses duplicate scheduling effect |
| Vendor's older reply arrives late | Newer proposed window is retained |
| Resident leaves confirmation unanswered | Virtual clock crosses expiry; fresh availability required without persistence |
| Shared number has cross-account history | Recent outbound determines account; ambiguous/empty identities fail closed |
| YES could mean schedule or estimate approval | Clarification required; rent handler yields; explicit approve/decline keywords recognized |
| Resident reports gas/CO in English or Spanish | Emergency recognition, no generic intake menu |
| Resident opts out or reports stopped heater | STOP compliance distinguished from a repair sentence |
| Vendor delivery fails once then recovers | Exactly two attempts; successful thread retained |
| Vendor delivery repeatedly fails | Retry budget stops at two; failure reason retained for caller handoff |
| Duplicate vendor discovery results | Suggestions deduplicated and ranked before choice presentation |

The scheduling driver carries the real production FSM state across turns, with fixed timestamps and explicit provider IDs. It supplies resolved availability timestamps as fixtures; it does not pretend to test natural-language date extraction. Resident YES/NO uses the production text parser. Carrier results are injected through the production retry function; no SMS is sent. Other scenarios exercise production recognition, selection and arbitration functions directly rather than a replacement router.

## Evidence boundaries

Passing simulations demonstrate the listed component behavior only. They do not establish full inbound router dispatch, webhook signatures, database locking/rollback, atomic deduplication under concurrent processes, deployed cron execution, carrier receipts, emergency human acknowledgement, actual approval execution/authorization, full maintenance completion, real vendor availability, model quality, handset response times, or end-to-end account isolation. Failed-delivery tests cover vendor reschedule retry logic, not every delivery/retry entrypoint. Approval tests cover ambiguity and keyword parsing, not approve/decline side effects. Emergency tests cover recognition, not dispatch or human receipt.

Run isolated integration and designated real-phone checks separately and label those evidence types independently. No production readiness claim follows from this suite alone.
