/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  AWAITING_VENDOR_AVAILABILITY_PROBE,
  VENDOR_PROBE_HOLD_MS,
  buildLandlordInspectionVisitChoiceSms,
  buildLandlordProbeStatusSms,
  buildVendorAvailabilityProbeSms,
  buildVendorInspectionVisitAckSms,
  buildVendorInspectionVisitProbeSms,
  buildVendorOpenProbesReminderSms,
  buildVendorProbeAckSms,
  buildVendorProbeWhichJobSms,
  canHandleVendorAvailabilityProbe,
  checklistLabelFromTicketDescription,
  formatVendorProbeLocationLine,
  probeAllCandidatesResponded,
  probePhoneCandidates,
  readAwaitingVendorProbe,
  readAwaitingVendorProbes,
  readVendorAvailabilityProbe,
  removeAwaitingVendorProbeFromIntake,
  resolveVendorProbeTicketFromReply,
  shouldFinalizeVendorProbeHold,
  ticketIsAwaitingVendorAvailabilityProbe,
  upsertAwaitingVendorProbeOnIntake,
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
  assertStringIncludes(body, "Reply 1 or 2 — if you have more than one pending, include the address")
  assertStringIncludes(body, "Hi Osita — vendors available")
  assertStringIncludes(body, "Ref: WO-1234")
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
  assertStringIncludes(body, "Hi Osita — vendor available")
  assertStringIncludes(body, "Flex Plumbing is available.")
  assertStringIncludes(body, "Reply YES to send the job to Flex Plumbing")
  assertStringIncludes(body, "Ref: WO-1C50")
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

