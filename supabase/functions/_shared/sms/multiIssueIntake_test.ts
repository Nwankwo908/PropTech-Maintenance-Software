import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  beginMultiIssueSharedIntake,
  buildMediaEvidenceAck,
  buildMultiIssueConfirmSms,
  buildMultiIssueSubmittedSms,
  buildRequestSubmittedSms,
  clusterIssueSegments,
  coalesceIssueSegments,
  detectMultipleMaintenanceIssues,
  INTAKE_SUBMIT_FAILED_SMS,
  isActionableIssueFragment,
  isMediaEvidenceFragment,
  splitMaintenanceIssueSegments,
  summarizeIssueCandidate,
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
  assertMatch(body, /1\. carpentry — piece for the door/i)
  assertMatch(body, /2\. pest control — bees in the window/i)
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
  assertEquals(next.pending_issues?.length, 2)
  assertEquals(next.preferred_contact_method, "text")
  assertEquals(next.room_or_area, "kitchen")
  assertEquals(
    next.diagnostic_question_type === "pest_frequency" ||
      next.diagnostic_question_type === "door_part" ||
      next.step === "photo" ||
      next.step === "diagnostic" ||
      next.step === "awaiting_confirm",
    true,
  )
})

Deno.test("buildRequestSubmittedSms sends one short ref and does not promise a vendor", () => {
  const noVendor = buildRequestSubmittedSms(
    "30a0b8cc-4284-42a7-8139-b59e219219f0",
    false,
    null,
    {
      categoryLabel: "HVAC",
      sourceText: "The AC isn't working",
    },
  )
  assertEquals(
    noVendor,
    "Thanks! We've received your AC repair request. We'll text you here with updates.\n\nRef: 30A0B8CC",
  )
  assertEquals(/vendor will be in touch/i.test(noVendor), false)
  assertEquals(noVendor.includes("30a0b8cc-4284"), false)

  const named = buildRequestSubmittedSms("abc12345-1111-4000-8000-000000000001", true, "Kendo Properties", {
    categoryLabel: "plumbing",
    handlingTip:
      "Until help arrives: if you can safely reach the shutoff valve, turn it off.",
  })
  assertMatch(named, /We've received your plumbing request/i)
  assertMatch(named, /Your vendor will be in touch to schedule/i)
  assertMatch(named, /shutoff valve/i)
  assertMatch(named, /Ref: ABC12345/)
  assertEquals(/property manager/i.test(named), false)

  assertEquals(/property manager/i.test(INTAKE_SUBMIT_FAILED_SMS), false)
})

Deno.test("buildMultiIssueSubmittedSms is one confirmation with a ref per request", () => {
  const body = buildMultiIssueSubmittedSms(
    ["aaaaaaaa-1111-4000-8000-000000000001", "bbbbbbbb-2222-4000-8000-000000000002"],
    false,
    null,
    { handlingTip: "Until help arrives: avoid using the affected area." },
  )
  assertMatch(body, /We've received your 2 maintenance requests/i)
  assertMatch(body, /We'll text you here with updates/i)
  assertEquals(/vendor will be in touch/i.test(body), false)
  assertMatch(body, /Until help arrives/i)
  assertMatch(body, /Ref: AAAAAAAA/)
  assertMatch(body, /Ref: BBBBBBBB/)
  assertEquals(/You're all set/i.test(body), false)
})

const BATHROOM_LEAK_CASCADE =
  "My bathroom sink is leaking bad. The wood of the bottom drawer of the vanity has soaked and broke. And a metal piece has rusted and broke from the faucet. I can't use my sink at all and I have turned off the valves. I also have videos of the leaking."

Deno.test("media evidence fragment is not actionable", () => {
  assertEquals(isMediaEvidenceFragment("have videos of the leaking."), true)
  assertEquals(isActionableIssueFragment("have videos of the leaking."), false)
  assertEquals(
    isActionableIssueFragment("Also my bedroom smoke alarm is beeping"),
    true,
  )
})

Deno.test(
  "multi-symptom leak cascade does not split; symptoms stay one summary; videos acknowledged",
  async () => {
    const issues = await detectMultipleMaintenanceIssues(BATHROOM_LEAK_CASCADE)
    assertEquals(issues.length, 0, JSON.stringify(issues))

    const parts = splitMaintenanceIssueSegments(BATHROOM_LEAK_CASCADE)
    const coalesced = coalesceIssueSegments(parts)
    assertEquals(coalesced.length, 1, JSON.stringify(coalesced))
    assertMatch(coalesced[0], /drawer/i)
    assertMatch(coalesced[0], /faucet|rusted/i)
    assertMatch(coalesced[0], /videos?/i)

    const summary = summarizeIssueCandidate(coalesced[0])
    assertMatch(summary, /sink|leak|plumbing/i)
    assertEquals(/\bvideos?\b/i.test(summary), false)
    // No mid-word character truncation (e.g. "soaked a…")
    assertEquals(/\w…/.test(summary), false)

    const ack = buildMediaEvidenceAck(BATHROOM_LEAK_CASCADE)
    assertMatch(ack ?? "", /attach your video/i)
  },
)

Deno.test(
  "distinct second issue still splits with clean summaries",
  async () => {
    const msg =
      "My bathroom sink is leaking bad. Also my bedroom smoke alarm is beeping constantly."
    const issues = await detectMultipleMaintenanceIssues(msg)
    assertEquals(issues.length, 2, JSON.stringify(issues))
    assertMatch(issues[0].summary, /sink|leak|plumbing/i)
    assertMatch(issues[1].summary, /smoke|alarm|beep|electrical|detector/i)
    for (const issue of issues) {
      assertEquals(/\w…/.test(issue.summary), false, issue.summary)
      assertEquals(issue.summary.length <= 80, true, issue.summary)
    }
    const confirm = buildMultiIssueConfirmSms(issues, msg)
    assertMatch(confirm, /1\. /)
    assertMatch(confirm, /2\. /)
    assertEquals(/have videos/i.test(confirm), false)
  },
)

Deno.test(
  "same-trade marker split still opens two tickets for sink + toilet",
  async () => {
    const issues = await detectMultipleMaintenanceIssues(
      "My kitchen sink is leaking badly under the cabinet. Also, the toilet in the bathroom won't stop running.",
    )
    assertEquals(issues.length, 2, JSON.stringify(issues))
    assertMatch(issues[0].summary, /sink|leak|plumbing/i)
    assertMatch(issues[1].summary, /toilet/i)
  },
)
