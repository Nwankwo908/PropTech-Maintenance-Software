import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildFeedFactSheet,
  fallbackFeedCardCopy,
  validateFeedCardCopy,
} from "../../../../shared/activityFeed/feedFactSheet.ts"
import { writeFeedCardCopy } from "./writeFeedCardCopy.ts"

Deno.test("writeFeedCardCopy uses fallback when model invents names", async () => {
  const ticket = {
    issueHeadline: "Broken freezer door seal",
    vendorName: "NTA Handyman Services",
    awaitingLandlordChoiceAt: "2026-11-03T12:00:00.000Z",
    building: "78 Maple Ave",
    unitLabel: "1",
  }
  const facts = buildFeedFactSheet(ticket, [])
  const copy = await writeFeedCardCopy({
    ticket,
    events: [],
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: "Acme finished the probe",
                  status_line: "Waiting on batch",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  })
  assertEquals(copy.source, "fallback")
  assertEquals(copy.headline, fallbackFeedCardCopy(facts).headline)
  assertEquals(validateFeedCardCopy(copy, facts).ok, true)
})

Deno.test("writeFeedCardCopy accepts valid AI output", async () => {
  const ticket = {
    issueHeadline: "Broken freezer door seal",
    vendorName: "NTA Handyman Services",
    awaitingLandlordChoiceAt: "2026-11-03T12:00:00.000Z",
    building: "78 Maple Ave",
    unitLabel: "1",
  }
  const copy = await writeFeedCardCopy({
    ticket,
    events: [],
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: "Pick a vendor for the freezer seal",
                  status_line: "",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  })
  assertEquals(copy.source, "ai")
  assertMatch(copy.headline, /Pick a vendor for the freezer seal/i)
  assertEquals(copy.status_line, "")
})

Deno.test("writeFeedCardCopy rejects Repair issue and initials-only vendor", async () => {
  const ticket = {
    issueHeadline: "Broken freezer door seal",
    vendorName: "NTA Services LLC",
    awaitingLandlordChoiceAt: "2026-11-03T12:00:00.000Z",
    building: "78 Maple Ave",
    unitLabel: "1",
  }
  const facts = buildFeedFactSheet(ticket, [])
  assertEquals(validateFeedCardCopy({ headline: "NTA finished: Repair", status_line: "" }, facts).ok, false)
  assertEquals(
    validateFeedCardCopy({ headline: "Pick a vendor for the freezer seal", status_line: "" }, facts).ok,
    true,
  )
  const repairCopy = await writeFeedCardCopy({
    ticket,
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: "Pick vendor: Repair",
                  status_line: "",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  })
  assertEquals(repairCopy.source, "fallback")
  assertMatch(repairCopy.headline, /Pick a vendor for the /i)
  assertEquals(/\bRepair\b/.test(repairCopy.headline), false)
})

Deno.test("writeFeedCardCopy reuses cache when facts_hash matches", async () => {
  const ticket = {
    issueHeadline: "Dryer caught fire",
    awaitingLandlordChoiceAt: "2026-11-05T12:00:00.000Z",
  }
  const facts = buildFeedFactSheet(ticket, [])
  const cached = {
    ...fallbackFeedCardCopy(facts),
    facts_hash: "deadbeef",
    source: "ai" as const,
    updated_at: "2026-11-01T00:00:00.000Z",
  }
  // Wrong hash → regenerates
  const first = await writeFeedCardCopy({ ticket, cached, skipLlm: true })
  assertEquals(first.source, "fallback")
  const reused = await writeFeedCardCopy({
    ticket,
    cached: { ...first, source: "ai" },
    skipLlm: true,
  })
  assertEquals(reused.headline, first.headline)
  assertEquals(reused.facts_hash, first.facts_hash)
})
