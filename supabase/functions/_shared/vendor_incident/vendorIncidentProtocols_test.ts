import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildNoShowLandlordEmail,
  __test,
} from "./vendorIncidentProtocols.ts"

Deno.test("no-show windows are T+120 notify / T+125 rematch", () => {
  assertEquals(__test.NOSHOW_NOTIFY_MINUTES, 120)
  assertEquals(__test.NOSHOW_REMATCH_MINUTES, 125)
})

Deno.test("no-show landlord email mentions rematch", () => {
  const email = buildNoShowLandlordEmail({
    vendorName: "Flex Plumbing",
    unit: "4B",
    scheduledAt: "2026-07-22T15:00:00.000Z",
  })
  assertEquals(email.subject.includes("Flex Plumbing"), true)
  assertEquals(email.text.toLowerCase().includes("another vendor"), true)
  assertEquals(email.text.includes("4B"), true)
})
