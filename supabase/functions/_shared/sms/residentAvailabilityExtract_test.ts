import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  extractResidentAvailabilityText,
  hasResidentAvailabilityCues,
} from "./residentAvailabilityExtract.ts"
import { detectMultipleMaintenanceIssues } from "./multiIssueIntake.ts"
import { buildVendorAvailabilityAskSms, buildVendorJobAssignmentSms } from "../vendor_outreach_copy.ts"

const SAMPLE = [
  "Today I saw a mouse come out from behind the stove and run across my kitchen counter.",
  "",
  "In addition, the kitchen cabinets are falling apart.",
  "",
  "Someone will be available this Saturday after 3:00 PM and Sunday between 11:00 AM and 4:00 PM. Mark will also be available this coming Monday from 10:30 AM to 12:00 PM.",
].join("\n")

Deno.test("extracts resident visit windows from SMS", () => {
  assertEquals(hasResidentAvailabilityCues(SAMPLE), true)
  const avail = extractResidentAvailabilityText(SAMPLE)
  assertEquals(Boolean(avail), true)
  assertMatch(avail ?? "", /saturday/i)
  assertMatch(avail ?? "", /sunday|monday/i)
})

Deno.test("mouse + cabinets multi-issue prefers pest then carpentry", async () => {
  const issues = await detectMultipleMaintenanceIssues(SAMPLE)
  assertEquals(issues.length >= 2, true, JSON.stringify(issues))
  const trades = issues.map((i) => i.vendor_trade)
  assertEquals(trades.includes("pest_control"), true, JSON.stringify(trades))
  assertEquals(trades.includes("carpentry"), true, JSON.stringify(trades))
  assertEquals(trades[0] === "appliance_repair", false)
})

Deno.test("vendor assignment SMS includes resident availability", () => {
  const body = buildVendorJobAssignmentSms({
    vendorName: "Flex Pest",
    priority: "normal",
    unit: "2B",
    description: "Mouse in kitchen",
    ticketId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    residentAvailabilityText: "Saturday after 3pm; Sunday 11am-4pm",
  })
  assertMatch(body, /Resident availability/i)
  assertMatch(body, /Saturday after 3pm/i)
})

Deno.test("vendor availability ask references resident windows", () => {
  const body = buildVendorAvailabilityAskSms(
    "WO-AAAAAAAA",
    "Saturday after 3pm; Sunday 11am-4pm",
  )
  assertMatch(body, /resident shared these times/i)
  assertMatch(body, /Saturday after 3pm/i)
})
