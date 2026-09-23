/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { decideVendorAssignmentFromTiers } from "./vendor_assignment.ts"
import {
  buildLandlordVendorChoiceSms,
  canHandleLandlordVendorChoice,
  canReplaceAssignedVendorForLandlordChoice,
  choiceOptionsFromExternalSuggestions,
  formatExternalVendorSmsLine,
  landlordNumberedChoiceReplyHint,
  landlordVendorChoiceResolvedIntake,
  parseLandlordVendorChoice,
  readAwaitingVendorChoice,
  ticketIsAwaitingLandlordVendorChoice,
  vendorChoiceOptionIdsEqual,
} from "./vendorLandlordChoice.ts"

const specialist = {
  id: "spec-1",
  name: "Manny Plumber",
  email: null,
  phone: null,
  notification_channel: "sms",
  active: true,
  category: "plumbing",
  portal_api_key: null,
  last_assigned_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
}

const generalist = {
  ...specialist,
  id: "gen-1",
  name: "Ivanhomesolutions",
  category: "general",
}

const generalistB = {
  ...specialist,
  id: "gen-2",
  name: "Handyman Services By Michael",
  category: "general",
}

Deno.test("decideVendorAssignmentFromTiers lists every matchable specialist and handyman", () => {
  const bothTiers = decideVendorAssignmentFromTiers(specialist, generalist)
  assertEquals(bothTiers.kind, "landlord_choice")
  if (bothTiers.kind === "landlord_choice") {
    assertEquals(bothTiers.options.length, 2)
  }

  const twoHandymen = decideVendorAssignmentFromTiers(null, [generalist, generalistB])
  assertEquals(twoHandymen.kind, "landlord_choice")
  if (twoHandymen.kind === "landlord_choice") {
    assertEquals(twoHandymen.options.length, 2)
    assertEquals(twoHandymen.options[0]?.vendor.id, "gen-1")
    assertEquals(twoHandymen.options[1]?.vendor.id, "gen-2")
  }

  const one = decideVendorAssignmentFromTiers(null, generalist)
  assertEquals(one.kind, "landlord_choice")
  if (one.kind === "landlord_choice") {
    assertEquals(one.options.length, 1)
    assertEquals(one.options[0]?.vendor.id, "gen-1")
  }

  assertEquals(decideVendorAssignmentFromTiers(null, null).kind, "none")
})

Deno.test("decideVendorAssignmentFromTiers prioritizes preferred over trade tier", () => {
  const preferredGeneralist = {
    ...generalist,
    id: "gen-preferred",
    name: "Preferred Handyman",
    preferred_emergency: true,
  }
  const standardSpecialist = {
    ...specialist,
    preferred_emergency: false,
  }
  const preferredSpecialist = {
    ...specialist,
    id: "spec-preferred",
    name: "Preferred Plumber",
    preferred_emergency: true,
  }
  const standardGeneralist = {
    ...generalistB,
    preferred_emergency: false,
  }

  const decision = decideVendorAssignmentFromTiers(
    [standardSpecialist, preferredSpecialist],
    [preferredGeneralist, standardGeneralist],
  )
  assertEquals(decision.kind, "landlord_choice")
  if (decision.kind === "landlord_choice") {
    assertEquals(
      decision.options.map((o) => o.vendor.id),
      ["spec-preferred", "gen-preferred", "spec-1", "gen-2"],
    )
    assertEquals(
      decision.options.map((o) => o.role),
      ["specialist", "generalist", "specialist", "generalist"],
    )
  }
})

Deno.test("parseLandlordVendorChoice: YES confirms a single vendor", () => {
  const options = [
    { id: "gen-1", name: "Ivanhomesolutions", role: "generalist" as const },
  ]
  assertEquals(parseLandlordVendorChoice("YES", options)?.id, "gen-1")
  assertEquals(parseLandlordVendorChoice("ok", options)?.id, "gen-1")
  assertEquals(parseLandlordVendorChoice("1", options)?.id, "gen-1")
  assertEquals(parseLandlordVendorChoice("not now", options), null)
})

Deno.test("parseLandlordVendorChoice: 1 or 2 when two vendors are listed", () => {
  const options = [
    { id: "spec-1", name: "Manny Plumber", role: "specialist" as const },
    { id: "gen-1", name: "Ivanhomesolutions", role: "generalist" as const },
  ]
  assertEquals(parseLandlordVendorChoice("1", options)?.id, "spec-1")
  assertEquals(parseLandlordVendorChoice("2", options)?.id, "gen-1")
  assertEquals(parseLandlordVendorChoice("YES", options), null)
  assertEquals(parseLandlordVendorChoice("Ivanhomesolutions", options)?.id, "gen-1")
})

