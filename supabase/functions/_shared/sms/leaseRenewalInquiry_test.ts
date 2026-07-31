import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildEarlyLeaseInquiryAckSms,
  isLeaseRenewalInquirySms,
  parseLeaseRenewalInquiry,
} from "./leaseRenewalInquiry.ts"

const SAMPLE =
  `Good morning  Emeka, 
I was wondering when I would receive a renewal lease. can we do 1 or 2 years?`

Deno.test("detects renewal lease timing + term ask", () => {
  assertEquals(isLeaseRenewalInquirySms(SAMPLE), true)
  const p = parseLeaseRenewalInquiry(SAMPLE)
  assertEquals(p.isLeaseInquiry, true)
  assertEquals(p.wantsRenewalTiming, true)
  assertEquals(p.preferredTermYears, "either")
  assertEquals(p.response, "renew")
})

Deno.test("does not treat plumbing SMS as lease inquiry", () => {
  assertEquals(
    isLeaseRenewalInquirySms("My kitchen sink is leaking under the cabinet."),
    false,
  )
})

Deno.test("ack SMS acknowledges timing and term", () => {
  const body = buildEarlyLeaseInquiryAckSms({
    parse: parseLeaseRenewalInquiry(SAMPLE),
    leaseEndDate: "2026-12-31",
  })
  assertMatch(body, /lease renewal/i)
  assertMatch(body, /1- or 2-year/i)
  assertMatch(body, /when your renewal will be ready/i)
  assertMatch(body, /December 31, 2026/)
  assertMatch(body, /follow up/i)
})
