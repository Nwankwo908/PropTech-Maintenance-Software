import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { checkFixture, runFixture, SIM_TICKET_ID, type SmsFixture } from "./replay.ts"

for (const id of [
  "visit-question-captures-new-repair",
  "expired-visit-question-captures-new-repair",
  "staff-question-swallows-new-repair",
]) {
  Deno.test({
    name: `pending question breakout preserves original repair and continues intake: ${id}`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const fixture = JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${id}.json`, import.meta.url))) as SmsFixture
      fixture.turns.push({ from: "resident", body: "The upstairs bathroom" })
      const run = await runFixture(fixture)
      assertEquals(run.turns.map((t) => t.error), [null, null])
      assertEquals(run.db.rows("maintenance_requests").length, 2)
      const original = run.db.rows("maintenance_requests").find((t) => t.id === SIM_TICKET_ID)!
      assertEquals(original.description, "Kitchen sink leaking")
      assertEquals(original.vendor_work_status, "accepted")
      assertEquals(original.scheduled_at, undefined)
      assertEquals(run.turns[1].route, "resident_maintenance_intake")
      assertEquals(run.turns[1].outbound.some((o) => /power out only in that room/i.test(o.body)), true)
    },
  })
}

for (const body of ["Yes thanks", "Sounds good", "Yes, that works, thank you!"]) {
  Deno.test({
    name: `natural visit answer confirms exactly the pending repair: ${body}`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const fixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/visit-question-natural-yes.json", import.meta.url))) as SmsFixture
      fixture.turns[0].body = body
      const run = await runFixture(fixture)
      assertEquals(checkFixture(fixture, run), [])
      const ticket = run.db.rows("maintenance_requests")[0]
      assertEquals(ticket.id, SIM_TICKET_ID)
      assertEquals(ticket.scheduled_at, "2026-11-12T19:00:00.000Z")
      assertEquals(ticket.description, "Kitchen sink leaking")
    },
  })
}

for (const id of ["visit-question-captures-new-repair", "staff-question-swallows-new-repair"]) {
  Deno.test({
    name: `plain failure report needs no special new-repair keyword: ${id}`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const fixture = JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${id}.json`, import.meta.url))) as SmsFixture
      fixture.turns[0].body = "The bathroom ceiling light stopped working."
      const run = await runFixture(fixture)
      assertEquals(checkFixture(fixture, run), [])
    },
  })
}
