# Pilot gate status (coding-task evidence)

**Decision: NOT PILOT-READY.**

| Field | Value |
| --- | --- |
| Generated | 2026-10-21 (local coding task) |
| Base checkout | `9953d8468bafec87b6ad086bfd5f0806159b10e1` (+ uncommitted pilot-gate fixes) |
| Repo path | PropTech Maintenance Software |
| Note | Do not claim pilot-ready from packaging alone or from unit tests. |

## Gates re-checked this session

| Gate | Status | Notes |
| --- | --- | --- |
| Packaging (`npm run build`) | **passed** | Prerender MemoryRouter; rebuild verified after pilot-gate edits |
| Frontend ledger R01–R06 | **passed** | Focused Vitest re-run (51 tests across those files) |
| Deno ledger R07–R11, R17–R19, Thumbtack R09 | **passed** (`deno test --no-check`, `TZ=UTC`) | Typecheck gate still separate — shared `DibIdentification` re-export fixed; other Deno type diagnostics remain |
| PDF `page.render` API | **fixed** | Pass required `canvas` in `pdfPageImages.ts` |
| Connected workflows (full matrix) | **UNKNOWN** / **EXCLUDED** for most rows | Policy unit tests are supporting only; no isolated Supabase/provider sandbox in this environment |
| Overall pilot | **blocked** | `evaluatePilotReadiness().ready === false` (`shared/pilotGate.ts`) |

## Runtime failure ledger dispositions (this session)

| ID | Outcome |
| --- | --- |
| R01 generateIssueSummary word-boundary | **Fixed** — assertion no longer rejects complete-word + ellipsis |
| R02 wordBoundaryAlternation / conversationCloseAck | **Fixed** — regex uses `\b` on the group, not one-sided alternates |
| R03 adminNavigation settings cards | **Fixed** — expect ≥3; billing omitted without payments capability |
| R04 rent-roll illegible unit | **Fixed** — keep `needsReview` when unit was empty/illegible |
| R05 canRetryVendorOnboarding | **Fixed** — import missing export |
| R06 pest generalist | **Already passing** on this checkout |
| R07–R08 Ask Ulo priorities routing | **Already passing** (`executive_briefing`) |
| R09 Thumbtack listingUrl | **Fixed** — assert partner UTM retained |
| R10–R11 schedule TTL / tomorrow TZ | **Already passing** under `TZ=UTC` |
| R12 inbound handler registry map | **Already passing** |
| R13–R16 invoice paid router | **Already passing** |
| R17 flooding label | **Fixed** — distinct `flooding` issue type (not leak/plumbing) |
| R18–R19 vendor service area | **Fixed** — rosterState fallback; booking blocks unknown job state; discovery helper separate |

## Connected-workflow matrix (honest)

| Workflow | Success | Failure | Recovery | Evidence |
| --- | --- | --- | --- | --- |
| Emergency → human alert | UNKNOWN | UNKNOWN | UNKNOWN | Unit: flooding label; no durable alert delivery proof |
| SMS identity → action | UNKNOWN | UNKNOWN | UNKNOWN | Mocks only; live handset YES not verified |
| Rent/payment ledger | EXCLUDED | EXCLUDED | EXCLUDED | Pilot gate excludes until Stripe sandbox ledger proof |
| Onboarding | passed* | passed* | passed* | *Isolated PG suite in readiness (prior run) |
| Lease imports | UNKNOWN | UNKNOWN | UNKNOWN | Not re-proven this session |
| Home Checks | EXCLUDED | EXCLUDED | EXCLUDED | Prerequisites blocked / not_run |
| Vendor assignment | UNKNOWN | UNKNOWN | UNKNOWN | Pest + state gates unit-tested only |
| Scheduling | passed* | partial | partial | *Requester TZ matrix + Chrono offset; DST edge cases not fully expanded here |
| Approvals | UNKNOWN | UNKNOWN | UNKNOWN | Invoice YES mocks only |
| Job completion | UNKNOWN | UNKNOWN | UNKNOWN | Not proven |
| Ask ULO priorities | UNKNOWN | UNKNOWN | UNKNOWN | Routing unit-covered; retrieval/actions not |

\*Prior `.readiness` artifacts on commit `9953d846…`; re-run `npm run check:readiness` on the final commit before any pilot claim.

## Implemented exclusion controls

| Control | Kind |
| --- | --- |
| `shared/pilotGate.ts` | **Implemented** inventory + `assertPilotAllows` / `evaluatePilotReadiness` |
| `PILOT_STRICT=1` | **Implemented** fail-closed for excluded/unknown when env set |
| Home Checks / rent ledger | Marked **excluded** in gate inventory (wire callers with `assertPilotAllows` before pilot) |
| Cosmetic-only hiding | **Not** used as the sole exclusion |

## Still required before any pilot-ready claim

1. Re-run full `npm run check:readiness` on one exact final commit; attach `.readiness/*` summaries.
2. Connected success/failure/recovery for core-safety rows (emergency, SMS identity, payments, vendor assign, approvals) with durable DB + outbox assertions.
3. Wire `assertPilotAllows` into booking, Checkout, and Home Check entry points when enabling `PILOT_STRICT`.
4. Do not treat UNKNOWN as passed.
