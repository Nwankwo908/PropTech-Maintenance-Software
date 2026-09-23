/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  AWAITING_VENDOR_AVAILABILITY_PROBE,
  buildVendorAvailabilityProbeSms,
  buildVendorProbeAckSms,
  canHandleVendorAvailabilityProbe,
  formatVendorProbeLocationLine,
  readAwaitingVendorProbe,
  readVendorAvailabilityProbe,
  ticketIsAwaitingVendorAvailabilityProbe,
} from "./vendorAvailabilityProbe.ts"
import { buildLandlordVendorChoiceSms } from "./vendorLandlordChoice.ts"

Deno.test("ticketIsAwaitingVendorAvailabilityProbe matches probe flag", () => {
  assertEquals(
    ticketIsAwaitingVendorAvailabilityProbe(AWAITING_VENDOR_AVAILABILITY_PROBE),
    true,
  )
  assertEquals(ticketIsAwaitingVendorAvailabilityProbe("Awaiting landlord vendor choice"), false)
  assertEquals(ticketIsAwaitingVendorAvailabilityProbe(null), false)
})

Deno.test("canHandleVendorAvailabilityProbe requires vendor + pending probe", () => {
  assertEquals(
    canHandleVendorAvailabilityProbe({
      identityType: "vendor",
      intakeState: {
        awaiting_vendor_probe: {
          ticket_id: "t1",
          vendor_id: "v1",
          sent_at: "2026-03-20T12:00:00.000Z",
        },
      },
    }),
    true,
  )
  assertEquals(
    canHandleVendorAvailabilityProbe({
      identityType: "landlord",
      intakeState: {
        awaiting_vendor_probe: {
          ticket_id: "t1",
          vendor_id: "v1",
          sent_at: "2026-03-20T12:00:00.000Z",
        },
      },
    }),
    false,
  )
  assertEquals(
    canHandleVendorAvailabilityProbe({
      identityType: "vendor",
      intakeState: {},
    }),
    false,
  )
})

Deno.test("readAwaitingVendorProbe + readVendorAvailabilityProbe round-trip shape", () => {
  const pending = readAwaitingVendorProbe({
    awaiting_vendor_probe: {
      ticket_id: "ticket-1",
      vendor_id: "vendor-1",
      sent_at: "2026-03-20T12:00:00.000Z",
    },
  })
  assertEquals(pending?.ticketId, "ticket-1")
  assertEquals(pending?.vendorId, "vendor-1")

  const probe = readVendorAvailabilityProbe({
    vendor_availability_probe: {
      ticket_id: "ticket-1",
      landlord_id: "ll-1",
      unit: "Unit 2",
      issue_category: "plumbing",
      description: "Kitchen sink leaking",
      resident_availability_text: "Weekdays after 3pm",
      candidates: [
        {
          vendor_id: "vendor-1",
          name: "Manny Plumber",
          role: "specialist",
          phone: "+15551212",
        },
      ],
      offers: [
        {
          vendor_id: "vendor-1",
          name: "Manny Plumber",
          role: "specialist",
          window_label: "Wed 9am–12pm",
          scheduled_at: "2026-03-25T13:00:00.000Z",
          end_at: "2026-03-25T16:00:00.000Z",
          estimate_note: "$150",
          received_at: "2026-03-20T12:05:00.000Z",
        },
      ],
      declined_vendor_ids: [],
      status: "awaiting_landlord",
      started_at: "2026-03-20T12:00:00.000Z",
      landlord_notified_at: "2026-03-20T12:05:00.000Z",
    },
  })
  assertEquals(probe?.ticketId, "ticket-1")
  assertEquals(probe?.offers.length, 1)
  assertEquals(probe?.offers[0]?.windowLabel, "Wed 9am–12pm")
  assertEquals(probe?.offers[0]?.estimateNote, "$150")
  assertEquals(probe?.status, "awaiting_landlord")
})

