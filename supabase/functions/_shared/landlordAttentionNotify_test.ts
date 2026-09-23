/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildLandlordAttentionEmail,
  buildLandlordAttentionSms,
  formatReportedAgo,
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
      "Reply YES if paid, or NO if not yet.",
      "",
      "Details:",
      "https://www.ulohome.io/admin/requests?q=WO-9E41",
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
    headline: "No vendor found — leaking kitchen faucet",
    locationLine: "14 Maple Ave · Unit 1 · reported 2h ago",
    whyLine:
      "No one on your preferred list can take this right now. Nearby vendors:",
    nextSteps: [
      "Rapid Plumb Co. · 4.9 stars (218 reviews)",
      "Metro Plumbing Services · 4.6 stars (142 reviews)",
      "Apex Pipe & Drain · 4.8 stars (96 reviews)",
    ],
    choiceReplyHint: "Reply 1, 2, or 3 and we'll contact them.",
    dashboardUrl: "https://app.ulohome.io/admin?findVendor=1&ticket=abc-123",
  })
  assertEquals(
    body,
    [
      "Ulo: No vendor found — leaking kitchen faucet",
      "",
      "14 Maple Ave · Unit 1 · reported 2h ago",
      "No one on your preferred list can take this right now. Nearby vendors:",
      "",
      "1 — Rapid Plumb Co. · 4.9 stars (218 reviews)",
      "2 — Metro Plumbing Services · 4.6 stars (142 reviews)",
      "3 — Apex Pipe & Drain · 4.8 stars (96 reviews)",
      "",
      "Reply 1, 2, or 3 and we'll contact them.",
      "",
      "Details:",
      "https://app.ulohome.io/admin?findVendor=1&ticket=abc-123",
    ].join("\n"),
  )
})

Deno.test("assign-vendor SMS omits fake in-app options when search is empty", () => {
  const body = buildLandlordAttentionSms({
    kind: "assign_vendor",
    headline: "No vendor found — leaking kitchen faucet",
    locationLine: "14 Maple Ave · Unit 1 · reported 2h ago",
    nextSteps: [],
    dashboardUrl: "https://app.ulohome.io/admin?findVendor=1&ticket=abc-123",
  })
  assertStringIncludes(body, "No one on your preferred list can take this right now.")
  assertEquals(body.includes("Try your preferred vendors"), false)
  assertEquals(body.includes("Handle this one yourself"), false)
  assertEquals(body.includes("Find a vendor nearby"), false)
})

Deno.test("attention email subject matches the SMS headline", () => {
  const mail = buildLandlordAttentionEmail({
    kind: "assign_vendor",
    headline: "No vendor found — leaking kitchen faucet",
    locationLine: "14 Maple Ave · Unit 1 · reported 2h ago",
    nextSteps: [
      "Rapid Plumb Co. · 4.9 stars (218 reviews)",
      "Metro Plumbing Services · 4.6 stars (142 reviews)",
    ],
    choiceReplyHint: "Reply 1 or 2 and we'll contact them.",
    dashboardUrl: "https://www.ulohome.io/admin",
  })
  assertEquals(mail.subject, "Ulo: No vendor found — leaking kitchen faucet")
  assertStringIncludes(mail.text, "1 — Rapid Plumb Co. · 4.9 stars (218 reviews)")
  assertStringIncludes(mail.html, "4.9 stars (218 reviews)")
  assertStringIncludes(mail.html, "Open Find External Vendor")
  assertStringIncludes(mail.html, "https://www.ulohome.io/admin")
})

Deno.test("shortRepairLabel prefers the first description line", () => {
  assertEquals(
    shortRepairLabel("Leaking kitchen faucet\nTenant said it started today.", "plumbing"),
    "leaking kitchen faucet",
  )
  assertEquals(shortRepairLabel("", "electrical"), "electrical repair")
})

Deno.test("formatReportedAgo uses hours then days", () => {
  const now = new Date("2026-09-15T18:00:00.000Z")
  assertEquals(formatReportedAgo("2026-09-15T16:00:00.000Z", now), "reported 2h ago")
  assertEquals(formatReportedAgo("2026-09-13T18:00:00.000Z", now), "reported 2 days ago")
})
