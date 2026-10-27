/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildTenantRescheduleLandlordNotice,
  formatSavedPropertyAddress,
  resolveCurrentVisitLabel,
} from "./tenantRescheduleLandlordNotice.ts"

const current = "Wednesday, Oct 28 between 9:00 AM and 12:00 PM"
const preferred = "Thursday between 2pm and 4pm"
const maple = "14 Maple Ave, Newark, NJ 07102"
const lane = "100 Disposable Test Lane, Newark, NJ 07102"

function noticeText(notice: { headline: string; detail: string; whyLine: string }): string {
  return `${notice.headline}. ${notice.detail}. ${notice.whyLine}`
}

Deno.test("vendor outreach names the resident, home, repair, and full window", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: true,
    residentName: "Disposable Tenant",
    propertyAddress: lane,
    unitLabel: "1",
    propertyType: "single_family",
    repairLabel: "Bathroom light is out",
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  const text = noticeText(notice)
  assertEquals(notice.outcome, "inform")
  assertEquals(notice.headline.startsWith("Disposable Tenant at 100 Disposable Test Lane"), true)
  assertEquals(text.includes("Unit"), false)
  assertEquals(text.includes("Home"), false)
  assertEquals(text.includes("Bathroom light is out"), true)
  assertEquals(text.includes(current), true)
  assertEquals(text.includes(preferred), true)
  assertEquals(text.includes("We asked the vendor"), true)
  assertEquals(notice.whyLine, "No reply is needed.")
  assertEquals(text.includes("decision"), false)
  assertEquals(text.includes("9:00 AM."), false)
})

Deno.test("a missing name leads with the property and unit", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: true,
    propertyAddress: "14 Maple Ave",
    unitLabel: "4B",
    propertyType: "multi_family",
    repairLabel: "Kitchen sink",
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  assertEquals(notice.headline.startsWith("14 Maple Ave · Unit 4B"), true)
  assertEquals(notice.headline.includes("resident"), false)
  assertEquals(notice.detail.includes("The requested time is Thursday"), true)
  assertEquals(notice.detail.includes("The repair is the kitchen sink"), true)
})

Deno.test("missing address, unit, repair, and window are left out", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: false,
    failureCode: "update_failed",
    residentName: "Alex Rivera",
    currentVisitLabel: null,
    preferredWindow: null,
  })
  const text = noticeText(notice)
  assertEquals(notice.headline, "Alex Rivera asked to move a visit")
  assertEquals(text.includes(" at "), false)
  assertEquals(text.includes("Unit"), false)
  assertEquals(text.includes("The repair is"), false)
  assertEquals(text.includes("The current visit"), false)
  assertEquals(text.includes("asked for"), false)
  assertEquals(text.includes("another time"), false)
  assertEquals(text.includes("The vendor was not texted"), true)
  assertEquals(notice.whyLine.includes("Alex Rivera can send the new day and time again"), true)
  assertEquals(text.includes("check constraint"), false)
  assertEquals(text.includes("decision"), false)
})

Deno.test("a missing vendor phone tells the landlord what to add", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: false,
    failureCode: "no_vendor_phone",
    residentName: "Alex Rivera",
    propertyAddress: maple,
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  assertEquals(notice.whyLine.includes("Add a phone number"), true)
  assertEquals(notice.detail.includes(maple), false)
  assertEquals(notice.headline.includes(maple), true)
  assertEquals(notice.detail.includes("The vendor was not texted"), true)
})

Deno.test("a failed vendor text gives one next action", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: false,
    failureCode: "send_failed",
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  assertEquals(notice.whyLine.includes("Open the visit in Ulo"), true)
  assertEquals(notice.whyLine.includes("the resident sends the time again"), true)
  assertEquals(notice.detail.includes(current), true)
})

Deno.test("account approval names the visit and how to reply", () => {
  const notice = buildTenantRescheduleLandlordNotice({
    vendorNotified: false,
    approvalRequired: true,
    residentName: "Alex Rivera",
    propertyAddress: maple,
    unitLabel: "2",
    propertyType: "multi_family",
    repairLabel: "No heat",
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  const text = noticeText(notice)
  assertEquals(notice.outcome, "approval")
  assertEquals(
    notice.headline.includes("Alex Rivera at 14 Maple Ave, Newark, NJ 07102 · Unit 2"),
    true,
  )
  assertEquals(text.includes("no heat"), true)
  assertEquals(notice.whyLine.includes(`YES to ask the vendor about ${preferred}`), true)
  assertEquals(notice.whyLine.includes(`NO to keep ${current}`), true)
  assertEquals(text.includes("We asked the vendor for a new time"), false)
})

Deno.test("two properties and two requests stay distinct", () => {
  const bathroom = buildTenantRescheduleLandlordNotice({
    vendorNotified: true,
    residentName: "Disposable Tenant",
    propertyAddress: lane,
    propertyType: "single_family",
    unitLabel: "1",
    repairLabel: "Bathroom light",
    currentVisitLabel: current,
    preferredWindow: preferred,
  })
  const sink = buildTenantRescheduleLandlordNotice({
    vendorNotified: false,
    failureCode: "update_failed",
    residentName: "Sam Lee",
    propertyAddress: maple,
    unitLabel: "3",
    propertyType: "multi_family",
    repairLabel: "Kitchen sink is leaking",
    currentVisitLabel: "Friday, Oct 30 between 1:00 PM and 3:00 PM",
    preferredWindow: "Monday after 4pm",
  })
  const bathroomText = noticeText(bathroom)
  const sinkText = noticeText(sink)
  assertEquals(bathroomText.includes("Disposable Tenant"), true)
  assertEquals(bathroomText.includes(lane), true)
  assertEquals(bathroomText.includes("Unit"), false)
  assertEquals(bathroomText.includes("bathroom light"), true)
  assertEquals(bathroomText.includes("Sam Lee"), false)
  assertEquals(bathroomText.includes("Kitchen sink"), false)
  assertEquals(sinkText.includes("Sam Lee at 14 Maple Ave, Newark, NJ 07102 · Unit 3"), true)
  assertEquals(sinkText.includes("Kitchen sink is leaking"), true)
  assertEquals(sinkText.includes("Friday, Oct 30 between 1:00 PM and 3:00 PM"), true)
  assertEquals(sinkText.includes("Monday after 4pm"), true)
  assertEquals(sinkText.includes("Disposable"), false)
  assertEquals(sinkText.includes("Bathroom"), false)
  assertEquals(sink.outcome, "failed")
})

Deno.test("the saved window keeps its end time", () => {
  assertEquals(
    resolveCurrentVisitLabel(current, "Wed, Oct 28, 9:00 AM"),
    current,
  )
  assertEquals(
    resolveCurrentVisitLabel("9:00 AM–12:00 PM", "Wed, Oct 28, 9:00 AM"),
    "Wed, Oct 28, 9:00 AM–12:00 PM",
  )
  assertEquals(resolveCurrentVisitLabel(null, null), null)
  assertEquals(
    formatSavedPropertyAddress({
      streetAddress: "100 Disposable Test Lane",
      city: "Newark",
      state: "NJ",
      zipCode: "07102",
    }),
    lane,
  )
  assertEquals(formatSavedPropertyAddress({ city: "Newark" }), "Newark")
})
