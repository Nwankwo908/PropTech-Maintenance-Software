/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildTenantRescheduleLandlordNotice } from "./tenantRescheduleLandlordNotice.ts"

const current = "Wednesday, Oct 28 between 9:00 AM and 12:00 PM"
const preferred = "Thursday between 2pm and 4pm"

Deno.test("vendor outreach informs the landlord and does not ask for a decision", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: true,
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  assertEquals(notice.outcome, "inform")
  assertEquals(notice.whyLine, "No reply is needed.")
  assertEquals(notice.detail.includes(current), true)
  assertEquals(notice.detail.includes(preferred), true)
  assertEquals(notice.whyLine.includes("decision"), false)
  assertEquals(notice.nextSteps.length, 0)
})

Deno.test("a failed update names the saved visit and the next step", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: false,
    failureCode: "update_failed",
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  assertEquals(notice.outcome, "failed")
  assertEquals(notice.detail.includes("still confirmed"), true)
  assertEquals(notice.detail.includes("check constraint"), false)
  assertEquals(notice.whyLine.includes("send the new day and time again"), true)
  assertEquals(notice.whyLine.includes("decision"), false)
})

Deno.test("a missing vendor phone tells the landlord what to add", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: false,
    failureCode: "no_vendor_phone",
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  assertEquals(notice.whyLine.includes("Add a phone number"), true)
})

Deno.test("account approval explains the reply", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: false,
    approvalRequired: true,
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  assertEquals(notice.outcome, "approval")
  assertEquals(notice.whyLine.includes("Reply YES"), true)
  assertEquals(notice.whyLine.includes("NO"), true)
  assertEquals(notice.detail.includes(current), true)
})
