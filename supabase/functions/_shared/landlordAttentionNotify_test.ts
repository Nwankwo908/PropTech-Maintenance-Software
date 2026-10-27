/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { summarizeEmergencyForLandlord } from "../../../shared/maintenance/emergencyLandlordSummary.ts"
import { findVendorTicketToken } from "../../../shared/maintenance/findVendorLink.ts"
import {
  buildLandlordAttentionEmail,
  buildLandlordAttentionSms,
  formatReportedAgo,
  landlordAttentionInboxPersistMode,
  shortRepairLabel,
} from "./landlordAttentionNotify.ts"

Deno.test("invoice_ready SMS uses YES/NO paid confirmation (no numbered fake options)", () => {
  const body = buildLandlordAttentionSms({
    kind: "invoice_ready",
    headline: "Invoice ready to pay",
    detail: "Unit 2B · Flex Plumbing · $450.00",
    dashboardUrl: "https://www.ulohome.io/admin/requests?q=WO-9E41",
    invoicePaid: {
      landlordFirstName: "Alex",
      unit: "2B",
      vendorName: "flex plumbing",
      amount: 450,
      jobHeadline: "Leaking kitchen faucet",
    },
  })
  assertEquals(
    body,
    [
      "Hi Alex — invoice ready",
      "",
      "Unit 2B · Flex Plumbing · $450.00",
      "Job: Leaking kitchen faucet",
      "",
      "Have you paid this invoice?",
      "Reply YES if paid, or NO if not yet — if you have more than one pending, include the address",
      "",
      "Details:",
      "https://www.ulohome.io/admin/requests?q=WO-9E41",
      "",
      "Ref: WO-9E41",
    ].join("\n"),
  )
  assertEquals(body.includes("1 — Review the invoice"), false)
  assertEquals(body.includes("2 — Pay in Ulo"), false)
})

Deno.test("invoice_ready without invoicePaid falls back to empty next steps", () => {
  const body = buildLandlordAttentionSms({
    kind: "invoice_ready",
    headline: "Invoice ready to pay",
    detail: "Unit 2B · Flex Plumbing · $450.00",
    dashboardUrl: "https://www.ulohome.io/admin",
  })
  assertStringIncludes(body, "Ulo: Invoice ready to pay")
  assertEquals(body.includes("1 — Review the invoice"), false)
  assertEquals(body.includes("2 — Pay in Ulo"), false)
})

Deno.test("assign-vendor SMS lists nearby vendors for numbered reply", () => {
  const body = buildLandlordAttentionSms({
    kind: "assign_vendor",
    headline: "No preferred vendor matched this request",
    detail: "The leaking kitchen faucet.",
    locationLine: "14 Maple Ave, Unit 1, reported 2h ago",
    requestRef: "676FE1DD",
    whyLine: "",
    nextSteps: [
      "Rapid Plumb Co., 4.9/5 (218 reviews)",
      "Metro Plumbing Services, 4.6/5 (142 reviews)",
      "Apex Pipe & Drain, 4.8/5 (96 reviews)",
    ],
    choiceReplyHint: "Reply 1, 2, or 3 and we'll contact that vendor.",
    dashboardUrl: "https://www.ulohome.io/admin?findVendor=1&ticket=676FE1DD",
  })
  const expected = [
    "Ulo: The leaking kitchen faucet.",
    "14 Maple Ave, Unit 1, reported 2h ago.",
    "No preferred vendor matched this request.",
    "Nearby options: 1. Rapid Plumb Co., 4.9/5 (218 reviews). 2. Metro Plumbing Services, 4.6/5 (142 reviews). 3. Apex Pipe & Drain, 4.8/5 (96 reviews).",
    "Reply 1, 2, or 3 and we'll contact that vendor.",
    "Ref: 676FE1DD.",
    "Details: https://www.ulohome.io/admin?findVendor=1&ticket=676FE1DD",
  ].join(" ")
  assertEquals(body, expected)
  assertEquals(body.replace(/\s+/g, " "), expected)
  assertEquals(body.includes("No vendor found"), false)
  assertEquals(body.includes("preferred list"), false)
  assertEquals(body.includes("unavailable"), false)
  for (const ch of body) {
    assertEquals((ch.codePointAt(0) ?? 0) <= 127, true, `non-ascii ${ch}`)
  }
})