Deno.test("parseLandlordVendorChoice: numbered reply when two handymen are listed", () => {
  const options = [
    { id: "gen-1", name: "Ivanhomesolutions", role: "generalist" as const },
    { id: "gen-2", name: "Handyman Services By Michael", role: "generalist" as const },
  ]
  assertEquals(parseLandlordVendorChoice("1", options)?.id, "gen-1")
  assertEquals(parseLandlordVendorChoice("2", options)?.id, "gen-2")
  assertEquals(parseLandlordVendorChoice("Handyman Services By Michael", options)?.id, "gen-2")
})

Deno.test("canHandleLandlordVendorChoice honors pending ask even if phone was mislabeled resident", () => {
  const intake = {
    awaiting_vendor_choice: {
      ticket_id: "t1",
      options: [
        { id: "gen-1", name: "Ivanhomesolutions", role: "generalist" },
      ],
    },
  }
  assertEquals(
    canHandleLandlordVendorChoice({
      identityType: "landlord",
      conversationType: "landlord_update",
      intakeState: intake,
    }),
    true,
  )
  assertEquals(
    canHandleLandlordVendorChoice({
      identityType: "resident",
      conversationType: "resident_intake",
      intakeState: intake,
    }),
    true,
  )
  assertEquals(
    canHandleLandlordVendorChoice({
      identityType: "vendor",
      conversationType: "vendor_alert",
      intakeState: intake,
    }),
    false,
  )
  assertEquals(
    canHandleLandlordVendorChoice({
      identityType: "landlord",
      conversationType: "landlord_update",
      intakeState: {},
    }),
    false,
  )
  assertEquals(readAwaitingVendorChoice(intake)?.options.length, 1)
})

Deno.test("buildLandlordVendorChoiceSms asks YES for one vendor and 1 or 2 for two", () => {
  const one = buildLandlordVendorChoiceSms({
    landlordFirstName: "Alex",
    companyName: "Ulo Homes",
    workOrderRef: "WO-E6F7",
    unit: "1",
    tradeLabel: "plumbing",
    issueHeadline: "dripping faucet",
    locationLabel: "563 Springdale Circle",
    options: [
      { id: "gen-1", name: "Ivanhomesolutions", role: "generalist" },
    ],
  })
  assertEquals(one.includes("Reply YES to send this job to Ivanhomesolutions"), true)
  assertEquals(one.includes("property management team"), false)
  assertEquals(one.includes("WO-E6F7"), false)
  assertStringIncludes(one, "Hi Alex — job at 563 Springdale Circle, Unit 1")
  assertStringIncludes(one, "Issue: dripping faucet")
  assertStringIncludes(one, "Vendor: Ivanhomesolutions")

  const two = buildLandlordVendorChoiceSms({
    landlordFirstName: "Alex",
    companyName: "Ulo Homes",
    workOrderRef: "WO-E6F7",
    unit: "1",
    tradeLabel: "plumbing",
    options: [
      { id: "spec-1", name: "Manny Plumber", role: "specialist" },
      { id: "gen-1", name: "Ivanhomesolutions", role: "generalist" },
    ],
  })
  assertEquals(two.includes("Reply 1 or 2 to send them the job"), true)
  const twoHandymen = buildLandlordVendorChoiceSms({
    landlordFirstName: "Alex",
    companyName: "Ulo Homes",
    workOrderRef: "WO-E6F7",
    unit: "1",
    tradeLabel: "plumbing",
    options: [
      { id: "gen-1", name: "Ivanhomesolutions", role: "generalist" },
      { id: "gen-2", name: "Handyman Services By Michael", role: "generalist" },
    ],
  })
  assertEquals(twoHandymen.includes("Reply 1 or 2"), true)
  assertEquals(twoHandymen.includes("1 — Ivanhomesolutions"), true)
  assertEquals(twoHandymen.includes("2 — Handyman Services By Michael"), true)
})

