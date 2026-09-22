/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  AWAITING_VENDOR_AVAILABILITY_PROBE,
  buildVendorAvailabilityProbeSms,
  buildVendorProbeAckSms,
  canHandleVendorAvailabilityProbe,
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
    companyName: "Acme Property",
    workOrderRef: "WO-1234",
    unit: "14 Maple · Unit 1",
    description: "Kitchen sink leaking",
    residentAvailabilityText: "Weekdays after 3pm",
  })
  assertStringIncludes(body, "Acme Property")
  assertStringIncludes(body, "Kitchen sink leaking")
  assertStringIncludes(body, "Resident availability: Weekdays after 3pm")
  assertStringIncludes(body, "earliest day and arrival window")
  assertStringIncludes(body, "NO WO-1234")
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
    landlordFirstName: "Alex",
    companyName: "Acme Property",
    workOrderRef: "WO-1234",
    unit: "Unit 1",
    tradeLabel: "plumbing",
    reason: "availability",
    options: [
      { id: "v1", name: "Manny Plumber — Wed 9am–12pm · $150", role: "specialist" },
      { id: "v2", name: "Rapid Plumb — Thu morning", role: "specialist" },
    ],
  })
  assertStringIncludes(body, "returned availability")
  assertStringIncludes(body, "These vendors shared availability:")
  assertStringIncludes(body, "1. Manny Plumber — Wed 9am–12pm · $150")
  assertStringIncludes(body, "Reply 1 or 2")
})
