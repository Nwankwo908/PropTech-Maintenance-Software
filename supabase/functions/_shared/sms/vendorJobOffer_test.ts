/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { composeVendorJobOfferIssue } from "../../../../shared/maintenance/vendorJobOffer.ts"
import { buildVendorJobAssignmentSms, extractWorkOrderRefFromSms } from "../vendor_outreach_copy.ts"
import { buildVendorAvailabilityProbeSms } from "../vendorAvailabilityProbe.ts"

const BATHROOM_LIGHT = [
  "The bathroom light won't turn on",
  "Tenant update: Only in that room",
  "Tenant update: Yes",
  "",
  "Affected area: Bedroom.",
  "",
  "Entry if not home: Yes.",
].join("\n")

Deno.test("vendor offer names the confirmed light, room, and scope", () => {
  const issue = composeVendorJobOfferIssue({
    description: BATHROOM_LIGHT,
    issueHeadline: "Electrical issue",
    locationQuestion: "Which bathroom is it in?",
    locationAnswer: "Bedroom",
    facts: { electrical_scope: "Only in that room", unit_entry: "Yes" },
  })
  assertEquals(
    issue,
    "The light in the bedroom bathroom won't turn on. The tenant reports the issue is limited to that room.",
  )
})

Deno.test("vendor offer omits a place it cannot confirm", () => {
  const issue = composeVendorJobOfferIssue({
    description: BATHROOM_LIGHT,
    issueHeadline: "Electrical issue",
  })
  assertEquals(
    issue,
    "The bathroom light won't turn on. The tenant reports the issue is limited to that room.",
  )
  assertEquals(issue?.includes("bedroom"), false)
  assertEquals(/Electrical issue/i.test(issue ?? ""), false)
  assertEquals(/Tenant update/i.test(issue ?? ""), false)
})

Deno.test("vendor offer keeps a later problem and drops empty labels", () => {
  const issue = composeVendorJobOfferIssue({
    description: [
      "The bathroom light won't turn on",
      "Tenant update: The outlet is sparking",
      "Tenant update: Only in that room",
      "",
      "Affected area: Bedroom.",
    ].join("\n"),
    issueHeadline: "Electrical issue",
    locationQuestion: "Which bathroom is it in?",
    locationAnswer: "Bedroom",
    safetyConcern: "Sparks, smoke, or burning smell reported",
  })
  assertEquals(
    issue,
    "The bedroom bathroom outlet is sparking. The tenant reports the issue is limited to that room. Sparks, smoke, or a burning smell were reported.",
  )
  assertEquals(/won't turn on/i.test(issue ?? ""), false)
})

Deno.test("vendor offer omits missing details instead of a placeholder", () => {
  assertEquals(composeVendorJobOfferIssue({}), null)
  assertEquals(
    composeVendorJobOfferIssue({ issueHeadline: "Electrical issue" }),
    "Electrical issue",
  )
  const body = buildVendorAvailabilityProbeSms({
    vendorName: "Disposable Test Vendor",
    companyName: "Disposable Maintenance Test",
    workOrderRef: "WO-EB1D",
    issueHeadline: "Electrical issue",
  })
  assertEquals(body.includes("Address:"), false)
  assertEquals(body.includes("Unit:"), false)
  assertEquals(body.includes("Entry OK"), false)
  assertEquals(body.includes("See the work order"), false)
  assertEquals(body.includes("Issue: Electrical issue"), true)
})

Deno.test("availability offer uses the confirmed bathroom light and keeps the reply", () => {
  const body = buildVendorAvailabilityProbeSms({
    vendorName: "Disposable Test Vendor",
    companyName: "Disposable Maintenance Test",
    workOrderRef: "WO-EB1D",
    location: "100 Disposable Test Lane · Unit 1",
    propertyType: "single_family",
    description: BATHROOM_LIGHT,
    issueHeadline: "Electrical issue",
    locationQuestion: "Which bathroom is it in?",
    locationAnswer: "Bedroom",
    facts: { electrical_scope: "Only in that room" },
    entryOkIfAbsent: true,
  })
  assertEquals(
    body,
    [
      "Hi Disposable Test Vendor — job WO-EB1D",
      "Disposable Maintenance Test",
      "Address: 100 Disposable Test Lane",
      "Issue: The light in the bedroom bathroom won't turn on. The tenant reports the issue is limited to that room.",
      "Entry OK if resident out: Yes",
      "",
      "Take it? Reply earliest day + window (ex: Wed 9am-12pm) + estimate if you have one",
      "Can't? Reply NO WO-EB1D",
    ].join("\n"),
  )
  assertEquals(body.includes("Unit 1"), false)
  assertEquals(body.includes("Home"), false)
  assertEquals(extractWorkOrderRefFromSms(body), "WO-EB1D")
})

Deno.test("availability offer shows a real unit and a plumbing update", () => {
  const body = buildVendorAvailabilityProbeSms({
    vendorName: "flex plumbing",
    companyName: "Maple Homes",
    workOrderRef: "WO-3B00",
    location: "14 Maple Ave · Unit 2B",
    propertyType: "multifamily",
    description: [
      "The kitchen sink is dripping",
      "Tenant update: The kitchen sink is flooding the floor",
      "",
      "Entry if not home: No.",
    ].join("\n"),
    issueHeadline: "Plumbing issue",
  })
  assertEquals(body.includes("Address: 14 Maple Ave"), true)
  assertEquals(body.includes("Unit: 2B"), true)
  assertEquals(
    body.includes("Issue: The kitchen sink is flooding the floor."),
    true,
  )
  assertEquals(body.includes("Entry OK if resident out: No"), true)
  assertEquals(/Plumbing issue/i.test(body), false)
  assertEquals(body.includes("Reply NO WO-3B00"), true)
})

Deno.test("gas offer stays urgent and does not add a troubleshooting step", () => {
  const body = buildVendorAvailabilityProbeSms({
    vendorName: "City Plumbing",
    companyName: "Maple Homes",
    workOrderRef: "WO-4A81",
    location: "100 Disposable Test Lane · Unit 1",
    propertyType: "single_family",
    description: "I smell gas in the kitchen",
    issueHeadline: "Other issue",
    urgent: true,
  })
  assertEquals(body.includes("— URGENT"), true)
  assertEquals(body.includes("Issue: There is a gas smell in the kitchen."), true)
  assertEquals(body.includes("Take it? Reply earliest day + window"), true)
  assertEquals(body.includes("Reply NO WO-4A81"), true)
  assertEquals(/until help arrives|call 911|try this/i.test(body), false)
  assertEquals(body.includes("Unit"), false)
})

Deno.test("assignment offer keeps YES and NO routing", () => {
  const body = buildVendorJobAssignmentSms({
    vendorName: "flex plumbing",
    priority: "high",
    unit: "2B",
    description: "The hall bathroom fan won't turn on\n\nAffected area: Hall bathroom.",
    issueHeadline: "Electrical issue",
    location: "14 Maple Ave · Unit 2B",
    entryOkIfAbsent: null,
    ticketId: "3b0047aa-1111-2222-3333-444444444444",
  })
  assertEquals(body.includes("Address: 14 Maple Ave"), true)
  assertEquals(body.includes("Unit: 2B"), true)
  assertEquals(body.includes("The hall bathroom fan won't turn on."), true)
  assertEquals(body.includes("Reply YES WO-3B00 to accept or NO WO-3B00 to decline."), true)
  assertEquals(body.includes("Entry OK"), false)
})
