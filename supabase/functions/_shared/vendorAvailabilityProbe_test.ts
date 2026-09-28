/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  AWAITING_VENDOR_AVAILABILITY_PROBE,
  VENDOR_PROBE_HOLD_MS,
  buildLandlordProbeStatusSms,
  buildVendorAvailabilityProbeSms,
  buildVendorProbeAckSms,
  canHandleVendorAvailabilityProbe,
  formatVendorProbeLocationLine,
  probeAllCandidatesResponded,
  probePhoneCandidates,
  readAwaitingVendorProbe,
  readVendorAvailabilityProbe,
  shouldFinalizeVendorProbeHold,
  ticketIsAwaitingVendorAvailabilityProbe,
  type VendorAvailabilityProbe,
} from "./vendorAvailabilityProbe.ts"
import {
  buildLandlordProbeHoldClarifySms,
  buildLandlordVendorChoiceSms,
  canHandleLandlordVendorChoice,
  intakeHasActiveVendorProbeHold,
  parseLandlordVendorChoice,
} from "./vendorLandlordChoice.ts"

function baseProbe(
  overrides: Partial<VendorAvailabilityProbe> = {},
): VendorAvailabilityProbe {
  return {
    ticketId: "ticket-1",
    landlordId: "ll-1",
    unit: "Unit 1",
    issueCategory: "plumbing",
    description: "Kitchen sink leaking",
    issueHeadline: "dripping faucet",
    entryOkIfAbsent: null,
    urgent: false,
    residentAvailabilityText: null,
    candidates: [
      {
        vendorId: "v1",
        name: "mecus handman",
        role: "generalist",
        phone: "+15551110001",
      },
      {
        vendorId: "v2",
        name: "Flex Plumbing",
        role: "specialist",
        phone: "+15551110002",
      },
    ],
    offers: [],
    declinedVendorIds: [],
    status: "probing",
    startedAt: "2026-03-20T12:00:00.000Z",
    firstOfferAt: null,
    statusSmsSentAt: null,
    holdUntil: null,
    landlordNotifiedAt: null,
    ...overrides,
  }
}

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

  const probe = readVendorAvailabilityProbe({
    vendor_availability_probe: {
      ticket_id: "ticket-1",
      landlord_id: "ll-1",
      unit: "Unit 2",
      issue_category: "plumbing",
      description: "Kitchen sink leaking",
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
      status: "holding",
      started_at: "2026-03-20T12:00:00.000Z",
      first_offer_at: "2026-03-20T12:05:00.000Z",
      status_sms_sent_at: "2026-03-20T12:05:00.000Z",
      hold_until: "2026-03-20T12:25:00.000Z",
      landlord_notified_at: null,
    },
  })
  assertEquals(probe?.status, "holding")
  assertEquals(probe?.firstOfferAt, "2026-03-20T12:05:00.000Z")
  assertEquals(probe?.holdUntil, "2026-03-20T12:25:00.000Z")
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
  assertStringIncludes(body, "Manny Plumber")
  assertStringIncludes(body, "WO-1234")
})

Deno.test("formatVendorProbeLocationLine joins street and unit", () => {
  assertEquals(
    formatVendorProbeLocationLine({
      streetAddress: "14 Maple Ave",
      unit: "1",
    }),
    "14 Maple Ave · Unit 1",
  )
})

Deno.test("buildVendorProbeAckSms confirms window without assigning", () => {
  const body = buildVendorProbeAckSms({
    windowLabel: "Wed 9am–12pm",
    workOrderRef: "WO-1234",
  })
  assertStringIncludes(body, "Wed 9am–12pm")
  assertStringIncludes(body, "if the property team selects you")
})

Deno.test("buildLandlordProbeStatusSms is not an approval ask", () => {
  const body = buildLandlordProbeStatusSms({
    issueHeadline: "dripping faucet",
    locationLabel: "563 Springdale Circle · Unit 1",
  })
  assertStringIncludes(body, "Checking vendor availability for dripping faucet")
  assertStringIncludes(body, "563 Springdale Circle · Unit 1")
  assertStringIncludes(body, "I'll follow up shortly with options")
  assertEquals(/Reply YES/i.test(body), false)
  assertEquals(/Reply 1/i.test(body), false)
})

Deno.test("hold finalize: two offers within window → ready once both responded", () => {
  const t0 = Date.parse("2026-03-20T12:00:00.000Z")
  const probe = baseProbe({
    status: "holding",
    firstOfferAt: new Date(t0).toISOString(),
    statusSmsSentAt: new Date(t0).toISOString(),
    holdUntil: new Date(t0 + VENDOR_PROBE_HOLD_MS).toISOString(),
    offers: [
      {
        vendorId: "v1",
        name: "mecus handman",
        role: "generalist",
        windowLabel: "Thu 10am",
        scheduledAt: null,
        endAt: null,
        estimateNote: "$200",
        receivedAt: new Date(t0).toISOString(),
      },
    ],
  })
  // Still waiting on v2 — do not finalize early.
  assertEquals(shouldFinalizeVendorProbeHold(probe, t0 + 5 * 60_000), false)

  probe.offers.push({
    vendorId: "v2",
    name: "Flex Plumbing",
    role: "specialist",
    windowLabel: "Fri morning",
    scheduledAt: null,
    endAt: null,
    estimateNote: null,
    receivedAt: new Date(t0 + 5 * 60_000).toISOString(),
  })
  assertEquals(probeAllCandidatesResponded(probe), true)
  assertEquals(shouldFinalizeVendorProbeHold(probe, t0 + 5 * 60_000), true)
})