Deno.test("assign-vendor SMS omits fake in-app options when search is empty", () => {
  const body = buildLandlordAttentionSms({
    kind: "assign_vendor",
    headline: "No preferred vendor matched this request",
    whyLine: "",
    locationLine: "14 Maple Ave, Unit 1, reported 2h ago",
    nextSteps: [],
    dashboardUrl: "https://app.ulohome.io/admin?findVendor=1&ticket=abc-123",
  })
  assertStringIncludes(body, "No preferred vendor matched this request.")
  assertEquals(body.includes("preferred list"), false)
  assertEquals(body.includes("Try your preferred vendors"), false)
  assertEquals(body.includes("Handle this one yourself"), false)
  assertEquals(body.includes("Find a vendor nearby"), false)
  assertEquals(body.includes("This repair"), false)
  assertStringIncludes(body, "The request did not include a description.")
  assertStringIncludes(body, "14 Maple Ave, Unit 1, reported 2h ago.")
  assertEquals(body.includes("unavailable"), false)
})

Deno.test("attention email subject matches the SMS headline", () => {
  const mail = buildLandlordAttentionEmail({
    kind: "assign_vendor",
    headline: "No preferred vendor matched this request",
    whyLine: "",
    detail: "The leaking kitchen faucet.",
    locationLine: "14 Maple Ave, Unit 1, reported 2h ago",
    nextSteps: [
      "Rapid Plumb Co., 4.9/5 (218 reviews)",
      "Metro Plumbing Services, 4.6/5 (142 reviews)",
    ],
    choiceReplyHint: "Reply 1 or 2 and we'll contact that vendor.",
    dashboardUrl: "https://www.ulohome.io/admin",
  })
  assertEquals(mail.subject, "Ulo: No preferred vendor matched this request")
  assertStringIncludes(mail.text, "1. Rapid Plumb Co., 4.9/5 (218 reviews)")
  assertStringIncludes(mail.html, "4.9/5 (218 reviews)")
  assertStringIncludes(mail.html, "Open Find External Vendor")
  assertStringIncludes(mail.html, "https://www.ulohome.io/admin")
})

Deno.test("shortRepairLabel prefers the first description line", () => {
  assertEquals(
    shortRepairLabel("Leaking kitchen faucet\nTenant said it started today.", "plumbing"),
    "leaking kitchen faucet",
  )
  assertEquals(
    shortRepairLabel(
      "The AC isn't working. It's 100 inside and my son feels dizzy. The AC won't turn on.",
      "hvac",
    ),
    "the AC isn't working",
  )
  assertEquals(shortRepairLabel("", "electrical"), "Electrical repair")
  assertEquals(shortRepairLabel("", "other"), "")
  assertEquals(shortRepairLabel("", null), "")
  assertEquals(
    shortRepairLabel("I smell gas in the kitchen\n\nAffected area: kitchen.", "other"),
    "i smell gas in the kitchen",
  )
  assertEquals(
    shortRepairLabel("", "pest_control", { street: "109 S Grove St" }),
    "Pest control at 109 S Grove St",
  )
})

Deno.test("emergency SMS is scannable and has no fake numbered reply", () => {
  const summary = summarizeEmergencyForLandlord(
    "The AC isn't working. It's 100 inside and my son feels dizzy. The AC won't turn on.",
  )
  assertEquals(
    summary,
    "The AC is not turning on. It is 100 F inside. Someone in the home feels dizzy.",
  )
  const body = buildLandlordAttentionSms({
    kind: "workflow_escalated",
    headline: "Emergency",
    detail: summary,
    locationLine: "100 Disposable Test Lane",
    requestRef: "30A0B8CC",
    whyLine: "No reply is needed. We'll text you with updates.",
    nextSteps: [],
    dashboardUrl: `https://www.ulohome.io/admin?findVendor=1&ticket=${findVendorTicketToken("30a0b8cc-4284-42a7-8139-b59e219219f0", "30A0B8CC")}`,
  })
  assertEquals(
    body,
    [
      "Ulo: Emergency.",
      "The AC is not turning on. It is 100 F inside. Someone in the home feels dizzy.",
      "100 Disposable Test Lane.",
      "Ref: 30A0B8CC.",
      "No reply is needed. We'll text you with updates.",
      "Details: https://www.ulohome.io/admin?findVendor=1&ticket=30A0B8CC",
    ].join(" "),
  )
  assertEquals(body.includes("1. "), false)
  assertEquals(body.includes("Open Ulo to decide next"), false)
  assertEquals(
    findVendorTicketToken("30a0b8cc-4284-42a7-8139-b59e219219f0", "30A0B8CC"),
    "30A0B8CC",
  )
  for (const ch of body) {
    assertEquals((ch.codePointAt(0) ?? 0) <= 127, true, `non-ascii ${ch}`)
  }
})