Deno.test("buildVendorAvailabilityProbeSms asks for window before assign", () => {
  const body = buildVendorAvailabilityProbeSms({
    vendorName: "Manny Plumber",
    companyName: "acme property",
    workOrderRef: "WO-1234",
    location: "14 Maple Ave · Unit 1",
    issueHeadline: "Kitchen sink leaking",
    entryOkIfAbsent: true,
    residentAvailabilityText: "Weekdays after 3pm",
  })
  assertStringIncludes(body, "Hi Manny Plumber — job WO-1234 at 14 Maple Ave · Unit 1")
  assertStringIncludes(body, "Acme Property")
  assertStringIncludes(body, "Issue: Kitchen sink leaking")
  assertStringIncludes(body, "Entry OK if resident out: Yes")
  assertStringIncludes(body, "Resident avail: Weekdays after 3pm")
  assertStringIncludes(body, "Take it? Reply earliest day + window")
  assertStringIncludes(body, "Can't? Reply NO WO-1234")
  // Accept and decline sit on adjacent lines — no blank between them.
  assertStringIncludes(
    body,
    "Take it? Reply earliest day + window (ex: Wed 9am-12pm) + estimate if you have one\nCan't? Reply NO WO-1234",
  )
})

Deno.test("buildVendorAvailabilityProbeSms uses clean headline, not Q&A-stuffed description", () => {
  const stuffed =
    "No water pressure Tenant update: No Affected area: kitchen. Entry if not home: No."
  const body = buildVendorAvailabilityProbeSms({
    vendorName: "Flex plumbing",
    companyName: "maurice mcdonald properties",
    workOrderRef: "WO-6633",
    location: "120 Main St · Unit 1",
    // Callers may still pass the stuffed description for legacy fields —
    // the rendered issue line must ignore it.
    description: stuffed,
    issueHeadline: "No water pressure",
    entryOkIfAbsent: false,
    urgent: true,
  })

  assertStringIncludes(body, "Hi Flex Plumbing — job WO-6633 at 120 Main St · Unit 1 — URGENT")
  assertStringIncludes(body, "Maurice Mcdonald Properties")
  assertStringIncludes(body, "Issue: No water pressure")
  assertStringIncludes(body, "Entry OK if resident out: No")
  const issueLine = body.split("\n").find((l) => l.startsWith("Issue:")) ?? ""
  assertEquals(issueLine, "Issue: No water pressure")
  assertEquals(/Tenant update/i.test(issueLine), false)
  assertEquals(/Affected area/i.test(issueLine), false)
  assertEquals(/Entry if not home/i.test(issueLine), false)
  // Stuffed description text must not appear anywhere as the issue body.
  assertEquals(body.includes(stuffed), false)
})

Deno.test("formatVendorProbeLocationLine prefers street address over bare unit", () => {
  assertEquals(
    formatVendorProbeLocationLine({
      streetAddress: "14 Maple Ave",
      unit: "1",
    }),
    "14 Maple Ave · Unit 1",
  )
  assertEquals(
    formatVendorProbeLocationLine({ unit: "1" }),
    "Unit 1",
  )
  assertEquals(
    formatVendorProbeLocationLine({
      streetAddress: "14 Maple Ave",
      unit: null,
    }),
    "14 Maple Ave",
  )
})

Deno.test("buildVendorAvailabilityProbeSms omits entry line when unknown", () => {
  const body = buildVendorAvailabilityProbeSms({
    vendorName: "Manny Plumber",
    companyName: "Acme",
    workOrderRef: "WO-1",
    unit: "2",
    issueHeadline: "Clogged drain",
  })
  assertEquals(/Entry OK if resident out/i.test(body), false)
  assertEquals(/URGENT/i.test(body), false)
})

Deno.test("buildVendorProbeAckSms confirms window without assigning", () => {
  const body = buildVendorProbeAckSms({
    windowLabel: "Wed 9am–12pm",
    workOrderRef: "WO-1234",
  })
  assertStringIncludes(body, "Wed 9am–12pm")
  assertStringIncludes(body, "if the property team selects you")
})