Deno.test("hold finalize: single responder waits for timeout, not immediate decision", () => {
  const t0 = Date.parse("2026-03-20T12:00:00.000Z")
  const probe = baseProbe({
    status: "holding",
    firstOfferAt: new Date(t0).toISOString(),
    statusSmsSentAt: new Date(t0).toISOString(),
    holdUntil: new Date(t0 + VENDOR_PROBE_HOLD_MS).toISOString(),
    offers: [
      {
        vendorId: "v1",
        name: "mecus handman",
        role: "generalist",
        windowLabel: "Thu 10am",
        scheduledAt: null,
        endAt: null,
        estimateNote: null,
        receivedAt: new Date(t0).toISOString(),
      },
    ],
  })
  assertEquals(probePhoneCandidates(probe).length, 2)
  assertEquals(shouldFinalizeVendorProbeHold(probe, t0 + 5 * 60_000), false)
  assertEquals(
    shouldFinalizeVendorProbeHold(probe, t0 + VENDOR_PROBE_HOLD_MS),
    true,
  )
})

Deno.test("single soft-offered vendor finalizes immediately (no hold)", () => {
  const probe = baseProbe({
    candidates: [
      {
        vendorId: "v1",
        name: "Flex Plumbing",
        role: "specialist",
        phone: "+15551110001",
      },
    ],
    offers: [
      {
        vendorId: "v1",
        name: "Flex Plumbing",
        role: "specialist",
        windowLabel: "Thu",
        scheduledAt: null,
        endAt: null,
        estimateNote: "$90",
        receivedAt: "2026-03-20T12:05:00.000Z",
      },
    ],
  })
  assertEquals(shouldFinalizeVendorProbeHold(probe), true)
})

Deno.test("landlord choice SMS title-cases vendor names and shows missing estimate", () => {
  const body = buildLandlordVendorChoiceSms({
    landlordFirstName: "Osita",
    workOrderRef: "WO-1234",
    unit: "Unit 1",
    tradeLabel: "plumbing",
    reason: "availability",
    issueHeadline: "dripping faucet",
    locationLabel: "563 Springdale Circle",
    options: [
      {
        id: "v1",
        name: "mecus handman",
        role: "generalist",
        windowLabel: "Thursday, Sep 24 · 10 AM–1 PM",
        estimateNote: "$200",
      },
      {
        id: "v2",
        name: "flex plumbing",
        role: "specialist",
        windowLabel: "Thu morning",
      },
    ],
    adminUrl: "https://www.ulohome.io/admin/requests?q=WO-1234",
  })
  assertStringIncludes(body, "1 — Mecus Handman")
  assertStringIncludes(body, "2 — Flex Plumbing")
  assertStringIncludes(body, "$200")
  assertStringIncludes(body, "No estimate provided")
  assertStringIncludes(body, "Reply 1 or 2 to send them the job.")
  assertEquals(body.includes("mecus handman"), false)
})

Deno.test("landlord choice SMS single vendor title-cases and asks YES", () => {
  const body = buildLandlordVendorChoiceSms({
    landlordFirstName: "Osita",
    workOrderRef: "WO-1C50",
    tradeLabel: "plumbing",
    reason: "availability",
    issueHeadline: "dripping faucet",
    locationLabel: "563 Springdale Circle",
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
  assertStringIncludes(body, "Flex Plumbing is available for")
  assertStringIncludes(body, "Reply YES to send the job to Flex Plumbing.")
  assertEquals(body.includes("flex plumbing"), false)
})

Deno.test("hold window: landlord reply is not silently dropped or treated as YES", () => {
  const intake = {
    vendor_availability_probe: {
      ticket_id: "ticket-1",
      landlord_id: "ll-1",
      status: "holding",
      offers: [{ vendor_id: "v1", name: "Flex", role: "specialist" }],
      candidates: [],
      declined_vendor_ids: [],
      landlord_notified_at: null,
    },
  }
  assertEquals(intakeHasActiveVendorProbeHold(intake), true)
  assertEquals(
    canHandleLandlordVendorChoice({
      identityType: "landlord",
      intakeState: intake,
    }),
    true,
  )
  const clarify = buildLandlordProbeHoldClarifySms()
  assertStringIncludes(clarify, "still being gathered")
  assertEquals(/How can we help with your maintenance/i.test(clarify), false)
  // No awaiting_vendor_choice yet — YES must not parse as an approval.
  assertEquals(parseLandlordVendorChoice("YES", []), null)
})

Deno.test(
  "bare YES after numbered multi-vendor decision does not pick a vendor",
  () => {
    const options = [
      { id: "v1", name: "Mecus Handman", role: "generalist" as const },
      { id: "v2", name: "Flex Plumbing", role: "specialist" as const },
    ]
    assertEquals(parseLandlordVendorChoice("YES", options), null)
    assertEquals(parseLandlordVendorChoice("1", options)?.id, "v1")
    assertEquals(parseLandlordVendorChoice("2", options)?.id, "v2")
  },
)

Deno.test("VENDOR_PROBE_HOLD_MS is in the 15–30 minute band", () => {
  assertEquals(VENDOR_PROBE_HOLD_MS >= 15 * 60_000, true)
  assertEquals(VENDOR_PROBE_HOLD_MS <= 30 * 60_000, true)
})
