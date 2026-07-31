import { applyDomainToolResults } from "../../retrieval/applyDomainToolResults.ts"

Deno.test("applyDomainToolResults maps rank_vendors lookup to vendorBest", () => {
  const seed = applyDomainToolResults([
    {
      toolId: "rank_vendors",
      result: {
        toolId: "rank_vendors",
        available: true,
        found: true,
        metric: "overall_quality",
        bullets: ["Acme Plumbing"],
        citations: [],
        markdown: "## Vendors",
        ranked: [{ vendorId: "v1", name: "Acme Plumbing" }],
        params: { metric: "overall_quality" },
        lookup: {
          available: true,
          found: true,
          ranked: [{ vendorId: "v1", name: "Acme Plumbing" }],
          bullets: ["Acme Plumbing"],
          citations: [],
          markdown: "## Vendors",
        },
      },
    },
  ])

  if (!seed.vendorBest?.found) {
    throw new Error("expected vendorBest from rank_vendors lookup")
  }
  if (!seed.toolsCalled.includes("rank_vendors")) {
    throw new Error("expected rank_vendors in toolsCalled")
  }
})

Deno.test("applyDomainToolResults maps multiple live tools", () => {
  const seed = applyDomainToolResults([
    {
      toolId: "list_active_workflows",
      result: {
        toolId: "list_active_workflows",
        available: true,
        found: false,
        bullets: [],
        citations: [],
        markdown: "",
        facts: {
          activeCount: 0,
          escalatedCount: 0,
          awaitingDecisionCount: 0,
          byDomain: {},
          recentUloActions: [],
        },
        params: {},
      },
    },
    {
      toolId: "draft_communication",
      result: {
        toolId: "draft_communication",
        kind: "notice",
        markdown: "Draft body",
      },
    },
  ] as unknown as Parameters<typeof applyDomainToolResults>[0])

  if (!seed.activeWorkflowsResult) throw new Error("missing activeWorkflowsResult")
  if (!seed.draftCommunicationResult) throw new Error("missing draftCommunicationResult")
  if (seed.toolsCalled.length !== 2) {
    throw new Error(`expected 2 toolsCalled, got ${seed.toolsCalled.length}`)
  }
})

Deno.test("applyDomainToolResults maps extended domain tools", () => {
  const seed = applyDomainToolResults([
    {
      toolId: "get_recurring_repairs",
      result: {
        toolId: "get_recurring_repairs",
        available: true,
        found: true,
        bullets: ["HVAC recurring"],
        citations: [],
        markdown: "## Recurring",
        params: { organizationId: "org1" },
      },
    },
    {
      toolId: "get_missing_updates",
      result: {
        toolId: "get_missing_updates",
        available: true,
        found: true,
        bullets: ["WO-123 stale"],
        citations: [],
        markdown: "## Missing",
        params: { organizationId: "org1" },
      },
    },
  ] as unknown as Parameters<typeof applyDomainToolResults>[0])

  if (!seed.recurringRepairs?.found) throw new Error("missing recurringRepairs")
  if (!seed.missingUpdates?.found) throw new Error("missing missingUpdates")
  if (seed.toolsCalled.length !== 2) {
    throw new Error(`expected 2 toolsCalled, got ${seed.toolsCalled.length}`)
  }
})