Deno.test("upsertAwaitingVendorProbeOnIntake keeps multiple tickets (no last-write-wins)", () => {
  let intake: Record<string, unknown> = {}
  intake = upsertAwaitingVendorProbeOnIntake(intake, {
    ticketId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    vendorId: "v1",
    sentAt: "2026-09-29T13:21:41.000Z",
    workOrderRef: "WO-AAAA",
    issueHeadline: "Kitchen stove",
  })
  intake = upsertAwaitingVendorProbeOnIntake(intake, {
    ticketId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    vendorId: "v1",
    sentAt: "2026-09-29T13:21:43.000Z",
    workOrderRef: "WO-BBBB",
    issueHeadline: "Ceiling",
  })
  const probes = readAwaitingVendorProbes(intake)
  assertEquals(probes.length, 2)
  assertEquals(probes.map((p) => p.ticketId).sort().join(","), [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  ].sort().join(","))
  // Legacy single still present (most recent) for older readers.
  assertEquals(readAwaitingVendorProbe(intake)?.ticketId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2")
})

Deno.test("resolveVendorProbeTicketFromReply: WO code picks the matching ticket", () => {
  const probes = [
    {
      ticketId: "d1548c67-21e9-45c4-95aa-9983689abef5",
      vendorId: "v1",
      sentAt: "t1",
      workOrderRef: "WO-D154",
      issueHeadline: "Kitchen stove",
    },
    {
      ticketId: "4052eb01-da51-4120-abdf-368e2580abe0",
      vendorId: "v1",
      sentAt: "t2",
      workOrderRef: "WO-4052",
      issueHeadline: "Garbage",
    },
  ]
  const hit = resolveVendorProbeTicketFromReply({
    body: "WO-D154 Wed 9am-12pm",
    probes,
  })
  assertEquals(hit.kind, "matched")
  if (hit.kind !== "matched") return
  assertEquals(hit.probe.ticketId, "d1548c67-21e9-45c4-95aa-9983689abef5")
  assertEquals(hit.bodyForParse.toLowerCase().includes("wo-d154"), false)
  assertStringIncludes(hit.bodyForParse.toLowerCase(), "wed")
})

Deno.test("resolveVendorProbeTicketFromReply: multiple without WO → ambiguous", () => {
  const probes = [
    {
      ticketId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      vendorId: "v1",
      sentAt: "t1",
      workOrderRef: "WO-AAAA",
    },
    {
      ticketId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      vendorId: "v1",
      sentAt: "t2",
      workOrderRef: "WO-BBBB",
    },
  ]
  const hit = resolveVendorProbeTicketFromReply({
    body: "Tomorrow 10am",
    probes,
  })
  assertEquals(hit.kind, "ambiguous")
  const clarify = buildVendorProbeWhichJobSms(probes)
  assertStringIncludes(clarify, "WO-AAAA")
  assertStringIncludes(clarify, "WO-BBBB")
  assertStringIncludes(clarify, "which job")
})

Deno.test("checklistLabelFromTicketDescription strips HQS fail prefix", () => {
  assertEquals(
    checklistLabelFromTicketDescription(
      "HQS fail: Kitchen - Stove or Range with Oven\nrepair gas range",
    ),
    "Kitchen — Stove or Range with Oven",
  )
})

Deno.test("buildVendorInspectionVisitProbeSms: one scheduling ask for the visit", () => {
  const body = buildVendorInspectionVisitProbeSms({
    vendorName: "Handyman Services by Michael",
    companyName: "Ulo",
    location: "646 Bartlett · Unit 1",
    inspectionRef: "IR-8AC8",
    items: [
      { label: "Kitchen — Stove or Range with Oven", workOrderRef: "WO-D154" },
      { label: "Living Room — Ceiling Condition", workOrderRef: "WO-5E0A" },
      { label: "Deteriorated Bathtub", workOrderRef: "WO-B7EF" },
    ],
  })
  assertStringIncludes(body, "inspection visit at 646 Bartlett")
  assertStringIncludes(body, "Kitchen — Stove or Range with Oven (WO-D154)")
  assertStringIncludes(body, "Living Room — Ceiling Condition (WO-5E0A)")
  assertStringIncludes(body, "Deteriorated Bathtub (WO-B7EF)")
  assertStringIncludes(body, "one day + window for the whole visit")
  // Primary framing is the visit checklist — not three separate Take it? asks.
  assertEquals((body.match(/Take it\?/g) ?? []).length, 0)
  assertEquals((body.match(/earliest day \+ window/gi) ?? []).length, 0)
  assertStringIncludes(body, "NO + that WO code")
})

Deno.test("resolveVendorProbeTicketFromReply: shared inspection report → visit_group", () => {
  const reportId = "8ac8ee35-9f78-44ec-85a8-97b90442e54c"
  const probes = [
    {
      ticketId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      vendorId: "v1",
      sentAt: "t1",
      workOrderRef: "WO-AAAA",
      issueHeadline: "Kitchen stove",
      inspectionReportId: reportId,
    },
    {
      ticketId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      vendorId: "v1",
      sentAt: "t2",
      workOrderRef: "WO-BBBB",
      issueHeadline: "Ceiling",
      inspectionReportId: reportId,
    },
    {
      ticketId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      vendorId: "v1",
      sentAt: "t3",
      workOrderRef: "WO-CCCC",
      issueHeadline: "Bathtub",
      inspectionReportId: reportId,
    },
  ]
  const hit = resolveVendorProbeTicketFromReply({
    body: "Wed 9am-12pm",
    probes,
  })
  assertEquals(hit.kind, "visit_group")
  if (hit.kind !== "visit_group") return
  assertEquals(hit.probes.length, 3)
  assertEquals(hit.inspectionReportId, reportId)
})

Deno.test("resolveVendorProbeTicketFromReply: NO + WO declines only that ticket in a visit group", () => {
  const reportId = "8ac8ee35-9f78-44ec-85a8-97b90442e54c"
  const probes = [
    {
      ticketId: "d1548c67-21e9-45c4-95aa-9983689abef5",
      vendorId: "v1",
      sentAt: "t1",
      workOrderRef: "WO-D154",
      inspectionReportId: reportId,
    },
    {
      ticketId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      vendorId: "v1",
      sentAt: "t2",
      workOrderRef: "WO-BBBB",
      inspectionReportId: reportId,
    },
    {
      ticketId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      vendorId: "v1",
      sentAt: "t3",
      workOrderRef: "WO-CCCC",
      inspectionReportId: reportId,
    },
  ]
  const hit = resolveVendorProbeTicketFromReply({
    body: "NO WO-D154",
    probes,
  })
  assertEquals(hit.kind, "matched")
  if (hit.kind !== "matched") return
  assertEquals(hit.probe.ticketId, "d1548c67-21e9-45c4-95aa-9983689abef5")
  // Remaining two stay independently pending after remove of the matched one.
  let intake: Record<string, unknown> = {}
  for (const p of probes) {
    intake = upsertAwaitingVendorProbeOnIntake(intake, p)
  }
  intake = removeAwaitingVendorProbeFromIntake(intake, hit.probe.ticketId)
  const left = readAwaitingVendorProbes(intake)
  assertEquals(left.length, 2)
  assertEquals(left.some((p) => p.ticketId === hit.probe.ticketId), false)
})

Deno.test("buildLandlordInspectionVisitChoiceSms consolidates items under one YES", () => {
  const body = buildLandlordInspectionVisitChoiceSms({
    landlordFirstName: "Alex",
    vendorName: "Handyman Services by Michael",
    locationLabel: "646 Bartlett · Unit 1",
    windowLabel: "Wed 9am–12pm",
    workOrderRef: "WO-D154",
    items: [
      { label: "Kitchen — Stove", workOrderRef: "WO-D154" },
      { label: "Ceiling", workOrderRef: "WO-5E0A" },
      { label: "Bathtub", workOrderRef: "WO-B7EF" },
    ],
  })
  assertStringIncludes(body, "Hi Alex — vendor available")
  assertStringIncludes(body, "646 Bartlett · Unit 1 · inspection visit")
  assertStringIncludes(body, "Kitchen — Stove")
  assertEquals(body.includes("Kitchen — Stove (WO-D154)"), false)
  assertStringIncludes(body, "Reply YES to send the job to Handyman Services By Michael")
  assertStringIncludes(body, "Ref: WO-D154")
  assertEquals((body.match(/Reply YES/g) ?? []).length, 1)
})

Deno.test("buildVendorInspectionVisitAckSms covers item count", () => {
  const body = buildVendorInspectionVisitAckSms({
    windowLabel: "Wed 9am–12pm",
    itemCount: 3,
  })
  assertStringIncludes(body, "Wed 9am–12pm")
  assertStringIncludes(body, "3 items")
})

Deno.test("per-ticket completion stays independent of shared visit schedule", () => {
  // Pure contract: shared scheduled_at does not imply shared vendor_work_status.
  const tickets = [
    { id: "t1", scheduled_at: "2026-10-01T13:00:00.000Z", vendor_work_status: "completed" },
    { id: "t2", scheduled_at: "2026-10-01T13:00:00.000Z", vendor_work_status: "completed" },
    { id: "t3", scheduled_at: "2026-10-01T13:00:00.000Z", vendor_work_status: "pending_accept" },
  ]
  assertEquals(new Set(tickets.map((t) => t.scheduled_at)).size, 1)
  assertEquals(
    tickets.filter((t) => t.vendor_work_status === "completed").map((t) => t.id),
    ["t1", "t2"],
  )
  assertEquals(
    tickets.find((t) => t.id === "t3")?.vendor_work_status,
    "pending_accept",
  )
})

Deno.test("removeAwaitingVendorProbeFromIntake leaves siblings pending", () => {
  let intake: Record<string, unknown> = {}
  intake = upsertAwaitingVendorProbeOnIntake(intake, {
    ticketId: "t1",
    vendorId: "v1",
    sentAt: "a",
  })
  intake = upsertAwaitingVendorProbeOnIntake(intake, {
    ticketId: "t2",
    vendorId: "v1",
    sentAt: "b",
  })
  intake = removeAwaitingVendorProbeFromIntake(intake, "t1")
  const left = readAwaitingVendorProbes(intake)
  assertEquals(left.length, 1)
  assertEquals(left[0]?.ticketId, "t2")
})

Deno.test("buildVendorOpenProbesReminderSms lists all WO codes", () => {
  const body = buildVendorOpenProbesReminderSms({
    vendorName: "Handyman Services By Michael",
    probes: [
      { workOrderRef: "WO-D154", issueHeadline: "Kitchen stove" },
      { workOrderRef: "WO-4052", issueHeadline: "Garbage" },
    ],
  })
  assertStringIncludes(body, "WO-D154")
  assertStringIncludes(body, "WO-4052")
  assertStringIncludes(body, "2 open jobs")
})

Deno.test("legacy single awaiting_vendor_probe still readable via list helper", () => {
  const probes = readAwaitingVendorProbes({
    awaiting_vendor_probe: {
      ticket_id: "legacy-1",
      vendor_id: "v1",
      sent_at: "2026-09-29T13:21:58.000Z",
    },
  })
  assertEquals(probes.length, 1)
  assertEquals(probes[0]?.ticketId, "legacy-1")
})