Deno.test("landlord choice SMS after probe uses availability reason", () => {
  const body = buildLandlordVendorChoiceSms({
    landlordFirstName: "Osita",
    companyName: "Osita properties",
    workOrderRef: "WO-1234",
    unit: "Unit 1",
    tradeLabel: "plumbing",
    reason: "availability",
    issueHeadline: "dripping faucet",
    locationLabel: "563 Springdale Circle",
    options: [
      {
        id: "v1",
        name: "Flex Plumbing",
        role: "specialist",
        windowLabel: "Thursday, Sep 24 · 10 AM–1 PM",
        estimateNote: "$200",
      },
      {
        id: "v2",
        name: "Rapid Plumb",
        role: "specialist",
        windowLabel: "Thu morning",
      },
    ],
    adminUrl: "https://www.ulohome.io/admin/requests?q=WO-1234",
  })
  assertStringIncludes(
    body,
    "Hi Osita — vendors are available for the dripping faucet at 563 Springdale Circle.",
  )
  assertEquals(body.includes("property management team"), false)
  assertEquals(body.includes("returned availability"), false)
  assertEquals(body.includes("WO-1234"), true) // details URL
  assertStringIncludes(body, "1 — Flex Plumbing")
  assertStringIncludes(body, "Thursday, Sep 24 · 10 AM–1 PM")
  assertStringIncludes(body, "$200")
  assertStringIncludes(body, "Reply 1 or 2 to send them the job.")
  assertStringIncludes(body, "Details: https://www.ulohome.io/admin/requests?q=WO-1234")
})

Deno.test("landlord choice SMS single vendor is scannable with title-cased vendor", () => {
  const withEstimate = buildLandlordVendorChoiceSms({
    landlordFirstName: "Osita",
    companyName: "Osita properties",
    workOrderRef: "WO-1C50",
    unit: "1",
    tradeLabel: "plumbing",
    reason: "availability",
    issueHeadline: "dripping faucet",
    locationLabel: "563 Springdale Circle",
    adminUrl: "https://www.ulohome.io/admin/requests?q=WO-1C50",
    options: [
      {
        id: "v1",
        name: "flex plumbing",
        role: "specialist",
        windowLabel: "Thursday, Sep 24 · 10 AM–1 PM",
        estimateNote: "$200",
      },
    ],
  })
  assertEquals(
    withEstimate,
    [
      "Hi Osita — job at 563 Springdale Circle, Unit 1",
      "",
      "Issue: dripping faucet",
      "Vendor: Flex Plumbing",
      "Available: Thursday, Sep 24 · 10 AM–1 PM",
      "Estimate: $200",
      "",
      "Reply YES to send this job to Flex Plumbing.",
      "",
      "Details: https://www.ulohome.io/admin/requests?q=WO-1C50",
    ].join("\n"),
  )

  const noEstimate = buildLandlordVendorChoiceSms({
    landlordFirstName: "Osita",
    workOrderRef: "WO-1C50",
    unit: "1",
    tradeLabel: "plumbing",
    reason: "availability",
    issueHeadline: "dripping faucet",
    locationLabel: "563 Springdale Circle · Unit 1",
    adminUrl: "https://www.ulohome.io/admin/requests?q=WO-1C50",
    options: [
      {
        id: "v1",
        name: "Flex Plumbing",
        role: "specialist",
        windowLabel: "Thursday, Sep 24 · 10 AM–1 PM",
      },
    ],
  })
  assertEquals(noEstimate.includes("Estimate:"), false)
  assertEquals(noEstimate.includes("$undefined"), false)
  assertEquals(noEstimate.includes("Estimate: $"), false)
  assertStringIncludes(noEstimate, "Hi Osita — job at 563 Springdale Circle, Unit 1")
  assertStringIncludes(noEstimate, "Issue: dripping faucet")
  assertStringIncludes(noEstimate, "Vendor: Flex Plumbing")
  assertStringIncludes(noEstimate, "Available: Thursday, Sep 24 · 10 AM–1 PM")
  assertStringIncludes(noEstimate, "Reply YES to send this job to Flex Plumbing.")
})
