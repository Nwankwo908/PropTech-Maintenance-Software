import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildLandlordPickBatchSms } from "./batchMessage.ts"

Deno.test("one item uses a single ask and does not invent example ids", () => {
  const sms = buildLandlordPickBatchSms([
    {
      displayId: 102,
      unitLabel: "2",
      issue: "Bedroom sink leak",
      vendorName: "Dan Conard Pest Control",
      windowLabel: "Wednesday, Oct 14 between 9:00 AM and 12:00 PM",
      ticketClass: "reactive",
      propertyType: "multifamily",
    },
  ])
  assertStringIncludes(sms, "Ulo: Approval needed: Bedroom sink leak, Unit 2.")
  assertStringIncludes(sms, "Dan Conard Pest Control · Wednesday, Oct 14 between 9:00 AM and 12:00 PM")
  assertStringIncludes(sms, "Reply YES to approve or NO to decline.")
  assertEquals(sms.includes("YES ALL"), false)
  assertEquals(sms.includes("#"), false)
  assertEquals(sms.includes("101"), false)
  assertEquals(sms.includes("103"), false)
  assertEquals(sms.includes("104"), false)
  assertEquals(sms.includes("SNOOZE"), false)
  assertEquals(sms.includes("SKIP"), false)
  assertEquals(sms.includes("hold the appointment"), false)
})

Deno.test("one proactive item uses YES/NO and still has no display id", () => {
  const sms = buildLandlordPickBatchSms([
    {
      displayId: 102,
      issue: "Filter replacement",
      vendorName: "Handy Co",
      windowLabel: "Wed PM",
      ticketClass: "proactive",
      propertyType: "single_family_home",
      unitLabel: "1",
    },
  ])
  assertStringIncludes(sms, "Reply YES to approve or NO to decline.")
  assertEquals(sms.includes("SNOOZE"), false)
  assertEquals(sms.includes("SKIP"), false)
  assertEquals(sms.includes("Unit"), false)
  assertEquals(sms.includes("#102"), false)
})

Deno.test("three items build the example from the batch ids only", () => {
  const sms = buildLandlordPickBatchSms(
    [
      {
        displayId: 102,
        unitLabel: "2",
        issue: "Bedroom sink leak",
        vendorName: "ABC Plumbing",
        windowLabel: "Wed AM",
        propertyAddress: "14 Maple Ave",
      },
      {
        displayId: 105,
        unitLabel: "4",
        issue: "Outlet dead",
        vendorName: "Metro Electric",
        windowLabel: "Fri AM",
        propertyAddress: "9 Oak St",
      },
      {
        displayId: 108,
        issue: "Filter replacement",
        vendorName: "Handy Co",
        windowLabel: "Thu PM",
      },
    ],
    0,
    { propertyCount: 2 },
  )
  assertStringIncludes(sms, "Ulo: 3 requests need your decision")
  assertStringIncludes(sms, "Reply like: 102 yes, 105 no. Or YES ALL.")
  assertStringIncludes(sms, "ABC Plumbing · Wed AM")
  assertStringIncludes(sms, "Bedroom sink leak — Unit 2 (bedroom) at 14 Maple Ave")
  assertEquals(sms.includes("101"), false)
  assertEquals(sms.includes("103"), false)
  assertEquals(sms.includes("104"), false)
  assertEquals(sms.includes("SNOOZE"), false)
  assertEquals(sms.includes("SKIP"), false)
})

Deno.test("one item can include a single quick-fix line before YES/NO", () => {
  const sms = buildLandlordPickBatchSms([
    {
      displayId: 102,
      issue: "Kitchen outlets dead",
      vendorName: "Bright Electric",
      windowLabel: "Wed AM",
      selfFixLine: "Tenant already tried the GFCI reset — still out.",
    },
  ])
  assertStringIncludes(sms, "Tenant already tried the GFCI reset — still out.")
  assertStringIncludes(sms, "Reply YES to approve or NO to decline.")
  assertEquals(sms.includes("Quick check"), false)
})

Deno.test("a vacant quick check keeps the YES/NO line", () => {
  const sms = buildLandlordPickBatchSms([
    {
      displayId: 102,
      issue: "Kitchen outlets dead",
      vendorName: "Bright Electric",
      selfFixLine: "Quick check first: press RESET on the outlet by the sink. Reply FIXED if it works.",
    },
  ])
  assertStringIncludes(sms, "Quick check first: press RESET on the outlet by the sink. Reply FIXED if it works.")
  assertStringIncludes(sms, "Reply YES to approve or NO to decline.")
})

Deno.test("a batch of 3 has no tip lines", () => {
  const sms = buildLandlordPickBatchSms([
    {
      displayId: 102,
      issue: "Kitchen outlets dead",
      vendorName: "Bright Electric",
      selfFixLine: "Tenant already tried the GFCI reset — still out.",
    },
    {
      displayId: 105,
      issue: "Slow sink",
      vendorName: "Handy Co",
      selfFixLine: "Quick check: pull out the stopper and rinse it. Reply FIXED if the sink drains.",
    },
    {
      displayId: 106,
      issue: "Washer",
      vendorName: "Handy Co",
      selfFixLine: "Quick check: close the lid, pick a cycle, and test the outlet. Reply FIXED if it starts.",
    },
  ])
  assertEquals(sms.includes("GFCI"), false)
  assertEquals(sms.includes("Quick check"), false)
  assertEquals(sms.includes("FIXED"), false)
  assertStringIncludes(sms, "Reply like: 102 yes, 105 no. Or YES ALL.")
})