Deno.test("formatReportedAgo uses hours then days", () => {
  const now = new Date("2026-09-15T18:00:00.000Z")
  assertEquals(formatReportedAgo("2026-09-15T16:00:00.000Z", now), "reported 2h ago")
  assertEquals(formatReportedAgo("2026-09-13T18:00:00.000Z", now), "reported 2 days ago")
})

Deno.test("landlordAttentionInboxPersistMode always picks a Messages mirror path", () => {
  assertEquals(
    landlordAttentionInboxPersistMode({}),
    "mirror",
  )
  assertEquals(
    landlordAttentionInboxPersistMode({
      vendorChoice: {
        ticketId: "t1",
        options: [{ id: "v1", name: "Acme", role: "preferred" }],
      } as never,
    }),
    "vendor_choice",
  )
  assertEquals(
    landlordAttentionInboxPersistMode({
      vendorChoice: { ticketId: "t1", options: [] } as never,
    }),
    "mirror",
  )
  assertEquals(
    landlordAttentionInboxPersistMode({
      invoicePaidConfirmation: {
        invoiceId: "i1",
        ticketId: "t1",
      } as never,
    }),
    "invoice_paid",
  )
})

Deno.test("vendor-options SMS leads with the issue and property", () => {
  const body = buildLandlordAttentionSms({
    kind: "assign_vendor",
    headline: "No preferred vendor matched this request",
    detail: "I smell gas in the kitchen.",
    locationLine: "100 Disposable Test Lane",
    requestRef: "4A81E0CB",
    whyLine: "",
    nextSteps: ["Metro Plumbing, 4.8/5 (40 reviews)"],
    choiceReplyHint: "Reply 1 and we'll contact that vendor.",
    dashboardUrl: "https://www.ulohome.io/admin?findVendor=1&ticket=4A81E0CB",
  })
  assertEquals(
    body,
    [
      "Ulo: I smell gas in the kitchen.",
      "100 Disposable Test Lane.",
      "No preferred vendor matched this request.",
      "Nearby options: 1. Metro Plumbing, 4.8/5 (40 reviews).",
      "Reply 1 and we'll contact that vendor.",
      "Ref: 4A81E0CB.",
      "Details: https://www.ulohome.io/admin?findVendor=1&ticket=4A81E0CB",
    ].join(" "),
  )
  assertEquals(body.includes("This repair"), false)
  assertEquals(body.includes("unavailable"), false)
})

Deno.test("vendor-options SMS stays a complete sentence when details are missing", () => {
  const body = buildLandlordAttentionSms({
    kind: "assign_vendor",
    headline: "No preferred vendor matched this request",
    detail: "",
    locationLine: "",
    requestRef: "4A81E0CB",
    whyLine: "",
    nextSteps: ["Metro Plumbing, 4.8/5 (40 reviews)"],
    choiceReplyHint: "Reply 1 and we'll contact that vendor.",
    dashboardUrl: "https://www.ulohome.io/admin?findVendor=1&ticket=4A81E0CB",
  })
  assertEquals(
    body,
    [
      "Ulo: The request did not include a description.",
      "The property address was not included.",
      "No preferred vendor matched this request.",
      "Nearby options: 1. Metro Plumbing, 4.8/5 (40 reviews).",
      "Reply 1 and we'll contact that vendor.",
      "Ref: 4A81E0CB.",
      "Details: https://www.ulohome.io/admin?findVendor=1&ticket=4A81E0CB",
    ].join(" "),
  )
  assertEquals(body.includes("This repair"), false)
  assertEquals(body.includes("100 Disposable"), false)
  assertEquals(body.includes("gas"), false)
})

Deno.test("vendor-options SMS omits reply numbers when no vendor is appropriate", () => {
  const body = buildLandlordAttentionSms({
    kind: "assign_vendor",
    headline: "No preferred vendor matched this request",
    detail: "I smell gas in the kitchen.",
    locationLine: "100 Disposable Test Lane",
    requestRef: "4A81E0CB",
    whyLine: "",
    nextSteps: [],
    dashboardUrl: "https://www.ulohome.io/admin?findVendor=1&ticket=4A81E0CB",
  })
  assertStringIncludes(body, "Ulo: I smell gas in the kitchen.")
  assertStringIncludes(body, "100 Disposable Test Lane.")
  assertStringIncludes(body, "No nearby vendor matched this kind of request.")
  assertEquals(body.includes("Reply 1"), false)
  assertEquals(body.includes("This repair"), false)
  assertEquals(body.includes("unavailable"), false)
  assertEquals(body.includes("S&K"), false)
})
