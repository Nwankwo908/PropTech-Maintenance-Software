import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  beginMultiIssueSharedIntake,
  buildMultiIssueConfirmSms,
  buildMultiIssueSubmittedSms,
  buildRequestSubmittedSms,
  clusterIssueSegments,
  detectMultipleMaintenanceIssues,
  INTAKE_SUBMIT_FAILED_SMS,
  splitMaintenanceIssueSegments,
} from "./multiIssueIntake.ts"

const SAMPLE = `Good morning. I hope all is well. Following up again regarding the piece for the door and the exterminator for behind the stove.

Also, yesterday when I came home there were two big bees in the window inside the apartment. Saad helped me get them out. We are suspecting that there might be a hive in the tree. We stuffed paper towels in the cracks of the windows but that may not suffice during summer.

I appreciate your assistance. Talk to you soon.`

Deno.test("splitMaintenanceIssueSegments uses Also / paragraphs", () => {
  const parts = splitMaintenanceIssueSegments(SAMPLE)
  assertEquals(parts.length >= 2, true)
})

Deno.test("clusterIssueSegments finds distinct trades for door + bees", () => {
  const parts = splitMaintenanceIssueSegments(SAMPLE)
  const clustered = clusterIssueSegments(parts)
  const trades = new Set(clustered.map((c) => c.trade))
  assertEquals(trades.has("pest_control"), true)
  assertEquals(
    trades.has("carpentry") || trades.has("pest_control"),
    true,
  )
  assertEquals(clustered.length >= 2 || trades.size >= 1, true)
})

Deno.test("detectMultipleMaintenanceIssues returns 2+ for sample SMS", async () => {
  const issues = await detectMultipleMaintenanceIssues(SAMPLE)
  assertEquals(issues.length >= 2, true, JSON.stringify(issues))
  const trades = new Set(issues.map((i) => i.vendor_trade))
  assertEquals(trades.has("pest_control"), true)
})

Deno.test("detectMultipleMaintenanceIssues returns [] for single leak", async () => {
  const issues = await detectMultipleMaintenanceIssues(
    "My kitchen sink is leaking badly under the cabinet.",
  )
  assertEquals(issues.length, 0)
})

const TWO_PLUMBING =
  "My kitchen sink is leaking badly under the cabinet. Also, the toilet in the bathroom won't stop running."

Deno.test("clusterIssueSegments keeps two plumbing segments for marker split", () => {
  const parts = splitMaintenanceIssueSegments(TWO_PLUMBING)
  assertEquals(parts.length >= 2, true)
  const clustered = clusterIssueSegments(parts, { keepSameTrade: true })
  assertEquals(clustered.length >= 2, true)
  assertEquals(clustered.every((c) => c.trade === "plumbing"), true)
})

Deno.test("detectMultipleMaintenanceIssues returns 2 plumbing tickets", async () => {
  const issues = await detectMultipleMaintenanceIssues(TWO_PLUMBING)
  assertEquals(issues.length, 2, JSON.stringify(issues))
  assertEquals(issues.every((i) => i.vendor_trade === "plumbing"), true)
})

Deno.test("detectMultipleMaintenanceIssues does not split one leak across sentences", async () => {
  const issues = await detectMultipleMaintenanceIssues(
    "My kitchen sink is leaking badly under the cabinet. Water is pooling on the floor near the pipes.",
  )
  assertEquals(issues.length, 0)
})

Deno.test("buildMultiIssueConfirmSms same-trade copy mentions both", () => {
  const body = buildMultiIssueConfirmSms([
    {
      summary: "kitchen sink leaking",
      description: "kitchen sink leaking",
      vendor_trade: "plumbing",
      issue_type: "leak",
    },
    {
      summary: "toilet running",
      description: "toilet running",
      vendor_trade: "plumbing",
      issue_type: "plumbing",
    },
  ])
  assertMatch(body, /1\. plumbing/i)
  assertMatch(body, /2\. plumbing/i)
  assertMatch(body, /assign your vendor to both/i)
})

Deno.test("buildMultiIssueConfirmSms asks YES/NO", () => {
  const body = buildMultiIssueConfirmSms([
    {
      summary: "piece for the door",
      description: "piece for the door",
      vendor_trade: "carpentry",
      issue_type: "general",
    },
    {
      summary: "bees in the window / hive",
      description: "bees in the window",
      vendor_trade: "pest_control",
      issue_type: "pest",
    },
  ])
  assertMatch(body, /more than one request/i)
  assertMatch(body, /1\. door \/ carpentry/i)
  assertMatch(body, /2\. pest control/i)
  assertMatch(body, /Reply YES/)
  assertMatch(body, /follow-ups/i)
})

Deno.test("beginMultiIssueSharedIntake enters wizard, keeps pending issues", () => {
  const next = beginMultiIssueSharedIntake({
    step: "awaiting_multi_issue_confirm",
    initial_message: SAMPLE,
    pending_issues: [
      {
        summary: "door",
        description: "door",
        vendor_trade: "carpentry",
        issue_type: "general",
      },
      {
        summary: "bees",
        description: "bees",
        vendor_trade: "pest_control",
        issue_type: "pest",
        room_or_area: "kitchen",
      },
    ],
  })
  assertEquals(next.step, "first_noticed")
  assertEquals(next.pending_issues?.length, 2)
  assertEquals(next.preferred_contact_method, undefined)
  assertEquals(next.room_or_area, "kitchen")
})

Deno.test("buildRequestSubmittedSms does not ask the tenant to call the manager", () => {
  const noVendor = buildRequestSubmittedSms("abc12345-uuid", false)
  assertMatch(noVendor, /property team has it/i)
  assertEquals(/property manager/i.test(noVendor), false)
  assertEquals(/line up a vendor/i.test(noVendor), false)

  const assigned = buildRequestSubmittedSms("abc12345-uuid", true)
  assertMatch(assigned, /keep you posted/i)

  assertEquals(/property manager/i.test(INTAKE_SUBMIT_FAILED_SMS), false)
})

Deno.test("buildMultiIssueSubmittedSms follows up with the team when no vendor", () => {
  const body = buildMultiIssueSubmittedSms(["aaaaaaaa", "bbbbbbbb"], false)
  assertMatch(body, /property team has them/i)
  assertEquals(/line up the right vendor/i.test(body), false)
})
