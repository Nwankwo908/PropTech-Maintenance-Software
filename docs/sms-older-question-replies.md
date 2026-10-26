# Answering older SMS questions

Visit questions now include a question-specific reference such as `S-AB12CD34EF56`, alongside the existing work-order reference. Residents can answer `S-AB12CD34EF56 YES`, or `S-AB12CD34EF56 NO Thursday 2pm`. The reference identifies that proposal, not whichever text happens to be newest. A simple YES/NO or natural-language answer still works with one open visit question.

Estimate questions include an immutable estimate-version reference such as `E-AB12CD34EF56`. Landlords answer `E-AB12CD34EF56 APPROVE` or `E-AB12CD34EF56 DECLINE`. A superseded, expired, withdrawn, or already decided estimate returns its status; it cannot silently select a revised estimate. When a job has superseded estimates, an unqualified decision requires the current estimate's reference. Multiple pending estimates also require disambiguation.

Vendors continue using existing job references: `YES WO-AB12` or `WO-AB12 Thursday 2pm`. An explicit job reference takes priority over the latest conversation/FSM pin. Unknown, closed, multiple, or colliding references cannot fall back to another open job. Bare YES/NO with multiple open vendor jobs now requires clarification, even with a pinned conversation.

## Lifecycle and safety

- Multiple resident proposals for different jobs are retained in the same thread's `intake_state.schedule_reply_questions`; answering one preserves the others. A new proposal for the same job invalidates that job's old reference.
- New resident confirmation questions expire after 24 hours. A passed appointment time, reassigned vendor, or advanced work-order status also prevents accepting the old proposal.
- Explicit question references bypass unrelated staff/activation handlers. Identity, account and status checks still apply. A reference is not an authorization token.
- Ambiguous bare NO now receives clarification across decision types, as bare YES already did.
- Successful referenced visit/estimate acknowledgements identify the question/job. Repeated or stale referenced visit replies cannot reuse the current question on another job; no-longer-open references receive clarification.
- Existing pending legacy questions continue to work. Clearing or replacing the legacy schedule slot invalidates conflicting stored references rather than resurrecting them. Old texts are not rewritten or resent.
- No schema migration, account updates, payment configuration changes, new external service or deployment is part of this change.

## Boundaries

This implements older-question replies for resident visit proposals and landlord estimates, plus safer vendor job matching. Other asks (activation, vendor selection, inspections, rent, staff free-text questions) retain their existing reply formats; this is not a universal historical-message inbox. Numbered estimate disambiguation and existing work-order references remain supported. General notification batching/reduction is not changed.

Schedule references are retained on the resident conversation, not globally searchable across different phones/conversations. If the thread changes or a reference is unavailable, the system asks for clarification instead of selecting the newest question. Schedule intake updates retain the existing read/modify/write architecture; concurrent multi-process transaction safety is not established by component tests. Estimate reference prefix collisions fail closed. For vendor jobs, existing four-character WO collisions also require clarification.

Verification uses synthetic identities and in-memory database/delivery fixtures with network denied. It is automated/simulated evidence, not carrier, handset, deployed cron or production concurrency evidence. Typecheck the changed production entrypoints and new test files separately: several older runtime-only suites have pre-existing fixture type errors.
