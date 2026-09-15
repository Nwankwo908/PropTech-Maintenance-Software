/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { decideVendorAssignmentFromTiers } from "./vendor_assignment.ts"
import {
  buildLandlordVendorChoiceSms,
  canHandleLandlordVendorChoice,
  parseLandlordVendorChoice,
  readAwaitingVendorChoice,
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

Deno.test("canHandleLandlordVendorChoice requires pending ask on landlord thread", () => {
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
      conversationType: "landlord_update",
      intakeState: intake,
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
    options: [
      { id: "gen-1", name: "Ivanhomesolutions", role: "generalist" },
    ],
  })
  assertEquals(one.includes("Reply YES"), true)
  assertEquals(one.includes("Ivanhomesolutions"), true)

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
  assertEquals(twoHandymen.includes("1. Ivanhomesolutions"), true)
  assertEquals(twoHandymen.includes("2. Handyman Services By Michael"), true)
})
