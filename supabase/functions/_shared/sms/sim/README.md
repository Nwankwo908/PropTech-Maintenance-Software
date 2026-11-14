# SMS sandbox and regression replays

Runs a scripted text conversation through the **real** inbound SMS pipeline
(`processInboundSms`: identity, state handlers, interpretation, workflow
router) against an in-memory database. Every bug that gets a fixture here is
checked on every pull request, so it can't quietly come back.

## Safety

- **No network.** `fetch` is blocked. Twilio sends are captured, not sent. AI
  model calls fail fast, so the pipeline uses its built-in fallbacks and the
  results are the same every run.
- **No real accounts.** Sandbox ids and `+1555` numbers only. Limited Alpha
  landlord ids are refused.
- **Simulated time.** "25 hours later" runs instantly.

## Run it

```bash
npm run sim:sms                                  # every fixture, with transcripts
npm run sim:sms -- path/to/fixture.json          # one fixture
SMS_SIM_VERBOSE=1 npm run sim:sms -- path.json   # include pipeline logs
```

CI runs `replay_test.ts` as part of the Deno behavior suite.

## Fixture status

| Status | Meaning |
|---|---|
| `locked` | Ulo handles this correctly. The test fails if that ever changes. |
| `known_bug` | The bug still reproduces. The test passes while it does, and **fails once it's fixed**, telling you to switch the fixture to `locked`. |

Write `expect` as the **correct** behavior, even for a known bug.
`currentBehavior` says what Ulo does today.

The four original routing bugs are now `locked`: fresh repair reports break out
of open/expired visit and staff questions, and natural visit confirmations work.
Additional tests check that the original repair stays unchanged, intake continues
on the next turn, and polite confirmations apply to the pending visit only.
These are network-blocked simulations, not handset or production verification.

## Adding a fixture

1. Copy a fixture in `fixtures/` and rename it. The file name must match `id`.
2. Use made-up names, numbers and addresses only. Never paste a real
   resident's phone number or address.
3. `setup.ticket` seeds an open work order (fields merge over a default
   plumbing ticket). `setup.intakeState` seeds the thread's state, such as an
   open visit question. Use `{{TICKET_ID}}` and `{{VENDOR_ID}}` as placeholders.
4. Each turn can check `route`, `routeNot`, `replies`, `replyMatches` and
   `replyNotMatches` (case-insensitive regex). `expectEnd.ticketsCreated`
   counts new work orders.
5. Run `npm run sim:sms -- fixtures/<id>.json` and read the transcript.
6. A person confirms the expected behavior before the fixture is `locked`.

When a locked fixture fails, fix the code. Change the fixture only if you
decide the expected behavior itself was wrong.

## Limits

- The database is a stand-in. It covers the queries the SMS pipeline uses,
  not every Postgres feature (no triggers, no RLS, no real RPCs).
- AI classification is off, so these replays test the deterministic rules.
  Cases that depend on the model need a recorded model answer (not built yet).
- Fire-and-forget work (activity logs, graph events) lands in the fake
  database. It is not asserted.
