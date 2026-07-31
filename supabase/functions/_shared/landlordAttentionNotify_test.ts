/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildLandlordAttentionEmail,
  buildLandlordAttentionSms,
} from "./landlordAttentionNotify.ts"

Deno.test("attention SMS identifies sender, reason, and dashboard link", () => {
  const body = buildLandlordAttentionSms({
    headline: "Invoice ready to pay",
    detail: "WO-79B6 · Unit 2B · Flex Plumbing · $450.00",
    dashboardUrl: "https://www.ulohome.io/admin",
  })
  assertStringIncludes(body, "This is the property management team.")
  assertStringIncludes(body, "Something needs your attention in Ulo: Invoice ready to pay.")
  assertStringIncludes(body, "WO-79B6 · Unit 2B · Flex Plumbing · $450.00")
  assertStringIncludes(body, "Review it in Needs Your Attention or your Ulo Activity Feed:")
  assertStringIncludes(body, "https://www.ulohome.io/admin")
})

Deno.test("attention email subject and body stay plain-language", () => {
  const mail = buildLandlordAttentionEmail({
    headline: "SLA breached — assign a vendor",
    detail: "WO-12AB · Unit 4A",
    dashboardUrl: "https://www.ulohome.io/admin",
  })
  assertEquals(mail.subject, "Needs your attention: SLA breached — assign a vendor")
  assertStringIncludes(mail.text, "This is the property management team.")
  assertStringIncludes(mail.text, "Ulo Activity Feed")
  assertStringIncludes(mail.html, "Ulo Activity Feed")
  assertStringIncludes(mail.html, "Open Needs Your Attention")
  assertStringIncludes(mail.html, "https://www.ulohome.io/admin")
})