Deno.test("buildLandlordVendorChoiceSms rematch copy does not auto-assign", () => {
  const sms = buildLandlordVendorChoiceSms({
    landlordFirstName: "Alex",
    companyName: "Ulo Homes",
    workOrderRef: "WO-E6F7",
    unit: "1",
    tradeLabel: "plumbing",
    reason: "no_response",
    options: [
      { id: "spec-1", name: "Frank Rooter LLC", role: "specialist" },
      { id: "gen-2", name: "Handyman Services By Michael", role: "generalist" },
    ],
  })
  assertEquals(sms.includes("hasn't responded in time"), true)
  assertEquals(sms.includes("Reply 1 or 2"), true)
  assertEquals(sms.includes("Frank Rooter LLC"), true)
  assertEquals(sms.includes("property management team"), false)
})

Deno.test("canReplaceAssignedVendorForLandlordChoice allows pending_accept rematch", () => {
  assertEquals(canReplaceAssignedVendorForLandlordChoice("pending_accept"), true)
  assertEquals(canReplaceAssignedVendorForLandlordChoice("accepted"), false)
  assertEquals(canReplaceAssignedVendorForLandlordChoice("in_progress"), false)
  assertEquals(ticketIsAwaitingLandlordVendorChoice("Awaiting landlord vendor choice"), true)
  assertEquals(ticketIsAwaitingLandlordVendorChoice(null), false)
})

Deno.test("landlordVendorChoiceResolvedIntake drops choice + probe host state", () => {
  const next = landlordVendorChoiceResolvedIntake({
    awaiting_vendor_choice: {
      ticket_id: "t1",
      options: [{ id: "v1", name: "Flex", role: "specialist" }],
    },
    vendor_availability_probe: { status: "awaiting_landlord", ticket_id: "t1" },
    unknown_contact_intake: { status: "identifying_location" },
    keep_me: true,
  })
  assertEquals(next.awaiting_vendor_choice, undefined)
  assertEquals(next.vendor_availability_probe, undefined)
  assertEquals(next.unknown_contact_intake, undefined)
  assertEquals(next.keep_me, true)
})

Deno.test("vendorChoiceOptionIdsEqual ignores order", () => {
  assertEquals(vendorChoiceOptionIdsEqual(["a", "b"], ["b", "a"]), true)
  assertEquals(vendorChoiceOptionIdsEqual(["a", "b"], ["a"]), false)
  assertEquals(vendorChoiceOptionIdsEqual(["a"], ["c"]), false)
})

Deno.test("external suggestions become numbered SMS choices", () => {
  const options = choiceOptionsFromExternalSuggestions(
    [
      { name: "Rapid Plumb Co.", providerRef: "biz-1", searchId: "s1", categoryId: "c1" },
      { name: "Metro Plumbing Services", providerRef: "biz-2" },
      { name: "Apex Pipe & Drain", providerRef: "biz-3" },
      { name: "Fourth should drop", providerRef: "biz-4" },
    ],
    3,
  )
  assertEquals(options.length, 3)
  assertEquals(options[0]?.id, "biz-1")
  assertEquals(options[0]?.role, "external")
  assertEquals(parseLandlordVendorChoice("1", options)?.name, "Rapid Plumb Co.")
  assertEquals(parseLandlordVendorChoice("3", options)?.id, "biz-3")
  assertEquals(parseLandlordVendorChoice("4", options), null)
  assertEquals(
    landlordNumberedChoiceReplyHint(3),
    "Reply 1, 2, or 3 and we'll contact them.",
  )
  assertEquals(
    formatExternalVendorSmsLine({
      name: "Rapid Plumb Co.",
      rating: 4.5,
      reviewCount: 100,
    }),
    "Rapid Plumb Co. · 4.5 stars (100 reviews)",
  )
  assertEquals(
    formatExternalVendorSmsLine({ name: "Solo Pro", rating: 1, reviewCount: 1 }),
    "Solo Pro · 1 star (1 review)",
  )
  assertEquals(formatExternalVendorSmsLine({ name: "No stats" }), "No stats")
})

Deno.test("readAwaitingVendorChoice keeps external search metadata", () => {
  const awaiting = readAwaitingVendorChoice({
    awaiting_vendor_choice: {
      ticket_id: "t-ext",
      search_location: "14 Maple Ave",
      issue_category: "plumbing",
      options: [
        {
          id: "biz-1",
          name: "Rapid Plumb Co.",
          role: "external",
          source: "external",
          search_id: "s1",
          category_id: "c1",
        },
      ],
    },
  })
  assertEquals(awaiting?.ticketId, "t-ext")
  assertEquals(awaiting?.searchLocation, "14 Maple Ave")
  assertEquals(awaiting?.options[0]?.searchId, "s1")
  assertEquals(awaiting?.options[0]?.source, "external")
})
