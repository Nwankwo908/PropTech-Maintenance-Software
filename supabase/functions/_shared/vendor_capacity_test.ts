import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildVendorCapacityPausedSms,
  buildVendorCapacityResumedSms,
  buildVendorJobsMaxSms,
  parseVendorCapacityCommand,
  startOfUtcWeek,
} from "./vendor_capacity.ts"

Deno.test("parseVendorCapacityCommand — PAUSE / RESUME", () => {
  assertEquals(parseVendorCapacityCommand("PAUSE"), { kind: "pause" })
  assertEquals(parseVendorCapacityCommand("  pause please  "), { kind: "pause" })
  assertEquals(parseVendorCapacityCommand("RESUME"), { kind: "resume" })
  assertEquals(parseVendorCapacityCommand("resume"), { kind: "resume" })
})

Deno.test("parseVendorCapacityCommand — JOBS MAX n", () => {
  assertEquals(parseVendorCapacityCommand("JOBS MAX 3"), { kind: "jobs_max", max: 3 })
  assertEquals(parseVendorCapacityCommand("jobs max 10"), { kind: "jobs_max", max: 10 })
  assertEquals(parseVendorCapacityCommand("JOB MAX 1"), { kind: "jobs_max", max: 1 })
  assertEquals(parseVendorCapacityCommand("JOBS MAXIMUM 2"), { kind: "jobs_max", max: 2 })
  assertEquals(parseVendorCapacityCommand("JOBS MAX"), null)
  assertEquals(parseVendorCapacityCommand("YES"), null)
  assertEquals(parseVendorCapacityCommand("NO"), null)
})

Deno.test("capacity SMS copy mentions existing jobs unchanged / confirmation", () => {
  const paused = buildVendorCapacityPausedSms()
  assertEquals(paused.includes("paused"), true)
  assertEquals(paused.toLowerCase().includes("already accepted") || paused.toLowerCase().includes("scheduled"), true)
  assertEquals(paused.includes("RESUME"), true)

  const resumed = buildVendorCapacityResumedSms()
  assertEquals(resumed.toLowerCase().includes("back"), true)
  assertEquals(resumed.includes("PAUSE"), true)

  const capped = buildVendorJobsMaxSms(3, false)
  assertEquals(capped.includes("3"), true)
  assertEquals(capped.toLowerCase().includes("week"), true)
})

Deno.test("startOfUtcWeek returns Monday UTC", () => {
  // 2026-07-22 is Wednesday → week starts 2026-07-20
  const week = startOfUtcWeek(new Date("2026-07-22T15:00:00.000Z"))
  assertEquals(week.startsWith("2026-07-20"), true)
})
