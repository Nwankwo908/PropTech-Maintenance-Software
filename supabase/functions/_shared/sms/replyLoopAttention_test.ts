import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildLandlordAttentionSms } from "../landlordAttentionNotify.ts"
import {
  buildReplyLoopAttention,
  replyLoopNeedsIntervention,
} from "./replyLoopAttention.ts"

const CLARIFY =
  "Hi Disposable,\n\nHappy to help. What do you need — a repair, something about rent or your lease, or something else?"
const HELP =
  "Thanks for reaching out — this is Ulo. How can we help with your maintenance issue today?"
const CLOSED_OFFER = "That offer isn't available anymore. Reply YES or NO."
const SCHEDULE =
  "What day and time works for the bathroom light? Reply with a day and arrival window."

Deno.test("a repeated menu or closed offer does not need a person", () => {
  assertEquals(replyLoopNeedsIntervention(CLARIFY), false)
  assertEquals(replyLoopNeedsIntervention(HELP), false)
  assertEquals(replyLoopNeedsIntervention(CLOSED_OFFER), false)
  assertEquals(replyLoopNeedsIntervention("That action isn't available on this account."), false)
  assertEquals(replyLoopNeedsIntervention(SCHEDULE), true)
})

Deno.test("a real loop names the resident, home, and repair once", () => {
  const copy = buildReplyLoopAttention({
    audience: "resident",
    residentName: "Disposable Tenant",
    propertyAddress: "100 Disposable Test Lane, Newark, NJ 07102",
    unitLabel: "1",
    propertyType: "single_family",
    repairLabel: "The bathroom light won't turn on",
    suppressedBody: SCHEDULE,
  })
  const sms = buildLandlordAttentionSms({
    kind: "workflow_escalated",
    headline: copy.headline,
    detail: copy.detail,
    whyLine: copy.whyLine,
    nextSteps: copy.nextSteps,
    dashboardUrl: "https://www.ulohome.io/admin/requests?q=WO-EB1D",
    requestRef: "EB1D7CFC",
  })
  assertEquals(sms.includes("Disposable Tenant"), true)
  assertEquals(sms.includes("100 Disposable Test Lane, Newark, NJ 07102"), true)
  assertEquals(sms.includes("Unit 1"), false)
  assertEquals(sms.includes("bathroom light"), true)
  assertEquals(sms.includes("Text the resident on this request"), true)
  assertEquals(sms.includes("looping"), false)
  assertEquals(sms.split("Ulo stopped a repeated text").length, 2)
  assertEquals(sms.split("needs a follow-up").length, 2)
})

Deno.test("a missing name leads with the property", () => {
  const copy = buildReplyLoopAttention({
    audience: "resident",
    residentName: "there",
    propertyAddress: "14 Maple Ave, Newark, NJ 07102",
    unitLabel: "2",
    propertyType: "multifamily",
    repairLabel: "Kitchen sink is leaking",
    suppressedBody: SCHEDULE,
  })
  assertEquals(copy.headline.startsWith("14 Maple Ave"), true)
  assertEquals(copy.headline.includes("Unit 2"), true)
  assertEquals(copy.headline.includes("there"), false)
})

Deno.test("missing facts do not invent a name, address, or repair", () => {
  const copy = buildReplyLoopAttention({
    audience: "resident",
    suppressedBody: SCHEDULE,
  })
  assertEquals(copy.headline, "A text thread needs a follow-up")
  assertEquals(copy.detail.includes("bathroom"), false)
  assertEquals(copy.detail.includes("Unit"), false)
})

Deno.test("an estimate ask tells the property team how to answer", () => {
  const copy = buildReplyLoopAttention({
    audience: "property_team",
    propertyAddress: "100 Disposable Test Lane, Newark, NJ 07102",
    propertyType: "single_family",
    repairLabel: "The bathroom light won't turn on",
    suppressedBody: "Reply APPROVE to let them continue, or DECLINE if you need a revised estimate.",
  })
  assertEquals(copy.headline.includes("property-team thread"), true)
  assertEquals(copy.headline.includes("100 Disposable Test Lane"), true)
  assertEquals(copy.whyLine, "Reply APPROVE or DECLINE for that estimate.")
  assertEquals(copy.nextSteps.length, 0)
})
